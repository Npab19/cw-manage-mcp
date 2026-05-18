import type { RequestHandler } from 'express';
import {
  looksLikeServiceAccountKey,
  verifyServiceAccountKey,
} from '../services/service-accounts.js';

/**
 * Inspects the Authorization header. If it carries a service-account
 * token (sa_<prefix>_<secret>), verifies it and populates req.identity
 * directly so the OAuth and identity-resolver middlewares can skip the
 * JWT path entirely. Anything else (no header / JWT bearer) is passed
 * through untouched.
 */
export const serviceAccountAuthMiddleware: RequestHandler = async (req, res, next) => {
  const header = req.get('authorization') ?? req.get('Authorization');
  if (!header) return next();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !match[1]) return next();
  const token = match[1].trim();
  if (!looksLikeServiceAccountKey(token)) return next();

  const sa = await verifyServiceAccountKey(token);
  if (!sa) {
    res.status(401).json({
      error: 'invalid_token',
      error_description: 'Service-account key is invalid, revoked, or unknown.',
    });
    return;
  }

  req.identity = {
    oauthSub: `sa:${sa.id}`,
    oauthEmail: `${sa.name}@service-account`,
    cwMember: null,
    policy: {
      allowedTools: new Set(sa.allowedTools),
      fieldProjections: {},
    },
    isAdmin: false,
    serviceAccount: { id: sa.id, name: sa.name },
  };
  // Also expose on req.oauth so downstream logging (request-context
  // middleware) records the service-account identity consistently.
  req.oauth = { sub: `sa:${sa.id}`, email: `${sa.name}@service-account`, scope: [] };
  next();
};
