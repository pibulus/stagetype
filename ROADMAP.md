# StageType: where it's going and why

A living note of the product and business thinking behind StageType, so decisions don't evaporate between sessions. Update it when a decision is made or reversed.

## Where it sits (21 Nov 2026)

Hardened, visually unified across all 6 pages, copy-polished, accessible, and live on CHONK (`https://stage.talktype.app`, systemd + Cloudflare Tunnel). Locally, run `deno task dev`, then open http://localhost:8787 (or `/demo`).

**The ten-second test:** land on `/demo` or the console. A sample talk types itself into the stage (`SAMPLE`). Click **Start captions**, the QR + visible `/join` host + 4-letter code appear, a phone camera scans it, and the phone scrolls words in its own font, size, and theme. Say something; watch it land in three places.

**What is real:** unified Soft Neo Toybrut design across all 6 pages (`presenter`, `audience`, `mic`, `join`, `demo`, `ticker`), fixed-height console + clipped-free Document PiP float (`⌥+F`), Take-Home Pack (presenter-pinned links + kept-line starring/editing/keyboard+touch reordering + 1-tap client-side Quote Card PNG + prose `.md`/PDF export + offline Service Worker), multi-phone lapel mic with unique session IDs + speaker tags + pocket lock + automatic handoff, Room Words primer (`applyRoomWords` + Deepgram `keyterm`), zero-internet LAN whisper pipe (`deno task listen-local`), full SEO/OG/PWA baseline, and sealed single-box relay (`HOST`/`TRUST_PROXY`, global RAM cap, streaming upload cap, magic-byte image checks, `STAGETYPE_DEEPGRAM_PASS` + UI keyhole, `/healthz`, `/version.json`).

**Deliberately lean by design:** rooms run fast in memory (400 lines + 40 images), transcripts live on each listener's own phone, and the stage stays calm and focused on the speaker's words.

**The next three, in order:**
1. **Wire the 1-click Slide-o-Matic `?title=&words=` bridge button** and rehearse a live room with pass-gated Deepgram Nova-3.
2. **Live translation (10 to 15 languages on the relay).** Each final line translates once per active audience language and fans out via SSE, opening multilingual rooms for conferences, classrooms, and congregations.
3. **One-time Event Passes ($15 / $39 / $89 with $1/pass to Palestine)** + BYO Deepgram escape hatch + AGPL-3.0 relicense once hosted passes open. Mac host app ($29 one-time) later once web pull is proven.

## The one-line position

**Open a tab and speak. The back row gets a front-row seat.**

Browser-native, open source, warm to read, and built for real rooms: floating captions over slides and OBS, a wireless phone lapel mic, and offline take-home notes in every pocket.

## The two acts (the pitch in one breath)

**During the talk:** speak at the desk, and the room reads along. A bar under the slides, a giant ticker on the spare screen, and every phone in the back row scrolling at its own size.

**After the talk:** everyone leaves with the talk in their pocket. The live stream settles into a note they can keep: the transcript, the lines they tapped to keep, Quote Card PNGs, and the links that were spoken or pinned on stage.

That second act is why the QR gets scanned by the whole room and not just the people who need captions. Accessibility stops being a separate lane and becomes the default handout.

## What makes StageType shine

The centerpiece is **the room's own phones**: every reader tuned to their own typeface, size, theme, and (soon) language, tapping lines to keep, and walking out with the transcript, Quote Cards, and a bag of the talk's links.

## The model: room-first distribution

| Part | Price | Why |
| :--- | :--- | :--- |
| Audience reader | Free forever, opens straight in any mobile browser | The growth loop: every talk puts the QR in front of a room |
| Web console and relay | Free and open source, self-hostable | Trust, reach, Windows and Linux presenters, the sovereign story |
| Mac host app | One-time purchase | Floats over anything without Chrome, on-device speech so low running cost, menubar. Cross-sold to TalkType users |
| Passes | Per event-hour | Deepgram quality and live translation cost real money per minute. A payment link returns an instant pass code that activates directly in the console |

Windows later: Tauri or Electron around the same web console, only once the Mac app has proven the host-app idea.

## The numbers (checked September 2026)

| | Our cost per talk-hour | Typical market rate |
| :--- | :--- | :--- |
| Relay, text fan-out | close to zero | |
| Browser speech | free | |
| Deepgram Nova-3 streaming | about $0.46 at list price | |
| Translation per language | cents to about $1 | |
| Human CART captioner | | $75 to $300 an hour |
| **StageType pass, suggested** | **$1 to $5 with a few languages** | **$10 to $15 an hour** |

Translation cost scales with the number of languages, not listeners: each line is translated once per language, then fanned out.

## Who first

1. **Conference and meetup organisers.** They feel the pain, have an accessibility or translation budget line, and buy per event. Every differentiator shows up at once.
2. **Lecturers**, free, as the way into universities. Disability services come later with the budget. Needs a VPAT and a privacy story before procurement.
3. **Churches:** weekly services, multilingual congregations, and OBS already running in the booth. StageType drops straight in as a browser source and puts every sermon on every phone in the pews.

## Guardrails

- **Complementary to human CART.** Automated captions shine for every talk, meetup, class, and stream that wants instant accessible text right away.
- **Privacy is the procurement question.** The browser engine sends audio to Google or Apple. `deno task listen-local` today (and on-device speech in the Mac app later) keeps audio completely on-device.
- **Reliability before features.** A failure in front of 300 people is a support ticket with feelings.
- **Pure, distraction-free captions.** The stage bar and phone reader belong completely to the speaker's words.
- **Classy is the ceiling.** See CLAUDE.md.

## Open decision: the licence

StageType is MIT today. If a hosted paid pass tier launches later, consider relicensing the relay and pages to **AGPL-3.0** while Pablo is the only author. Vendored fonts and the QR encoder keep their own licences. **Decided September 2026: Pablo is fine with AGPL, deferred until a hosted paid tier is close.** Still MIT in code until then.

## Build order

Done: captions, phone lapel mic with multi-phone tracking, pocket lock and handoff, speaker labels (`Host`, `Guest`), audience reader with themes and type, join codes, typing into the stage bar, standalone ticker, offline persistence on every device via Service Worker, Deepgram through the relay with optional `STAGETYPE_DEEPGRAM_PASS` + UI keyhole, Room Words glossary (`applyRoomWords` + Deepgram `keyterm`), zero-internet LAN pipe (`deno task listen-local`), hosting recipe + live CHONK relay (`https://stage.talktype.app`), live demo at `/demo`, flat Soft Neo Toybrut console with a sample talk in the stage, kept lines with drag/keyboard reorder and 1-tap Quote Card PNG, presenter-pinned Take-Home links + spoken link collection, shelf export, and live image sharing (clipboard watcher, client-side WebP/JPEG compression, the catch in every feed, pull-back).

Next, in order:

1. **Live translation.** Each reader picks a language; each final line is translated once per language on the relay and fanned out. Deepgram's multilingual mode recognises many spoken languages; relay translation adds per-reader output languages.
2. **Event Passes & Palestine Support.** One-time supporter/event passes unlocking hosted Deepgram + translation with $1 per pass donated to Palestine.
3. **Speaker diarisation on Deepgram.** Map Deepgram's streaming Speaker 0/1 tags to named speaker pills on the console.
4. **Slide-o-Matic 1-click bridge + Exploratory Showbag ([docs/ECOSYSTEM.md](docs/ECOSYSTEM.md)).** One button in Slide-o-Matic opens a pre-primed StageType room (`?title=&words=`), and future fleet links connect saved transcripts into ProMapper and ZipList.
5. **Mac host app** wrapping `/ticker/:id`, with native on-device speech.

## Why the room stays calm

The room is quiet on purpose so the talk itself stays front and center:

- **Spoken Q&A stays in the room.** Questions stay out loud where they belong, keeping the console calm and focused.
- **Clean typography on stage.** The ticker is dedicated purely to the talk's words.
- **Verbatim record first.** The saved transcript faithfully preserves what the speaker actually said.
- **Direct, personal, and focused.** Every reader opens in one tap, transcripts live on each attendee's own phone, and the caption bar belongs wholly to the talk.

## Local LAN mode (shipped via `deno task listen-local`)

Pipe any local on-device transcriber (such as `whisper-stream`) straight into a StageType room over LAN using `STAGETYPE_MIC_URL=... deno task listen-local --speaker Host`. See [docs/DEPLOY.md](docs/DEPLOY.md#zero-internet-lan-mode-deno-task-listen-local).

## Multi-mic (shipped)

Each lapel mic tab generates a unique session `phoneId` (`ph-…`) and optional speaker label (`Host`, `Guest`). The relay tracks up to 8 concurrent phones in `room.phones` and stays phone-live until the last paired phone pauses or drops.

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
