# StageType Design System (`DESIGN.md`)

> Hardware-grade Soft Neo-Toybrut rules for StageType (`presenter.html`, `demo.html`, `join.html`, `audience.html`, `mic.html`).
> Read this file before touching any layout, border, shadow, or theme token.

---

## 1. The 6 UI Laws

1. **Elevation = Pressability:** Offset bottom lips/shadows mean *"push me."* Immovable layout panels, headers, and passive status badges MUST NEVER cast hard offset shadows (`box-shadow: none`). Screens and text inputs sit *below* the faceplate (`inset` depth). Only clickable controls rise *above* the faceplate (`0 2px 0` lip + `:active` press travel).
2. **Strict Silhouette Vocabulary (Zero Pill Fatigue):** Shape communicates affordance before reading a word:
   - `999px` capsule → **Strictly passive status/telemetry badges** (`Ready · Laptop mic`, `Lobby open`, `14 reading`). Never clickable buttons.
   - `8px`–`9px` crisp keycap → **All interactive buttons, dropdowns, and segmented switches.**
   - `10px`–`12px` recessed bezel → **Stage monitors, QR pass plates, and text inputs.**
   - `13px`–`16px` hardware seam → **Outer console chassis and structural zones.**
3. **Viewport-Native App Grain (No Floating Postcards):** Application consoles inhabit the browser window (`100dvh`, zero desktop page scroll), using elastic flex/grid workspaces (`flex: 1; min-height: 0`) and `@container` queries—never disconnected boxes drifting in empty wallpaper.
4. **Whole-State Composition:** Never hide elements on state change if hiding them leaves a dead hollow container behind. Session setup (`Language`, `Engine`) lives inline inside the Top Transport Bar and gives way cleanly to live transport (`Pause`, `End`). Transient alerts (reload recovery, mic handoff, relay reconnect) belong in auto-dismissing floating toasts, never wedged into structural layout rows.
5. **Real State Over Symbolic Placeholders:** Never draw geometric CSS approximations of missing UI (such as fake corner checkboxes pretending to be a QR code). Mint a stateless pre-live pass (`/api/lobby/mint`) at `t=0` so the real scannable QR and 4-letter room code stand ready immediately.
6. **Single Home Per Concept:** Group controls strictly by blast radius—session/audio transport in the Top Bar, stage caption styling directly under the Stage Monitor, and audience room sharing in the Audience Pass Rail/Modal. Never duplicate status readouts that toolbar active states already show.

---

## 2. The 4 Locked Physical Primitives

Compose UI strictly from these four physical tiers (crisp warm hardware, never thick black comic boxes and never washed-out beige mush):

- **`.ui-zone` (Chassis & Structural Panels):** Layered warm faceplate/panel fill, `1px solid var(--seam)` (`~17%` warm ink), subtle `1px` top inner specular highlight (`inset 0 1px 0 var(--specular)`), `border-radius: 13px–16px`, zero drop shadow on inner panels.
- **`.ui-well` (Recessed Monitor & Inputs):** Recessed bezel (`1.5px` border + `inset 0 2px 4px` / `inset 0 3px 10px`), `border-radius: 10px–11px`. Zero neon double-outline offsets.
- **`.ui-keycap` (Every Interactive Button, Select & Menu Summary):** `1.5px solid var(--key-border)`, `border-radius: 8px`, `box-shadow: 0 2px 0 var(--key-shadow)`, `transition: transform 80ms, box-shadow 80ms`. Lifts `-1px` (`0 3px 0`) on `:hover`; presses flush (`translateY(2px)`, `0 0 0`) on `:active`. Differentiate primary (`Start captions`), active (`Pause`), and secondary (`End`, `Copy link`, `Project QR`, `Pair phone as lapel mic`) via fill color—never by stripping tactile depth off real buttons.
- **`.ui-pill` (Passive Telemetry Only):** `border-radius: 999px`, `1px solid var(--seam)`, `box-shadow: none`, `pointer-events: none`.

---

## 3. Strict 2-Layer Theme Architecture

- **Console Faceplate (`data-vibe` / `--vibe-*` & chassis tokens):** Skins the **presenter's hardware chassis**—visibly tinting the outer desk mat, anodized faceplate (`Peach Sunset`, `Stage Lights`, `Warm Paper`, `Night Ink`), header bar, ink warmth, and primary switch accent. `Night Ink` provides a low-glare dark backstage lectern console.
- **Stage Projection Style (`#ticker[data-style]`):** Controls **only** the caption screen inside `.monitor-well` (and exported `/ticker/:id` / PiP windows). Pairs screen ground, text contrast, and active highlight (`Ink`, `Paper`, `Brut`, `Serif`), with custom accent overrides tucked inside `More`.

---

## 4. 4 Mandatory Viewport Geometries

Every UI change on `presenter.html` must pass visual inspection across all four real-world presenter geometries (Idle + Live):

1. **Wide Desktop (`>= 948px`, e.g. `1440×900`):** 2-column hardware split (`minmax(0, 1fr)` Stage Deck + `clamp(282px, 24cqw, 328px)` Audience Pass Rail). Zero page scroll; `#ticker` stretches dynamically (`flex: 1`) and scales type via `@container` units.
2. **Split-Screen Presenter (`641px–947px`, e.g. `780×860` beside Keynote/OBS):** `@container work (max-width: 919px)` auto-collapses the right Audience Pass Rail into a top-bar `.ui-keycap` (`[ ▦ CODE · N reading ]`) that opens the projector QR modal, giving 100% width to the Stage Monitor and keeping `.stage-controls` on a single unclipped row.
3. **Short Projector / Lectern Laptop (`max-height: 700px`, e.g. `1280×640`):** Vertical padding and QR SVG dimensions tighten via `clamp()`/`cqh` so zero controls clip or scroll vertically. Bottom toolbar popovers open **upward** (`bottom: calc(100% + 8px)`).
4. **Mobile Portrait (`<= 640px`, e.g. `390×844`):** `visualViewport`-aware `100dvh` handheld transceiver with a 1-tap `[ Stage | QR · CODE ]` mode switch—never stacking the giant QR pass below the fold.
