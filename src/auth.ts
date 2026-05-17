import { CwRequestContext } from './types.js';

/**
 * Basic-Auth header: Base64(companyId+publicKey:privateKey). clientId
 * comes from the request context, which is sourced from the config
 * helper (DB-or-env precedence).
 */
export function buildAuthHeaders(ctx: CwRequestContext): Record<string, string> {
  const raw = `${ctx.companyId}+${ctx.publicKey}:${ctx.privateKey}`;
  const encoded = Buffer.from(raw).toString('base64');

  return {
    Authorization: `Basic ${encoded}`,
    clientId: ctx.clientId,
    Accept: 'application/vnd.connectwise.com+json; version=2021.2',
    'Content-Type': 'application/json',
  };
}
