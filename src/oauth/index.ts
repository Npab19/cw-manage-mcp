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
  app.get(PROTECTED_RESOURCE_METADATA_PATH, protectedResourceMetadataHandler);
  if (!isOAuthConfigured()) return;
  app.get(AUTHORIZATION_SERVER_METADATA_PATH, authorizationServerMetadataHandler);
  app.get(JWKS_PATH, jwksHandler);
  app.post('/oauth/register', registerHandler);
  app.get('/oauth/authorize', authorizeHandler);
  app.get('/oauth/callback', callbackHandler);
  app.post('/oauth/token', tokenHandler);
}
