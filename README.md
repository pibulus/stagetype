# 🎙️ StageType

> **"TalkType is for the desk. StageType is for the room."**

Live browser captions over slides and OBS, a wireless phone lapel mic, and an instant QR reader for every seat in the room. Built for guest speakers, workshop tutors, meetup hosts, churches, and lecturers who want warm, high-legibility captions and take-home notes straight from one open tab.

**Live:** [stage.talktype.app](https://stage.talktype.app) · [Live demo](https://stage.talktype.app/demo) · Part of the **TalkType** family.

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

**Try it:** open `/demo` on a laptop, scan the code with a phone, type. The code is private and only becomes a room when it is scanned.

---

## ✨ Why StageType?

### 1. Live Captions Over Every Window
Switch freely between Keynote, PowerPoint, VS Code, a terminal, and live browser tabs while captions stay pinned right on screen.

StageType's **Floating Ticker** uses the native **Document Picture-in-Picture API** to keep a crisp, high-contrast Swiss typography bar anchored over whichever window is on display.

### 2. Pocket Wireless Lapel Mic (Appendage Pattern)
Step away from the lectern and walk the stage freely using the phone already in a pocket.

Pictures ride along too: copy a screenshot anywhere, return to the console, and tap the one-click chip (or press ⌘V / Ctrl+V directly) to send it straight to every phone, compressed on-device and easy to pull back at any time.

StageType implements the **Appendage Architecture**: scan the **Mic** pairing QR code, slip the phone into a shirt pocket, and walk the stage freely. The phone captures voice, holds the screen awake via the Screen Wake Lock API, offers a one-tap **Pocket lock**, and streams transcript tokens straight to the room relay.

The handoff is automatic. When the phone goes live the console pauses the laptop mic, so one voice never lands in the transcript twice, and shows **Phone mic live**. Pause the phone and the laptop stays paused until you say otherwise (Space or Resume). If the phone drops out (battery, lock screen, wifi) the relay notices within 45 seconds and the laptop mic comes back on by itself, with a note saying so. Closing the mic tab hands back immediately.

### 3. It's a chat room, and anything can talk into it
Under the hood a talk is a room: something sends lines in, everything else reads them out. The laptop mic is one source. The phone lapel mic is another. The **typing box** on the console is the third: a captioner, a colleague fixing a name, or a presenter who doesn't speak can type a line and it lands on every phone, words showing as they're typed and the line settling on Enter. Reading side, the audience phones are one display, the stage ticker another, and the **standalone ticker page** (`/ticker/:id`) is the bar on its own for any second screen or an OBS browser source.

### 4. Join by four-letter code
Every talk gets a four-letter code (no I, O or Q, nothing rude). It's on the console, large on the projector card, and anyone can type it at `/join`. That's the back row, the overflow room on Zoom, and the screen-reader user who prefers typing a short code.

### 5. The Pocket Jumbotron & Post-Talk Export
In large lecture halls or crowded meetups, attendees in the back or individuals with neurodivergent/hearing differences can point their camera at the screen to read along live in their palm:
* **Client-Side Comfort Controls:** Attendees choose their own font size, loose dyslexic spacing, and theme (**Cream**, **Espresso**, **High-Contrast Black/Gold**, or **Night**).
* **Smooth Backlog Replay:** Late joiners catch up immediately on earlier lines with calm, steady scrolling.
* **Instant Take-Home Notes:** When the talk wraps, attendees copy, share, generate a 1-tap Quote Card PNG, download a prose `.md` file (with kept quotes and pinned links), or print a clean PDF. Saved talks reopen offline via Service Worker.

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
* **Phone Lapel Mic:** The room card carries one code. Hit **Mic** for the pairing code, scan it with your own phone, pocket it; the phone inherits the talk's language and engine.
* **Second screen or OBS:** Under Stage → Display, **Second screen** opens `/ticker/<roomId>?…` with the current bar prefs. In OBS add it as a browser source and size it as a strip, for example 1920 × 180.
* **Floating over Keynote needs Chrome or Edge.** The float uses Document Picture-in-Picture, which Safari and Firefox don't have. In those, use the standalone ticker page on a second display instead.

## ⌨️ Keyboard Shortcuts (Stage Console)

| Shortcut | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Start captions, then pause / resume the laptop mic (never ends the talk) |
| <kbd>⌥ + F</kbd> | Float the ticker over slides (Document Picture-in-Picture, Chrome or Edge) |
| <kbd>⌥ + Q</kbd> | Open Fullscreen QR Projector modal |
| <kbd>⌥ + R</kbd> | Shuffle the ticker look |
| <kbd>Esc</kbd> | Dismiss Fullscreen modal |

## 📚 Documentation

| Doc | What's in it |
| :--- | :--- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The chat-room model, relay API, speech engines, persistence, security, file map |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Running on the open web, Fly and Docker, environment variables, launch checklist, LAN rehearsals |
| [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | Contrast numbers, reader comfort controls, the curated typefaces |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Shared vocabulary |
| [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) | Exploratory fleet vision (StageType + ProMapper + Slide-o-Matic + ZipList) |
| [ROADMAP.md](ROADMAP.md) | Position, model, guardrails, and build order |
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
