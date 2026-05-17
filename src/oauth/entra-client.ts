import { decodeJwt } from 'jose';

interface EntraEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  issuer: string;
}

interface EntraTokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

let endpointsCache: EntraEndpoints | null = null;

export async function getEntraEndpoints(): Promise<EntraEndpoints> {
  if (endpointsCache) return endpointsCache;
  const issuer = (process.env.OAUTH_ISSUER ?? '').replace(/\/$/, '');
  if (!issuer) throw new Error('OAUTH_ISSUER is not set');
  const url = `${issuer}/.well-known/openid-configuration`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Entra discovery failed: ${resp.status} ${resp.statusText} (${url})`);
  }
  const doc = (await resp.json()) as {
    authorization_endpoint?: string;
    token_endpoint?: string;
    jwks_uri?: string;
    issuer?: string;
  };
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri || !doc.issuer) {
    throw new Error(`Entra discovery doc missing required fields (${url})`);
  }
  endpointsCache = {
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
    issuer: doc.issuer,
  };
  return endpointsCache;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<EntraTokenResponse> {
  const endpoints = await getEntraEndpoints();
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET must be set');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const resp = await fetch(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Entra token exchange failed: ${resp.status} ${text}`);
  }
  return (await resp.json()) as EntraTokenResponse;
}

export function extractEmailFromIdToken(idToken: string): string | null {
  const payload = decodeJwt(idToken);
  if (typeof payload.email === 'string') return payload.email;
  const preferred = (payload as { preferred_username?: unknown }).preferred_username;
  if (typeof preferred === 'string' && preferred.includes('@')) return preferred;
  return null;
}

export function extractSubFromIdToken(idToken: string): string | null {
  const payload = decodeJwt(idToken);
  if (typeof payload.sub === 'string') return payload.sub;
  const oid = (payload as { oid?: unknown }).oid;
  if (typeof oid === 'string') return oid;
  return null;
}
