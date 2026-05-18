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
import {
  contextIndexHandler,
  contextRolesListHandler,
  contextUsersListHandler,
  contextEditorHandler,
  contextSaveHandler,
  contextRollbackHandler,
  contextPreviewHandler,
} from './context.js';
import {
  aliasesGetHandler,
  aliasCreateHandler,
  aliasDeleteHandler,
  deprecatedBoardAddHandler,
  deprecatedBoardDeleteHandler,
} from './aliases.js';
import {
  exclusionsGetHandler,
  exclusionAddHandler,
  exclusionDeleteHandler,
} from './exclusions.js';
import {
  serviceAccountsGetHandler,
  serviceAccountCreateHandler,
  serviceAccountRevokeHandler,
} from './service-accounts.js';

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

  // Context: index + per-scope list/edit/save/rollback + preview.
  // Route ordering matters: /preview must precede /:scope param matchers.
  router.get('/context', contextIndexHandler);
  router.get('/context/preview', contextPreviewHandler);
  router.get('/context/roles', contextRolesListHandler);
  router.get('/context/users', contextUsersListHandler);
  router.get('/context/:scope(global)', contextEditorHandler);
  router.post('/context/:scope(global)', contextSaveHandler);
  router.post('/context/:scope(global)/rollback/:versionId', contextRollbackHandler);
  router.get('/context/:scope(roles)/:roleName', contextEditorHandler);
  router.post('/context/:scope(roles)/:roleName', contextSaveHandler);
  router.post('/context/:scope(roles)/:roleName/rollback/:versionId', contextRollbackHandler);
  router.get('/context/:scope(users)/:email', contextEditorHandler);
  router.post('/context/:scope(users)/:email', contextSaveHandler);
  router.post('/context/:scope(users)/:email/rollback/:versionId', contextRollbackHandler);

  router.get('/aliases', aliasesGetHandler);
  router.post('/aliases', aliasCreateHandler);
  router.post('/aliases/:name/delete', aliasDeleteHandler);
  router.post('/aliases/deprecated', deprecatedBoardAddHandler);
  router.post('/aliases/deprecated/:boardId/delete', deprecatedBoardDeleteHandler);

  router.get('/exclusions', exclusionsGetHandler);
  router.post('/exclusions', exclusionAddHandler);
  router.post('/exclusions/:id/delete', exclusionDeleteHandler);

  router.get('/service-accounts', serviceAccountsGetHandler);
  router.post('/service-accounts', serviceAccountCreateHandler);
  router.post('/service-accounts/:id/revoke', serviceAccountRevokeHandler);

  return router;
}
