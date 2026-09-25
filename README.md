# 🎙️ StageType

> **"TalkType is for the desk. StageType is for the room."**

Live presentation captions ticker, zero-hardware wireless lapel mic, and instant audience QR reader. Built for guest speakers, workshop tutors, meetup hosts, and university lecturers who want accessible, high-legibility real-time captions without paying $5,000/year for bloated enterprise software.

Part of the **TalkType** family.

---

```
                       ┌────────────────────────────────┐
                       │      PRESENTER ON STAGE        │
                       │   Mac Laptop or Phone Mic      │
                       └──────────────┬─────────────────┘
                                      │
                         HTTP POST /api/room/:id
                                      │
                                      ▼
                       ┌────────────────────────────────┐
                       │     DENO IN-MEMORY RELAY       │
                       │     (server.ts · Zero Deps)    │
                       └──────────────┬─────────────────┘
                                      │
                         SSE Fan-Out Stream (/stream)
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│     FLOATING STAGE TICKER     │               │     AUDIENCE MOBILE PHONES    │
│  Always-on-top PiP bar docked │               │   Zero-install web reader     │
│   over Keynote / VS Code /    │               │  Custom typography, themes,   │
│       Terminal / Chrome       │               │   and instant export (.md)    │
└───────────────────────────────┘               └───────────────────────────────┘
```

---

## ✨ Why StageType?

### 1. The App-Switcher's Safety Net
Native captioning in Google Slides and PowerPoint dies the second you `⌘ + Tab` out of full-screen slideshow mode to demonstrate code in VS Code, run commands in a terminal, or walk through a web app. 

StageType's **Floating Ticker** uses the native **Document Picture-in-Picture API** to keep a crisp, high-contrast Swiss typography bar pinned on top of whatever window or screen you are sharing.

### 2. The Zero-Hardware Lapel Mic (Wii U Appendage Pattern)
Presenters are normally tethered to their MacBook's built-in microphone at the lectern or stuck troubleshooting Bluetooth AirPods. 

StageType implements the **Appendage Architecture**: scan the **Phone lapel mic** QR code, slide your smartphone into your shirt pocket, and walk the stage freely. Your phone captures your voice, keeps the screen awake via the Screen Wake Lock API, and streams transcript tokens straight to the room relay.

The handoff is automatic. When the phone goes live the console pauses the laptop mic, so one voice never lands in the transcript twice, and shows **Phone mic live**. Pause the phone and the laptop stays paused until you say otherwise (Space or Resume mic). If the phone drops out (battery, lock screen, wifi) the relay notices within 45 seconds and the laptop mic comes back on by itself, with a note saying so. Closing the mic tab hands back immediately.

### 3. It's a chat room, and anything can talk into it
Under the hood a talk is a room: something sends lines in, everything else reads them out. The laptop mic is one source. The phone lapel mic is another. The **typing box** on the console is the third: a captioner, a colleague fixing a name, or a presenter who doesn't speak can type a line and it lands on every phone, words showing as they're typed and the line settling on Enter. Reading side, the audience phones are one display, the stage ticker another, and the **standalone ticker page** (`/ticker/:id`) is the bar on its own for any second screen or an OBS browser source.

### 4. Join by code, Jackbox-style
Every talk gets a four-letter code (no I, O or Q, nothing rude). It's on the console, large on the projector card, and anyone can type it at `/join`. That's the back row, the overflow room on Zoom, and the screen-reader user who can't scan a projector.

### 5. The Pocket Jumbotron & Post-Talk Export
In large lecture halls or crowded meetups, attendees in the back or individuals with neurodivergent/hearing differences can point their camera at the screen to read along live in their palm:
* **Client-Side Comfort Controls:** Attendees choose their own font size, loose dyslexic spacing, and theme (**Cream**, **Espresso**, **High-Contrast Black/Gold**, or **Night**).
* **Smooth Backlog Replay:** Late joiners instantly receive previous sentences without jarring layout shifts.
* **Instant Take-Home Notes:** When the talk wraps, attendees download the formatted lecture transcript as `.md`, `.txt`, or print a clean PDF with one tap.

---

## 🚀 Quick Start

### Prerequisites
* [Deno](https://deno.com) (v1.40+ or v2.0+)

### Running Locally
```bash
# Clone the repository
git clone https://github.com/pibulus/stagetype.git
cd stagetype

# Start development server with file-watching
deno task dev
```

* **Stage Console:** Open [`http://localhost:8787`](http://localhost:8787) in Chrome or Edge.
* **Audience Reader:** Scan the generated QR code or navigate to `http://<your-lan-ip>:8787/live/<roomId>`.
* **Phone Lapel Mic:** Toggle the tab to **Phone lapel mic** and scan with your phone.
* **Second screen or OBS:** Under Stage Ticker, **Open on a second screen** opens `/ticker/<roomId>?…` with your current bar prefs. In OBS add it as a browser source and size it as a strip, for example 1920 × 180.
* **Floating over Keynote needs Chrome or Edge.** The float uses Document Picture-in-Picture, which Safari and Firefox don't have. In those, use the standalone ticker page on a second display instead.

---

## ⌨️ Keyboard Shortcuts (Stage Console)

| Shortcut | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Start captions, then pause / resume the laptop mic (never ends the talk) |
| <kbd>⌥ + F</kbd> | Float ticker window over slides (Document Picture-in-Picture) |
| <kbd>⌥ + Q</kbd> | Open Fullscreen QR Projector modal |
| <kbd>Esc</kbd> | Dismiss Fullscreen modal |

---

## 🛡️ Security & Privacy Architecture

* **Zero-Database, In-Memory Rooms:** Rooms and transcript buffers live strictly in RAM. A server restart wipes all history. Idle rooms self-destruct after 30 minutes of inactivity; the open presenter console sends a keepalive so a long Q&A or lunch break doesn't end the talk.
* **URL Fragment Token Security:** The administrative write token for the phone lapel mic is passed in the URL hash `#fragment` (e.g. `/mic/401dd18c#token`). Browsers never transmit `#fragments` over HTTP, preventing credentials from leaking into server access logs, reverse proxies, or referral headers. **Don't project the lapel-mic QR:** anyone who scans it can write captions into your room. Scan it from the console yourself; the fullscreen projector view is for the audience QR.
* **Abuse limits:** room creation, listeners per room, backlog length and push body size are all capped, and the write token is compared in constant time.
* **The relay never sees audio.** Only text reaches the server. The speech-to-text itself is the browser's Web Speech API, which in Chrome and Edge streams your microphone audio to Google's recognition service and in Safari to Apple's. If a talk must stay fully on-device, that's the piece to swap (see Roadmap). The VU meter is local (Web Audio `AnalyserNode`) and never leaves the tab.
* **No CDN at runtime.** The QR encoder and the fonts are vendored under `vendor/`, so every page works on venue wifi with no internet and nothing third-party loads into any page.

---

## 🛠️ Project Structure

```
stagetype/
├── server.ts         # Zero-dependency Deno HTTP + SSE fan-out relay (~200 lines)
├── server_test.ts    # Test suite: room lifecycle, SSE events, limits, TTL sweep
├── presenter.html    # Stage Console: VU meter, QR controller, floating ticker
├── audience.html     # Mobile reader: themes, dyslexic spacing, transcript export
├── mic.html          # Appendage lapel mic: wake lock, haptics, pocket guard
├── ticker.html       # The bar alone: second screens and OBS browser sources
├── join.html         # Four-letter code entry for people who can't scan
├── ghost.svg         # Favicon / home-screen icon
├── vendor/qrcode.js  # Vendored QR encoder (MIT, Kazuhiko Arase) so nothing loads from a CDN
├── vendor/fonts.css  # @font-face for the five curated faces (all OFL), plus the --face-* stacks
├── vendor/fonts/     # Inter, Atkinson Hyperlegible, Fraunces, JetBrains Mono as woff2 (Latin + Latin Ext)
├── deno.json         # Task runner & compiler options
├── GLOSSARY.md       # Shared vocabulary and design primitives
└── CLAUDE.md         # Assistant ops and instructions
```

---

## 🧪 Testing

```bash
deno task test
```

Verifies the room lifecycle, token authorization, backlog delivery for late joiners (with the trim offset that keeps reconnects exact), live SSE fan-out, listener cleanup on end, keepalive pings, the room / body-size caps, and idle room garbage collection sweeps.

---

## ♿ Accessibility

StageType exists so the people at the back, the people who can't hear the speaker, and the people who process text better than speech all get the talk. Some numbers a disability services office can check:

| Reader theme | Live line | Earlier lines | Small UI text |
| :--- | :--- | :--- | :--- |
| Cream (`#1e1714` on `#fbf1e4`) | 15.8:1 | 8.1:1 | 4.7:1 |
| Espresso (`#fbf1e4` on `#1e1714`) | 15.8:1 | 10.0:1 | 6.6:1 |
| Contrast (`#1e1714` on `#fff0a8`) | 15.4:1 | 8.0:1 | 4.6:1 |
| Night (`#fff0a8` on `#1e1714`) | 15.4:1 | 9.7:1 | 6.4:1 |
| Stage ticker (`#fffef7` on `#1e1714`) | 17.5:1 | 6.0:1 | |

Every caption line clears WCAG AAA (7:1); secondary UI text clears AA (4.5:1). Beyond colour: the reader has a 14 to 56 px type scale, a loose-spacing mode for dyslexic readers, `aria-live` regions that announce finished sentences but not the in-progress fragment, full keyboard focus rings, and every animation honours `prefers-reduced-motion`. The transcript is downloadable as plain text or Markdown so it can go into a screen reader, a notes app, or an LMS.

## 🔤 Typography, curated

Five faces, all SIL Open Font License, vendored in `vendor/fonts/` so they load on venue wifi with no internet. Readers pick theirs in the Aa panel on their own phone; the presenter picks the stage ticker's on the console. Nobody has to touch either: the default is the Swiss system look.

| Face | Why it's here |
| :--- | :--- |
| System (Helvetica / SF) | Zero bytes, invisible, the stage default |
| Inter | Clean humanist grotesk, tall x-height, variable weight |
| Atkinson Hyperlegible | Designed by the Braille Institute for low-vision readers; letterforms that can't be confused for each other |
| Fraunces | Warm soft serif at its softest setting, for rooms that want a friendlier voice |
| JetBrains Mono | For the dev talk, where captions read like the code on screen |

Weight is three stops (Regular, Medium, Bold). **Flow** is two: *Live words* streams the in-progress fragment as it's recognised; *Settled sentences* shows finished sentences only, which is calmer on a six-metre screen and for readers who find the flicker tiring. The stage ticker also chooses its **style** (Ink, a dark bar; Paper, a light one for bright rooms and light decks), **depth** (one to three lines) and **ring** colour (or none). The same options ride the standalone ticker's query string: `style`, `face`, `weight`, `size` (px), `depth`, `flow`, `ring`. Webfonts cover Latin and Latin Extended; other scripts fall through to the system stack.

A **talk title** ("COMP1010 Week 3") shows on every phone, on the projector QR card, and in the exported file name and Markdown header.

## 🔌 Relay API

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

`offset` is how many old lines the server has already trimmed from the backlog (it keeps the last 400), so a phone that reconnects mid-talk can line up exactly where it left off.

## 🌐 Mobile Rehearsals (HTTPS Tunnel)

Mobile Safari and mobile Chrome enforce HTTPS for microphone access (`getUserMedia` and Web Speech API are blocked over plain local `http://192.168.x.x`).

For wireless lapel mic rehearsals on a local network, expose the local port via `cloudflared`:

```bash
cloudflared tunnel --url http://localhost:8787
```

Scan the resulting `https://*.trycloudflare.com` QR code with your phone to use the phone as your wireless stage microphone.

The same applies to the audience: a QR that points at `http://192.168.x.x:8787` only works for phones on the same wifi. At a meetup where people are on cellular, run the presenter console through the tunnel URL (or a small public host) so the audience QR is reachable from anywhere. The relay is a single process with rooms in memory, so it wants one instance, not a serverless fleet.

## 🗺️ Roadmap

* **On-device speech** for talks that must not leave the room: Chrome's `SpeechRecognition` on-device mode (`processLocally`) where available, or a WebGPU Whisper worker as the fallback.
* **Live translation** so each phone picks its own language.
* **Hosted edition** at a stable URL so the audience QR works on cellular without a tunnel.

---

## 📜 License

MIT License. Handcrafted by [Pablo Andres](https://github.com/pibulus). Built with personality, utility, and soul.
