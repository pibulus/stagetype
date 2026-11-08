# StageType: where it's going and why

A living note of the product and business thinking behind StageType, so decisions don't evaporate between sessions. Update it when a decision is made or reversed.

## The one-line position

**Wordly is the one you book a demo for. StageType is the one you just open.**

Same job, a tenth of the price, none of the ceremony, open source, and nicer to look at. The Plausible-versus-Google-Analytics play.

## The two acts (the pitch in one breath)

**During the talk:** speak at the desk, and the room reads along. A bar under the slides, a giant ticker on the spare screen, and every phone in the back row scrolling at its own size.

**After the talk:** everyone leaves with the talk in their pocket. The live stream settles into a note they can keep: the transcript, the lines they tapped to keep, and the links that were spoken or typed into the stage.

That second act is why the QR gets scanned by the whole room and not just the people who need captions. Accessibility stops being a separate lane and becomes the default handout.

## What we're actually selling

Floating captions are becoming free plumbing: macOS Live Captions, PowerPoint live subtitles and Chrome Live Caption all put words over a screen at no cost. Don't sell the ticker.

Sell what none of them do: **the room's own phones**, each reader in their own type, size, theme and (soon) language, **keeping the transcript** and a **bag** of the talk's links when they walk out.

## The model: Jackbox, literally

| Part | Price | Why |
| :--- | :--- | :--- |
| Audience reader | Free forever, web, no install, no account | The growth loop: every talk puts the QR in front of a room |
| Web console and relay | Free and open source, self-hostable | Trust, reach, Windows and Linux presenters, the sovereign story |
| Mac host app | One-time purchase | Floats over anything without Chrome, on-device speech so no per-minute cost, menubar. Cross-sold to TalkType users |
| Passes | Per event-hour | Deepgram quality and live translation cost real money per minute. A payment link returns a pass code the console accepts. No accounts needed |

Windows later: Tauri or Electron around the same web console, only once the Mac app has proven the host-app idea.

## The numbers (checked September 2026)

| | Our cost per talk-hour | What buyers pay |
| :--- | :--- | :--- |
| Relay, text fan-out | close to zero | |
| Browser speech | zero | |
| Deepgram Nova-3 streaming | about $0.46 at list price | |
| Translation per language | cents to about $1 | |
| Wordly | | $150/hour at entry (10 hours for $1,500), about $75/hour at volume |
| Human CART captioner | | $75 to $300 an hour |
| **StageType pass, suggested** | **$1 to $5 with a few languages** | **$10 to $15 an hour** |

Translation cost scales with the number of languages, not listeners: each line is translated once per language, then fanned out.

## Who first

1. **Conference and meetup organisers.** They feel the pain, have an accessibility or translation budget line, and buy per event. Every differentiator shows up at once.
2. **Lecturers**, free, as the way into universities. Disability services come later with the budget. Needs a VPAT and a privacy story before procurement.
3. **Churches**, the sleeper: weekly services, multilingual congregations, OBS already running, and orphaned by Web Captioner's shutdown. Wordly has one in its customer carousel.

## Guardrails

- **Not a CART replacement.** AI captions aren't a legal accommodation for a Deaf student who needs verbatim accuracy. Pitch: captions for every talk that never had a captioner booked.
- **Privacy is the procurement question.** The browser engine sends audio to Google or Apple. On-device speech in the Mac app is the answer.
- **Reliability before features.** A failure in front of 300 people is a support ticket with feelings.
- **No sponsor slots on captions.** Wordly sells them. Not doing that is part of the pitch.
- **Classy is the ceiling.** See CLAUDE.md.

## Open decision: the licence

StageType is MIT today. MIT lets anyone host it and sell it back to our customers. If a hosted service is part of the plan, relicense the relay and pages to **AGPL-3.0** while Pablo is the only author (Plausible and Cal.com do this). Vendored fonts and the QR encoder keep their own licences. **Decided September 2026: Pablo is fine with AGPL, deferred until a hosted service is close.** Still MIT in code until then.

## Build order

Done: captions, phone lapel mic with handoff, audience reader with themes and type, join codes, typing into the stage bar, standalone ticker, persistence on every device, Deepgram through the relay, hosting recipe, the live demo at `/demo`, the flat console with a sample talk in the stage, kept lines on the reader, live links collected into a take-home card, shelf export, live image sharing (clipboard watcher, compression on the presenter's device, the catch in every feed, pull-back).

Next, in order:

0. **The take-home pack, finished.** Presenters attach a few links, a deck, a syllabus, their notes, either before Start or while bags are being packed; every reader's end card grows a section for them. The typing bar already recognises links and pins them, so this is mostly a place to put them that isn't a caption.
1. **The Live Knowledge Loop & Showbag ([docs/ECOSYSTEM.md](docs/ECOSYSTEM.md)).** Connect the fleet loop: StageType thermal weighting → ProMapper topic clusters & action items → Slide-o-Matic auto-generated slide deck via compressed `gz.` URLs. The audience end card becomes the interactive Showbag (transcript, deck link, ProMap, links, ethical trading card).
2. ~~Distinct Identity & Mascot.~~ Closed: the console is type-led and the mascot is retired (CLAUDE.md, "No mascot"). The palette broke away from TalkType peach in the flat pass: cream, ink, hot pink, amber, teal, violet.
3. **Ambient Presence & Thermal Map (No Text, No Numbers).** Audience taps create organic bioluminescent glows/auras rather than noisy chat/counters. Invisible thermal map weights the post-talk slide deck synthesis.
4. **Live translation.** Each reader picks a language; each final line is translated once per language on the relay (DeepL or a small model) and fanned out. Deepgram doesn't translate; its multilingual mode only *recognises* many spoken languages.
5. **Passes & Palestine Support.** Supporter passes ($19–$29) unlocking hosted engines with ethical donation per sale.
6. **Glossary.** A "words to get right" field on the console, passed to Deepgram Nova-3 as key terms.
7. **Hosted relay on a real domain**, with `/demo` as the front page.
8. **Diarisation and speaker names** for panels: Deepgram's streaming diarizer tags Speaker 0, 1, and the console lets you name them.
9. **Mac host app** wrapping `/ticker/:id`, with on-device speech.

## Money: one Passport for the family

Free, right in the browser: browser speech, a floating bar, a fullscreen ticker, a live room. Every reader is free forever, with their own type, theme, kept lines and downloads.

The TalkType Passport extends to the room: no session clock on long lectures and conference days, the phone-mic relay, the offline engines, and the take-home pack. A presenter pasting their own Deepgram key is the cheap escape hatch; a pooled relay pass is the convenience.

StageType is the family's growth loop because it is the only one that is public by nature: every talk puts the URL in forty pockets.

## Engines: the dual-track idea (not built)

Offline Whisper in chunks of 10-15 seconds is fine for a catch-pad and wrong for a stage: when the mouth stops, twelve seconds of silence looks broken, and a cut mid-word invites invented punctuation. The shape that works is two tracks: browser or on-device streaming for the in-flight words (sub-300 ms), and a local Whisper pass over pause-delimited phrases (voice activity at roughly 600 ms of silence, capped at 10 s) that quietly replaces the rough line as it settles into the transcript. Instant words on screen, clean saved text, no per-minute cost.

## The mic handshake (designed, not built)

The lapel mic pairing card carries the room's write token, so it can never be the code on the projector, and a reader page cannot simply "become the mic" without it. The honest version: a phone asks the relay to be the mic, the console shows "a phone wants the mic", the presenter taps allow, and the relay hands that request a scoped one-shot token. Until then the pairing card lives behind one Mic button.

## The live demo and signed noise

`/demo` gives every visitor their own QR. The id is **signed noise** (`signed_noise.ts`): random, HMAC-signed with a server secret, stored nowhere. The room only exists once a phone opens the link, and made-up ids never verify, so bots can't mint rooms. The page that minted it can type into the room with a token derived from the id, again without storage. Demo rooms: three listeners, ten minutes, typing and browser speech only, never Deepgram.

`signed_noise.ts` has no dependencies and uses WebCrypto only, so it drops straight into **QR Buddy** or anything else that wants "a code that isn't anything until it's used".
