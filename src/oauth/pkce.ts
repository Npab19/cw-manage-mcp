import { createHash, randomBytes } from 'crypto';

export function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function generateVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

export function challengeFromVerifier(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}
