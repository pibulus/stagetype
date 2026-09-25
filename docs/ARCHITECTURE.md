# Architecture

StageType is a chat room. **Sources** send lines in, the **relay** fans them out, **displays** read them. The relay only ever sees text, keeps nothing beyond an open room's last 400 lines, and runs as one small Deno process.

```
  SOURCES                            RELAY                              DISPLAYS
  ───────                            ─────                              ────────
  Laptop mic (browser speech)  ┐                                    ┌  Audience phones  /live/:id
  Phone lapel mic   /mic/:id   ├─ POST /api/room/:id ─┐        ┌───┤  Console ticker and PiP float
  Typing box on the console    ┘                      ▼        │    ├  Standalone ticker /ticker/:id
  Deepgram (audio over WS) ──── /api/room/:id/audio ─► server.ts ──┤  OBS browser source
                                                    pushChunk()│    └  Demo page      /demo
                                                   in memory   └── SSE /api/room/:id/stream
```

Everything that adds words goes through `pushChunk()` in `server.ts`. New capability should be a new source or a new display, not a new server feature.

## Relay API

| Method | Path | Auth | What |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/room` | none | Open a room; optional body `{ title }` → `{ id, token, title, code }` |
| `GET` | `/api/join/:code` | none | Resolve a four-letter join code → `{ id }` (404 when no open talk has it) |
| `GET` | `/j/:code` | none | Short link: 302 to `/live/:id`, or to `/join?nope=CODE` |
| `GET` | `/join` | none | Type-the-code page (also served at `/live`) |
| `GET` | `/ticker/:id` | none | The bar on its own; prefs in the query string |
| `POST` | `/api/room/:id` | Bearer token | Push `{ text, final, source }`; `source` is `mic` (default), `phone` or `typed`. `{ ping: true }` is a keepalive that broadcasts nothing. `{ ping: true, source: "phone", live: true\|false }` announces the phone mic and heartbeats it while live |
| `GET` | `/api/room/:id/stream` | none | SSE: `backlog { lines, offset, startedAt, title, phone }`, then `interim { text, source }`, `final { text, seq, source }`, `source { source: "phone", live, lost }` on handoffs, `end` |
| `DELETE` | `/api/room/:id` | Bearer token | End the talk and drop the room |
| `GET` | `/api/info` | localhost only | `{ lan }` base URL for QR codes |
| `GET` | `/api/engines` | none | `{ browser: true, deepgram: bool }` |
| `GET` | `/demo` | none | The live demo: a private signed QR per visitor |
| `GET` | `/api/demo/mint` | none | `{ id, sig, exp, token }`. Stores nothing |
| `GET` | `/api/demo/:id?s=sig` | signature | `{ alive, listeners }` |
| `WS` | `/api/room/:id/audio?source=mic\|phone&lang=xx` | subprotocol `bearer, <token>` | 16 kHz mono PCM in; `{ ready }`, `{ interim }`, `{ final }`, `{ error }` JSON back; send `{ "type": "stop" }` to finish |

`offset` is how many old lines the server has already trimmed from the backlog (it keeps the last 400), so a phone that reconnects mid-talk can line up exactly where it left off.

## Speech engines

The relay is a chat room and the speech engine is just a source. Two ship:

| Engine | Where it runs | Cost | Notes |
| :--- | :--- | :--- | :--- |
| **Browser** | Chrome / Edge / Safari's own recogniser | free | Zero setup. Chrome and Edge send the audio to Google, Safari to Apple. Accuracy is fine, punctuation patchy. |
| **Deepgram** | The relay streams your mic to Deepgram | under a cent a minute | Punctuation, smart formatting, 30-plus languages, ~300 ms. Needs a key on the relay. |

Pick the engine on the console (This Talk → Engine) or on the phone mic page. With Deepgram the page captures 16 kHz PCM in an AudioWorklet and streams it over a WebSocket to `/api/room/:id/audio`; the relay holds the key, forwards to Deepgram, and turns each finished utterance into an ordinary room push. The browser never sees the key and the relay never stores audio.

To turn it on, give the relay a key:

```bash
DEEPGRAM_API_KEY=dg_… deno task start        # locally
fly secrets set DEEPGRAM_API_KEY=dg_…         # on Fly
```

`DEEPGRAM_MODEL` (default `nova-3`) and `DEEPGRAM_URL` (for a proxy or a test double) are optional. Without a key the Deepgram option is greyed out with a note, and the browser engine carries on. The unit and browser suites exercise the whole path against a mock upstream, so the plumbing is proven; a real key is the only thing this repo hasn't run with.

## The transcript survives

* **On every phone.** The reader stashes each finished line under the room id as it arrives. Close the tab, lock the phone, open the link a week later: the talk is there, with the export card. The join page lists **Saved talks** on that phone.
* **On the console.** The presenter keeps the full transcript (not just the ticker's tail), can copy or save it as .txt or .md at any point, and finds the last ten talks under **Previous talks** on that machine.
* **Through a reload.** If the console tab reloads mid-talk, it picks the same room back up, restores the transcript, and starts listening again. Phones never notice.

Nothing is stored on the server beyond the last 400 lines of an open room. That's the sovereign part: the copies live with the people who were in the room.

## Security and privacy

* **Zero-Database, In-Memory Rooms:** Rooms and transcript buffers live strictly in RAM. A server restart wipes all history. Idle rooms self-destruct after 30 minutes of inactivity; the open presenter console sends a keepalive so a long Q&A or lunch break doesn't end the talk.
* **URL Fragment Token Security:** The administrative write token for the phone lapel mic is passed in the URL hash `#fragment` (e.g. `/mic/401dd18c#token`). Browsers never transmit `#fragments` over HTTP, preventing credentials from leaking into server access logs, reverse proxies, or referral headers. **Don't project the lapel-mic QR:** anyone who scans it can write captions into your room. Scan it from the console yourself; the fullscreen projector view is for the audience QR.
* **Abuse limits:** room creation, listeners per room, backlog length and push body size are all capped, and the write token is compared in constant time.
* **The relay never sees audio.** Only text reaches the server. The speech-to-text itself is the browser's Web Speech API, which in Chrome and Edge streams your microphone audio to Google's recognition service and in Safari to Apple's. If a talk must stay fully on-device, that's the piece to swap (see [ROADMAP.md](../ROADMAP.md)). The console's level animation, the ghost, is computed locally with a Web Audio `AnalyserNode` and never leaves the tab.
* **No CDN at runtime.** The QR encoder and the fonts are vendored under `vendor/`, so every page works on venue wifi with no internet and nothing third-party loads into any page.
* **Signed demo ids.** `/demo` rooms use `signed_noise.ts`: HMAC-signed random ids that are stored nowhere and only become rooms when a phone opens them. Made-up ids never verify.

See [SECURITY.md](../SECURITY.md) for reporting.

## Project structure

```
stagetype/
├── server.ts         # Zero-dependency Deno HTTP + SSE fan-out relay (~420 lines)
├── server_test.ts    # Unit tests: rooms, SSE, limits, handoff, Deepgram session, demo, signing
├── presenter.html    # Stage console: talk setup, voice, stage ticker, transcript, QR card
├── audience.html     # Mobile reader: themes, dyslexic spacing, transcript export
├── mic.html          # Appendage lapel mic: wake lock, haptics, pocket guard
├── ticker.html       # The bar alone: second screens and OBS browser sources
├── join.html         # Four-letter code entry for people who can't scan
├── demo.html         # Live demo: signed QR per visitor, type on the laptop, read on the phone
├── signed_noise.ts   # Zero-dep HMAC ids that only become real when used (also for QR Buddy)
├── ROADMAP.md        # Position, model, numbers, build order
├── ghost.svg         # Favicon / home-screen icon
├── vendor/qrcode.js  # Vendored QR encoder (MIT, Kazuhiko Arase) so nothing loads from a CDN
├── vendor/fonts.css  # @font-face for the five curated faces (all OFL), plus the --face-* stacks
├── vendor/fonts/     # Inter, Atkinson Hyperlegible, Fraunces, JetBrains Mono as woff2 (Latin + Latin Ext)
├── deepgram.js       # Browser side of the Deepgram source: AudioWorklet PCM capture + WebSocket to the relay
├── deno.json         # Task runner & compiler options
├── Dockerfile        # One process, one box; used by fly.toml or any Docker host
├── fly.toml          # A single never-sleeping Fly machine
├── e2e/              # Browser suite (Playwright) and the shared mock Deepgram
├── docs/             # Architecture, deploy, accessibility, glossary
├── SECURITY.md       # Reporting vulnerabilities
├── .env.example      # Every environment variable, documented
└── CLAUDE.md         # Assistant ops and instructions
```
