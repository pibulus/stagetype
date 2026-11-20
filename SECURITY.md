# Security

## Reporting a vulnerability

Please email **pibulus@gmail.com** with "StageType security" in the subject, rather than opening a public issue. Include what you found, how to reproduce it, and what you think the impact is. You'll get a reply within a week.

## What StageType protects

- **Write access to a room.** Only holders of the room's token can add captions, pin links, share images, or end a talk. Tokens are 32 hex characters, compared in constant time, sent in an `Authorization` header or WebSocket subprotocol, and never in an HTTP path or query string. The phone mic link carries its token in the `#fragment` and moves it to `sessionStorage` when going live.
- **The relay's resources.** Room creation, demo minting, and join-code lookups (`/api/join/:code` and `/j/:code`) are rate-limited per client IP (with `TRUST_PROXY=cloudflare|fly` isolation). Listeners, backlog length, push body size, streaming multipart image uploads (magic-byte sniffed + global RAM cap), demo rooms, and concurrent Deepgram sessions are all capped. Demo ids are HMAC-signed and stored nowhere until scanned.
- **Keys and speech relays.** The Deepgram key lives only on the relay and browsers never see it. Public relays with Deepgram enabled can gate WebSocket audio upgrades behind `STAGETYPE_DEEPGRAM_PASS` (base64url-encoded in the `pass-b64` subprotocol).

## Ephemeral by design

- **Public rooms for live talks.** Anyone with the live link or four-letter join code can read captions while the talk is open.
- **Device-owned transcripts.** Talks run live in memory, and saved copies live directly on the devices that were in the room (reopening offline via Service Worker).
- **Browser speech vs. relay/local speech.** The built-in Browser engine routes audio through the browser's speech service (Google/Apple). Use Deepgram or `deno task listen-local` with a local on-device transcriber whenever audio should stay off third-party browser services.

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-and-privacy).
