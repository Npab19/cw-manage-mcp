import type { Request, RequestHandler } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { SignJWT, jwtVerify, createLocalJWKSet, type JSONWebKeySet, type JWTPayload } from 'jose';
import { getKeys, getJwksDoc } from '../oauth/keys.js';
import {
  generateVerifier,
  challengeFromVerifier,
  base64UrlEncode,
} from '../oauth/pkce.js';
import { getPublicBaseUrl } from '../oauth/base-url.js';
import {
  getEntraEndpoints,
  exchangeCodeForToken,
  extractEmailFromIdToken,
  extractSubFromIdToken,
} from '../oauth/entra-client.js';
import { getOauthProvider, getConfig } from '../config.js';
import { getSql } from '../db.js';

const SESSION_COOKIE = 'mcp_admin_session';
const SESSION_TTL = '8h';
const ADMIN_AUDIENCE = 'mcp-admin';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: { sub: string; email: string };
    }
  }
}

interface PendingAdminLogin {
  verifier: string;
  returnTo: string;
  expiresAt: number;
}
const pendingLogins = new Map<string, PendingAdminLogin>();

function isAdminEmail(email: string, extra: string[]): boolean {
  const lower = email.toLowerCase();
  const fromEnv = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.includes(lower) || extra.map((e) => e.toLowerCase()).includes(lower);
}

async function getExtraAdminEmails(): Promise<string[]> {
  const value = await getConfig<string[]>('extra_admin_emails', () => []);
  return Array.isArray(value) ? value : [];
}

let jwks: ReturnType<typeof createLocalJWKSet> | null = null;
async function getLocalJwks() {
  if (jwks) return jwks;
  const doc = await getJwksDoc();
  jwks = createLocalJWKSet(doc as JSONWebKeySet);
  return jwks;
}

async function mintAdminSession(sub: string, email: string): Promise<string> {
  const { privateKey, kid } = await getKeys();
  return new SignJWT({ email, role: 'admin' })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuer(ADMIN_AUDIENCE)
    .setAudience(ADMIN_AUDIENCE)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(privateKey);
}

async function verifyAdminSession(token: string): Promise<JWTPayload | null> {
  try {
    const set = await getLocalJwks();
    const { payload } = await jwtVerify(token, set, {
      issuer: ADMIN_AUDIENCE,
      audience: ADMIN_AUDIENCE,
    });
    return payload;
  } catch {
    return null;
  }
}

function sessionCookieOptions(req: Request): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  const proto = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol || 'https';
  return {
    httpOnly: true,
    secure: proto === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  };
}

/**
 * Returns 200 + login link when no session, or attaches req.admin and
 * calls next() when the session is valid and the email is an admin.
 */
export const adminAuthMiddleware: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    redirectToLogin(req, res);
    return;
  }
  const payload = await verifyAdminSession(token);
  if (!payload || typeof payload.email !== 'string' || typeof payload.sub !== 'string') {
    redirectToLogin(req, res);
    return;
  }
  const extra = await getExtraAdminEmails();
  if (!isAdminEmail(payload.email, extra)) {
    res.status(403).render('403', { email: payload.email });
    return;
  }
  req.admin = { sub: payload.sub, email: payload.email.toLowerCase() };
  next();
};

function redirectToLogin(req: Request, res: Parameters<RequestHandler>[1]): void {
  const returnTo = req.originalUrl.startsWith('/admin') ? req.originalUrl : '/admin';
  const url = new URL('/admin/login', `${getPublicBaseUrl(req)}/`);
  url.searchParams.set('returnTo', returnTo);
  res.redirect(302, url.toString());
}

export const loginHandler: RequestHandler = async (req, res, next) => {
  try {
    const provider = await getOauthProvider();
    if (!provider) {
      res.status(503).send('OAuth provider not configured. Complete the setup wizard first.');
      return;
    }
    const endpoints = await getEntraEndpoints();
    const verifier = generateVerifier();
    const challenge = challengeFromVerifier(verifier);
    const state = randomUUID();
    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/admin';
    pendingLogins.set(state, {
      verifier,
      returnTo,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const url = new URL(endpoints.authorizationEndpoint);
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', `${getPublicBaseUrl(req)}/admin/auth/callback`);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'openid email profile offline_access');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('response_mode', 'query');
    res.redirect(302, url.toString());
  } catch (err) {
    next(err);
  }
};

export const callbackHandler: RequestHandler = async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
    if (error) {
      res.status(400).send(`Login failed: ${error} - ${error_description ?? ''}`);
      return;
    }
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }
    const pending = pendingLogins.get(state);
    pendingLogins.delete(state);
    if (!pending || pending.expiresAt < Date.now()) {
      res.status(400).send('Login state expired — try again');
      return;
    }
    const callbackUrl = `${getPublicBaseUrl(req)}/admin/auth/callback`;
    const token = await exchangeCodeForToken(code, callbackUrl, pending.verifier);
    if (!token.id_token) {
      res.status(500).send('IdP did not return an id_token');
      return;
    }
    const email = extractEmailFromIdToken(token.id_token);
    if (!email) {
      res.status(403).send('Identity token has no email claim');
      return;
    }
    const provider = await getOauthProvider();
    const allowed = provider?.allowedEmailDomains ?? [];
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || !allowed.includes(domain)) {
      res.status(403).render('403', { email });
      return;
    }
    const sub = extractSubFromIdToken(token.id_token) ?? email;
    const jwt = await mintAdminSession(sub, email);
    res.cookie(SESSION_COOKIE, jwt, sessionCookieOptions(req));
    res.redirect(302, pending.returnTo || '/admin');
  } catch (err) {
    next(err);
  }
};

export const logoutHandler: RequestHandler = (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.redirect(302, '/admin/login');
};

/**
 * Used by setup-wizard routes: a request is allowed if either it's
 * authenticated as an admin OR it carries the in-memory bootstrap code.
 */
export async function isRequestAdmin(req: Request): Promise<boolean> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return false;
  const payload = await verifyAdminSession(token);
  if (!payload || typeof payload.email !== 'string') return false;
  const extra = await getExtraAdminEmails();
  return isAdminEmail(payload.email, extra);
}

// Periodic GC for the in-memory login state.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingLogins) if (v.expiresAt < now) pendingLogins.delete(k);
}, 60_000).unref();

export { ADMIN_AUDIENCE };

// Stub used by the setup-wizard flow before sessions exist — verifies
// the random hex bootstrap code from the container logs.
let bootstrapCode: string | null = null;
export function generateBootstrapCode(): string {
  bootstrapCode = base64UrlEncode(randomBytes(16));
  return bootstrapCode;
}
export function consumeBootstrapCode(code: string): boolean {
  if (!bootstrapCode || code !== bootstrapCode) return false;
  bootstrapCode = null;
  return true;
}
export function bootstrapCodeMatches(code: string): boolean {
  return !!bootstrapCode && code === bootstrapCode;
}
