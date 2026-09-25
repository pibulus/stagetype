# 🌐 The SoftStack Live Knowledge Loop (StageType · ProMapper · Slide-o-Matic · ZipList)

> *"A recursive, circular, organic sampler intelligence generation system."*  
> — Pablo Alvarado, September 2026

This document records the architectural synthesis of the SoftStack fleet as realized during the creation of **StageType**. It captures the closed-loop pipeline where speech, collective room presence, concept mapping, slide deck generation, and sovereign audience artifacts link together seamlessly.

---

## 🔁 The Core Accretion Flywheel

```
                             🎙️ THE ROOM SPEAKS
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │        STAGETYPE        │
                        │  - Phone lapel mic      │
                        │  - Floating PiP ticker  │
                        │  - Ambient crowd heat   │
                        └────────────┬────────────┘
                                     │ Live SSE stream or raw transcript
                                     ▼
                        ┌─────────────────────────┐
                        │        PROMAPPER        │
                        │  - Topic clustering     │
                        │  - Action item ticking  │
                        │  - Thermal weighting    │
                        └────────────┬────────────┘
                                     │ ?data=gz.<compressed_deck>
                                     ▼
                        ┌─────────────────────────┐
                        │      SLIDE-O-MATIC      │
                        │  - Neo-brutalist deck   │
                        │  - Quote/pillar layouts │
                        │  - Self-generating      │
                        └────────────┬────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │      THE SHOWBAG        │
                        │  - Audience take-home   │
                        │  - Zero-storage files   │
                        │  - ZipList portals      │
                        └────────────┬────────────┘
                                     │
                                     └───► Feeds back into ProMapper (Append loop)
```

### 1. StageType: The Sensory Anchor
- **Hardware-free capture**: Presenter slips their phone into their pocket (`/mic/:id#token`) with Screen Wake Lock and automatic laptop fallback.
- **Floating PiP Ticker (`⌥+F`)**: Document Picture-in-Picture keeps captions visible over terminals, slides, or code without breaking on `⌘+Tab`.
- **Jackbox-style 4-letter join codes**: `/join` gets anyone in the room reading on their own device with custom fonts (Atkinson Hyperlegible), dark themes, and dyslexic spacing.

### 2. Ambient Collective Presence (No Text, No Numbers)
- **Zero social noise**: No chat box, no troll moderation, no distracting `♥ 42` counters.
- **The Resonance Bloom**: When audience members tap or hold a sentence on their phone, the sentence softly radiates with an organic bioluminescent aura.
- **The Silent Thermal Map**: Under the hood, the room tracks which chunks had collective focus without displaying scoreboards to the crowd.
- **Ambient Room CSS**: Variables like `--crowd-energy` (0.0 to 1.0) subtly tune the background dot-grid warmth, lighting intensity, and mascot awareness.

### 3. The Single-Pass Hub Synthesis (80/20 Efficiency)
- The room has **one shared thermal timeline**.
- When the talk ends, the hub runs **one single synthesis pass** (via Gemini Flash or Claude Haiku).
- It bakes the Slide-o-Matic deck, the action items, and the summary in a single prompt.
- It compresses the result into a stateless URL parameter (`?data=gz.<base64url>`).
- 500 audience phones hit download and receive the exact same pre-baked artifact with **zero redundant API cost**.

### 4. Recursive Knowledge Accretion
- In multi-session workshops or lectures, session 2’s transcript appends directly into session 1’s existing ProMap.
- ProMapper recognizes when earlier open action items are resolved, cross-links new topics to previous clusters, and generates an updated cumulative slide deck.
- Knowledge accumulates organically across sessions instead of dying in forgotten documents.

### 5. The Showbag & ZipList Integration
- At the end of the talk, the reader's view transforms into an interactive **Showbag**:
  - The verbatim transcript (`.md`, `.txt`, print PDF).
  - The auto-generated Slide-o-Matic deck link.
  - The ProMapper concept map and unasked questions.
  - Pinned links dropped by the speaker during the talk.
  - The QRBuddy-style ethical stats trading card ("You were reader #42 of 68 · Busiest minute: 14:22").
- Checklists and action items open directly in **ZipList** with 1-tap portals.

---

## 🎨 Distinct Character & Identity

StageType is not TalkType. It does not wear TalkType's dessert peach gradient or its bedsheet ghost.

- **Vibe**: The Stage, the Beam, the Electric Night.
- **Palette ("Stage Lights")**:
  - Ground: Warm Ink `#1e1714` and Paper `#fffef7`.
  - Accents: Electric Mint `#00f5a0`, Cyber Cyan `#00d9f5`, Stage Violet `#7b61ff`, Hot Magenta `#d946ef`.
- **Character**: The Spotlight Luminaire / Retro Broadcast Capsule ("Lumen" / "Beam").
  - Adheres to the `softstack-mascot` 1024x1024 contract (`#mascot-body-path`, `#mascot-background`, `#mascot-eye-left-path`, `#mascot-eye-right-path`).
  - Modular eye-tracking, blink personality, and volume reactivity (`--vu`).

---

## 🎸 Politics & Commercial Model: The Garage Punk Band on GitHub

- **No Enterprise Procurement**: No RFPs, no 6-month sales cycles, no VPAT sales reps.
- **The Jackbox Viral Engine**: Every talk puts the QR code in front of 50–200 potential presenters. The audience is the distribution.
- **Ethical Commerce**:
  - Self-hosted / BYO key is 100% free and sovereign forever.
  - One-time Supporter Pass ($19–$29) unlocks hosted Deepgram + Translation and custom stage branding.
  - Palestine donation on sales: tech with moral gravity and political soul.

---

## ⚡️ Engine Tiering & Unit Economics (The Profit Vault)

By decoupling the high-cost STT tier from the synthesis tier, StageType achieves 97%+ margins on paid passes while offering an absurdly low-cost free tier:

| Tier | Speech-to-Text Engine | Post-Talk LLM Synthesis | Total Cost (45 min talk) | Business Logic |
| :--- | :--- | :--- | :--- | :--- |
| **Free / Community** | **Browser Web Speech** ($0.00) or **Groq Whisper Turbo** (~$0.03) | **Gemini 2.5 Flash-Lite** ($0.002) | **~$0.002 to $0.03** | Free users cost next to nothing. You can run 30+ full talks for $1.00. |
| **Taster / First Runs**| **Deepgram Nova-3** ($0.35) | **Gemini Flash Latest** ($0.018) | **~$0.37** | First 1–2 talks or `/demo` give the premium studio feel for pennies. |
| **Supporter Pass ($19–$29)** | **Deepgram Nova-3** ($0.35) | **Gemini Flash Latest** ($0.018) | **~$0.37** | **98% Gross Margin.** Presenter gets pristine custom keywords, diarization, and highest-fidelity decks. |

**The 80/20 Rule:**
- Paid passes ride Deepgram Nova-3 + Gemini Flash Latest.
- Free rooms fall back to Groq Whisper Turbo or Browser Speech + Gemini Flash-Lite.
- The Single Hub rule guarantees that whether 5 or 500 audience members download the Showbag, zero redundant AI tokens are ever consumed.

---

## 🎙️ The Voice & Soul: "The Whole Caboodle"

Never use corporate jargon or developer spec-bragging ("Deepgram Nova-3", "Speech Bank", "Unlimited AI"). No preaching, no "you".

We have all been conditioned to expect auto-captions to butcher every sentence ("beat up Martha"). StageType's freakishly accurate, buttery-smooth live streaming text blows people away because it captures the speaker's true cadence in real-time.

When the free cloud allocation finishes, the copy stays warm, playful, and grounded:
- **Pill State**: `[ Freakish accuracy · 42m ]` ➔ `[ Local mic · Always on ]`
- **Notice State**: *"Uh-oh, the ghost needs a breather. Local mic carries on from here—never cuts out. Unlock the whole caboodle to keep streaming perfect live text."*
- **The Philosophy**: No countdown anxiety. No locked screens in front of an auditorium. The speaker is always protected.


