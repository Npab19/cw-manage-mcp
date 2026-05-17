import { generateKeyPair, exportJWK, importJWK, type JWK } from 'jose';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

interface PersistedKeys {
  privateJwk: JWK;
  publicJwk: JWK;
  kid: string;
}

interface ResolvedKeys {
  privateKey: PrivateKey;
  publicJwk: JWK;
  kid: string;
}

let keysPromise: Promise<ResolvedKeys> | null = null;

function keyFilePath(): string {
  return process.env.OAUTH_KEY_FILE ?? '/data/oauth-keys.json';
}

async function loadFromDisk(): Promise<PersistedKeys | null> {
  try {
    const data = await fs.readFile(keyFilePath(), 'utf8');
    return JSON.parse(data) as PersistedKeys;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function persistToDisk(keys: PersistedKeys): Promise<void> {
  const file = keyFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(keys), { mode: 0o600 });
}

async function computeKeys(): Promise<ResolvedKeys> {
  let persisted = await loadFromDisk();
  if (!persisted) {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    const privateJwk = await exportJWK(privateKey);
    const kid = randomUUID();
    publicJwk.kid = kid;
    publicJwk.use = 'sig';
    publicJwk.alg = 'RS256';
    privateJwk.kid = kid;
    privateJwk.alg = 'RS256';
    persisted = { privateJwk, publicJwk, kid };
    await persistToDisk(persisted);
    console.log(`Generated new OAuth signing key (kid=${kid}) at ${keyFilePath()}`);
  }
  const privateKey = (await importJWK(persisted.privateJwk, 'RS256')) as PrivateKey;
  return { privateKey, publicJwk: persisted.publicJwk, kid: persisted.kid };
}

export function getKeys(): Promise<ResolvedKeys> {
  if (!keysPromise) keysPromise = computeKeys();
  return keysPromise;
}

export async function getJwksDoc(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getKeys();
  return { keys: [publicJwk] };
}
