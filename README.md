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

### 3. The Pocket Jumbotron & Post-Talk Export
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
* **No CDN at runtime.** The QR encoder is vendored in `vendor/qrcode.js`, so the console works on venue wifi with no internet and nothing third-party loads into the presenter page.

---

## 🛠️ Project Structure

```
stagetype/
├── server.ts         # Zero-dependency Deno HTTP + SSE fan-out relay (~200 lines)
├── server_test.ts    # Test suite: room lifecycle, SSE events, limits, TTL sweep
├── presenter.html    # Stage Console: VU meter, QR controller, floating ticker
├── audience.html     # Mobile reader: themes, dyslexic spacing, transcript export
├── mic.html          # Appendage lapel mic: wake lock, haptics, pocket guard
├── ghost.svg         # Favicon / home-screen icon
├── vendor/qrcode.js  # Vendored QR encoder (MIT, Kazuhiko Arase) so nothing loads from a CDN
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

## 🎛️ Plain or playful

The presenter console has a **Playful details** switch, on by default. Turn it off for a lecture, a clinical setting, or a board room: the audience pages drop the confetti, the wink in the copy, and the coloured ring on the stage ticker, and the talk ends with "Talk ended" instead of "That's a wrap". The console itself keeps its personality either way, because only you see it. A **talk title** ("COMP1010 Week 3") shows on every phone, in the projector QR card, and in the exported file name and Markdown header.

## 🔌 Relay API

| Method | Path | Auth | What |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/room` | none | Open a room; optional body `{ title, playful }` → `{ id, token, title, playful }` |
| `POST` | `/api/room/:id` | Bearer token | Push `{ text, final }`; `{ ping: true }` is a keepalive that broadcasts nothing |
| `GET` | `/api/room/:id/stream` | none | SSE: `backlog { lines, offset, startedAt, title, playful }`, then `interim { text }`, `final { text, seq }`, `end` |
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
