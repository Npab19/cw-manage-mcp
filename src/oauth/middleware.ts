import type { RequestHandler } from 'express';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { getJwksDoc } from './keys.js';
import { getPublicBaseUrl } from './base-url.js';
import { getOauthProvider } from '../config.js';

const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

export function isOAuthConfigured(): boolean {
  return !!process.env.OAUTH_ISSUER;
}

let jwksGetter: ReturnType<typeof createLocalJWKSet> | null = null;
async function getJwks() {
  if (jwksGetter) return jwksGetter;
  const doc = await getJwksDoc();
  jwksGetter = createLocalJWKSet(doc as JSONWebKeySet);
  return jwksGetter;
}

function sendUnauthorized(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  error: 'invalid_token' | 'invalid_request',
  description?: string,
): void {
  const metadataUrl = `${getPublicBaseUrl(req)}${PROTECTED_RESOURCE_METADATA_PATH}`;
  const parts = [`Bearer resource_metadata="${metadataUrl}"`, `error="${error}"`];
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  res.setHeader('WWW-Authenticate', parts.join(', '));
  res.status(401).json({ error, error_description: description });
}

function sendForbidden(res: Parameters<RequestHandler>[1], description: string): void {
  res.status(403).json({ error: 'forbidden', error_description: description });
}

async function getAllowedDomains(): Promise<string[]> {
  const provider = await getOauthProvider();
  return provider?.allowedEmailDomains ?? [];
}

export const oauthMiddleware: RequestHandler = async (req, res, next) => {
  if (!isOAuthConfigured()) return next();
  // Service-account auth (if applicable) already populated req.identity.
  if (req.identity) return next();

  const authHeader = req.get('authorization') ?? req.get('Authorization');
  if (!authHeader) {
    sendUnauthorized(req, res, 'invalid_request', 'Missing Authorization header');
    return;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match || !match[1]) {
    sendUnauthorized(req, res, 'invalid_request', 'Authorization header must use Bearer scheme');
    return;
  }
  const token = match[1].trim();

  const baseUrl = getPublicBaseUrl(req);
  let payload: JWTPayload;
  try {
    const jwks = await getJwks();
    const result = await jwtVerify(token, jwks, {
      issuer: baseUrl,
      audience: baseUrl,
    });
    payload = result.payload;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token verification failed';
    sendUnauthorized(req, res, 'invalid_token', msg);
    return;
  }

  const email = typeof payload.email === 'string' ? payload.email : null;
  if (!email) {
    sendForbidden(res, 'Token has no email claim');
    return;
  }
  const allowed = await getAllowedDomains();
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain || !allowed.includes(domain)) {
    sendForbidden(res, `Email '${email}' is not in an allowed domain (${allowed.join(', ')})`);
    return;
  }

  req.oauth = {
    sub: typeof payload.sub === 'string' ? payload.sub : null,
    email: email.toLowerCase(),
    scope: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
  };
  return next();
};
