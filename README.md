# 🎙️ StageType

> **"TalkType is for the desk. StageType is for the room."**

Live presentation captions ticker, zero-hardware wireless lapel mic, and instant audience QR reader. Built for guest speakers, workshop tutors, meetup hosts and university lecturers who want accessible, high-legibility live captions without an enterprise contract or a sales call.

Part of the **TalkType** family.

---

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

---

**Try it:** open `/demo` on a laptop, scan the code with your phone, type. The code is yours alone and only becomes a room when you scan it.

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

* **Stage Console:** Open [`http://localhost:8787`](http://localhost:8787) in Chrome or Edge. Give the talk a title, pick a language and an engine, hit **Start captions**. The QR card fills in with the audience link and a four-letter code.
* **Audience Reader:** Scan the generated QR code or navigate to `http://<your-lan-ip>:8787/live/<roomId>`.
* **Phone Lapel Mic:** Toggle the tab to **Phone lapel mic** and scan with your phone.
* **Second screen or OBS:** Under Stage Ticker, **Open on a second screen** opens `/ticker/<roomId>?…` with your current bar prefs. In OBS add it as a browser source and size it as a strip, for example 1920 × 180.
* **Floating over Keynote needs Chrome or Edge.** The float uses Document Picture-in-Picture, which Safari and Firefox don't have. In those, use the standalone ticker page on a second display instead.

## ⌨️ Keyboard Shortcuts (Stage Console)

| Shortcut | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Start captions, then pause / resume the laptop mic (never ends the talk) |
| <kbd>⌥ + F</kbd> | Float the ticker over slides (Document Picture-in-Picture, Chrome or Edge) |
| <kbd>⌥ + Q</kbd> | Open Fullscreen QR Projector modal |
| <kbd>Esc</kbd> | Dismiss Fullscreen modal |

## 📚 Documentation

| Doc | What's in it |
| :--- | :--- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The chat-room model, relay API, speech engines, persistence, security, file map |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Running on the open web, Fly and Docker, environment variables, launch checklist, LAN rehearsals |
| [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | Contrast numbers, reader comfort controls, the curated typefaces |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Shared vocabulary |
| [ROADMAP.md](ROADMAP.md) | Position, business model, numbers, guardrails, build order |
| [CLAUDE.md](CLAUDE.md) | Working rules for AI assistants on this repo, and a dense reference |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |

## 🧪 Testing

```bash
deno task ci     # format check, lint, typecheck, unit tests
deno task e2e    # browser suite: every page in headless Chromium against an in-process relay
```

The unit suite covers the room lifecycle, auth, backlog offsets, SSE fan-out, listener cleanup, limits, phone handoff, the Deepgram session against a mock, join codes, signed noise and demo rooms. The browser suite drives the console, reader, mic, ticker, join and demo pages end to end, including the phone handoff, persistence across reloads, exports and the Deepgram path. It needs Chromium: set `CHROMIUM_PATH`, or run `deno run -A npm:playwright@1.56.1 install chromium` once. Screenshots land in `e2e/screenshots/`.

## 📜 License

MIT License. Handcrafted by [Pablo Andres](https://github.com/pibulus). Built with personality, utility, and soul.
