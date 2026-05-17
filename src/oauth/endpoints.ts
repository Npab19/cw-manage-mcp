import type { RequestHandler } from 'express';
import { SignJWT } from 'jose';
import { randomUUID, randomBytes } from 'crypto';
import {
  getEntraEndpoints,
  exchangeCodeForToken,
  extractEmailFromIdToken,
  extractSubFromIdToken,
} from './entra-client.js';
import {
  putPending,
  takePending,
  putCode,
  takeCode,
  putRefreshToken,
  getRefreshToken,
  revokeRefreshToken,
} from './store.js';
import { getKeys } from './keys.js';
import { generateVerifier, challengeFromVerifier, base64UrlEncode } from './pkce.js';
import { getPublicBaseUrl } from './base-url.js';

const STATIC_CLIENT_ID = 'mcp-public-client';

function getAllowedDomains(): string[] {
  const raw = process.env.OAUTH_ALLOWED_EMAIL_DOMAINS ?? '';
  return raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

function isAllowedEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && getAllowedDomains().includes(domain);
}

export const registerHandler: RequestHandler = (req, res) => {
  const body = (req.body ?? {}) as {
    redirect_uris?: unknown;
    client_name?: unknown;
    scope?: unknown;
  };
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : [];
  if (redirectUris.length === 0) {
    res
      .status(400)
      .json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' });
    return;
  }
  res.status(201).json({
    client_id: STATIC_CLIENT_ID,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: typeof body.client_name === 'string' ? body.client_name : 'MCP Client',
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: typeof body.scope === 'string' ? body.scope : 'mcp',
  });
};

function redirectWithError(
  res: Parameters<RequestHandler>[1],
  redirectUri: string,
  error: string,
  description: string | undefined,
  state: string | undefined,
): void {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  res.redirect(302, url.toString());
}

export const authorizeHandler: RequestHandler = async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;

    if (!q.redirect_uri) {
      res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is required' });
      return;
    }
    if (q.response_type !== 'code') {
      redirectWithError(res, q.redirect_uri, 'unsupported_response_type', 'Only "code" is supported', q.state);
      return;
    }
    if (!q.state || !q.code_challenge) {
      redirectWithError(res, q.redirect_uri, 'invalid_request', 'state and code_challenge are required', q.state);
      return;
    }
    if (q.code_challenge_method && q.code_challenge_method !== 'S256') {
      redirectWithError(res, q.redirect_uri, 'invalid_request', 'Only S256 PKCE method is supported', q.state);
      return;
    }

    const ourVerifier = generateVerifier();
    const ourChallenge = challengeFromVerifier(ourVerifier);
    const ourState = randomUUID();

    putPending(ourState, {
      claudeRedirectUri: q.redirect_uri,
      claudeState: q.state,
      claudeCodeChallenge: q.code_challenge,
      claudeCodeChallengeMethod: q.code_challenge_method ?? 'S256',
      claudeClientId: q.client_id ?? STATIC_CLIENT_ID,
      ourPkceVerifier: ourVerifier,
      scope: q.scope ?? 'mcp',
    });

    const endpoints = await getEntraEndpoints();
    const callbackUrl = `${getPublicBaseUrl(req)}/oauth/callback`;
    const entraClientId = process.env.OAUTH_CLIENT_ID;
    if (!entraClientId) {
      res.status(500).send('Server misconfigured: OAUTH_CLIENT_ID not set');
      return;
    }
    const url = new URL(endpoints.authorizationEndpoint);
    url.searchParams.set('client_id', entraClientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('state', ourState);
    url.searchParams.set('scope', 'openid email profile offline_access');
    url.searchParams.set('code_challenge', ourChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('response_mode', 'query');

    res.redirect(302, url.toString());
  } catch (err) {
    next(err);
  }
};

export const callbackHandler: RequestHandler = async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    if (!q.state) {
      res.status(400).send('Missing state');
      return;
    }
    const pending = takePending(q.state);
    if (!pending) {
      res.status(400).send('Invalid or expired state');
      return;
    }

    if (q.error) {
      redirectWithError(
        res,
        pending.claudeRedirectUri,
        q.error,
        q.error_description,
        pending.claudeState,
      );
      return;
    }
    if (!q.code) {
      redirectWithError(
        res,
        pending.claudeRedirectUri,
        'invalid_request',
        'IdP returned no code',
        pending.claudeState,
      );
      return;
    }

    const callbackUrl = `${getPublicBaseUrl(req)}/oauth/callback`;
    let entraToken;
    try {
      entraToken = await exchangeCodeForToken(q.code, callbackUrl, pending.ourPkceVerifier);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Token exchange failed';
      console.error(`Entra token exchange failed: ${msg}`);
      redirectWithError(res, pending.claudeRedirectUri, 'server_error', msg, pending.claudeState);
      return;
    }

    if (!entraToken.id_token) {
      redirectWithError(
        res,
        pending.claudeRedirectUri,
        'server_error',
        'IdP did not return an id_token',
        pending.claudeState,
      );
      return;
    }

    const email = extractEmailFromIdToken(entraToken.id_token);
    if (!email) {
      redirectWithError(
        res,
        pending.claudeRedirectUri,
        'access_denied',
        'Identity token has no email claim',
        pending.claudeState,
      );
      return;
    }
    if (!isAllowedEmail(email)) {
      redirectWithError(
        res,
        pending.claudeRedirectUri,
        'access_denied',
        `Email '${email}' is not in an allowed domain`,
        pending.claudeState,
      );
      return;
    }
    const sub = extractSubFromIdToken(entraToken.id_token) ?? email;

    const mcpCode = base64UrlEncode(randomBytes(32));
    putCode(mcpCode, {
      email: email.toLowerCase(),
      sub,
      redirectUri: pending.claudeRedirectUri,
      clientId: pending.claudeClientId,
      codeChallenge: pending.claudeCodeChallenge,
      codeChallengeMethod: pending.claudeCodeChallengeMethod,
      scope: pending.scope,
    });

    const redirect = new URL(pending.claudeRedirectUri);
    redirect.searchParams.set('code', mcpCode);
    redirect.searchParams.set('state', pending.claudeState);
    res.redirect(302, redirect.toString());
  } catch (err) {
    next(err);
  }
};

async function mintAccessToken(opts: {
  email: string;
  sub: string;
  scope: string;
  baseUrl: string;
}): Promise<string> {
  const { privateKey, kid } = await getKeys();
  return new SignJWT({ email: opts.email, scope: opts.scope })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'at+jwt' })
    .setIssuer(opts.baseUrl)
    .setAudience(opts.baseUrl)
    .setSubject(opts.sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

export const tokenHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const baseUrl = getPublicBaseUrl(req);

    if (body.grant_type === 'authorization_code') {
      const { code, redirect_uri, code_verifier } = body;
      if (!code || !redirect_uri || !code_verifier) {
        res
          .status(400)
          .json({ error: 'invalid_request', error_description: 'code, redirect_uri, code_verifier required' });
        return;
      }
      const issued = takeCode(code);
      if (!issued) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired or already used' });
        return;
      }
      if (issued.redirectUri !== redirect_uri) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        return;
      }
      if (challengeFromVerifier(code_verifier) !== issued.codeChallenge) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
        return;
      }

      const accessToken = await mintAccessToken({
        email: issued.email,
        sub: issued.sub,
        scope: issued.scope,
        baseUrl,
      });
      const refreshToken = base64UrlEncode(randomBytes(32));
      putRefreshToken(refreshToken, {
        email: issued.email,
        sub: issued.sub,
        clientId: issued.clientId,
        scope: issued.scope,
      });
      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: issued.scope,
      });
      return;
    }

    if (body.grant_type === 'refresh_token') {
      const { refresh_token } = body;
      if (!refresh_token) {
        res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
        return;
      }
      const stored = getRefreshToken(refresh_token);
      if (!stored) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or expired refresh token' });
        return;
      }
      revokeRefreshToken(refresh_token);
      const newRefresh = base64UrlEncode(randomBytes(32));
      putRefreshToken(newRefresh, {
        email: stored.email,
        sub: stored.sub,
        clientId: stored.clientId,
        scope: stored.scope,
      });
      const accessToken = await mintAccessToken({
        email: stored.email,
        sub: stored.sub,
        scope: stored.scope,
        baseUrl,
      });
      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: newRefresh,
        scope: stored.scope,
      });
      return;
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (err) {
    next(err);
  }
};
