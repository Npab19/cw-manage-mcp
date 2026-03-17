import { CwRequestContext } from './types.js';

/**
 * Constructs the HTTP headers required by the ConnectWise Manage API.
 *
 * Basic Auth format: Base64(companyId+publicKey:privateKey)
 */
export function buildAuthHeaders(ctx: CwRequestContext): Record<string, string> {
  const raw = `${ctx.companyId}+${ctx.publicKey}:${ctx.privateKey}`;
  const encoded = Buffer.from(raw).toString('base64');

  return {
    Authorization: `Basic ${encoded}`,
    clientId: process.env.CW_CLIENT_ID!,
    Accept: 'application/vnd.connectwise.com+json; version=2021.2',
    'Content-Type': 'application/json',
  };
}
