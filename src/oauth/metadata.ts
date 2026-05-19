import type { RequestHandler } from 'express';
import { getJwksDoc } from './keys.js';
import { getPublicBaseUrl } from './base-url.js';
import { isOAuthConfigured } from './middleware.js';
import { getOauthProvider } from '../config.js';

export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
export const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';
export const JWKS_PATH = '/.well-known/jwks.json';

export const protectedResourceMetadataHandler: RequestHandler = async (req, res) => {
  // Accept either env (OAUTH_ISSUER) or wizard-stored config — both
  // represent a configured OAuth provider.
  if (!isOAuthConfigured() && !(await getOauthProvider())) {
    res.status(404).json({ error: 'OAuth not configured on this server' });
    return;
  }
  const base = getPublicBaseUrl(req);
  res.json({
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    resource_documentation: `${base}/`,
  });
};

export const authorizationServerMetadataHandler: RequestHandler = (req, res) => {
  const base = getPublicBaseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    jwks_uri: `${base}${JWKS_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  });
};

export const jwksHandler: RequestHandler = async (_req, res, next) => {
  try {
    const doc = await getJwksDoc();
    res.json(doc);
  } catch (err) {
    next(err);
  }
};
