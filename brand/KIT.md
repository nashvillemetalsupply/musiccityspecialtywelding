# Music City Specialty Welding

W1 brand kit. November 9, 2026.

We fix the metal you put to work. If we miss one, we own it.

This kit applies the approved `BRAND-BRIEF.md` and section 2 of `SERVICES-BRAND-PLAN-2026-11-09.md`. W1 adds assets and a review sheet. W1a is the owner look. W2 wires the kit into the public site.

## The shop

The speaker is the shop lead who answers the phone. Say **we**. Speak to one person whose gate drags, whose trailer has to haul, or whose rail needs to fit. Name the metal and the part. Use the place when the job record supplies it.

**Family, branded, trusted** is the working rule. Family means the crew owns the job together. Branded means the same badge, type and shop voice on every surface. Trusted means a count tied to a record and a callback that includes the miss. It does not claim family ownership or a family history.

Show the weld before talking about skill. A face on camera is optional. The crew voice and the count stay. No reshoot is required. Existing real photos support still posts and slideshows.

## The mark

The source is `public/images/optimized/mcs_welding_logo.webp`, a 240 by 160 transparent badge. Keep its engine silhouette, torch flames, MCS initials and blue arc. Clean edges lightly. Preserve its core colors. Do not draw a replacement, add a mascot, or turn it into a new monogram.

Use `public/brand/mcsw-mark.svg` for scale. The transparent square PNG exports are `mcsw-mark-512.png`, `mcsw-mark-192.png` and `mcsw-mark-32.png` in the same folder.

- Leave clear space equal to one quarter of the visible badge width on every side. The canvas margin does not replace this space.
- Use the full badge at 96px wide or larger when its small lettering needs to read. At 32px, the MCS shape is the identifier. Engine detail and the small WELDING line are secondary.
- Set the full name **Music City Specialty Welding** beside the badge in navigation and social lockups. Keep the name legible in a profile presentation. Use platform title metadata alongside a favicon.
- Place the badge on plain Carbon or Bone. Give busy photos a solid field behind it.
- Keep the source proportions and transparent background. No stretching, rotation, glow, drop shadow, outline effect or recoloring.
- The original blue and red belong inside the mark. They never become button, heading or page accents.

The review sheet shows the same traced badge on both fields and at small sizes. It is a check on the supplied mark, not permission to replace it.

The SVG contains paths, not an embedded bitmap or live text. VTracer 0.6.15 traced the supplied WebP after a 4x Lanczos sampling pass to smooth the contours. This is interpolation of the source pixels, not generated detail. The viewBox crops only the empty transparent canvas, from source bounds `(41, 8)` to `(215, 135)`. The original art stays in proportion. Use `object-fit: contain` when the image box has a different ratio. Sharp renders the square PNGs from that SVG with transparent padding.

## Palette

| Token | Hex | Share | Job |
| --- | --- | --- | --- |
| Carbon | `#0B0A09` | 72% | Main canvas and large brand fields |
| Bone | `#E8E1D4` | 20% | Main type and warm light sections |
| Steel | `#777872` | 6% | Rules and disabled states |
| Arc | `#FF4A1C` | 2% | Call actions, focus and counted data |

These shares describe the page furniture, not the colors inside real photos or the existing mark. Arc is the single interface accent. Use it where a person acts or a real number needs attention. Keep headings Bone or Carbon. No accent underline used as decoration. No gradient text.

Bone on Carbon and Carbon on Bone carry normal text. Put Carbon labels on Arc buttons. Steel is not small body text. The semantic muted tones are neutral support colors, `#B5B3A9` on dark and `#4B4B46` on light. Preserve their readable contrast instead of lowering text opacity.

`brand/tokens.css` contains the four primitives and their semantic roles. Default roles use the dark field. Put `data-mcsw-theme="light"` on a light section, or `data-mcsw-theme="dark"` on a dark island inside it. Components use `--mcsw-bg`, `--mcsw-text`, `--mcsw-text-muted`, `--mcsw-border` and action roles. Do not scatter raw hex values through component styles.

## Type

**Archivo 800** carries display type. Tight tracking, a 0.92 line height and deliberate breaks give it weight without a stencil or saloon face. Main statements use caps. Set their breaks for the phone first. Never clip a letter to force the composition.

**IBM Plex Sans 400** carries body copy. Use 500 for labels and 600 for emphasis. Keep body text in sentence case. Start at 16px with a 1.5 line height. Keep ordinary paragraphs under 58 characters per line where the layout permits. Steel-colored microtype is not a substitute for readable labels.

The token scale uses `clamp()`. A large heading still needs a width check at 320px and 390px. Give the display face its own size at each layout break. Do not shrink the entire page to make it fit.

W2 loads these faces through `next/font/google`. This is the handoff example, not a live-site change made in W1.

```tsx
import { Archivo, IBM_Plex_Sans } from "next/font/google"

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-archivo",
  display: "swap",
})

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
})

// Apply both variable classes to the existing public wrapper during W2.
const publicFontClasses = `${archivo.variable} ${plex.variable}`
```

The sheet loads the real faces for review. Future public CSS uses `--mcsw-font-display` and `--mcsw-font-body`. System body fonts are not a finished brand state.

## Real work, one grade

Use the shop's own photos in `public/images`. Preserve every original. Crop to the metal that explains the job, with enough context to show what the part does. A tight weld crop can sit beside a wider view. Never call two crops a before and after.

Start all three sheet examples with this exact filter order.

```css
.job-photo {
  filter: saturate(0.72) contrast(1.12) brightness(0.88);
  object-fit: cover;
  object-position: 50% 50%;
}
```

The same rule is `--mcsw-photo-grade`. Adjust crop position per source. Lift exposure only if the dark grade hides the repair or weld edge. Keep arc light and hot metal honest. No orange wash, fake sparks, replaced sky, generated person or invented job. Do not erase damage to make a repair look better.

Text belongs on a solid field beside the image. If an image needs overlaid text, use a tested solid scrim and check contrast at the actual crop. Do not rely on a dark patch that moves out of frame on a phone.

The sheet shows three real source photos before and after this grade. Filenames identify source files, not permission to make a named-project claim.

### Twelve photo picks

Reviewed from the existing image inventory at source resolution. Paths below start at `public/images/`. The subject descriptions name what is visible. They do not assert a customer, date or approved project name.

| Source | Use and crop |
| --- | --- |
| `optimized/welder.webp` | Lead proof. Keep the joint and the welder's hands. Sheet crop `42% 50%`. |
| `optimized/Service 02.webp` | Installed railing. Keep enough deck to show where the rail fits. |
| `optimized/speciality_welding.webp` | Manifold detail. Keep the full pipe run and brackets. |
| `owner-work/IMG_20250527_141244.webp` | Steel frame on site. Keep the opening and steel connections. |
| `owner-work/IMG_20250723_161108.webp` | Frame in the shop. Use a vertical crop along the members. |
| `owner-work/IMG_20250809_180018.webp` | Trailer frame and hub. Keep damage visible. Sheet crop `50% 58%`. |
| `owner-work/IMG_20260225_135845.webp` | Balcony installation. Keep the house opening and working context. |
| `owner-work/IMG_3994.webp` | People at the installed pipework. Do not name the crew without a source. |
| `owner-work/stainless-worktable.webp` | Installed stainless worktable. Keep the edges and room. Sheet crop `55% 60%`. |
| `owner-work/staircase-onsite.webp` | Stair assembly. Keep the connection points in frame. |
| `owner-work/steel-frame-onsite.webp` | Overhead steel. Keep the support connection and roof line. |
| `owner-work/trailer-repair.webp` | Trailer members. Crop along the frame; do not hide wear. |

The source/grade pairs on the sheet use the welder, trailer frame and stainless worktable. No source files were edited. Avoid the existing distant chapel view as a weld proof image; the part is too far away to judge.

## Page behavior

Use hard edges and straight rules. Default radius is zero; 6px is the ceiling. No glow or decorative faux steel. Build an uneven editorial rhythm with one strong image and readable type. Do not follow the hero with three equal icon cards.

Call is the primary action. Quote is secondary. Make the primary action fit a thumb at 44px or larger. Use a bottom call bar on the phone mock. Keep the existing phone source, intake paths and measurement intact when W2 begins. No availability claim is approved.

Buttons keep Arc through hover and active states. Use a short physical shift or an underline to show response, not a second accent. Focus uses a 3px outline with a 4px offset. The focus role is Arc on Carbon and Carbon on Bone, where Arc alone falls below 3:1 against the field. A control on an Arc field needs a Carbon separator so focus still reads.

Motion engages and stops. The kit allows 120ms control feedback and a 220ms hard-mask reveal. Nothing delays a call or hides proof on load. Reduced motion sets movement and durations to zero. The review sheet stays still.

## Voice rules

Use short sentences and hard stops. The shop is **we**, the reader is **you**. A count means something only when the record backs it. If a job went wrong, name what happened and what we did next. Let the work supply the confidence.

Useful words include plate, gusset, frame, hinge, ramp, rail, bracket, crack, load path, fit, cut, burn in, check and callback. Use a technical word only when it helps that reader understand the part.

Write about the trailer owner who has to haul Monday, the homeowner whose gate catches the ground, or the contractor waiting on a rail. Pick one. Do not address every buyer in one post.

Do not use these moves in shop copy.

- Em dashes, three-part slogans, colon reveals or question-and-answer openers.
- The phrases “cannot,” “will not” or “our team.”
- Self-praise, fake toughness, cowboy costume or a claim that we are the best.
- Corporate promises such as “quality you can trust,” “complete solutions,” “your one-stop shop,” “exceptional service,” “industry-leading” or “we are committed to.”
- Unverified job counts, review totals, named-project claims, credentials or response promises.
- A service list posing as a story. A frame inventory posing as a caption. The same job posted twice with new words.
- An automatic “Get a quote” ending. Titles carry no CTA. A post closer must fit the reader and the post.

For a monthly count post, use dated jobs and callbacks from `instruments/booked-jobs.jsonl` and the lead feeds described in the plan. Reconcile the count before publication. A missing callback count is missing data, never zero. Quotes from real reviews need the actual source and permission for their use.

## Ten title examples

**Illustrative drafts only. These counts and events are unverified examples, not shop claims. Do not publish them until a job record supports the wording.** Each title uses we, a count and a stake or admission. It speaks to one reader. The number is part of the story, not a service price or a decorative statistic.

1. We Measured 1 Opening Twice Because Your Gate Has to Swing.
2. We Cut 2 Pieces Too Short for Your Gate and Started Again.
3. We Found 3 Cracks Before Your Trailer Moved.
4. We Checked 4 Corners Before Your Frame Left the Shop.
5. We Took 2 Passes on Your Frame Because Our First Weld Was Rough.
6. We Counted 6 Loose Bolts Before Your Ramp Came Down.
7. We Went Back for 1 Weld We Missed on Your Frame.
8. We Scrapped 2 Brackets That Did Not Fit Your Gate.
9. We Checked 8 Feet of Rail Where Your Kids Lean.
10. We Made 1 Callback Before We Called Your Job Done.

Before using a line, run the voice checks in `instruments/creative-intake/copy_gate_v2.py` from the plan's Mirror repo. A voice pass does not verify an example count. Evidence must pass separately.

## W1 handoff

Review `docs/brand/kit-sheet.png` and its source `docs/brand/kit-sheet.html`. Check the badge on Carbon and Bone, the type, three grade comparisons and the homepage mocks at 390px and 1280px.

W1 adds kit files only. It does not load fonts into the live app or import tokens there. W1a records the owner look. W2 applies the approved kit while every guard path in plan section 3 stays unchanged.

### Rendering the sheet

The HTML opens directly from disk. It reads `brand/tokens.css` and the existing photos through relative paths. The real Archivo 800 and IBM Plex Sans 400/500/600 fonts are embedded as Latin WOFF2 subsets, with their full SIL Open Font License texts in the HTML. The sheet makes no external font request.

`kit-sheet.png` is a full-page Playwright 1.63.0 Chromium screenshot at a 1680px viewport and device scale factor 1. The desktop iframe has a real 1280px layout, shown at 80% on the sheet. The phone iframe has a real 390px layout, shown at actual size. Both contain the same homepage study and load the same tokens and fonts. Controls show placement only.

From the repository root, this JavaScript reproduces the PNG with the installed `playwright` package. Run it through Node without adding a repository script.

```js
const { chromium } = require("playwright")
const { pathToFileURL } = require("node:url")
const path = require("node:path")

;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 1680, height: 1100 },
      deviceScaleFactor: 1,
    })
    await page.goto(pathToFileURL(path.resolve("docs/brand/kit-sheet.html")).href)
    await page.evaluate(() => window.brandSheetReady)
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images, image => image.decode()))
    })
    await page.screenshot({ path: "docs/brand/kit-sheet.png", fullPage: true })
  } finally {
    await browser.close()
  }
})()
```

The ten illustrative titles passed the forbidden-construction and tricolon checks imported through Mirror's `instruments/creative-intake/copy_gate_v2.py`. This is a voice check, not evidence admission. Each has a number and a stake or admission, and none carries a CTA. The homepage studies were also checked at 320, 390, 768, 1280 and 1440px for overflow and actual font loading.
