import type { Request } from 'express';

export function getPublicBaseUrl(req: Request): string {
  const envBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (envBase) return envBase;
  const host = req.get('host') ?? 'localhost';
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = forwardedProto?.split(',')[0]?.trim() || req.protocol || 'https';
  return `${proto}://${host}`;
}
