import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import {
  adminAuthMiddleware,
  loginHandler,
  callbackHandler,
  logoutHandler,
} from './auth.js';
import {
  setupGetHandler,
  setupPostHandler,
  testCwConnectionHandler,
} from './setup.js';
import {
  settingsGetHandler,
  updateCwConnectionHandler,
  updateOauthProviderHandler,
  testCwConnectionAuthedHandler,
} from './settings.js';
import { auditLogGetHandler, auditLogRowsHandler, auditLogCsvHandler } from './audit-log.js';
import {
  usersGetHandler,
  usersSyncHandler,
  usersMapHandler,
  usersUnmapHandler,
} from './users.js';
import {
  permissionsListHandler,
  permissionsEditHandler,
  permissionsUpdateHandler,
  permissionsResyncHandler,
} from './permissions.js';

const __filename = fileURLToPath(import.meta.url);
const ADMIN_DIR = path.dirname(__filename);

export const ADMIN_VIEWS_DIR = path.join(ADMIN_DIR, 'views');
export const ADMIN_STATIC_DIR = path.join(ADMIN_DIR, 'static');

export function buildAdminRouter(): Router {
  const router = Router();

  router.use('/static', express.static(ADMIN_STATIC_DIR, { maxAge: '1h' }));

  router.get('/setup', setupGetHandler);
  router.post('/setup', setupPostHandler);
  router.post('/setup/test-cw', testCwConnectionHandler);

  router.get('/login', (req, res, next) => {
    if (typeof req.query.returnTo === 'string') {
      loginHandler(req, res, next);
    } else {
      res.render('login', { title: 'Sign in', returnTo: '/admin' });
    }
  });
  router.get('/auth/callback', callbackHandler);
  router.get('/logout', logoutHandler);

  router.use(adminAuthMiddleware);

  router.get('/', (req, res) => {
    res.render('index', { title: 'Dashboard', admin: req.admin });
  });

  router.get('/settings', settingsGetHandler);
  router.post('/settings/cw-connection', updateCwConnectionHandler);
  router.post('/settings/cw-connection/test', testCwConnectionAuthedHandler);
  router.post('/settings/oauth-provider', updateOauthProviderHandler);

  router.get('/audit-log', auditLogGetHandler);
  router.get('/audit-log/rows', auditLogRowsHandler);
  router.get('/audit-log.csv', auditLogCsvHandler);

  router.get('/users', usersGetHandler);
  router.post('/users/sync', usersSyncHandler);
  router.post('/users/map', usersMapHandler);
  router.post('/users/unmap', usersUnmapHandler);

  router.get('/permissions', permissionsListHandler);
  router.get('/permissions/:roleId', permissionsEditHandler);
  router.post('/permissions/:roleId', permissionsUpdateHandler);
  router.post('/permissions/:roleId/resync', permissionsResyncHandler);

  return router;
}
