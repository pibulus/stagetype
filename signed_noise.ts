// Signed noise: ids that cost nothing until someone uses them.
//
// mint() makes a random id plus a short signature and an expiry. Nothing is stored anywhere. Later,
// verify() proves the id came from us and hasn't expired, so a server can create whatever the id
// stands for (a room, a QR target, a claim) at the moment it's first used, and never before. Made-up
// ids fail verification, so bots can't mint things by guessing URLs. derive() turns an id into a
// stable secret (a write token, say) that only the holder of the server secret can compute.
//
// Zero dependencies, WebCrypto only: runs in Deno, browsers, Workers and Node 20+.

const enc = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();
const key = (secret: string) => {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keys.set(secret, k);
  }
  return k;
};
const hmac = async (secret: string, msg: string) =>
  new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(msg)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export type Noise = { id: string; sig: string; exp: number };

/** A fresh id with its signature. `sig` is "<exp base36>.<22 chars>", safe in a URL query. */
export async function mint(secret: string, ttlMs: number, prefix = "n", now = Date.now()): Promise<Noise> {
  const id = prefix + hex(crypto.getRandomValues(new Uint8Array(6)));
  const exp = now + ttlMs;
  const mac = b64url(await hmac(secret, `${id}.${exp}`)).slice(0, 22);
  return { id, sig: `${exp.toString(36)}.${mac}`, exp };
}

/** The expiry time if `sig` is ours for `id` and still valid, otherwise null. */
export async function verify(secret: string, id: string, sig: string | null, now = Date.now()): Promise<number | null> {
  if (!sig || !/^[a-z0-9]{1,12}\.[A-Za-z0-9_-]{22}$/.test(sig)) return null;
  const [e, mac] = sig.split(".");
  const exp = parseInt(e, 36);
  if (!Number.isFinite(exp) || exp < now) return null;
  const want = b64url(await hmac(secret, `${id}.${exp}`)).slice(0, 22);
  return same(mac, want) ? exp : null;
}

/** A stable 32-hex-char secret for this id and purpose. Same inputs, same output, no storage. */
export async function derive(secret: string, id: string, purpose: string): Promise<string> {
  return hex(await hmac(secret, `derive:${purpose}:${id}`)).slice(0, 32);
}
