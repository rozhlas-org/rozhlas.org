// Client-side playback gate. When a build-time password hash is baked in
// (PUBLIC_AUTH_HASH), the public site hides all playback until the visitor unlocks it
// at /auth. Auth is a localStorage flag set forever. This is a cosmetic product gate,
// NOT security: the hash is in the bundle, the flag is devtools-settable, and the IPFS
// gateway stays public (owner's accepted trade-off). Gate is OFF when no hash is set
// (dev/local), so nothing changes there.

const FLAG = "rozhlas:auth:v1";
// exactly 64 hex chars = a real SHA-256; undefined/empty/truncated → gate off
const HASH = (import.meta.env.PUBLIC_AUTH_HASH ?? "").trim().toLowerCase();

/** Is the gate configured (a valid password hash baked into this build)? */
export function authActive(): boolean {
  return /^[0-9a-f]{64}$/.test(HASH);
}

/** Has this browser unlocked playback (forever)? */
export function isAuthed(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/** Grant playback on this device, permanently. */
export function setAuthed(): void {
  try {
    localStorage.setItem(FLAG, "1");
  } catch {
    /* private mode — the in-memory session still unlocks via the html class */
  }
  document.documentElement.classList.remove("no-play");
}

/** Clear the flag (owner testing via /auth?lock=1). */
export function clearAuthed(): void {
  try {
    localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
  if (authActive()) document.documentElement.classList.add("no-play");
}

/** Playback is currently blocked: the gate is on and this device isn't unlocked. */
export function locked(): boolean {
  return authActive() && !isAuthed();
}

/** SHA-256(input) as lowercase hex — matches PUBLIC_AUTH_HASH. */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True if `password` matches the baked hash. */
export async function checkPassword(password: string): Promise<boolean> {
  if (!authActive()) return false;
  try {
    return (await sha256Hex(password)) === HASH;
  } catch {
    return false; // crypto.subtle needs a secure context (https/localhost)
  }
}
