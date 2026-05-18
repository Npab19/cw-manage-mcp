import type { ResolvedIdentity } from './identity-resolver.js';

/**
 * Removes the path described by `segments` from `value`. The path
 * grammar:
 *   - "field"            -> top-level field
 *   - "obj.field"        -> nested
 *   - "arr[]"            -> the array itself (rare; usually combined)
 *   - "arr[].field"      -> each element's `field`
 *   - "tickets[].notes[].text" -> nested arrays
 *
 * Mutates `value` in place. Silently no-ops when the path doesn't
 * resolve (missing keys, wrong types).
 */
function applyOnePath(value: unknown, segments: string[]): void {
  if (segments.length === 0 || !value || typeof value !== 'object') return;
  const head = segments[0]!;
  const rest = segments.slice(1);
  const arrayMatch = /^(.+)\[\]$/.exec(head);

  if (arrayMatch) {
    const field = arrayMatch[1]!;
    const arr = (value as Record<string, unknown>)[field];
    if (rest.length === 0) {
      // "arr[]" with no tail: delete the array itself.
      delete (value as Record<string, unknown>)[field];
      return;
    }
    if (Array.isArray(arr)) {
      for (const item of arr) applyOnePath(item, rest);
    }
    return;
  }

  if (rest.length === 0) {
    delete (value as Record<string, unknown>)[head];
    return;
  }
  applyOnePath((value as Record<string, unknown>)[head], rest);
}

export function redactFields<T>(payload: T, paths: string[]): T {
  if (!paths || paths.length === 0) return payload;
  // Deep clone via JSON so the redaction can't leak back into a callerʼs
  // reference (and so we keep this dependency-free).
  let cloned: T;
  try {
    cloned = JSON.parse(JSON.stringify(payload));
  } catch {
    return payload;
  }
  for (const path of paths) {
    const segments = path.split('.').map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) continue;
    applyOnePath(cloned, segments);
  }
  return cloned;
}

/**
 * Returns the redacted text for a tool response. No-op when the
 * identity is an admin or a service account (service accounts get
 * tool-level allow-listing, not field-level redaction) or when no
 * projections are configured for the tool.
 */
export function redactToolResponseText(
  identity: ResolvedIdentity | null,
  toolName: string,
  text: string,
): string {
  if (!identity || identity.isAdmin || identity.serviceAccount) return text;
  const paths = identity.policy.fieldProjections[toolName];
  if (!paths || paths.length === 0) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text; // tool returned non-JSON text — don't touch it.
  }
  const redacted = redactFields(parsed, paths);
  return JSON.stringify(redacted, null, 2);
}
