import type { Express } from 'express';
import {
  protectedResourceMetadataHandler,
  authorizationServerMetadataHandler,
  jwksHandler,
  PROTECTED_RESOURCE_METADATA_PATH,
  AUTHORIZATION_SERVER_METADATA_PATH,
  JWKS_PATH,
} from './metadata.js';
import {
  registerHandler,
  authorizeHandler,
  callbackHandler,
  tokenHandler,
} from './endpoints.js';
import { oauthMiddleware, isOAuthConfigured } from './middleware.js';

export { oauthMiddleware, isOAuthConfigured, PROTECTED_RESOURCE_METADATA_PATH };

export function registerOAuthRoutes(app: Express): void {
  // Register all OAuth routes unconditionally. The handlers themselves
  // load the provider config (env OR wizard-stored DB row) at request
  // time, so wizard-only deployments (where OAUTH_ISSUER is unset in env
  // but stored in dashboard_settings) still expose a working OAuth surface.
  // Startup asserts OAuth is configured via either path before listen().
  app.get(PROTECTED_RESOURCE_METADATA_PATH, protectedResourceMetadataHandler);
  app.get(AUTHORIZATION_SERVER_METADATA_PATH, authorizationServerMetadataHandler);
  app.get(JWKS_PATH, jwksHandler);
  app.post('/oauth/register', registerHandler);
  app.get('/oauth/authorize', authorizeHandler);
  app.get('/oauth/callback', callbackHandler);
  app.post('/oauth/token', tokenHandler);
}
