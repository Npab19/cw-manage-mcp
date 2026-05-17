interface PendingAuth {
  claudeRedirectUri: string;
  claudeState: string;
  claudeCodeChallenge: string;
  claudeCodeChallengeMethod: string;
  claudeClientId: string;
  ourPkceVerifier: string;
  scope: string;
  expiresAt: number;
}

interface IssuedCode {
  email: string;
  sub: string;
  redirectUri: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  expiresAt: number;
}

interface RefreshTokenRecord {
  email: string;
  sub: string;
  clientId: string;
  scope: string;
  expiresAt: number;
}

const TEN_MIN_MS = 10 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const pending = new Map<string, PendingAuth>();
const codes = new Map<string, IssuedCode>();
const refreshTokens = new Map<string, RefreshTokenRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
  for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k);
  for (const [k, v] of refreshTokens) if (v.expiresAt < now) refreshTokens.delete(k);
}, 60_000).unref();

export function putPending(key: string, data: Omit<PendingAuth, 'expiresAt'>): void {
  pending.set(key, { ...data, expiresAt: Date.now() + TEN_MIN_MS });
}

export function takePending(key: string): PendingAuth | null {
  const v = pending.get(key);
  pending.delete(key);
  if (!v || v.expiresAt < Date.now()) return null;
  return v;
}

export function putCode(key: string, data: Omit<IssuedCode, 'expiresAt'>): void {
  codes.set(key, { ...data, expiresAt: Date.now() + TEN_MIN_MS });
}

export function takeCode(key: string): IssuedCode | null {
  const v = codes.get(key);
  codes.delete(key);
  if (!v || v.expiresAt < Date.now()) return null;
  return v;
}

export function putRefreshToken(token: string, data: Omit<RefreshTokenRecord, 'expiresAt'>): void {
  refreshTokens.set(token, { ...data, expiresAt: Date.now() + THIRTY_DAYS_MS });
}

export function getRefreshToken(token: string): RefreshTokenRecord | null {
  const v = refreshTokens.get(token);
  if (!v) return null;
  if (v.expiresAt < Date.now()) {
    refreshTokens.delete(token);
    return null;
  }
  return v;
}

export function revokeRefreshToken(token: string): void {
  refreshTokens.delete(token);
}
