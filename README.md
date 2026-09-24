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
| <kbd>Space</kbd> | Toggle live speech capture (Start / End) |
| <kbd>⌥ + F</kbd> | Float ticker window over slides (Document Picture-in-Picture) |
| <kbd>⌥ + Q</kbd> | Open Fullscreen QR Projector modal |
| <kbd>Esc</kbd> | Dismiss Fullscreen modal |

---

## 🛡️ Security & Privacy Architecture

* **Zero-Database, In-Memory Rooms:** Rooms and transcript buffers live strictly in RAM. A server restart wipes all history. Idle rooms self-destruct after 30 minutes of inactivity.
* **URL Fragment Token Security:** The administrative write token for the phone lapel mic is passed in the URL hash `#fragment` (e.g. `/mic/401dd18c#token`). Browsers never transmit `#fragments` over HTTP, preventing credentials from leaking into server access logs, reverse proxies, or referral headers.
* **Client-Side Speech Processing:** Audio capture and interim parsing run locally in the browser using the Web Speech API and Web Audio `AnalyserNode`.

---

## 🛠️ Project Structure

```
stagetype/
├── server.ts         # Zero-dependency Deno HTTP + SSE fan-out relay (~140 lines)
├── server_test.ts    # Test suite: room lifecycle, SSE events, TTL sweep
├── presenter.html    # Stage Console: VU meter, QR controller, floating ticker
├── audience.html     # Mobile reader: themes, dyslexic spacing, transcript export
├── mic.html          # Appendage lapel mic: wake lock, haptics, pocket guard
├── deno.json         # Task runner & compiler options
├── GLOSSARY.md       # Shared vocabulary and design primitives
└── CLAUDE.md         # Assistant ops and instructions
```

---

## 🧪 Testing

```bash
deno task test
```

Verifies the room lifecycle, token authorization, backlog delivery for late joiners, live SSE fan-out, and idle room garbage collection sweeps.

---

## 🌐 Mobile Rehearsals (HTTPS Tunnel)

Mobile Safari and mobile Chrome enforce HTTPS for microphone access (`getUserMedia` and Web Speech API are blocked over plain local `http://192.168.x.x`).

For wireless lapel mic rehearsals on a local network, expose the local port via `cloudflared`:

```bash
cloudflared tunnel --url http://localhost:8787
```

Scan the resulting `https://*.trycloudflare.com` QR code with your phone to use the phone as your wireless stage microphone.

---

## 📜 License

MIT License. Handcrafted by [Pablo Alvarado](https://github.com/pibulus). Built with personality, utility, and soul.
