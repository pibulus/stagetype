# StageType: where it's going and why

A living note of the product and business thinking behind StageType, so decisions don't evaporate between sessions. Update it when a decision is made or reversed.

## The one-line position

**Wordly is the one you book a demo for. StageType is the one you just open.**

Same job, a tenth of the price, none of the ceremony, open source, and nicer to look at. The Plausible-versus-Google-Analytics play.

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

StageType is MIT today. MIT lets anyone host it and sell it back to our customers. If a hosted service is part of the plan, relicense the relay and pages to **AGPL-3.0** while Pablo is the only author (Plausible and Cal.com do this). Vendored fonts and the QR encoder keep their own licences. **Pablo's call; not changed in code.**

## Build order

Done: captions, phone lapel mic with handoff, audience reader with themes and type, join codes, typing box, standalone ticker, persistence on every device, Deepgram through the relay, hosting recipe, the live demo at `/demo`.

Next, in order:

1. **Live translation.** Each reader picks a language; each final line is translated once per language on the relay (DeepL or a small model) and fanned out. Deepgram doesn't translate; its multilingual mode only *recognises* many spoken languages.
2. **The bag (v1).** Presenter drops links live ("I'll put it in the bag"), a speaker card, terms from the glossary. The join page's Saved talks becomes a shelf of bags. A library, not a game: no points, badges or streaks. UI says "the bag"; brand voice can say "showbag".
3. **Glossary.** A "words to get right" field on the console, passed to Deepgram Nova-3 as key terms.
4. **Passes.** Stripe payment link, pass code unlocks Deepgram and translation for N hours.
5. **Hosted relay on a real domain**, with `/demo` as the front page.
6. **Diarisation and speaker names** for panels: Deepgram's streaming diarizer tags Speaker 0, 1, and the console lets you name them.
7. **Mac host app** wrapping `/ticker/:id`, with on-device speech.
8. **Summaries** as a pass feature.

## The live demo and signed noise

`/demo` gives every visitor their own QR. The id is **signed noise** (`signed_noise.ts`): random, HMAC-signed with a server secret, stored nowhere. The room only exists once a phone opens the link, and made-up ids never verify, so bots can't mint rooms. The page that minted it can type into the room with a token derived from the id, again without storage. Demo rooms: three listeners, ten minutes, typing and browser speech only, never Deepgram.

`signed_noise.ts` has no dependencies and uses WebCrypto only, so it drops straight into **QR Buddy** or anything else that wants "a code that isn't anything until it's used".
