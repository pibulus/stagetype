# 🎙️ StageType (CLAUDE.md)
> Live presentation captions ticker + wireless phone lapel mic + instant audience QR reader.
> Part of the TalkType family. Sovereign, zero-dependency, in-memory architecture.

## 🏃 Quick Start & Commands
```bash
deno task dev      # Start development server with auto-reload (port 8787)
deno task start    # Start production server
deno task test     # Run room lifecycle and SSE unit test suite
deno task check    # TypeScript type-checking
```

## 🌐 Routes & Ports
- Default port: `8787` (`http://localhost:8787`)
- Presenter Console: `GET /`
- Audience Live Reader: `GET /live/:roomId`
- Phone Lapel Mic: `GET /mic/:roomId#token`
- Network Discovery: `GET /api/info` (returns LAN IP and port for QR encoding)
- Static: `GET /vendor/qrcode.js` (vendored QR encoder, no CDN), `GET /ghost.svg` (favicon)
- Room Lifecycle API:
  - `POST /api/room` -> `{ id, token }` (capped at 1000 open rooms)
  - `POST /api/room/:id` (Bearer auth) -> pushes speech chunk `{ text, final }`; `{ ping: true }` is a silent keepalive
  - `GET /api/room/:id/stream` -> Server-Sent Events: `backlog { lines, offset, startedAt }`, `interim`, `final { text, seq }`, `end`
  - `DELETE /api/room/:id` (Bearer auth) -> ends talk and flushes room
- Invariants: token compared in constant time; push body ≤ 16 KB; backlog keeps last 400 lines and reports `offset`; every listener's ping timer is cleared on end/sweep (Deno's test sanitizer enforces this).

## 🎨 Design System & Aesthetic Laws
- **Soft Neo Toybrut**:
  - Ground: `#fffef7`
  - Paper: `#fbf1e4`
  - Ink: `#1e1714`
  - Line: `#3a2e28`
  - Pastels: Pink `#ffb3d1`, Mint `#b8f0d8`, Lilac `#d9c8ff`, Butter `#fff0a8`
- **Zero absolute white (`#fff`) or absolute black (`#000`)** across body and UI surfaces.
- **NO EMOJIS as button labels or copy garnish**. Keep buttons typographic and clear.
- `button { display: inline-flex }` beats the `hidden` attribute; keep the `button[hidden] { display: none }` rule.
- **Mascot**: TalkType ghost SVG in header with open eyes and subtle hover animation.

## 📱 Appendage Pattern (Phone as Lapel Mic)
- Phone connects via `/mic/:id#token`.
- Write token rides in `#hash`, keeping credentials client-side only.
- Audio capture via Web Speech API / `getUserMedia`.
- Screen Wake Lock active while broadcasting.
- Mobile browsers enforce HTTPS for mic capture (`cloudflared tunnel --url http://localhost:8787` for mobile rehearsals).
- Never project the mic QR: it carries the write token. The fullscreen modal copy says so.

## 🧭 Presenter Rules
- Space toggles mic pause/resume, never ends the talk. Ending is a deliberate click.
- Finals reach the ticker via the SSE echo (works for laptop and phone mic alike); local push only if the relay is unreachable.
- Fatal recogniser errors (`not-allowed`, `audio-capture`, ...) pause instead of restart-looping.
