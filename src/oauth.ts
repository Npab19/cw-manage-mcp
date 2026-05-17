import type { RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

export function isOAuthConfigured(): boolean {
  return !!process.env.OAUTH_ISSUER;
}

function getIssuer(): string {
  const issuer = process.env.OAUTH_ISSUER;
  if (!issuer) {
    throw new Error('OAUTH_ISSUER is not set');
  }
  return issuer.replace(/\/$/, '');
}

function getAudience(): string {
  const audience = process.env.OAUTH_AUDIENCE;
  if (!audience) {
    throw new Error('OAUTH_AUDIENCE is not set');
  }
  return audience;
}

function getRequiredScope(): string | null {
  return process.env.OAUTH_REQUIRED_SCOPE ?? null;
}

let resolvedJwksUri: string | null = null;
async function resolveJwksUri(): Promise<string> {
  if (resolvedJwksUri) return resolvedJwksUri;
  const override = process.env.OAUTH_JWKS_URI;
  if (override) {
    resolvedJwksUri = override;
    return resolvedJwksUri;
  }
  const issuer = getIssuer();
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const resp = await fetch(discoveryUrl);
  if (!resp.ok) {
    throw new Error(`OAuth discovery failed: ${resp.status} ${resp.statusText} (${discoveryUrl})`);
  }
  const doc = (await resp.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) {
    throw new Error(`OAuth discovery document missing jwks_uri (${discoveryUrl})`);
  }
  resolvedJwksUri = doc.jwks_uri;
  return resolvedJwksUri;
}

let jwksGetter: ReturnType<typeof createRemoteJWKSet> | null = null;
async function getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (jwksGetter) return jwksGetter;
  const uri = await resolveJwksUri();
  jwksGetter = createRemoteJWKSet(new URL(uri), {
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
  return jwksGetter;
}

function buildResourceUrl(req: Parameters<RequestHandler>[0]): string {
  const host = req.get('host') ?? 'localhost';
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = forwardedProto?.split(',')[0]?.trim() || req.protocol || 'https';
  return `${proto}://${host}`;
}

function metadataUrl(req: Parameters<RequestHandler>[0]): string {
  return `${buildResourceUrl(req)}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

function sendUnauthorized(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  error: 'invalid_token' | 'insufficient_scope' | 'invalid_request',
  description?: string,
): void {
  const parts = [
    `Bearer resource_metadata="${metadataUrl(req)}"`,
    `error="${error}"`,
  ];
  if (description) {
    parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  }
  res.setHeader('WWW-Authenticate', parts.join(', '));
  res.status(401).json({ error, error_description: description });
}

function extractScopes(payload: JWTPayload): string[] {
  if (typeof payload.scope === 'string') {
    return payload.scope.split(' ').filter(Boolean);
  }
  if (Array.isArray((payload as { scp?: unknown }).scp)) {
    return ((payload as { scp: unknown[] }).scp).filter(
      (s): s is string => typeof s === 'string',
    );
  }
  return [];
}

export const oauthMiddleware: RequestHandler = async (req, res, next) => {
  if (!isOAuthConfigured()) {
    return next();
  }

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

  try {
    const jwks = await getJwks();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: getIssuer(),
      audience: getAudience(),
    });

    const scopes = extractScopes(payload);
    const requiredScope = getRequiredScope();
    if (requiredScope && !scopes.includes(requiredScope)) {
      sendUnauthorized(req, res, 'insufficient_scope', `Required scope: ${requiredScope}`);
      return;
    }

    req.oauth = {
      sub: typeof payload.sub === 'string' ? payload.sub : null,
      email: typeof (payload as { email?: unknown }).email === 'string'
        ? (payload as { email: string }).email
        : null,
      scope: scopes,
    };
    return next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    sendUnauthorized(req, res, 'invalid_token', message);
    return;
  }
};

export const protectedResourceMetadataHandler: RequestHandler = (req, res) => {
  if (!isOAuthConfigured()) {
    res.status(404).json({ error: 'OAuth not configured on this server' });
    return;
  }
  const requiredScope = getRequiredScope();
  res.json({
    resource: buildResourceUrl(req),
    authorization_servers: [getIssuer()],
    scopes_supported: requiredScope ? [requiredScope] : [],
    bearer_methods_supported: ['header'],
    resource_documentation: `${buildResourceUrl(req)}/`,
  });
};

export { PROTECTED_RESOURCE_METADATA_PATH };
