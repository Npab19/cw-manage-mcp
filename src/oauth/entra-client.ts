import { decodeJwt } from 'jose';
import { getOauthProvider } from '../config.js';

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

const endpointsCacheByIssuer = new Map<string, EntraEndpoints>();

const IDP_FETCH_TIMEOUT_MS = 10_000;

/**
 * undici collapses every transport-level failure into a bare `TypeError: fetch
 * failed` and hides the real reason (DNS, TLS, proxy, timeout) on `.cause`.
 * Unwrap it so the log names the host and the errno instead of a stack trace.
 */
async function fetchIdp(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(IDP_FETCH_TIMEOUT_MS) });
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    const detail =
      cause instanceof Error
        ? `${(cause as NodeJS.ErrnoException).code ?? cause.name}: ${cause.message}`
        : (err as Error).message;
    throw new Error(
      `Cannot reach the identity provider at ${url} — ${detail}. ` +
        'Check that the issuer URL is correct and that this container has outbound HTTPS/DNS access.',
      { cause: err },
    );
  }
}

export async function getEntraEndpoints(): Promise<EntraEndpoints> {
  const provider = await getOauthProvider();
  const issuer = provider?.issuer ?? '';
  if (!issuer) throw new Error('OAuth issuer is not configured (set OAUTH_ISSUER or run the setup wizard)');
  const cached = endpointsCacheByIssuer.get(issuer);
  if (cached) return cached;
  const url = `${issuer}/.well-known/openid-configuration`;
  const resp = await fetchIdp(url);
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
  const endpoints: EntraEndpoints = {
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
    issuer: doc.issuer,
  };
  endpointsCacheByIssuer.set(issuer, endpoints);
  return endpoints;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<EntraTokenResponse> {
  const endpoints = await getEntraEndpoints();
  const provider = await getOauthProvider();
  const clientId = provider?.clientId;
  const clientSecret = provider?.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('OAuth provider clientId/clientSecret are not configured');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const resp = await fetchIdp(endpoints.tokenEndpoint, {
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
