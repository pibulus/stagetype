# 📖 StageType Glossary

> "TalkType is for the desk. StageType is for the room."

Shared vocabulary, architecture primitives, and mental models across the StageType platform.

---

### Core Concepts

#### 🎙️ Stage Console (`presenter.html` / `/`)
The presenter's mission control deck. Manages room creation, Web Audio VU level metering, language targeting, QR broadcast displays, and live ticker previews. Connects to the room's SSE stream so speech from either the local laptop mic or a paired wireless phone mic updates the console in real time.

#### 🪟 Floating Ticker
The high-contrast, always-on-top caption bar. In the browser, it leverages Chrome/Edge's **Document Picture-in-Picture API** (`requestWindow`) to stay pinned over full-screen Keynote, PowerPoint, terminal sessions, or browser tabs. Renders the *Rolling Tail* so long talks never overflow the display.

#### 📱 Appendage Mic (`mic.html` / `/mic/:id#token`)
The Wii U / Appendage pattern: transforms a presenter's phone into a wireless stage lapel mic. Uses the device's microphone, locks the screen awake via the Screen Wake Lock API, provides haptic feedback, and includes a double-tap confirmation guard to prevent pocket accidents.

#### 👥 Audience Reader (`audience.html` / `/live/:id`)
The zero-install, zero-auth viewport for attendees. Opens instantly in any mobile browser when scanning the presenter's QR code. Provides client-side reading comfort controls: 4 themes (Cream, Espresso, Contrast, Night), dyslexic loose spacing, font scaling, jump-to-live auto-scroll, and post-talk Markdown/TXT/PDF export.

#### ⚡ SSE Fan-Out Relay (`server.ts`)
A zero-dependency Deno server running an in-memory Server-Sent Events (SSE) broadcast. It handles room creation, token authorization, backlog delivery for late joiners, keep-alive heartbeats, and instant fan-out of text tokens to hundreds of phones under 50ms latency.

#### 📜 The Rolling Tail
The presentation viewport pattern that shows only the last two finalized sentences followed by the active interim speech chunk. The newest tokens render bright white while preceding lines gently dim, maintaining instant readability without jarring scroll jumps.

#### 🔑 Fragment Token Security
The security design where presenter authorization tokens ride strictly inside the URL hash `#fragment` (e.g. `/mic/401dd18c#token`). Browsers never transmit URL fragments over HTTP requests, preventing room administrative tokens from leaking into server access logs, reverse proxies, or referral headers.

---

### Shortcuts & Controls

| Shortcut | Action | Scope |
| :--- | :--- | :--- |
| `Space` | Start captions, then pause / resume the laptop mic | Stage Console |
| `⌥ + F` | Float Ticker over slides (Document PiP) | Stage Console |
| `⌥ + Q` | Open Fullscreen QR Projector Modal | Stage Console |
| `Esc` | Close Fullscreen Projector Modal | Stage Console |
| `⌘ + P` | Print or Save PDF Transcript | Audience Reader |
