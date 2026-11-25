import * as noise from "./signed_noise.ts";
import * as passes from "./passes.ts";

// StageType: one presenter speaks, many phones read along.
// Zero deps. Rooms live in memory; a restart ends every talk.
// Single-process in-memory rooms; move to Deno KV/Redis only if this ever runs on >1 instance.

type Chunk = {
  text?: unknown;
  final?: unknown;
  ping?: unknown;
  source?: unknown;
  live?: unknown;
  speaker?: unknown;
  phone?: unknown;
  paused?: unknown;
  links?: unknown;
};
type Source = "mic" | "phone" | "typed";
const SOURCES = new Set<string>(["mic", "phone", "typed"]);
type Listener = { ctrl: ReadableStreamDefaultController<Uint8Array>; ping: ReturnType<typeof setInterval> };
// An image shared into the room: the full frame for the phone that taps it, and a small thumb that
// rides along in the event so every phone can paint the catch without fetching anything.
type Asset = { id: string; seq: number; full: Uint8Array; type: string; thumb: string; bytes: number };
type Room = {
  token: string;
  code: string; // four-letter join code people can type instead of scanning
  title: string; // shown on every phone and in the export; "" when the presenter left it blank
  lang: string; // BCP-47 language tag (e.g. "en-AU", "ar-SA"); "" when unspecified
  paused: boolean; // whether the presenter paused captions on stage
  links: string[]; // presenter-pinned take-home URLs (slides, repo, reading list)
  lines: string[]; // finalized sentences, the backlog late joiners get
  speakers: string[]; // optional speaker label per line ("" when untagged), aligned with `lines`
  offset: number; // how many lines have been shifted out of `lines` (so seq = offset + index)
  phone: { live: boolean; seen: number }; // aggregate lapel mic state: live while any paired phone heartbeats
  phones: Map<string, number>; // active phone session IDs -> last heartbeat timestamp (up to MAX_PHONES)
  demo?: number; // demo rooms only: when they expire. Small, short, typing and browser speech only.
  closed: boolean;
  audioSessions: Set<() => void>;
  listeners: Set<Listener>;
  assets: Map<string, Asset>;
  assetBytes: number;
  pushWindowStart: number;
  pushWindowCount: number;
  touched: number;
  startedAt: number;
};

const env = (name: string, fallback = ""): string => Deno.env.get(name)?.trim() || fallback;
const parsePort = (raw: string): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 8787;
};

const ROOM_TTL_MS = 30 * 60_000; // idle rooms vanish after 30 min (presenter keepalive extends it)
const MAX_ROOMS = 1_000;
const MAX_LISTENERS = 500;
const MAX_TOTAL_LISTENERS = 2_000;
const MAX_BACKLOG = 400;
const MAX_CHUNK = 2_000; // chars kept per final line
const MAX_TITLE = 80;
const MAX_SPEAKER = 24;
const MAX_PHONES = 8;
const MAX_LINKS = 10;
const MAX_LINK_CHARS = 300;
const PUSH_WINDOW_MS = 1_000;
const PUSH_LIMIT_PER_SEC = 120;
export const cleanSpeaker = (raw: unknown): string =>
  typeof raw === "string" ? raw.slice(0, 128).replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, MAX_SPEAKER) : "";
const cleanPhoneId = (raw: unknown): string => typeof raw === "string" && /^[a-z0-9_-]{1,32}$/i.test(raw) ? raw : "default";
const cleanLang = (raw: unknown): string =>
  typeof raw === "string" ? (raw.trim().match(/^[A-Za-z]{2,3}(-[A-Za-z]{2,8})*$/)?.[0] ?? "") : "";
export function cleanLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().replace(/[.,;:!?)\]]+$/, "").slice(0, MAX_LINK_CHARS);
    if (!trimmed) continue;
    const explicit = /^https?:\/\//i.test(trimmed);
    if (!explicit && !/\.[a-z]{2,}/i.test(trimmed)) continue;
    const href = explicit ? trimmed : `https://${trimmed.replace(/^www\./i, "")}`;
    try {
      const u = new URL(href);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const host = u.hostname.toLowerCase();
      const isLocal = explicit && (host === "localhost" || host === "127.0.0.1");
      const isDomain = host.includes(".") && /\.[a-z]{2,}$/i.test(host) && !host.startsWith(".") && !host.includes("..");
      if ((isLocal || isDomain) && !out.includes(u.href)) {
        out.push(u.href);
        if (out.length >= MAX_LINKS) break;
      }
    } catch { /* skip invalid url */ }
  }
  return out;
}

function decodePassB64(raw: string): string {
  try {
    const pad = "=".repeat((4 - (raw.length % 4)) % 4);
    const bin = atob(raw.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

const MAX_BODY = 16_384; // bytes accepted per push
const PING_MS = 20_000;
const DEEPGRAM_KEEPALIVE_MS = 5_000; // Deepgram drops a silent socket after ~10 s
const DEEPGRAM_CLIENT_IDLE_MS = 60_000; // stop burning Deepgram minutes if client stops sending audio
const DEEPGRAM_CONNECT_TIMEOUT_MS = 10_000;
const MAX_WS_AUDIO_FRAME = 65_536; // 100ms 16kHz PCM16 is 3.2 KB; allow headroom without DoS
const MAX_WS_QUEUE_BYTES = 524_288;
const MAX_PENDING_CHARS = 4_000;
const MAX_DEEPGRAM_SESSIONS = 8;
const MAX_DEEPGRAM_SESSIONS_PER_ROOM = 2; // brief handoff overlap between laptop and phone is allowed
const DEEPGRAM_SESSION_MAX_MS = 4 * 60 * 60_000;
const ROOM_CREATE_WINDOW_MS = 60_000;
const ROOM_CREATE_LIMIT = 10;
const MAX_RATE_BUCKETS = 10_000;
const DEEPGRAM_DEFAULT_URL = "wss://api.deepgram.com/v1/listen";
const deepgramKey = () => env("DEEPGRAM_API_KEY");
const deepgramPass = () => env("STAGETYPE_DEEPGRAM_PASS");
const deepgramUrl = () => env("DEEPGRAM_URL", DEEPGRAM_DEFAULT_URL);
const deepgramModel = () => env("DEEPGRAM_MODEL", "nova-3");
const PHONE_LOST_MS = 45_000; // a live phone that goes this long without a push is treated as dropped
// Images: compressed on the presenter's device before they ever reach the relay. Caps are per room + global.
const MAX_ASSET_BYTES = 2_000_000;
const MAX_THUMB_CHARS = 90_000; // data URL length; the thumb rides in the SSE event
const MAX_THUMB_BYTES = 66_000; // raw bytes; base64 adds a third, and the data URL cap above wins
const MAX_UPLOAD_BYTES = 2_600_000; // hard streaming byte ceiling before formData() buffers
const MAX_ASSETS = 40;
const MAX_ASSET_TOTAL = 24_000_000;
const MAX_GLOBAL_ASSET_BYTES = (() => {
  const mb = Number(env("MAX_ASSET_RAM_MB", "128"));
  return (Number.isFinite(mb) && mb >= 8 && mb <= 2048 ? mb : 128) * 1_000_000;
})();
const MAX_BACKLOG_ASSETS = 12;
// The live demo on /demo: every visitor gets a signed-noise room id that only becomes a room when a
// phone scans it. Set STAGETYPE_SECRET in production so demo QR codes survive a restart.
const SECRET = env("STAGETYPE_SECRET") || (crypto.randomUUID() + crypto.randomUUID());
const DEMO_TTL_MS = 10 * 60_000;
const DEMO_IDLE_EMPTY_MS = 90_000;
const DEMO_MAX_ROOMS = 200;
const DEMO_MAX_LISTENERS = 3;
const DEMO_MINT_LIMIT = 60;
const LOBBY_TTL_MS = 30 * 60_000;
const LOBBY_MAX = 2_000;
const LOBBY_MINT_LIMIT = 60;
// Join-code lookups: 300/min handles a 200-300 person hall behind one venue NAT while throttling scans.
const JOIN_WINDOW_MS = 60_000;
const JOIN_LIMIT = 300;
const VERSION = env("STAGETYPE_VERSION", "dev");

function fileLastMod(name: string): string {
  try {
    const m = Deno.statSync(new URL(name, import.meta.url)).mtime;
    if (m) return m.toISOString().slice(0, 10);
  } catch { /* fallback if stat unavailable */ }
  return "";
}
const SITEMAP_PAGES = [
  { path: "/", file: "presenter.html" },
  { path: "/demo", file: "demo.html" },
  { path: "/join", file: "join.html" },
].map((p) => ({ path: p.path, lastmod: fileLastMod(p.file) }));

export const rooms: Map<string, Room> = new Map();
const codes = new Map<string, string>(); // join code -> room id, only while the room is open
type Lobby = { id: string; code: string; exp: number };
export const lobbies: Map<string, Lobby> = new Map(); // pre-live stateless-token lobby stubs (~64B each, zero Room RAM)
const lobbyCodes = new Map<string, string>(); // join code -> lobby id before first scan or Start captions
type RateBucket = { count: number; resetAt: number };
const roomCreateBuckets = new Map<string, RateBucket>();
const joinBuckets = new Map<string, RateBucket>();
const demoMintBuckets = new Map<string, RateBucket>();
const lobbyMintBuckets = new Map<string, RateBucket>();
const passCheckoutBuckets = new Map<string, RateBucket>();
const passPollBuckets = new Map<string, RateBucket>();
let globalAssetBytes = 0;
let totalListeners = 0;

const enc = new TextEncoder();
const dec = new TextDecoder();

const id = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2))), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);

// Join codes: four letters from an alphabet without I, O and Q (nothing that reads as a digit or
// each other on a projector), skipping the words nobody wants on a lecture screen.
const CODE_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ";
const CODE_BLOCKLIST = new Set([
  "FUCK",
  "SHIT",
  "CUNT",
  "DAMN",
  "DICK",
  "COCK",
  "TWAT",
  "ANAL",
  "ARSE",
  "BUTT",
  "CRAP",
  "JERK",
  "NAZI",
  "RAPE",
  "SLUT",
  "SUCK",
  "TITS",
  "WANK",
  "PISS",
  "CUMS",
  "KIKE",
  "SPIC",
  "DAGO",
  "PAKI",
  "HOMO",
  "FAGS",
  "DYKE",
  "JIZZ",
  "MUFF",
  "PUBE",
  "POOP",
  "PORN",
  "SCUM",
  "SEXY",
  "TURD",
  "HELL",
  "KILL",
  "DEAD",
  "GOOK",
  "COON",
  "CHNK",
  "FART",
  "BUMS",
  "NUTS",
  "DUMB",
  "LAME",
  "HATE",
]);
export function newCode(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const c = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (!CODE_BLOCKLIST.has(c) && !codes.has(c) && !lobbyCodes.has(c)) return c;
  }
}

function dropLobby(lobbyId: string) {
  const l = lobbies.get(lobbyId);
  if (!l) return;
  lobbies.delete(lobbyId);
  if (lobbyCodes.get(l.code) === lobbyId) lobbyCodes.delete(l.code);
}

function activeLobby(lobbyId: string, now = Date.now()): Lobby | null {
  const l = lobbies.get(lobbyId);
  if (!l) return null;
  if (l.exp <= now) {
    dropLobby(lobbyId);
    return null;
  }
  return l;
}

function activeLobbyIdForCode(code: string, now = Date.now()): string | undefined {
  const lid = lobbyCodes.get(code);
  if (!lid) return undefined;
  return activeLobby(lid, now) ? lid : undefined;
}

async function materialiseLobby(lobbyId: string, now = Date.now()): Promise<Room | undefined> {
  if (rooms.has(lobbyId)) return rooms.get(lobbyId);
  const l = activeLobby(lobbyId, now);
  if (!l || rooms.size >= MAX_ROOMS) return undefined;
  const token = await noise.derive(SECRET, lobbyId, "lobby-write");
  dropLobby(lobbyId);
  const room = makeRoom({ token, code: l.code, title: "", now });
  rooms.set(lobbyId, room);
  codes.set(l.code, lobbyId);
  return room;
}

const isLoopbackIp = (ip: string) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost";

export function clientKey(req: Request, info?: Deno.ServeHandlerInfo): string | null {
  const trustProxy = env("TRUST_PROXY").toLowerCase();
  const remoteIp = info?.remoteAddr?.transport === "tcp" ? info.remoteAddr.hostname : null;
  if (trustProxy === "cloudflare" && (!remoteIp || isLoopbackIp(remoteIp))) {
    const cfIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
    if (/^[0-9a-fA-F:.]+$/.test(cfIp)) return cfIp;
  }
  if (trustProxy === "fly" || env("FLY_APP_NAME")) {
    const flyIp = req.headers.get("fly-client-ip")?.trim() ?? "";
    if (/^[0-9a-fA-F:.]+$/.test(flyIp)) return flyIp;
  }
  return remoteIp;
}

function takeSlot(buckets: Map<string, RateBucket>, key: string, limit: number, windowMs: number, now = Date.now()): number | null {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_RATE_BUCKETS) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_RATE_BUCKETS) return windowMs;
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) return Math.max(1, bucket.resetAt - now);
  bucket.count++;
  return null;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

// Constant-time compare so a token can't be guessed a byte at a time from response timing.
export function sameToken(aStr: string, bStr: string): boolean {
  const a = enc.encode(aStr);
  const b = enc.encode(bStr);
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
function tokenOk(header: string | null, token: string): boolean {
  return sameToken(header ?? "", `Bearer ${token}`);
}

export function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

function makeRoom(opts: { token: string; code: string; title: string; lang?: string; links?: string[]; demo?: number; now: number }): Room {
  return {
    token: opts.token,
    code: opts.code,
    title: opts.title,
    lang: opts.lang ?? "",
    paused: false,
    links: opts.links ?? [],
    lines: [],
    speakers: [],
    offset: 0,
    phone: { live: false, seen: 0 },
    phones: new Map(),
    ...(opts.demo !== undefined ? { demo: opts.demo } : {}),
    closed: false,
    audioSessions: new Set(),
    listeners: new Set(),
    assets: new Map(),
    assetBytes: 0,
    pushWindowStart: opts.now,
    pushWindowCount: 0,
    touched: opts.now,
    startedAt: opts.now,
  };
}

function frame(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function drop(room: Room, l: Listener) {
  clearInterval(l.ping);
  if (room.listeners.delete(l)) totalListeners = Math.max(0, totalListeners - 1);
}

function send(room: Room, event: string, data: unknown) {
  const f = frame(event, data);
  for (const l of [...room.listeners]) {
    if ((l.ctrl.desiredSize ?? 1) <= 0) {
      try {
        l.ctrl.close();
      } catch { /* already closed */ }
      drop(room, l);
      continue;
    }
    try {
      l.ctrl.enqueue(f);
    } catch {
      drop(room, l);
    }
  }
}

// The one way words enter a room. HTTP pushes and relay-side speech engines both come through here.
function pushChunk(
  room: Room,
  chunk: { text: string; final: boolean; source: Source; speaker?: string; phoneId?: string; touchPhone?: boolean },
) {
  const text = chunk.text.trim().slice(0, MAX_CHUNK);
  const speaker = cleanSpeaker(chunk.speaker);
  room.touched = Date.now();
  if (chunk.source === "phone" && chunk.touchPhone !== false) {
    touchPhone(room, chunk.phoneId ?? "default", true, room.touched);
  }
  if (chunk.final) {
    if (text) {
      room.lines.push(text);
      room.speakers.push(speaker);
      if (room.lines.length > MAX_BACKLOG) {
        room.lines.shift();
        room.speakers.shift();
        room.offset++;
      }
      send(room, "final", { text, seq: room.offset + room.lines.length, source: chunk.source, ...(speaker ? { speaker } : {}) });
    } else {
      send(room, "interim", { text: "", source: chunk.source, ...(speaker ? { speaker } : {}) });
    }
  } else {
    send(room, "interim", { text, source: chunk.source, ...(speaker ? { speaker } : {}) });
  }
}

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function assetEvent(a: Asset) {
  return { id: a.id, seq: a.seq, thumb: a.thumb };
}

function deleteAsset(room: Room, asset: Asset) {
  if (!room.assets.delete(asset.id)) return;
  room.assetBytes = Math.max(0, room.assetBytes - asset.bytes);
  globalAssetBytes = Math.max(0, globalAssetBytes - asset.bytes);
}

// Oldest first out the door: a room holds a bounded number of images and bytes (Map preserves insertion order).
function trimAssets(room: Room) {
  while (room.assets.size > MAX_ASSETS || room.assetBytes > MAX_ASSET_TOTAL) {
    const oldest = room.assets.values().next().value;
    if (!oldest) return;
    deleteAsset(room, oldest);
    // A phone still holding that thumb would fetch a 404, so tell the room it is gone.
    send(room, "asset-gone", { id: oldest.id });
  }
}

function addAsset(room: Room, full: Uint8Array, type: string, thumb: string): Asset | null {
  const bytes = full.length + thumb.length;
  // Account for oldest assets in this room that trimAssets() will evict before enforcing the global RAM cap.
  let reclaimable = 0;
  let projectedCount = room.assets.size + 1;
  let projectedRoomBytes = room.assetBytes + bytes;
  for (const existing of room.assets.values()) {
    if (projectedCount <= MAX_ASSETS && projectedRoomBytes <= MAX_ASSET_TOTAL) break;
    reclaimable += existing.bytes;
    projectedCount--;
    projectedRoomBytes -= existing.bytes;
  }
  if (globalAssetBytes - reclaimable + bytes > MAX_GLOBAL_ASSET_BYTES) return null;
  const asset: Asset = {
    id: id(24),
    seq: room.offset + room.lines.length,
    full,
    type,
    thumb,
    bytes,
  };
  room.touched = Date.now();
  room.assets.set(asset.id, asset);
  room.assetBytes += bytes;
  globalAssetBytes += bytes;
  trimAssets(room);
  send(room, "asset", assetEvent(asset));
  return asset;
}

function setPhone(room: Room, live: boolean, lost: boolean) {
  if (room.phone.live === live) return;
  room.phone.live = live;
  send(room, "source", { source: "phone", live, lost });
}

function touchPhone(room: Room, phoneId: string, live: boolean, now: number) {
  if (live) {
    if (room.phones.has(phoneId) || room.phones.size < MAX_PHONES) {
      room.phones.set(phoneId, now);
    }
    room.phone.seen = now;
    setPhone(room, true, false);
  } else {
    room.phones.delete(phoneId);
    if (room.phones.size === 0) setPhone(room, false, false);
  }
}

// Runs every few seconds: a phone that stopped heartbeating (battery, lock screen, walked out of wifi)
// is marked lost so the console can bring the laptop mic back.
export function checkPhones(now: number = Date.now()): void {
  for (const r of rooms.values()) {
    for (const [pid, seen] of r.phones) {
      if (now - seen > PHONE_LOST_MS) r.phones.delete(pid);
    }
    if (r.phone.live && (r.phones.size === 0 && now - r.phone.seen > PHONE_LOST_MS)) {
      setPhone(r, false, true);
    }
  }
}

function endRoom(key: string, room: Room) {
  room.closed = true;
  send(room, "end", { endedAt: Date.now() });
  for (const close of [...room.audioSessions]) close();
  for (const l of [...room.listeners]) {
    try {
      l.ctrl.close();
    } catch { /* already gone */ }
    drop(room, l);
  }
  globalAssetBytes = Math.max(0, globalAssetBytes - room.assetBytes);
  room.assetBytes = 0;
  room.assets.clear();
  if (room.code) codes.delete(room.code);
  rooms.delete(key);
}

// Prefer a real LAN address (192.168.x, 10.x, 172.16-31.x) on a physical-looking interface
// over Docker bridges, VPN tunnels and the like, so the audience QR points somewhere phones can reach.
export function lanIp(): string {
  try {
    const rfc1918 = (a: string) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
    const physical = (n: string) => /^(en|eth|wl|wlan|wlp|enp)/.test(n);
    const score = (i: Deno.NetworkInterfaceInfo) =>
      (rfc1918(i.address) ? 2 : 0) + (physical(i.name) ? 1 : 0) - (/^(docker|br-|veth|utun|tun|tap|vmnet|virbr)/.test(i.name) ? 4 : 0);
    const candidates = Deno.networkInterfaces()
      .filter((i) => i.family === "IPv4" && !i.address.startsWith("127.") && !i.address.startsWith("169.254."))
      .sort((a, b) => score(b) - score(a));
    return candidates[0]?.address ?? "localhost";
  } catch {
    return "localhost";
  }
}

const isLoopbackHost = (req: Request, info?: Deno.ServeHandlerInfo) => {
  const hostOk = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.get("host") ?? "");
  if (!hostOk) return false;
  if (info?.remoteAddr?.transport === "tcp") return isLoopbackIp(info.remoteAddr.hostname);
  return true;
};

// Reads a request body with a hard byte limit before formData() can buffer unbounded chunked streams.
async function readBoundedFormData(req: Request, limit: number): Promise<FormData | "too-big" | "bad-form"> {
  const clHeader = req.headers.get("content-length");
  if (clHeader !== null) {
    const declared = Number(clHeader);
    if (!Number.isFinite(declared) || declared < 0 || declared > limit) return "too-big";
  }
  if (!req.body) return "bad-form";
  let seen = 0;
  let overflow = false;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) {
        overflow = true;
        controller.error(new Error("payload too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  try {
    const bounded = req.body.pipeThrough(limiter);
    return await new Response(bounded, { headers: req.headers }).formData();
  } catch {
    return overflow ? "too-big" : "bad-form";
  }
}

export async function handler(req: Request, info?: Deno.ServeHandlerInfo): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const get = req.method === "GET" || req.method === "HEAD";
  const head = req.method === "HEAD";
  const xfProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() ?? "";
  const isHttps = xfProto === "https" || url.protocol === "https:";
  const behindProxy = env("TRUST_PROXY") !== "" || env("FLY_APP_NAME") !== "";
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(url.host);

  // Operational health check stays reachable over plain HTTP for local/proxy probes
  if (get && path === "/healthz") {
    return json(
      { ok: true, rooms: rooms.size, listeners: totalListeners, assetsMb: Number((globalAssetBytes / 1_000_000).toFixed(2)) },
      200,
      { "x-robots-tag": "noindex, nofollow" },
    );
  }
  // Enforce canonical HTTPS when running behind a reverse proxy on a public hostname
  if (behindProxy && !isHttps && !isLocalHost) {
    return new Response(null, {
      status: get ? 301 : 308,
      headers: {
        location: `https://${url.host}${path}${url.search}`,
        "cache-control": "public, max-age=3600",
      },
    });
  }
  if (get && path === "/version.json") {
    return json({ commit: VERSION }, 200, { "x-robots-tag": "noindex, nofollow" });
  }
  const canonicalProto = isHttps || (behindProxy && !isLocalHost) ? "https" : url.protocol.replace(":", "");
  if (get && path === "/robots.txt") {
    const origin = `${canonicalProto}://${url.host}`;
    const body =
      `User-agent: *\nAllow: /\nAllow: /demo\nAllow: /join\nDisallow: /live/\nDisallow: /live$\nDisallow: /j/\nDisallow: /mic/\nDisallow: /ticker/\nDisallow: /api/\nDisallow: /healthz\nDisallow: /version.json\nSitemap: ${origin}/sitemap.xml\n`;
    return new Response(head ? null : body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-length": String(enc.encode(body).byteLength),
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (get && path === "/sitemap.xml") {
    const origin = `${canonicalProto}://${url.host}`;
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      SITEMAP_PAGES.map((p) => `  <url><loc>${origin}${p.path}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ""}</url>`).join(
        "\n",
      ) +
      `\n</urlset>\n`;
    return new Response(head ? null : body, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-length": String(enc.encode(body).byteLength),
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  }

  // Pages + vendored assets, so the console works on a venue LAN with no internet.
  if (get && path === "/") {
    return file("presenter.html", head, "text/html; charset=utf-8", false, { isHttps, allowMic: true, publicPage: true });
  }
  if (get && /^\/live\/[a-z0-9]+$/.test(path)) {
    return file("audience.html", head, "text/html; charset=utf-8", false, { isHttps, noindex: true });
  }
  // Phone as the mic: the write token rides in the URL #fragment, which browsers never send to the server
  if (get && /^\/mic\/[a-z0-9]+$/.test(path)) {
    return file("mic.html", head, "text/html; charset=utf-8", false, { isHttps, allowMic: true, noindex: true });
  }
  // The bar on its own: any second screen, or an OBS browser source for a livestream
  if (get && /^\/ticker\/[a-z0-9]+$/.test(path)) {
    return file("ticker.html", head, "text/html; charset=utf-8", false, { isHttps, embeddable: true, noindex: true });
  }
  if (get && path === "/demo") return file("demo.html", head, "text/html; charset=utf-8", false, { isHttps, publicPage: true });

  // Mint a demo id. Stateless: nothing exists until a phone opens the signed link.
  if (get && path === "/api/demo/mint") {
    const key = clientKey(req, info);
    if (key && takeSlot(demoMintBuckets, key, DEMO_MINT_LIMIT, JOIN_WINDOW_MS) !== null) {
      return json({ error: "too many demo rooms from this address" }, 429, { "retry-after": "60" });
    }
    const n = await noise.mint(SECRET, DEMO_TTL_MS, "d");
    return json({ id: n.id, sig: n.sig, exp: n.exp, ttlMs: DEMO_TTL_MS, token: await noise.derive(SECRET, n.id, "write") });
  }
  const demoStatus = path.match(/^\/api\/demo\/([a-z0-9]+)$/);
  if (get && demoStatus) {
    if (!await noise.verify(SECRET, demoStatus[1], url.searchParams.get("s"))) return json({ error: "not ours" }, 404);
    const r = rooms.get(demoStatus[1]);
    return json({ alive: !!r, listeners: r?.listeners.size ?? 0 });
  }

  // Mint a pre-live presenter lobby pass so QR + 4-letter code render at t=0 without allocating a Room
  // until the first audience phone scans or the presenter starts captions.
  if (get && path === "/api/lobby/mint") {
    if (req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "cross-site refused" }, 403);
    const key = clientKey(req, info);
    if (key && takeSlot(lobbyMintBuckets, key, LOBBY_MINT_LIMIT, JOIN_WINDOW_MS) !== null) {
      return json({ error: "too many lobby passes from this address" }, 429, { "retry-after": "60" });
    }
    const now = Date.now();
    if (lobbies.size >= LOBBY_MAX) {
      for (const [lid, l] of lobbies) if (l.exp <= now) dropLobby(lid);
      while (lobbies.size >= LOBBY_MAX) {
        const oldest = lobbies.keys().next().value;
        if (!oldest) break;
        dropLobby(oldest);
      }
    }
    const lobbyId = id(32);
    const code = newCode();
    const exp = now + LOBBY_TTL_MS;
    lobbies.set(lobbyId, { id: lobbyId, code, exp });
    lobbyCodes.set(code, lobbyId);
    const token = await noise.derive(SECRET, lobbyId, "lobby-write");
    return json({ id: lobbyId, code, token, exp, ttlMs: LOBBY_TTL_MS });
  }
  const lobbyStatus = path.match(/^\/api\/lobby\/([a-z0-9]{32})$/);
  if (get && lobbyStatus) {
    const lid = lobbyStatus[1];
    const r = rooms.get(lid);
    if (r) return json({ ok: true, materialized: true, listeners: r.listeners.size, phone: r.phone.live });
    if (activeLobby(lid)) return json({ ok: true, materialized: false, listeners: 0, phone: false });
    return json({ error: "lobby gone" }, 404);
  }

  // Type-the-code entry for people who can't scan the projector
  if (get && (path === "/live" || path === "/live/")) {
    return new Response(null, {
      status: 301,
      headers: {
        location: "/join",
        "cache-control": "public, max-age=3600",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
  if (get && path === "/join") {
    return file("join.html", head, "text/html; charset=utf-8", false, {
      isHttps,
      publicPage: true,
      noindex: url.searchParams.has("nope"),
    });
  }
  if (get && /^\/j\/[A-Za-z]{4}$/.test(path)) {
    const key = clientKey(req, info);
    if (key && takeSlot(joinBuckets, key, JOIN_LIMIT, JOIN_WINDOW_MS) !== null) {
      return json({ error: "too many code lookups from this address" }, 429, { "retry-after": "60" });
    }
    const code = path.slice(3).toUpperCase();
    const roomId = codes.get(code) ?? activeLobbyIdForCode(code);
    return new Response(null, {
      status: 302,
      headers: {
        location: roomId ? `/live/${roomId}` : `/join?nope=${code}`,
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
  if (get && /^\/api\/join\/[A-Za-z]{4}$/.test(path)) {
    const key = clientKey(req, info);
    if (key && takeSlot(joinBuckets, key, JOIN_LIMIT, JOIN_WINDOW_MS) !== null) {
      return json({ error: "too many code lookups from this address" }, 429, { "retry-after": "60" });
    }
    const code = path.slice(10).toUpperCase();
    const roomId = codes.get(code) ?? activeLobbyIdForCode(code);
    return roomId ? json({ id: roomId }) : json({ error: "no talk with that code" }, 404);
  }

  // Vendored assets: QR encoder, curated fonts, shared helpers, PWA shell & icons.
  if (get && /^\/vendor\/(fonts\/)?[a-z0-9-]+\.(js|css|woff2)$/.test(path)) {
    const type = path.endsWith(".js") ? "text/javascript; charset=utf-8" : path.endsWith(".css") ? "text/css; charset=utf-8" : "font/woff2";
    return file(path.slice(1), head, type, true);
  }
  if (get && (path === "/ghost.svg" || path === "/favicon.ico")) {
    return file("ghost.svg", head, "image/svg+xml", false, { sandboxSvg: true, cacheControl: "public, max-age=86400" });
  }
  if (get && path === "/apple-touch-icon.png") {
    return file("apple-touch-icon.png", head, "image/png", false, { cacheControl: "public, max-age=86400" });
  }
  if (get && path === "/icon-192.png") {
    return file("icon-192.png", head, "image/png", false, { cacheControl: "public, max-age=86400" });
  }
  if (get && path === "/icon-512.png") {
    return file("icon-512.png", head, "image/png", false, { cacheControl: "public, max-age=86400" });
  }
  if (get && path === "/og-image.png") {
    return file("og-image.png", head, "image/png", false, { cacheControl: "public, max-age=86400" });
  }
  if (get && path === "/manifest.webmanifest") {
    return file("manifest.webmanifest", head, "application/manifest+json; charset=utf-8", false, { cacheControl: "public, max-age=86400" });
  }
  if (get && path === "/sw.js") {
    return file("sw.js", head, "text/javascript; charset=utf-8", false, {
      cacheControl: "no-cache, no-store, must-revalidate",
      cdnCacheControl: "no-store",
    });
  }
  if (get && path === "/shared.js") return file("shared.js", head, "text/javascript; charset=utf-8", false);
  if (get && path === "/deepgram.js") return file("deepgram.js", head, "text/javascript; charset=utf-8", false);

  // Only answer the LAN address to a browser on this machine; nobody else needs the internal IP.
  if (get && path === "/api/info") {
    return isLoopbackHost(req, info) ? json({ lan: `http://${lanIp()}:${PORT}` }) : json({ error: "local only" }, 404);
  }

  // Presenter opens a room, optionally with a title, language, and pinned take-home links
  if (req.method === "POST" && path === "/api/room") {
    if (req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "cross-site refused" }, 403);
    const key = clientKey(req, info);
    if (key) {
      const wait = takeSlot(roomCreateBuckets, key, ROOM_CREATE_LIMIT, ROOM_CREATE_WINDOW_MS);
      if (wait !== null) {
        return json({ error: "too many rooms from this address" }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
      }
    }
    const raw = await readBody(req);
    if (raw === null) return json({ error: "too big" }, 413);
    let opts: { title?: unknown; lang?: unknown; links?: unknown; lobbyId?: unknown; lobbyToken?: unknown } = {};
    if (raw.trim()) {
      try {
        opts = JSON.parse(raw) ?? {};
      } catch {
        return json({ error: "bad json" }, 400);
      }
    }
    const title = typeof opts.title === "string" ? opts.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";
    const lang = cleanLang(opts.lang);
    const links = cleanLinks(opts.links);
    const now = Date.now();
    if (typeof opts.lobbyId === "string" && /^[a-z0-9]{32}$/.test(opts.lobbyId) && typeof opts.lobbyToken === "string") {
      const expectedToken = await noise.derive(SECRET, opts.lobbyId, "lobby-write");
      if (sameToken(opts.lobbyToken, expectedToken)) {
        const existing = rooms.get(opts.lobbyId);
        if (existing && sameToken(opts.lobbyToken, existing.token)) {
          existing.title = title;
          existing.lang = lang;
          existing.links = links;
          existing.touched = now;
          existing.startedAt = now;
          send(existing, "meta", { title, lang, links });
          return json({ id: opts.lobbyId, token: existing.token, title, lang, links, code: existing.code });
        }
        if (rooms.size >= MAX_ROOMS) return json({ error: "server full" }, 503);
        const pending = activeLobby(opts.lobbyId, now);
        if (pending) {
          dropLobby(pending.id);
          rooms.set(pending.id, makeRoom({ token: expectedToken, code: pending.code, title, lang, links, now }));
          codes.set(pending.code, pending.id);
          return json({ id: pending.id, token: expectedToken, title, lang, links, code: pending.code });
        }
      }
    }
    if (rooms.size >= MAX_ROOMS) return json({ error: "server full" }, 503);
    const roomId = id(32);
    const token = id(32);
    const code = newCode();
    rooms.set(roomId, makeRoom({ token, code, title, lang, links, now }));
    codes.set(code, roomId);
    return json({ id: roomId, token, title, lang, links, code });
  }

  // Which speech engines this relay offers. Browser recognition is always there; Deepgram needs a key.
  if (get && path === "/api/engines") {
    const passGate = Boolean(deepgramPass() || passes.isPassCheckoutConfigured());
    return json({
      browser: true,
      deepgram: deepgramKey() !== "",
      ...(passGate ? { passRequired: true } : {}),
      ...(passes.isPassCheckoutConfigured() ? { passesAvailable: true } : {}),
    });
  }

  // Event Passes: one-time 3h / 24h / 72h Deepgram relay passes ($1 per pass to Palestine relief).
  if (get && path === "/api/passes") {
    return json({
      available: passes.isPassCheckoutConfigured(),
      currency: "AUD",
      tiers: passes.PUBLIC_TIERS,
    });
  }

  if (get && path === "/api/passes/check") {
    const key = clientKey(req, info);
    if (key) {
      const wait = takeSlot(passPollBuckets, key, 45, 60_000);
      if (wait !== null) return json({ error: "slow down" }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
    }
    const rawCode = url.searchParams.get("code") ?? "";
    const status = await passes.inspectPass(rawCode);
    return json(status, status.valid ? 200 : 404);
  }

  if (req.method === "POST" && path === "/api/passes/checkout") {
    if (req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "cross-site refused" }, 403);
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== url.host) return json({ error: "origin mismatch" }, 403);
      } catch {
        return json({ error: "bad origin" }, 403);
      }
    }
    const key = clientKey(req, info);
    if (key) {
      const wait = takeSlot(passCheckoutBuckets, key, 15, 60_000);
      if (wait !== null) {
        return json({ error: "too many checkouts; try again shortly" }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
      }
    }
    const raw = await readBody(req);
    if (raw === null) return json({ error: "too big" }, 413);
    let body: { tier?: unknown } = {};
    try {
      body = raw.trim() ? (JSON.parse(raw) ?? {}) : {};
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const tier = typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "";
    const publicOrigin = `${canonicalProto}://${url.host}`;
    const res = await passes.createPassCheckout({ tier, origin: publicOrigin });
    if (!res.ok) return json({ error: res.error }, res.status);
    return json({ checkoutId: res.checkoutId, claimToken: res.claimToken, checkoutUrl: res.checkoutUrl });
  }

  const passPoll = path.match(/^\/api\/passes\/checkout\/([a-f0-9]{16,40})$/);
  if (get && passPoll) {
    const key = clientKey(req, info);
    if (key) {
      const wait = takeSlot(passPollBuckets, key, 90, 60_000);
      if (wait !== null) return json({ error: "slow down" }, 429, { "retry-after": String(Math.ceil(wait / 1000)) });
    }
    const res = await passes.pollPassCheckout(passPoll[1], req.headers.get("x-stagetype-claim"));
    return json(res.body, res.status);
  }

  if (req.method === "POST" && path === "/api/square/webhook") {
    const raw = await readBody(req, 65_536);
    if (raw === null) return json({ error: "too big" }, 413);
    const res = await passes.handleSquareWebhook(raw, req.headers.get("x-square-hmacsha256-signature"));
    return json(res.body, res.status);
  }

  // Relay-side speech: the page streams PCM over a WebSocket, the relay forwards it to Deepgram and
  // turns the results into ordinary room pushes. The token rides in the WebSocket subprotocol
  // ("bearer", <token>) because browsers can't set headers on a socket and a query string would be logged.
  const audio = path.match(/^\/api\/room\/([a-z0-9]+)\/audio$/);
  if (audio && req.method === "GET" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== url.host) return json({ error: "origin mismatch" }, 403);
      } catch {
        return json({ error: "bad origin" }, 403);
      }
    }
    const offered = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
    if (!rooms.has(audio[1]) && activeLobby(audio[1])) {
      const derived = await noise.derive(SECRET, audio[1], "lobby-write");
      if (offered[0] === "bearer" && sameToken(offered[1] ?? "", derived)) await materialiseLobby(audio[1]);
    }
    const r = rooms.get(audio[1]);
    if (!r) return json({ error: "room gone" }, 404);
    if (offered[0] !== "bearer" || !tokenOk(`Bearer ${offered[1] ?? ""}`, r.token)) return json({ error: "nope" }, 403);
    if (r.demo) return json({ error: "not in the demo" }, 403);
    const provided = offered[2] === "pass" ? (offered[3] ?? "") : offered[2] === "pass-b64" ? decodePassB64(offered[3] ?? "") : "";
    let sessionDgKey = deepgramKey();
    let sessionMaxMs = DEEPGRAM_SESSION_MAX_MS;
    if (provided.startsWith("dg:") && provided.slice(3).trim().length >= 16) {
      sessionDgKey = provided.slice(3).trim();
    } else {
      if (!sessionDgKey) return json({ error: "no speech engine on this relay" }, 503);
      const requiredPass = deepgramPass();
      const passGate = Boolean(requiredPass || passes.isPassCheckoutConfigured());
      if (passGate) {
        if (!provided) return json({ error: "speech pass required" }, 403);
        if (requiredPass && sameToken(provided, requiredPass)) {
          // Operator master pass accepted
        } else if (passes.hasPassSecret()) {
          const verdict = await passes.validateAndActivatePass(provided);
          if (!verdict.ok) {
            return json({ error: verdict.reason === "expired" ? "event pass expired" : "speech pass required" }, 403);
          }
          sessionMaxMs = Math.min(DEEPGRAM_SESSION_MAX_MS, Math.max(5_000, verdict.remainingMs));
        } else {
          return json({ error: "speech pass required" }, 403);
        }
      }
    }
    const activeSessions = [...rooms.values()].reduce((n, room) => n + room.audioSessions.size, 0);
    if (activeSessions >= MAX_DEEPGRAM_SESSIONS || r.audioSessions.size >= MAX_DEEPGRAM_SESSIONS_PER_ROOM) {
      return json({ error: "speech relay is at capacity; try again shortly" }, 503);
    }
    const { socket, response } = Deno.upgradeWebSocket(req, { protocol: "bearer" });
    const source: Source = url.searchParams.get("source") === "phone" ? "phone" : "mic";
    const lang = cleanLang(url.searchParams.get("lang")) || "en";
    const speaker = cleanSpeaker(url.searchParams.get("speaker"));
    const phoneId = url.searchParams.get("phone") ? cleanPhoneId(url.searchParams.get("phone")) : (speaker || "default");
    deepgramSession(r, socket, source, lang, keytermsFrom(url), speaker, phoneId, sessionDgKey, sessionMaxMs);
    return response;
  }

  // An image shared into the room. Multipart so the full frame and its thumb arrive in one go.
  const assetPost = path.match(/^\/api\/room\/([a-z0-9]+)\/asset$/);
  if (assetPost && req.method === "POST") {
    const r = rooms.get(assetPost[1]);
    if (!r) return json({ error: "room gone" }, 404);
    if (!tokenOk(req.headers.get("authorization"), r.token)) return json({ error: "nope" }, 403);
    if (r.demo) return json({ error: "not in the demo" }, 403);
    // Streaming byte ceiling protects against chunked or forged Content-Length uploads.
    const form = await readBoundedFormData(req, MAX_UPLOAD_BYTES);
    if (form === "too-big") return json({ error: "too big" }, 413);
    if (form === "bad-form") return json({ error: "expected a form" }, 400);
    const full = form.get("full");
    const thumb = form.get("thumb");
    if (!(full instanceof File) || !(thumb instanceof File)) return json({ error: "need full and thumb" }, 400);
    if (full.size === 0 || full.size > MAX_ASSET_BYTES) return json({ error: "too big" }, 413);
    if (thumb.size === 0 || thumb.size > MAX_THUMB_BYTES) return json({ error: "thumb too big" }, 413);
    const fullBytes = new Uint8Array(await full.arrayBuffer());
    const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
    const fullType = sniffImageType(fullBytes);
    const thumbType = sniffImageType(thumbBytes);
    if (!fullType || !thumbType) return json({ error: "images only" }, 415);
    const thumbUrl = `data:${thumbType};base64,${base64(thumbBytes)}`;
    // Every check lands before the broadcast: nothing may reach a phone and then be taken away.
    if (thumbUrl.length > MAX_THUMB_CHARS) return json({ error: "thumb too big" }, 413);
    const asset = addAsset(r, fullBytes, fullType, thumbUrl);
    if (!asset) return json({ error: "image memory full" }, 503);
    return json({ id: asset.id, seq: asset.seq, thumb: asset.thumb });
  }

  // Pull a picture back: the wrong screenshot never stays in forty pockets.
  const assetDel = path.match(/^\/api\/room\/([a-z0-9]+)\/asset\/([a-z0-9]+)$/);
  if (assetDel && req.method === "DELETE") {
    const r = rooms.get(assetDel[1]);
    if (!r) return json({ error: "room gone" }, 404);
    if (!tokenOk(req.headers.get("authorization"), r.token)) return json({ error: "nope" }, 403);
    const asset = r.assets.get(assetDel[2]);
    if (!asset) return json({ error: "no such image" }, 404);
    deleteAsset(r, asset);
    send(r, "asset-gone", { id: asset.id });
    return json({ ok: true });
  }

  // A phone taps a thumb: hand it the full frame. No auth (the room id is the secret), short private cache.
  const assetGet = path.match(/^\/api\/room\/([a-z0-9]+)\/asset\/([a-z0-9]+)$/);
  if (get && assetGet) {
    const r = rooms.get(assetGet[1]);
    const asset = r?.assets.get(assetGet[2]);
    if (!r || !asset) return json({ error: "no such image" }, 404);
    return new Response(head ? null : (asset.full as unknown as BodyInit), {
      headers: {
        "content-type": asset.type,
        "content-length": String(asset.full.byteLength),
        "cache-control": "private, max-age=60",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const m = path.match(/^\/api\/room\/([a-z0-9]+)(\/stream)?$/);
  if (m && m[2] && req.method === "GET" && !rooms.has(m[1])) {
    await materialiseDemo(m[1], url.searchParams.get("s"));
    if (!rooms.has(m[1])) await materialiseLobby(m[1]);
  }
  if (m && !m[2] && req.method === "POST" && !rooms.has(m[1]) && activeLobby(m[1])) {
    const derived = await noise.derive(SECRET, m[1], "lobby-write");
    if (tokenOk(req.headers.get("authorization"), derived)) await materialiseLobby(m[1]);
  }
  const room = m ? rooms.get(m[1]) : undefined;
  if (m && !room) return json({ error: "room gone" }, 404);

  // Presenter pushes a chunk (or keepalive, pause state, or take-home links)
  if (room && !m![2] && req.method === "POST") {
    if (!tokenOk(req.headers.get("authorization"), room.token)) return json({ error: "nope" }, 403);
    const now = Date.now();
    if (info) {
      if (now - room.pushWindowStart >= PUSH_WINDOW_MS) {
        room.pushWindowStart = now;
        room.pushWindowCount = 0;
      }
      if (++room.pushWindowCount > PUSH_LIMIT_PER_SEC) {
        return json({ error: "too fast" }, 429, { "retry-after": "1" });
      }
    }
    const raw = await readBody(req);
    if (raw === null) return json({ error: "too big" }, 413);
    let body: Chunk | null = null;
    try {
      body = JSON.parse(raw);
    } catch { /* fallthrough */ }
    if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);
    room.touched = now;
    const source: Source = typeof body.source === "string" && SOURCES.has(body.source) ? body.source as Source : "mic";
    const text = typeof body.text === "string" ? body.text : "";
    const speaker = cleanSpeaker(body.speaker);
    const phoneId = typeof body.phone === "string" ? cleanPhoneId(body.phone) : (speaker || "default");
    if (typeof body.paused === "boolean" && body.paused !== room.paused) {
      room.paused = body.paused;
      send(room, "paused", { paused: room.paused });
    }
    if (Array.isArray(body.links)) {
      room.links = cleanLinks(body.links);
      send(room, "links", { links: room.links });
    }
    if (source === "phone" && body.ping) {
      touchPhone(room, phoneId, typeof body.live === "boolean" ? body.live : room.phone.live, now);
    }
    if (!body.ping && (typeof body.text === "string" || typeof body.final === "boolean")) {
      pushChunk(room, { text, final: !!body.final, source, speaker, phoneId });
    }
    return json({ ok: true, listeners: room.listeners.size, title: room.title });
  }

  // Presenter ends the talk
  if (room && !m![2] && req.method === "DELETE") {
    if (!tokenOk(req.headers.get("authorization"), room.token)) return json({ error: "nope" }, 403);
    endRoom(m![1], room);
    return json({ ok: true });
  }

  // Audience listens (SSE; EventSource reconnects on its own)
  if (room && m![2] && req.method === "GET") {
    if (room.listeners.size >= (room.demo ? DEMO_MAX_LISTENERS : MAX_LISTENERS) || totalListeners >= MAX_TOTAL_LISTENERS) {
      return json({ error: "room full" }, 503);
    }
    let me: Listener;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const allAssets = [...room.assets.values()];
        const hello = frame("backlog", {
          lines: room.lines,
          ...(room.speakers.some(Boolean) ? { speakers: room.speakers } : {}),
          offset: room.offset,
          startedAt: room.startedAt,
          title: room.title,
          lang: room.lang,
          paused: room.paused,
          phone: room.phone.live,
          links: room.links,
          assets: allAssets.slice(-MAX_BACKLOG_ASSETS).map(assetEvent),
          assetIds: allAssets.map((a) => a.id),
        });
        c.enqueue(enc.encode(`retry: 2000\n${dec.decode(hello)}`));
        const ping = setInterval(() => {
          if ((c.desiredSize ?? 1) <= 0) {
            try {
              c.close();
            } catch { /* already gone */ }
            drop(room, me);
            return;
          }
          try {
            c.enqueue(enc.encode(": ping\n\n"));
          } catch {
            drop(room, me);
          }
        }, PING_MS);
        me = { ctrl: c, ping };
        room.listeners.add(me);
        totalListeners++;
      },
      cancel() {
        drop(room, me);
      },
    }, new CountQueuingStrategy({ highWaterMark: 64 }));
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    });
  }

  return new Response("not here", { status: 404 });
}

// Names the talk keeps saying: the presenter's own, the project, the jargon. Nova-3 takes these as
// repeated `keyterm` params; earlier models called the same idea `keywords`.
const MAX_KEYTERMS = 20;
const MAX_KEYTERM_CHARS = 40;
export function keytermsFrom(url: URL): string[] {
  const out: string[] = [];
  for (const raw of [...url.searchParams.getAll("keyterm"), ...url.searchParams.getAll("keywords")]) {
    for (const part of raw.slice(0, 512).split(",")) {
      const term = part.trim().slice(0, 128).replace(/[^\p{L}\p{N} '\-.&]/gu, "").slice(0, MAX_KEYTERM_CHARS);
      if (term && out.length < MAX_KEYTERMS && !out.includes(term)) out.push(term);
    }
  }
  return out;
}

function deepgramSession(
  room: Room,
  client: WebSocket,
  source: Source,
  lang: string,
  keyterms: string[] = [],
  speaker = "",
  phoneId = "default",
  apiKey = deepgramKey(),
  maxSessionMs = DEEPGRAM_SESSION_MAX_MS,
) {
  const params = new URLSearchParams({
    model: deepgramModel(),
    language: lang,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    endpointing: "300",
    utterance_end_ms: "1200",
    vad_events: "false",
  });
  if (keyterms.length) {
    const field = deepgramModel().startsWith("nova-3") ? "keyterm" : "keywords";
    for (const term of keyterms) params.append(field, term);
  }
  let up: WebSocket;
  try {
    up = new WebSocket(`${deepgramUrl()}?${params}`, ["token", apiKey]);
  } catch {
    client.close(1011, "upstream unavailable");
    return;
  }
  up.binaryType = "arraybuffer";
  const pending: string[] = [];
  let pendingChars = 0;
  const queue: ArrayBuffer[] = []; // audio that arrived before Deepgram answered
  let queueBytes = 0;
  let lastClientAudio = Date.now();
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const tell = (msg: unknown) => {
    try {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
    } catch { /* gone */ }
  };
  const finish = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    clearTimeout(sessionTimeout);
    clearTimeout(connectTimeout);
    room.audioSessions.delete(closeSession);
    try {
      if (up.readyState === WebSocket.OPEN) {
        up.send(JSON.stringify({ type: "Finalize" }));
        up.send(JSON.stringify({ type: "CloseStream" }));
      }
    } catch { /* gone */ }
    try {
      up.close();
    } catch { /* gone */ }
    try {
      client.close(code, reason.slice(0, 120));
    } catch { /* gone */ }
    if (room.closed) return;
    // Never mark a closing/paused phone session live again while clearing its trailing interim.
    if (pending.length) flush(false);
    else pushChunk(room, { text: "", final: false, source, speaker, phoneId, touchPhone: false });
  };
  const closeSession = () => finish(1001, "room ended");
  room.audioSessions.add(closeSession);
  const sessionTimeout = setTimeout(() => finish(1000, "session time limit"), maxSessionMs);
  const connectTimeout = setTimeout(() => {
    if (up.readyState !== WebSocket.OPEN) {
      tell({ error: "Speech relay timed out connecting upstream." });
      finish(1011, "upstream connect timeout");
    }
  }, DEEPGRAM_CONNECT_TIMEOUT_MS);
  const flush = (touch = true) => {
    const text = pending.join(" ").trim();
    pending.length = 0;
    pendingChars = 0;
    if (text) {
      pushChunk(room, { text, final: true, source, speaker, phoneId, touchPhone: touch });
      tell({ final: text });
    } else {
      pushChunk(room, { text: "", final: false, source, speaker, phoneId, touchPhone: false });
      tell({ interim: "" });
    }
  };
  up.onopen = () => {
    clearTimeout(connectTimeout);
    if (closed || room.closed) {
      try {
        up.close();
      } catch { /* already gone */ }
      return;
    }
    for (const buf of queue.splice(0)) {
      try {
        up.send(buf);
      } catch {
        break;
      }
    }
    queueBytes = 0;
    lastClientAudio = Date.now();
    keepalive = setInterval(() => {
      if (Date.now() - lastClientAudio > DEEPGRAM_CLIENT_IDLE_MS) {
        tell({ error: "Audio link closed after silence." });
        finish(1000, "client audio idle");
        return;
      }
      try {
        up.send(JSON.stringify({ type: "KeepAlive" }));
      } catch { /* gone */ }
    }, DEEPGRAM_KEEPALIVE_MS);
    tell({ ready: true });
  };
  up.onmessage = (e) => {
    if (typeof e.data !== "string" || closed || room.closed) return;
    let msg: { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === "UtteranceEnd") {
      flush();
      return;
    }
    if (msg.type !== "Results") return;
    const t = (msg.channel?.alternatives?.[0]?.transcript ?? "").trim();
    if (msg.is_final) {
      if (t) {
        pending.push(t);
        pendingChars += t.length + 1;
      }
      if (msg.speech_final || pendingChars >= MAX_PENDING_CHARS) flush();
      else {
        const i = pending.join(" ");
        pushChunk(room, { text: i, final: false, source, speaker, phoneId });
        tell({ interim: i });
      }
    } else {
      const i = [...pending, t].join(" ").trim();
      pushChunk(room, { text: i, final: false, source, speaker, phoneId });
      tell({ interim: i });
    }
  };
  up.onerror = () => {
    tell({ error: "The relay couldn't reach Deepgram." });
    finish(1011, "upstream error");
  };
  up.onclose = () => {
    if (!closed) {
      tell({ error: "Deepgram closed the stream." });
      finish(1011, "upstream closed");
    }
  };
  client.onmessage = (e) => {
    if (closed || room.closed) return;
    if (typeof e.data === "string") {
      try {
        const m = JSON.parse(e.data);
        if (m?.type === "Finalize" && up.readyState === WebSocket.OPEN) {
          up.send(JSON.stringify({ type: "Finalize" }));
          return;
        }
        if (m?.type === "stop") finish();
      } catch { /* ignore */ }
      return;
    }
    const buf = e.data as ArrayBuffer;
    if (!(buf instanceof ArrayBuffer) || buf.byteLength === 0 || buf.byteLength > MAX_WS_AUDIO_FRAME) {
      finish(1009, "audio frame too large");
      return;
    }
    lastClientAudio = Date.now();
    if (up.readyState === WebSocket.OPEN) {
      try {
        up.send(buf);
      } catch { /* upstream closing */ }
    } else if (queue.length < 200 && queueBytes + buf.byteLength <= MAX_WS_QUEUE_BYTES) {
      queue.push(buf);
      queueBytes += buf.byteLength;
    }
  };
  client.onclose = () => finish();
  client.onerror = () => finish(1011, "client error");
}

// The first scan of a signed demo link turns noise into a room. The write token is derived from the
// id, so the page that minted it can type into the room without the server ever having stored it.
async function materialiseDemo(id: string, sig: string | null) {
  const exp = await noise.verify(SECRET, id, sig);
  if (!exp || rooms.has(id)) return;
  let demos = 0;
  for (const r of rooms.values()) if (r.demo) demos++;
  if (demos >= DEMO_MAX_ROOMS || rooms.size >= MAX_ROOMS) return;
  const now = Date.now();
  rooms.set(
    id,
    makeRoom({
      token: await noise.derive(SECRET, id, "write"),
      code: "",
      title: "StageType demo",
      demo: exp,
      now,
    }),
  );
}

// Read a request body up to MAX_BODY bytes; null when it is larger.
async function readBody(req: Request, maxBytes = MAX_BODY): Promise<string | null> {
  const cl = req.headers.get("content-length");
  if (cl !== null) {
    const declared = Number(cl);
    if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) return null;
  }
  if (!req.body) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      await req.body.cancel().catch(() => {});
      return null;
    }
    parts.push(chunk);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return dec.decode(out);
}

type FileOpts = {
  isHttps?: boolean;
  allowMic?: boolean;
  embeddable?: boolean;
  sandboxSvg?: boolean;
  publicPage?: boolean;
  noindex?: boolean;
  cacheControl?: string;
  cdnCacheControl?: string;
};
async function file(name: string, isHead = false, type = "text/html; charset=utf-8", immutable = false, opts: FileOpts = {}) {
  const target = new URL(name, import.meta.url);
  let body: Uint8Array<ArrayBuffer> | null = null;
  let size = 0;
  try {
    if (isHead) {
      size = (await Deno.stat(target)).size;
    } else {
      body = await Deno.readFile(target);
      size = body.byteLength;
    }
  } catch {
    return new Response("not here", { status: 404 });
  }
  const headers: Record<string, string> = {
    "content-type": type,
    "content-length": String(size),
    "x-content-type-options": "nosniff",
    "referrer-policy": opts.publicPage ? "strict-origin-when-cross-origin" : "no-referrer",
    "cache-control": opts.cacheControl ?? (immutable ? "public, max-age=31536000, immutable" : "no-cache"),
  };
  if (opts.cdnCacheControl) headers["cdn-cache-control"] = opts.cdnCacheControl;
  if (opts.noindex) headers["x-robots-tag"] = "noindex, nofollow";
  if (opts.sandboxSvg) {
    headers["content-security-policy"] = "default-src 'none'; sandbox";
  } else if (type.startsWith("text/html")) {
    const beaconHost = opts.publicPage ? " https://hits.madebypablo.app" : "";
    headers["content-security-policy"] =
      `default-src 'self'; script-src 'self' 'unsafe-inline' blob:${beaconHost}; style-src 'self' 'unsafe-inline'; ` +
      `img-src 'self' data: blob:; connect-src 'self' ws: wss:${beaconHost}; font-src 'self'; worker-src 'self' blob:; ` +
      `base-uri 'none'; form-action 'self'; frame-ancestors ${opts.embeddable ? "*" : "'none'"}`;
    if (!opts.embeddable) headers["x-frame-options"] = "DENY";
    headers["permissions-policy"] = opts.allowMic
      ? "microphone=(self), clipboard-read=(self), camera=(), geolocation=()"
      : "microphone=(), camera=(), geolocation=()";
    if (opts.isHttps) headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  return new Response(body, { headers });
}

export function sweep(now: number = Date.now()): void {
  for (const [k, r] of [...rooms]) {
    const emptyDemoIdle = r.demo && r.listeners.size === 0 && now - r.touched > DEMO_IDLE_EMPTY_MS;
    if (now - r.touched > ROOM_TTL_MS || (r.demo && now > r.demo) || emptyDemoIdle) endRoom(k, r);
  }
  for (const [lid, l] of [...lobbies]) if (l.exp <= now) dropLobby(lid);
  // Rate-limit buckets hold client addresses; they belong to a window, not to the process.
  for (const buckets of [roomCreateBuckets, joinBuckets, demoMintBuckets, lobbyMintBuckets, passCheckoutBuckets, passPollBuckets]) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
}

const PORT = parsePort(env("PORT", "8787"));
const HOST = env("HOST", "0.0.0.0");

if (import.meta.main) {
  if (!env("STAGETYPE_SECRET")) {
    console.warn("[StageType] STAGETYPE_SECRET is unset; using an ephemeral secret (demo QRs will reset on restart).");
  }
  const phoneTimer = setInterval(checkPhones, 5_000);
  const sweepTimer = setInterval(() => sweep(), 15_000);
  const server = Deno.serve({ port: PORT, hostname: HOST }, handler);
  console.log(`presenter: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}   phones: http://${lanIp()}:${PORT}`);

  const gracefulShutdown = async () => {
    clearInterval(phoneTimer);
    clearInterval(sweepTimer);
    for (const [k, r] of [...rooms]) endRoom(k, r);
    await server.shutdown().catch(() => {});
    Deno.exit(0);
  };
  try {
    Deno.addSignalListener("SIGTERM", gracefulShutdown);
    Deno.addSignalListener("SIGINT", gracefulShutdown);
  } catch { /* optional on platforms without POSIX signals */ }
}
