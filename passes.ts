// StageType Event Passes: Square quick-pay checkout, HMAC webhook verification,
// order-status podium fallback, and first-use clock activation (3h / 24h / 72h).
// Zero external dependencies. Uses atomic JSON files when STAGETYPE_DATA_DIR is set,
// or an isolated in-memory Map in unit tests.

export type TierId = "meetup" | "day" | "weekend";

export type PassTier = {
  id: TierId;
  name: string;
  label: string;
  hours: number;
  priceMinor: number;
  displayPrice: string;
  summary: string;
};

export const PASS_TIERS: Record<TierId, PassTier> = {
  meetup: {
    id: "meetup",
    name: "StageType Meetup Pass (3h)",
    label: "Meetup Pass",
    hours: 3,
    priceMinor: 1500,
    displayPrice: "A$15",
    summary: "3 hours · single talk, lecture, or evening meetup",
  },
  day: {
    id: "day",
    name: "StageType Day Pass (24h)",
    label: "Day Pass",
    hours: 24,
    priceMinor: 3900,
    displayPrice: "A$39",
    summary: "24 hours · full workshop, conference track, or class day",
  },
  weekend: {
    id: "weekend",
    name: "StageType Weekend Pass (72h)",
    label: "Weekend Pass",
    hours: 72,
    priceMinor: 8900,
    displayPrice: "A$89",
    summary: "72 hours · multi-day summit, festival, or weekend services",
  },
};

export const PUBLIC_TIERS: PassTier[] = [PASS_TIERS.meetup, PASS_TIERS.day, PASS_TIERS.weekend];

export type CheckoutRecord = {
  id: string;
  claimHash: string;
  tier: TierId;
  hours: number;
  priceMinor: number;
  currency: string;
  orderId: string;
  paymentLinkId: string;
  status: "pending" | "paid";
  code?: string;
  createdAt: number;
  paidAt?: number;
  lastOrderCheckAt?: number;
};

export type PassRecord = {
  codeHash: string;
  code: string;
  checkoutId: string;
  tier: TierId;
  label: string;
  hours: number;
  durationMs: number;
  issuedAt: number;
  activatedAt: number | null;
  expiresAt: number | null;
};

const PASS_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ23456789";
const PASS_RE = /^ST-[A-HJ-NPR-Z2-9]{4}-[A-HJ-NPR-Z2-9]{4}$/;
const COMPACT_RE = /^[A-HJ-NPR-Z2-9]{8}$/;
const UNUSED_SHELF_MS = 180 * 24 * 60 * 60_000; // 180 days to start the clock
const ORDER_POLL_MIN_MS = 3_000;

const enc = new TextEncoder();
const memStore = new Map<string, string>();

const env = (name: string): string => Deno.env.get(name)?.trim() ?? "";

export function resetMemoryStoreForTests(): void {
  memStore.clear();
}

export function passSecret(): string {
  return env("STAGETYPE_PASS_SECRET") || env("PASSPORT_LICENSE_SECRET");
}

export function hasPassSecret(): boolean {
  return passSecret().length >= 16;
}

function squareBaseUrl(): string {
  const custom = env("SQUARE_BASE_URL");
  if (custom) return custom.replace(/\/+$/, "");
  return env("SQUARE_ENVIRONMENT") === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
}

export function isPassCheckoutConfigured(): boolean {
  return Boolean(env("SQUARE_ACCESS_TOKEN") && env("SQUARE_LOCATION_ID") && hasPassSecret());
}

export function isWebhookConfigured(): boolean {
  return Boolean(env("SQUARE_WEBHOOK_SIGNATURE_KEY") && env("SQUARE_WEBHOOK_NOTIFICATION_URL") && hasPassSecret());
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function sameStr(a: string, b: string): boolean {
  return sameBytes(enc.encode(a), enc.encode(b));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacBytes(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(message));
  return toHex(new Uint8Array(digest));
}

function randomId(hexChars = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(hexChars / 2)));
  return toHex(bytes).slice(0, hexChars);
}

function randomClaimToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export function normalizePassCode(raw: string): string {
  const up = (raw || "").trim().toUpperCase();
  if (PASS_RE.test(up)) return up;
  const compact = up.replace(/[\s_-]+/g, "").replace(/^ST/, "");
  if (COMPACT_RE.test(compact)) {
    return `ST-${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
  }
  return "";
}

export async function derivePassCode(checkoutId: string, secret = passSecret()): Promise<string> {
  const bytes = await hmacBytes(secret, `stagetype-pass:${checkoutId}`);
  let chars = "";
  for (let i = 0; i < 8; i++) {
    const val = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
    chars += PASS_ALPHABET[val % PASS_ALPHABET.length];
  }
  return `ST-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

async function passIndexKey(canonicalCode: string, secret = passSecret()): Promise<string> {
  const h = toHex(await hmacBytes(secret, `stagetype-pass-idx:${canonicalCode}`));
  return `pass_${h.slice(0, 40)}`;
}

// ---------- Atomic Persistence (STAGETYPE_DATA_DIR or in-memory test store) ----------
function dataDir(): string {
  return env("STAGETYPE_DATA_DIR");
}

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key)) throw new Error("invalid store key");
  return key;
}

async function storeGet<T>(key: string): Promise<T | null> {
  const k = safeKey(key);
  const dir = dataDir();
  if (!dir) {
    const raw = memStore.get(k);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  try {
    const raw = await Deno.readTextFile(`${dir}/${k}.json`);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function storeSet(key: string, value: unknown): Promise<void> {
  const k = safeKey(key);
  const body = JSON.stringify(value);
  const dir = dataDir();
  if (!dir) {
    memStore.set(k, body);
    return;
  }
  await Deno.mkdir(dir, { recursive: true });
  const target = `${dir}/${k}.json`;
  const tmp = `${target}.${randomId(8)}.tmp`;
  await Deno.writeTextFile(tmp, body);
  await Deno.rename(tmp, target);
}

// ---------- Square HTTP ----------
async function squareFetch(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const token = env("SQUARE_ACCESS_TOKEN");
  const version = env("SQUARE_API_VERSION") || "2026-01-22";
  const res = await fetch(`${squareBaseUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "square-version": version,
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, data };
}

export async function createPassCheckout(opts: {
  tier: string;
  origin: string;
  now?: number;
}): Promise<
  | { ok: true; checkoutId: string; claimToken: string; checkoutUrl: string; tier: PassTier }
  | { ok: false; status: number; error: string }
> {
  if (!isPassCheckoutConfigured()) {
    return { ok: false, status: 503, error: "event passes are not configured on this relay" };
  }
  const tier = PASS_TIERS[opts.tier as TierId];
  if (!tier) return { ok: false, status: 400, error: "unknown pass tier" };

  const now = opts.now ?? Date.now();
  const checkoutId = randomId(24);
  const claimToken = randomClaimToken();
  const claimHash = await sha256Hex(`stagetype-claim:${claimToken}`);
  const appOrigin = (env("PUBLIC_APP_URL") || opts.origin).replace(/\/+$/, "");
  const redirectUrl = `${appOrigin}/?pass_checkout=${encodeURIComponent(checkoutId)}`;

  const sq = await squareFetch("POST", "/v2/online-checkout/payment-links", {
    idempotency_key: `stagetype-${checkoutId}`,
    description: `${tier.name} ($1 donated to Palestine relief)`,
    quick_pay: {
      name: tier.name,
      price_money: { amount: tier.priceMinor, currency: "AUD" },
      location_id: env("SQUARE_LOCATION_ID"),
    },
    checkout_options: {
      redirect_url: redirectUrl,
      ask_for_shipping_address: false,
    },
  });

  const link = sq.data.payment_link as Record<string, unknown> | undefined;
  const checkoutUrl = typeof link?.url === "string" ? link.url : typeof link?.long_url === "string" ? link.long_url : "";
  const orderId = typeof link?.order_id === "string" ? link.order_id : "";
  const paymentLinkId = typeof link?.id === "string" ? link.id : "";

  if (sq.status < 200 || sq.status >= 300 || !checkoutUrl || !orderId) {
    return { ok: false, status: 502, error: "could not create Square checkout link" };
  }

  const record: CheckoutRecord = {
    id: checkoutId,
    claimHash,
    tier: tier.id,
    hours: tier.hours,
    priceMinor: tier.priceMinor,
    currency: "AUD",
    orderId,
    paymentLinkId,
    status: "pending",
    createdAt: now,
  };
  await storeSet(`checkout_${checkoutId}`, record);
  await storeSet(`order_${orderId}`, { checkoutId });

  return { ok: true, checkoutId, claimToken, checkoutUrl, tier };
}

async function fulfillCheckout(checkout: CheckoutRecord, now = Date.now()): Promise<{ code: string; pass: PassRecord }> {
  const code = await derivePassCode(checkout.id);
  const idxKey = await passIndexKey(code);
  let pass = await storeGet<PassRecord>(idxKey);
  if (!pass) {
    const tierMeta = PASS_TIERS[checkout.tier] ?? PASS_TIERS.meetup;
    pass = {
      codeHash: idxKey,
      code,
      checkoutId: checkout.id,
      tier: checkout.tier,
      label: tierMeta.label,
      hours: checkout.hours,
      durationMs: checkout.hours * 60 * 60_000,
      issuedAt: now,
      activatedAt: null,
      expiresAt: null,
    };
    await storeSet(idxKey, pass);
  }
  if (checkout.status !== "paid" || checkout.code !== code) {
    checkout.status = "paid";
    checkout.code = code;
    checkout.paidAt = checkout.paidAt ?? now;
    await storeSet(`checkout_${checkout.id}`, checkout);
  }
  return { code, pass };
}

export async function verifySquareSignature(rawBody: string, sigHeader: string | null): Promise<boolean> {
  if (!sigHeader || !isWebhookConfigured()) return false;
  const sigKey = env("SQUARE_WEBHOOK_SIGNATURE_KEY");
  const notifUrl = env("SQUARE_WEBHOOK_NOTIFICATION_URL");
  const mac = await hmacBytes(sigKey, notifUrl + rawBody);
  const expected = toBase64(mac);
  return sameStr(sigHeader.trim(), expected);
}

export async function handleSquareWebhook(
  rawBody: string,
  sigHeader: string | null,
  now = Date.now(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!isWebhookConfigured()) return { status: 503, body: { error: "webhook not configured" } };
  if (!(await verifySquareSignature(rawBody, sigHeader))) {
    return { status: 401, body: { error: "invalid signature" } };
  }
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }
  const payment = ((evt.data as Record<string, unknown> | undefined)?.object as Record<string, unknown> | undefined)
    ?.payment as Record<string, unknown> | undefined;
  const status = typeof payment?.status === "string" ? payment.status : "";
  const orderId = typeof payment?.order_id === "string" ? payment.order_id : "";

  if (status === "COMPLETED" && orderId) {
    const link = await storeGet<{ checkoutId?: string }>(`order_${orderId}`);
    if (link?.checkoutId) {
      const checkout = await storeGet<CheckoutRecord>(`checkout_${link.checkoutId}`);
      if (checkout) {
        await fulfillCheckout(checkout, now);
      }
    }
  }
  return { status: 200, body: { ok: true } };
}

export async function pollPassCheckout(
  checkoutId: string,
  claimToken: string | null,
  now = Date.now(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!/^[a-f0-9]{16,40}$/.test(checkoutId)) return { status: 404, body: { error: "unknown checkout" } };
  if (!claimToken) return { status: 401, body: { error: "claim token required" } };

  const checkout = await storeGet<CheckoutRecord>(`checkout_${checkoutId}`);
  if (!checkout) return { status: 404, body: { error: "unknown checkout" } };

  const providedHash = await sha256Hex(`stagetype-claim:${claimToken.trim()}`);
  if (!sameStr(providedHash, checkout.claimHash)) {
    return { status: 403, body: { error: "invalid claim token" } };
  }

  if (checkout.status === "paid" && checkout.code) {
    const tierMeta = PASS_TIERS[checkout.tier] ?? PASS_TIERS.meetup;
    return {
      status: 200,
      body: { status: "paid", code: checkout.code, tier: checkout.tier, label: tierMeta.label, hours: checkout.hours },
    };
  }

  // Podium resilience: if the presenter already returned from Square and the webhook is delayed,
  // check the Square Order directly (throttled to once every 3s per checkout).
  if (
    isPassCheckoutConfigured() &&
    checkout.orderId &&
    (!checkout.lastOrderCheckAt || now - checkout.lastOrderCheckAt >= ORDER_POLL_MIN_MS)
  ) {
    checkout.lastOrderCheckAt = now;
    await storeSet(`checkout_${checkout.id}`, checkout);
    try {
      const ordRes = await squareFetch("GET", `/v2/orders/${encodeURIComponent(checkout.orderId)}`);
      const order = ordRes.data.order as Record<string, unknown> | undefined;
      const state = typeof order?.state === "string" ? order.state : "";
      const tenders = Array.isArray(order?.tenders) ? order.tenders as Record<string, unknown>[] : [];
      const captured = state === "COMPLETED" ||
        tenders.some((t) => {
          const cardStatus = (t.card_details as Record<string, unknown> | undefined)?.status;
          return cardStatus === "CAPTURED" || t.type === "CASH" || t.type === "WALLET" || t.type === "SQUARE_GIFT_CARD";
        });
      if (captured) {
        const { code, pass } = await fulfillCheckout(checkout, now);
        return {
          status: 200,
          body: { status: "paid", code, tier: pass.tier, label: pass.label, hours: pass.hours },
        };
      }
    } catch {
      // Webhook path remains primary; ignore transient upstream hiccup during poll.
    }
  }

  return { status: 200, body: { status: "pending" } };
}

export async function inspectPass(
  rawCode: string,
  now = Date.now(),
): Promise<{
  valid: boolean;
  expired?: boolean;
  tier?: TierId;
  label?: string;
  hours?: number;
  activated?: boolean;
  expiresAt?: number | null;
  remainingMs?: number;
}> {
  if (!hasPassSecret()) return { valid: false };
  const canonical = normalizePassCode(rawCode);
  if (!canonical) return { valid: false };
  const idxKey = await passIndexKey(canonical);
  const pass = await storeGet<PassRecord>(idxKey);
  if (!pass) return { valid: false };

  if (pass.activatedAt === null || pass.expiresAt === null) {
    if (now - pass.issuedAt > UNUSED_SHELF_MS) return { valid: false, expired: true };
    return {
      valid: true,
      tier: pass.tier,
      label: pass.label,
      hours: pass.hours,
      activated: false,
      expiresAt: null,
      remainingMs: pass.durationMs,
    };
  }
  if (now >= pass.expiresAt) {
    return { valid: false, expired: true, tier: pass.tier, label: pass.label, hours: pass.hours };
  }
  return {
    valid: true,
    tier: pass.tier,
    label: pass.label,
    hours: pass.hours,
    activated: true,
    expiresAt: pass.expiresAt,
    remainingMs: pass.expiresAt - now,
  };
}

export async function validateAndActivatePass(
  rawCode: string,
  now = Date.now(),
): Promise<
  | { ok: true; remainingMs: number; tier: TierId; label: string; expiresAt: number }
  | { ok: false; reason: "invalid" | "expired" }
> {
  if (!hasPassSecret()) return { ok: false, reason: "invalid" };
  const canonical = normalizePassCode(rawCode);
  if (!canonical) return { ok: false, reason: "invalid" };
  const idxKey = await passIndexKey(canonical);
  const pass = await storeGet<PassRecord>(idxKey);
  if (!pass) return { ok: false, reason: "invalid" };

  if (pass.activatedAt === null || pass.expiresAt === null) {
    if (now - pass.issuedAt > UNUSED_SHELF_MS) return { ok: false, reason: "expired" };
    pass.activatedAt = now;
    pass.expiresAt = now + pass.durationMs;
    await storeSet(idxKey, pass);
    return { ok: true, remainingMs: pass.durationMs, tier: pass.tier, label: pass.label, expiresAt: pass.expiresAt };
  }
  if (now >= pass.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, remainingMs: pass.expiresAt - now, tier: pass.tier, label: pass.label, expiresAt: pass.expiresAt };
}
