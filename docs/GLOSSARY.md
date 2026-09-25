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

#### 🔤 Join Code
Four letters (no I, O, Q; nothing rude) shown beside the audience QR and large on the projector card. Typed at `/join` or used as `/j/CODE`. Released when the talk ends.

#### 🧾 Typing Box
The console's text field. A third source alongside the two mics: words show as interim while typed, Enter sends the line. For CART captioners, corrections, or talks with no mic.

#### 📺 Standalone Ticker (`ticker.html` / `/ticker/:id`)
The bar on its own, full-bleed, styled by query string. For a second display in any browser, and as an OBS browser source so livestreams get captions.

#### 🎧 Engine
Where speech becomes text. **Browser** is the device's own recogniser (free, zero setup). **Deepgram** streams PCM from the page to the relay, which holds the key and forwards to Deepgram; results come back as ordinary room pushes. Chosen per device: console or phone.

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
