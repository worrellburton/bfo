# BFO design system

This is the standard every page and pop-up in BFO is built on, and the
standard the reviews judge against. It is written so that two engineers
given the same screen would build the same thing. Where a page and this
document disagree, one of them is wrong: say which, and fix one of them in
the same pull request.

Each decision is stated once, with its reason in a sentence. Sizes are CSS
pixels. "Touch" means a phone (narrower than 768px) or any device whose
primary pointer is coarse (an iPad held in the hand); "desktop" means
everything else.

Examples use made-up records ("Northwind Holdings, LLC", "•• 4821"). Never
put a real name, balance, address or account into this file.

## Contents

1. [Principles](#1-principles)
2. [Colour](#2-colour)
3. [Type](#3-type)
4. [The root size, and how the app moves off 11.9px](#4-the-root-size-and-how-the-app-moves-off-119px)
5. [Spacing and layout](#5-spacing-and-layout)
6. [Shape and depth](#6-shape-and-depth)
7. [Motion](#7-motion)
8. [Components](#8-components)
9. [Navigation](#9-navigation)
10. [Numbers, money and dates](#10-numbers-money-and-dates)
11. [Legal and consent patterns](#11-legal-and-consent-patterns)
12. [Voice and copy](#12-voice-and-copy)
13. [Decorative pieces](#13-decorative-pieces)
14. [Implementation notes](#14-implementation-notes)

---

## 1. Principles

**Calm is the resting state.** A screen at rest has nothing moving, nothing
glowing, and one obvious next step. Colour, motion and weight are spent
only on what needs the person: an exception, a choice, a change they just
made. If everything on a screen is "fine", the screen says so by being
quiet, not by showing a row of green dots.

**One voice.** One sans-serif, one type scale, one set of components used
the same way on every page. A thing that looks the same behaves the same;
a thing that behaves differently looks different. When a page needs
something the system doesn't have, the system grows; the page doesn't
improvise.

**Content over chrome.** Surfaces are solid. Edges are hairlines. Only
things that float above the page cast a shadow. There is no glass, no
gradient, no glow, and nothing drifting behind the data. The figures and
the words carry the design.

**Both themes are first-class.** Light and dark are designed and measured
together from one set of tokens; neither is a filter laid over the other.
Every text colour passes 4.5:1 on every surface it is allowed on, in both
themes, and every control edge passes 3:1.

**Honest numbers.** Every figure says what it is, which period and basis it
covers, and when it is from. Signs, rounding and decimals follow one
convention per context, and totals foot.

**Say what happens.** Before anything that destroys, binds, bills or
sends, the person sees what will happen, to what, at what cost, and
whether it can be undone, in plain words. The app never promises something
it doesn't do.

**The phone is native, not squeezed.** 44px targets, sheets that rise from
the bottom edge, safe areas, lists instead of tables, actions that ride
above the keyboard.

**States are designed.** Loading, empty, error, offline, one item, a
thousand items and a very long name each have a defined look. A state that
isn't designed is a bug.

---

## 2. Colour

### 2.1 Themes

- **The setting** has three values: **Automatic** (follows the device; the
  default), **Light** and **Dark**. It is one setting for the whole app,
  kept per device. No page has its own theme switch; Mail's goes. Why: two
  theme settings is an inconsistency the copy then has to explain.
- **Applied** as `data-theme="light"` or `data-theme="dark"` on `<html>`,
  before first paint (§14.2).
- **Always dark:** the door (landing, sign-in, finish setup, the front-door
  gallery, the Face ID cover, the splash and the offline fallback) and the
  chrome of the full-screen media viewer. They set `data-theme="dark"` on
  their own root. The door has its own palette (§2.7). Why: the door is the
  brand at night, and a photo or scan reads best on black.
- **The public signing page** follows the signer's device (Automatic),
  whatever a signed-in staff member has chosen.
- **Print** is always light.

### 2.2 Tokens

The palette is a near-neutral grey ramp (a trace of cool, like zinc), one
accent (indigo) and four status colours. Components use the semantic tokens below and nothing
else: no Tailwind palette classes (`text-gray-500`, `bg-white/5`,
`text-emerald-400`), no hex values, no `isDark ? … : …`.

**Surfaces**

| Token | Light | Dark | Use |
|---|---|---|---|
| `page` | #f7f7f8 | #0b0b0c | The ground: behind every page, the sidebar, the phone top bar |
| `raised` | #ffffff | #141416 | Cards, sections, tables, lists |
| `sunken` | #efeff1 | #070708 | Wells behind documents, segmented tracks, skeletons, badges, keycaps |
| `overlay` | #ffffff | #1b1b1e | Dialogs, sheets, the phone drawer, menus, popovers, toasts, the Ask button |
| `field` | #ffffff | #101012 | Inputs, selects, text areas |
| `hover` | #f1f1f3 | #1e1e22 | Hover on rows and quiet controls |
| `selected` | #e9e9ec | #25252a | Selected rows, the current nav row, pressed quiet controls, the fill of a disabled button |

**Ink**

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | #18181b | #f4f4f5 | Primary text, figures, icons that act |
| `ink-2` | #52525b | #a8a8b1 | Secondary text: descriptions, meta lines, field hints, column heads, idle nav labels |
| `ink-3` | #64646d | #8e8e97 | Tertiary text: placeholders, timestamps, trailing hints, chevrons, the zero dash |
| `ink-disabled` | #64646d | #8e8e97 | Labels of disabled controls (same value as `ink-3`; a separate token so it can diverge) |
| `ink-inverse` | #ffffff | #0b0b0c | Text on `ink` fills: the primary button, tooltips |

**Lines**

| Token | Light | Dark | Use |
|---|---|---|---|
| `line` | #e4e4e7 | #2a2a2e | Hairlines between rows, card borders, dividers (decorative) |
| `line-strong` | #d4d4d8 | #3a3a40 | Overlay borders, the table-head rule, subtotal rules |
| `edge` | #85858e | #717179 | The boundary of anything you press or type in: inputs, secondary buttons, checkboxes, the switch's off track, the selected segment. Always 3:1 or more |

**Accent** (one hue, indigo)

| Token | Light | Dark | Use |
|---|---|---|---|
| `accent` | #4f46e5 | #8b93f8 | Focus ring, links, checked checkbox and radio, switch on, unread dot, "today", progress, a single-series line chart |
| `accent-hover` | #4338ca | #a5acfa | Links and accent fills on hover |
| `accent-tint` | #eef0fe | #1f2040 | The selected choice tile, today's cell |
| `on-accent` | #ffffff | #0b0b0c | Glyphs on accent fills (a check in a checkbox) |

**The primary button is ink, not accent**

| Token | Light | Dark |
|---|---|---|
| `ink` (fill) | #18181b | #f4f4f5 |
| `primary-hover` | #3f3f46 | #d4d4d8 |
| `primary-pressed` | #52525b | #a8a8b1 |

Why: an ink button is the calmest strong signal there is, it matches the
brand's ivory and black, and it keeps the accent free to mean "this is
selected, focused or a link".

**Status**

| Token | Light | Dark | Use |
|---|---|---|---|
| `positive` | #047857 | #4cc38a | Money in; done, when "done" is news |
| `positive-tint` | #ecf8f2 | #11261c | Background of a positive banner |
| `negative` | #b91c1c | #f47a7a | Errors, failures, overdrawn balances, destructive menu items |
| `negative-tint` | #fdf1f1 | #2c1515 | Background of an error banner |
| `warning` | #a35200 | #e8b04e | Needs the person's action |
| `warning-tint` | #fdf6e9 | #2a2010 | Background of a warning banner; an attention count |
| `info` | #0b6aa2 | #6cb6e6 | Neutral notices: test mode, scheduled, read-only |
| `info-tint` | #edf6fb | #0f2230 | Background of an info banner |
| `danger` | #b91c1c | #d42a2a | The fill of the destructive button in a confirm |
| `danger-hover` | #991b1b | #b82222 | Its hover |
| `on-danger` | #ffffff | #ffffff | Its label |

**Other**

| Token | Light | Dark | Use |
|---|---|---|---|
| `scrim` | rgb(9 9 11 / 0.32) | rgb(0 0 0 / 0.60) | Behind every modal overlay. No blur |
| `paper` | #ffffff | #ffffff | Documents and scans (§2.5) and the switch's thumb: white in both themes |
| focus ring | `accent` | `accent` | 2px solid, 2px offset, on every focusable element |
| `brand-ivory` | #f4ede0 | #f4ede0 | The wordmark on dark; the door's ink |
| `brand-ink` | #0a0a0a | #0a0a0a | The wordmark on light |

**Charts**

| Token | Light | Dark |
|---|---|---|
| `chart-1` | #4f46e5 | #8b93f8 |
| `chart-2` | #0f8a7e | #3fbfb0 |
| `chart-3` | #c27c0e | #e0a43c |
| `chart-4` | #c2416b | #ec7aa0 |
| `chart-5` | #64748b | #94a3b8 |
| `chart-other` | #85858e | #717179 |

### 2.3 Measured contrast

WCAG 2 contrast ratios, computed from the values above. Text tokens need
4.5:1; `edge` needs 3:1. Every cell passes.

Light

| Token | page | raised | sunken | overlay | field | hover | selected |
|---|---:|---:|---:|---:|---:|---:|---:|
| `ink` #18181b | 16.55 | 17.72 | 15.43 | 17.72 | 17.72 | 15.71 | 14.62 |
| `ink-2` #52525b | 7.22 | 7.73 | 6.73 | 7.73 | 7.73 | 6.85 | 6.38 |
| `ink-3` #64646d | 5.47 | 5.86 | 5.10 | 5.86 | 5.86 | 5.19 | 4.83 |
| `accent` #4f46e5 | 5.87 | 6.29 | 5.48 | 6.29 | 6.29 | 5.57 | 5.19 |
| `positive` #047857 | 5.12 | 5.48 | 4.78 | 5.48 | 5.48 | 4.86 | 4.53 |
| `negative` #b91c1c | 6.04 | 6.47 | 5.63 | 6.47 | 6.47 | 5.74 | 5.34 |
| `warning` #a35200 | 5.21 | 5.58 | 4.86 | 5.58 | 5.58 | 4.95 | 4.60 |
| `info` #0b6aa2 | 5.45 | 5.84 | 5.08 | 5.84 | 5.84 | 5.17 | 4.82 |
| `edge` #85858e | 3.42 | 3.66 | 3.18 | 3.66 | 3.66 | 3.24 | 3.02 |

Dark

| Token | page | raised | sunken | overlay | field | hover | selected |
|---|---:|---:|---:|---:|---:|---:|---:|
| `ink` #f4f4f5 | 17.90 | 16.74 | 18.32 | 15.63 | 17.29 | 15.11 | 13.88 |
| `ink-2` #a8a8b1 | 8.34 | 7.80 | 8.53 | 7.28 | 8.06 | 7.04 | 6.47 |
| `ink-3` #8e8e97 | 6.06 | 5.67 | 6.20 | 5.29 | 5.85 | 5.12 | 4.70 |
| `accent` #8b93f8 | 7.15 | 6.68 | 7.31 | 6.24 | 6.90 | 6.03 | 5.54 |
| `positive` #4cc38a | 8.88 | 8.31 | 9.09 | 7.76 | 8.58 | 7.50 | 6.89 |
| `negative` #f47a7a | 7.41 | 6.93 | 7.59 | 6.47 | 7.16 | 6.26 | 5.75 |
| `warning` #e8b04e | 10.07 | 9.42 | 10.31 | 8.80 | 9.73 | 8.51 | 7.81 |
| `info` #6cb6e6 | 8.87 | 8.30 | 9.08 | 7.75 | 8.57 | 7.49 | 6.88 |
| `edge` #717179 | 4.07 | 3.80 | 4.16 | 3.55 | 3.93 | 3.43 | 3.15 |

Pairs

| Pair | Light | Dark |
|---|---:|---:|
| `ink-inverse` on `ink` (primary button) | 17.72 | 17.90 |
| `ink-inverse` on `primary-hover` | 10.44 | 13.31 |
| `ink-inverse` on `primary-pressed` | 7.73 | 8.34 |
| `ink-disabled` on `selected` (disabled button) | 4.83 | 4.70 |
| `on-accent` on `accent` | 6.29 | 7.15 |
| `on-danger` on `danger` | 6.47 | 5.04 |
| `on-danger` on `danger-hover` | 8.31 | 6.38 |
| `positive` on `positive-tint` | 5.03 | 7.19 |
| `negative` on `negative-tint` | 5.86 | 6.46 |
| `warning` on `warning-tint` | 5.19 | 8.19 |
| `info` on `info-tint` | 5.33 | 7.33 |
| `accent` on `accent-tint` | 5.55 | 5.70 |
| `ink-2` on any tint (lowest) | 6.82 | 6.65 |
| `edge` (switch off) on `raised` | 3.66 | 3.80 |
| focus ring (`accent`) on `overlay` | 6.29 | 6.24 |
| `chart-1` … `chart-5`, `chart-other` on `raised` (lowest) | 3.40 | 3.80 |
| `line` on `raised` (decorative; no minimum) | 1.27 | 1.29 |
| `accent` against `ink` text | 2.82 | 2.51 |

The last row is why links inside running text are underlined (§3.4):
colour alone can't separate a link from the words around it.

### 2.4 How colour is used

- **One accent, and it never decorates.** The accent marks focus, links,
  selection (checked, on, current choice), unread, today and progress. It
  is never a status, never a button fill, never a tinted icon tile, never a
  figure that isn't a link.
- **Status colours mean status only,** and only exceptions get them. Green
  is for money in, and for "done" when done is news. Amber is for "needs
  you". Red is for "failed", "wrong" or "overdrawn". "Connected", "mapped",
  "on", "healthy" and "live" are silent: normal shows nothing. Why: a page
  full of green dots teaches people to stop looking.
- **Sentences are never set in a status colour.** The dot or icon carries
  the colour; the words stay `ink`.
- **Negative numbers are not red by default** (§10.2).
- **Identity is neutral.** Entities, people, mailboxes, branches and tags
  get no colour of their own: avatars, initials and tags are `sunken` and
  `ink-2`. Why: identity hues collide with status hues (an entity that is
  amber in one view and rose in another reads as a warning). The single
  exception is signer parties on a document, which take `chart-1`,
  `chart-2`, `chart-4`, `chart-5` in that order (never `chart-3`, which is
  close to the warning amber).
- **Charts:** a single series is `accent` (a line) or `ink-3` with the
  current period in `ink` (bars). Two or more series use `chart-1` onward,
  at most five, plus `chart-other` for "Other". No gradients or glows; the
  area under a line, if shown, is a flat `accent-tint`. Gridlines are
  `line`; axis labels are caption size in `ink-2`. Every value a hover
  shows can also be reached by keyboard and by tap.
- **Disabled is never opacity.** Opacity lets the surface behind show
  through and makes contrast unpredictable. Disabled uses `selected`,
  `ink-disabled` and `line` (§8.1).
- **No opacity modifiers on tokens** (`text-ink/60`): use `ink-2` or
  `ink-3`. The scrim and the media viewer's chrome (§2.5) are the only
  translucent colours.

### 2.5 Documents and media

PDF pages, scans and signature fields render as paper: white, in both
themes, on a `sunken` well. The full-screen media viewer's chrome is always
dark: controls are white on black at 55%, with a 1px white-at-25% ring.

### 2.6 Native chrome

`<meta name="theme-color">` and the iOS status bar follow the theme:
#f7f7f8 in light, #0b0b0c in dark, #05060b on the door.

### 2.7 The door's palette

The door is always night. It has its own small palette and uses nothing
else.

| Role | Value | On #05060b |
|---|---|---:|
| Ground | #05060b | |
| Ink (the mark, titles, entries) | #f4ede0 | 17.39 |
| Ink 2 (hints, links): ivory at 70% | #aca8a0 | 8.54 |
| Ink 3 (placeholders): ivory at 55% | #888580 | 5.51 |
| Edge (field underline): ivory at 45% | #716e6b | 4.00 |
| Error | #f2a0a0 | 9.94 |
| Success (the success state only) | #d8b56a | 10.35 |
| Focus | 2px #f4ede0, 3px offset | 17.39 |
| Button | #f4ede0 pill, #05060b label | 17.39 |

---

## 3. Type

### 3.1 Families

- **Geist** for everything in the app.
- **Geist Mono** only for identifiers that someone reads aloud or copies
  character by character: EINs, state file numbers, one-time codes, and
  technical ids under "Technical details". Never for money, dates,
  percentages, scores or account masks.
- **Playfair Display, the brand serif, survives in exactly two places:**
  the BFO wordmark, wherever it appears, and the one heading on each door
  screen. It is never used for dialog titles, avatars, initials, figures,
  tables, chips or buttons. Why: inside the app one typographic voice is
  calmer, and the serif keeps its meaning as the mark.
- Fonts are self-hosted (§14.8, step 7): variable woff2 files for Latin and
  Latin Extended in `public/fonts/`, under the SIL Open Font License (its
  text sits beside them). Inter is dropped. A brand typeface other than
  Playfair Display, chosen in the logo studio, still loads from Google Fonts
  when the door shows it; Playfair, Geist and Geist Mono never do.

### 3.2 Scale

Eight sizes, as tokens. Line heights and sizes are px.

| Token | Desktop | Touch | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `caption` | 12/16 | 12/16 | 400; 500 for column heads and counts | 0 | Timestamps, column heads, counts, footnotes, keycaps, chart axes. The floor |
| `small` | 13/18 | 13/18 | 400; 500 for labels | 0 | Secondary lines, field labels, hints, status words, back links, desktop menu rows |
| `body` | 14/20 | 15/22 | 400; 500 for buttons and figures | 0 | Rows, values, paragraphs, buttons, table cells |
| `field` | 14/20 | 16/22 | 400 | 0 | Text inside inputs (16 on touch, so iOS never zooms) |
| `reading` | 16/26 | 16/26 | 400 | 0 | Long-form text: Terms, Privacy, mail bodies, Ask answers, notes |
| `section` | 15/20 | 17/22 | 600 | -0.005em | Card titles, empty-state titles |
| `title` | 17/22 | 17/22 | 600 | -0.01em | Dialog and sheet titles, side-sheet titles |
| `heading` | 22/28 | 22/28 | 600 | -0.015em | Page titles; the values in a KPI strip |
| `display` | 28/34 | 28/34 | 600 | -0.02em | The one headline figure on a screen (a net position, an account balance). At most one per screen |

### 3.3 Rules

- **Nothing is set below 12px** anywhere in the app. The wordmark is the
  only exception.
- **Weights are 400, 500 and 600.** No 700 or heavier. No italics in UI
  text (reading text may italicise a quotation or a defined term).
- **Sentence case everywhere:** titles, buttons, tabs, menu items, labels,
  column heads. **No uppercase, no letter-spaced labels, no eyebrows.** The
  wordmark is the only text in capitals. Why: the app has four different
  tracked-caps styles today, and each adds a voice; section labels are
  13px medium in `ink-2` instead.
- **Headings outrank what they head.** A card title (15/600) sits over
  14/400 rows. Group labels inside a list or menu (12/500 `ink-2`) are
  quieter than the rows they group. A field label is never larger than the
  value it labels.
- **Tabular figures** (`tabular-nums`) on every number that sits in a
  column, changes in place or is compared: money, counts, percentages,
  dates and times in lists, codes. Numbers inside running prose may stay
  proportional.
- **Measure:** reading text runs at most 68 characters wide.
- **Wrapping:** `text-wrap: balance` on titles and headings;
  `text-wrap: pretty` on dialog and empty-state copy. Names wrap to two
  lines before they truncate; truncated text shows its full value on hover
  (desktop) and on the detail it opens (touch).

### 3.4 Links

- Inside running text, links are `accent` and underlined (1px, 3px
  offset). Why: accent and ink differ by under 3:1, so colour alone can't
  mark a link.
- A standalone link ("View all", "Open in Books") is `accent` with no
  underline, underlined on hover, and ends with a 16px chevron when it
  navigates. On touch its hit area is 44px tall.
- Links that leave BFO add the external-arrow icon and open in a new tab.

---

## 4. The root size, and how the app moves off 11.9px

### 4.1 The decision

The root font size becomes **16px**, and every size the system defines (type,
spacing, radii, control heights, widths) is a **px token** or a 4px spacing
unit, so nothing depends on the root again. The root flips **last**, after
every area has moved; until then the new scale is switched on page by page
with a scope class, `ds`.

Why not flip the root on the first day, with Tailwind's spacing retuned to
keep today's density: flipping changes about 120 rem values at once (68
arbitrary values in 29 files, 44 lines of `app.css`, 12 inline styles), most of
them in files other areas own, and resizes every `rounded-*`, `max-w-*` and
`text-xs` across about 60 pages in one step. The scoped switch has the same
end state, changes nothing on a page until that page's owner moves it, and
needs no cross-area edits.

### 4.2 How the scope works

Tailwind v4 compiles `p-4` to `padding: calc(var(--spacing) * 4)`, and
`text-xs`, `rounded-lg` and `max-w-md` to `var(--text-xs)`,
`var(--radius-lg)` and `var(--container-md)`. Each of those variables can
be redefined for a subtree. The `ds` class redefines them:

- `--spacing: 4px`, so the spacing scale is the true 4px grid (`p-4` is
  16px, `h-11` is 44px);
- the legacy text, radius and container names map to px values on the new
  scale, so a straggling `text-xs` inside a migrated page renders at 12px,
  not 8.9px;
- nothing else changes.

Outside `ds`, the root is still 11.9px and every page renders exactly as
today. The new tokens (`text-body`, `bg-raised`, `rounded-card`,
`h-(--control-md)`, …) are px, so they render identically inside and
outside `ds`.

Every component in `app/ui/` carries `ds` on its root, so a new `Button`
looks right even on a page that hasn't moved yet. The shell chrome (sidebar,
top bar, drawer, Ask button) moves in the foundation pass. `<Page>`
(§14.3) adds `ds` to a page's own content.

What a legacy class becomes inside `ds` (and everywhere after the flip):

| Class | Today (11.9px root) | Inside `ds` |
|---|---|---|
| `p-4` | 11.9px | 16px |
| `gap-3` | 8.9px | 12px |
| `h-8` / `h-11` | 23.8 / 32.7px | 32 / 44px |
| `text-xs` | 8.9px | 12px (caption) |
| `text-sm` | 10.4px | 13px (small) |
| `text-base` | 11.9px | 14px, 15px on touch (body) |
| `text-lg` / `text-xl` | 13.4 / 14.9px | 17px (title) |
| `text-2xl` | 17.9px | 22px (heading) |
| `text-3xl` and up | 22.3px and up | 28px (display) |
| `rounded-sm` / `rounded-md` / `rounded-lg` | 3 / 4.5 / 6px | 4 / 8 / 8px |
| `rounded-xl` / `rounded-2xl` / `rounded-3xl` | 8.9 / 11.9 / 17.9px | 12 / 12 / 16px |
| `max-w-md` | 333px | 448px |
| `text-[11px]` | 11px | 11px (px literals don't change; still banned) |
| `pb-[5.5rem]` | 65.5px | 65.5px (rem literals follow the root; banned in migrated code) |

Breakpoints don't move: Tailwind's `48rem` media queries resolve against
the browser's 16px, not the page's root.

### 4.3 What each page has to do

Moving a page is one pull request per page or group of pages, by the area
that owns it. The full checklist is §14.6. In short:

1. Render the page inside `<Page>` (which adds `ds`, the container and the
   page header).
2. Read every spacing utility again: inside `ds` it now means what it says
   (`p-4` was 11.9px and is now 16px). Bring each to the grid in §5.
3. Replace type classes and px literals with the type tokens (§3.2).
4. Replace colour classes, glass classes and `isDark` branches with the
   colour tokens (§2.2).
5. Replace hand-rolled controls and pop-ups with `app/ui` components.
6. Format money, dates and masks with `app/ui/format.ts`.
7. Remove the decoration listed in §13.
8. `npm run check:design` reports nothing for the page's files; check both
   themes at 390 and 1440 wide.

### 4.4 The flip

When `npm run check:design` reports zero legacy usage across `app/`
(§14.8), foundation makes the scope the default: `html` goes to 16px, the
`ds` values move to `:root`, and the `html.light` rescue layer is deleted.
Migrated pages see no change.

---

## 5. Spacing and layout

### 5.1 The grid

- **A 4px grid.** The steps are 4, 8, 12, 16, 20, 24, 32, 40, 48 and 64
  (Tailwind 1, 2, 3, 4, 5, 6, 8, 10, 12, 16 inside `ds`). 2px and 6px are
  allowed only inside a component, for a label-to-field gap or an optical
  nudge. No half steps (`*-0.5`, `*-1.5`, `*-2.5`, `*-3.5`) in migrated code.
- **Breakpoints:** phone under 768px; tablet 768–1023px; desktop 1024px
  and up; wide 1280px and up.
- **Gutters** (`--gutter`): 16px on phones, 24px on tablets, 32px on
  desktop, plus the safe-area insets on a phone held sideways. Every
  floating piece (toasts, sheets' inner padding, the Ask button) aligns to
  the gutter.

### 5.2 Page widths

Three containers, centred in the content area (between the sidebar and the
right edge of the window), with the page header in the same column.

| Container | Width | Pages |
|---|---|---|
| `reading` | 720px | Settings, forms, Notes, legal pages, the balance sheet and other single-column statements, Notifications, Games, not found |
| `workspace` | 1200px | Home, Entities, an entity's pages, Treasury, Investments, Signatures, Mail, Paper mail, Phone, People |
| `full` | the content width | Wide tables and matrices: Transactions, the P&L by month, the maps |

Reading text inside any container stays within 68 characters.

### 5.3 Page padding and rhythm

| Space | Phone | Desktop |
|---|---:|---:|
| Top of content, below the top bar or window edge | 16 | 32 |
| Back link to title | 8 | 8 |
| Title to its context line | 4 | 4 |
| Page header to first content | 24 | 24 |
| Between sections | 32 | 32 |
| Between cards in a stack or grid | 16 | 16 |
| Inside a card (padding) | 16 | 20 |
| Between fields in a form | 16 | 16 |
| Form groups, and the last field to the form's buttons | 24 | 24 |
| Bottom of content (clears the Ask button) | 96 + safe area | 96 |

### 5.4 The grid inside `workspace`

Twelve columns with 24px gaps on desktop and 16px on tablets; one column on
phones. Two layouts cover most pages:

- **Main and rail:** `minmax(0, 1fr) 320px` with a 24px gap from 1024px up.
  Below that, the rail's cards stack after the main column, in an order the
  page states in its code (urgent first).
- **Card grid:** two or three equal columns with 16px gaps; one column on
  phones.

### 5.5 The page header

One component, `PageHeader`, on every signed-in page.

- **Back link** (sub-pages only): a 16px chevron and the parent's name,
  `small` 500 `ink-2`, 32px tall (44 on touch). It returns to the parent at
  its previous scroll position. Top-level pages have none.
- **Title:** `heading` (22/28 600), `ink`. One line on desktop; wraps on a
  phone.
- **Context line** (optional): one line of `body` in `ink-2` that says what
  the page shows, its scope and its freshness ("9 entities · as of Nov 6,
  2026"). No second line, no KPI strip in the header.
- **Actions, desktop:** right-aligned on the title row, in this order: the
  "…" overflow, secondary buttons, then at most one primary, last.
- **Actions, phone:** the title row keeps two 44px icon buttons at most: a
  "+" when the primary action creates something (labelled for screen
  readers), and the "…" overflow holding every other action. A primary
  action that doesn't create (for example "Sync records") becomes a
  full-width primary button under the context line.
- **The browser tab title:** "Page · BFO" for a page, "Record · Section ·
  BFO" for a record ("Northwind Holdings, LLC · Entities · BFO").

### 5.6 Phone layout rules

- One column. Nothing scrolls sideways except a chip row that is meant to,
  which fades at its edge.
- No scroll container inside the page's scroll.
- Task pages (signing, a long edit) keep their actions in a sticky bottom
  bar above the safe area, and the Ask button hides.
- Tables become lists (§8.10).

---

## 6. Shape and depth

### 6.1 Radii

Four radii plus full.

| Token | Value | Use |
|---|---:|---|
| `rounded-mark` | 4 | Checkboxes, skeleton bars, keycaps |
| `rounded-control` | 8 | Buttons, inputs, selects, segmented controls, nav rows, highlighted menu items, tooltips |
| `rounded-card` | 12 | Cards, menus, popovers, toasts, banners, choice tiles |
| `rounded-dialog` | 16 | Dialogs; the top corners of bottom sheets |
| `rounded-full` | | Badges, counts, filter chips, status dots, avatars, the switch, the Ask button, the door's button |

Buttons are 8px, not pills. Why: buttons and fields sit side by side in
forms and toolbars, and one corner reads as one family. Pills are kept for
things that aren't pressed for an action (badges, counts) and for the door.

### 6.2 Borders over shadows

- **Cards:** 1px `line` border, no shadow.
- **Overlays** (dialogs, sheets, drawer, menus, popovers, toasts) and the
  Ask button: 1px `line-strong` border plus `--elevation-2`.
- **The selected segment and the switch thumb:** `--elevation-1`.
- **Nothing else casts a shadow.** Sticky bars use a hairline, not a
  shadow.

| Token | Light | Dark |
|---|---|---|
| `--elevation-1` | `0 1px 2px rgb(9 9 11 / 0.08)` | `0 1px 2px rgb(0 0 0 / 0.5)` |
| `--elevation-2` | `0 1px 2px rgb(9 9 11 / 0.06), 0 12px 32px -8px rgb(9 9 11 / 0.18)` | `0 1px 2px rgb(0 0 0 / 0.4), 0 16px 40px -8px rgb(0 0 0 / 0.7)` |

### 6.3 Glass and blur

**There is no glass and no blur in the app.** Every surface is solid,
including overlays, sticky bars, the sidebar and the top bar, and scrims are
flat colour. The Glass slider in Appearance goes. Why: glass turns a white
dialog grey over a scrim, lets the Ask button and the page show through
menus, and makes every contrast ratio depend on whatever happens to be
behind; a calm surface is the same every time you look at it.

### 6.4 Nothing decorative on a surface

No gradients on surfaces, buttons, borders or text. No glows, inner
highlights, dot grids or sheens. No card inside a card: a subsection inside
a card is a subhead and a hairline.

---

## 7. Motion

Motion explains a change of place or state, then stops.

### 7.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--dur-1` | 120ms | Colour changes (hover, press); exits of small overlays |
| `--dur-2` | 160ms | Menus and popovers entering; toasts and sheets leaving |
| `--dur-3` | 200ms | Dialogs and toasts entering; disclosures opening; sheets leaving |
| `--dur-4` | 240ms | Sheets, the drawer and side sheets entering; phone push views |
| `--ease-out` | cubic-bezier(0.16, 1, 0.3, 1) | Things arriving |
| `--ease-in` | cubic-bezier(0.4, 0, 1, 1) | Things leaving |
| `--ease-standard` | cubic-bezier(0.2, 0, 0, 1) | State changes in place |

### 7.2 What moves

| Thing | Enter | Exit |
|---|---|---|
| Hover and press colours | 120ms standard | 120ms |
| Menu, popover, select | fade and 4px from the trigger, 160ms out | fade, 120ms in |
| Dialog | fade and scale 0.98 to 1, 200ms out | fade, 120ms in |
| Bottom sheet | slides up from the edge, 240ms out | slides down, 200ms in |
| Drawer and side sheet | slide from their own edge, 240ms out | 200ms in |
| Scrim | fade, same duration as its overlay | fade |
| Toast | fade and 8px rise, 200ms out | fade, 160ms in |
| Disclosure, accordion | height, 200ms standard | 200ms |
| Phone push view (Mail, Texts, Paper mail: list to item) | 24px from the right and fade, 240ms out | reverse |
| Skeleton | opacity 1 to 0.6 and back, 1.6s, while loading | |
| Spinner | 800ms linear turn, while busy | |
| Route progress | a 2px `accent` bar, after 300ms | fades out |

### 7.3 What never moves

- Numbers (no counting up), cards on load (no staggered rise), data after
  it arrives.
- Backgrounds inside the app.
- Anything on a loop that isn't a live state. Pulses, pings, glows,
  breathing rings and marching lines go. Live states (recording, listening,
  a sync running, a spinner, a skeleton) may loop while they are true.
- Hover: no scale, no lift, no shadow growth.
- Theme switches: instant.
- An interactive control's own opacity or transform. Entrance animations
  sit on a wrapper, so they can never override a disabled or pressed
  state.
- Tabs, segmented controls and checkboxes: they change state instantly.

### 7.4 Reduced motion

Under `prefers-reduced-motion: reduce`: no transforms anywhere; overlays,
toasts and scrims fade over 100ms; skeletons are static at 0.8 opacity;
spinners keep turning (they are the only sign of work); the door shows a
still frame; the voice globe stays still and shows state by its ring alone.

---

## 8. Components

Every component below lives in `app/ui/` (props in §14.3). Pages use them;
they don't restyle them. A page that needs a variant asks foundation for it.

### 8.0 Shared rules

**Sizes come from tokens, not call sites.** Components read
`--control-sm|md|lg`, `--row-*` and `--icon`, which switch to touch sizes in
one place (§14.1). No `max-sm:h-[44px]` at call sites.

| Token | Desktop | Touch |
|---|---:|---:|
| `--control-sm` | 32 | 44 |
| `--control-md` | 36 | 44 |
| `--control-lg` | 44 | 48 |
| `--row-menu` | 32 | 44 |
| `--row-1` (one-line row) | 40 | 48 |
| `--row-2` (two-line row) | 56 | 64 |
| `--icon` | 16 | 20 |

**States**, the same everywhere:

| State | Treatment |
|---|---|
| Hover | Only on devices that hover (`hover:` in Tailwind v4 already checks). `hover` fill or the variant's hover colour. Nothing moves or grows |
| Pressed | `selected` fill, or the variant's pressed colour |
| Focus | 2px `accent` ring, 2px offset, on `:focus-visible`. Never removed. Borders don't also change colour |
| Disabled | `selected` fill, `ink-disabled` label, `line` border; `cursor: not-allowed`; no hover. Never opacity. A disabled action says why, in a visible hint next to it |
| Busy | A 16px spinner and a verb with an ellipsis ("Saving…"); the width is held; `aria-busy`; clicks are ignored |
| Selected, current, pressed toggle | Defined per component; always also exposed as `aria-selected`, `aria-current`, `aria-pressed` or `aria-checked` |
| Invalid | `negative` border and a message under the field |

**Icons:** one set (the outline paths in `app/entity/ui.tsx` are copied
into `app/ui/icon.tsx`, which becomes the only source), stroke 1.75, `--icon` sized, `currentColor`, always
`shrink-0`. Each glyph means one thing everywhere: pencil = edit, trash =
delete, "…" = more, sparkle = AI, arrows in a circle = sync, tray-up =
upload or replace, tray-down = download, two squares = copy, × = close or
dismiss (never delete), chevron-left = back, chevron-right = opens,
magnifier = search, (i) = explain. No text glyphs (←, →, ✕) as icons.

**One primary per screen or pop-up.** A form's submit is the only filled
button while the form is open.

### 8.1 Button

**Anatomy:** optional 16px leading icon (20 on touch), 8px gap, label.
Labels never wrap.

**Sizes**

| Size | Height (desktop / touch) | Padding x | Text |
|---|---|---:|---|
| `sm` | 32 / 44 | 12 | `small` 500 |
| `md` (default) | 36 / 44 | 16 | `body` 500 |
| `lg` | 44 / 48 | 20 | `body` 500 |

**Variants**

| Variant | Fill | Label | Border | Hover | Pressed |
|---|---|---|---|---|---|
| `primary` | `ink` | `ink-inverse` | none | `primary-hover` | `primary-pressed` |
| `secondary` (default) | transparent | `ink` | 1px `edge` | `hover` fill | `selected` fill |
| `quiet` | transparent | `ink-2` | none | `hover` fill, `ink` label | `selected` fill |
| `danger` | `danger` | `on-danger` | none | `danger-hover` | `danger-hover` |

Disabled: `selected` fill (`primary` and `danger`), transparent with a
`line` border (`secondary`) or transparent (`quiet`); always an
`ink-disabled` label.

**Groups:** 8px apart. Desktop: secondary then primary, primary last
(rightmost). Phone footers: stacked, full width, `lg`, primary on top.

- Do: name the action with a verb and its object ("Add owner", "Send for
  signature", "Delete rule").
- Do: put an ellipsis on a label only when a dialog asking for more follows
  ("Rename…").
- Don't: use `danger` outside a confirm. On a page, a destructive action is
  a menu item in `negative`, never a red button.
- Don't: put a price on a page-level button. The confirm states it
  (§11.3).
- Don't: show a disabled primary without saying, next to it, what's
  missing ("Add a name to continue").

### 8.2 IconButton

Square: 32px desktop, 44px touch; 16 or 20px icon; radius 8. Variants
`quiet` (default: `ink-2` icon, `hover` fill) and `secondary` (1px `edge`
border). A `pressed` toggle shows the `selected` fill and `ink` icon, with
`aria-pressed`. Every IconButton has a `label`: its accessible name and,
on desktop, its tooltip.

- Do: use it for close (×), "…", copy and other frequent, well-known
  actions.
- Don't: make a rare action icon-only on a phone. It goes in the "…" menu
  with its words.

### 8.3 Field, Input, Textarea and SearchField

**Field anatomy:** label above (`small` 500 `ink`), 6px gap, the control,
6px gap, then either a hint (`small` `ink-2`) or an error (`small`
`negative` with a 16px error icon). Optional fields add " (optional)" in
`ink-3` after the label; required fields carry no mark. Errors replace
hints while present. Focus moves to the first field when a form opens.

**Input:** height `--control-md` (36/44), 12px padding, `field` text size,
`field` fill, 1px `edge` border, radius 8. Placeholder in `ink-3`, used for
an example of the format ("name@example.com"), never as the only label and
never looking like real data. Prefix and suffix slots (`$`, `%`) in `ink-2`.
Read-only values are plain text, not a field with a border.

**Money input:** `$` prefix, decimal keypad (`inputMode="decimal"`),
formats to cents with separators on blur ("1,250.00").

**Date input:** shows "Nov 6, 2026"; opens a calendar popover (a sheet on
touch); accepts typed dates in common formats.

**Textarea:** starts at three lines, grows to ten, then scrolls.

**SearchField:** an Input with a leading magnifier, a clear (×) IconButton
once there is text, and `type="search"`. Placeholder "Search entities",
naming what it searches. Escape clears it.

- Don't: change the border colour on focus; the ring is the focus.
- Don't: use native validation bubbles. Validate on submit and on blur of
  a field already touched, and show the message under the field.

### 8.4 Select

There is no native `<select>`. **Select** is a trigger styled as an Input
(value in `ink`, "Choose…" in `ink-3` when empty, a 16px chevron-down in
`ink-3` 12px from the right edge) that opens a listbox:

- **Desktop:** a Menu (§8.19) anchored below, as wide as the trigger
  (200px minimum), with a search field at the top when there are more than
  ten options. The chosen option shows an `accent` check at the right.
- **Touch:** a Sheet titled with the field's label, 48px rows, the check at
  the right.
- **Multi-select:** rows with checkboxes; the sheet has Done. The trigger
  reads "3 selected", or the names joined by a list formatter when they
  fit.
- Keyboard: Enter, Space or ↓ opens; type-ahead jumps; Escape closes.
- Do: offer only real choices (states in use, not all fifty), and say in
  a footnote row when some are left out on purpose.
- Don't: let a free-text field stand in for a known list (states, entity
  types, roles).
- Don't: open a Select from a hover, or rewrite past records the moment a
  value is picked (§11.1).

### 8.5 Segmented control

For switching between two to five views or filters of the same content
(Map | List, Voice | Text, 30D | 90D | All).

- Track: `sunken` fill, radius 8, 2px inset padding; height `--control-sm`
  (32/44).
- Segments: content width, or equal widths with `full`. Labels at most two
  words, `small` 500 on desktop and `body` 500 on touch, `ink-2`.
- Selected segment: `overlay` fill, 1px `edge` border, `--elevation-1`,
  `ink` label. The edge is what makes the choice visible
  at 3:1.
- It is a radio group: one Tab stop, arrow keys move the choice.
- Do: use it instead of a label that flips ("Active only" → "Active | All").
- Don't: use it for navigation between pages (that is Tabs) or for more
  than five options (that is a Select).

### 8.6 Checkbox, ChoiceTiles and Switch

**Checkbox:** a 16px box (20 on touch), radius 4, 1.5px `edge` border,
`field` fill. Checked: `accent` fill with an `on-accent` check. Mixed: a
dash. The label sits 8px to the right in `body`; the whole row is the
target, at least 44px tall on touch. Use it for multi-select and for
agreement (§11.4). Native checkboxes are never shown.

**ChoiceTiles** (a radio group with descriptions, for two to four options
that carry consequences: a role, a signing mode, a tax election): each tile
has a 16px radio, a title (`body` 500) and one line of description (`small`
`ink-2`); 1px `edge` border, radius 12, 16px padding; stacked on phones, in
a row on desktop when they fit. Selected: a 2px `accent` border (drawn
inset, so nothing shifts), `accent-tint` fill and a filled radio. One Tab
stop, arrow keys move.

**Switch:** for a setting that takes effect immediately; never inside a
form with a Save button.

- Track 36×20 (44×26 on touch), radius full. Off: `edge` fill. On:
  `accent` fill.
- Thumb 16px (22 on touch), white, `--elevation-1`.
- The setting's name is on the left, the switch on the right, in a row of
  at least 44px. The label names the setting, never its current value.

- Do: pick by kind. Several independent yes/no choices: Checkboxes. One of
  two to four options with consequences: ChoiceTiles. One of two to five
  short options: Segmented. An immediate on/off setting: Switch. A long
  list: Select.
- Do: show an unanswered yes/no visibly as unanswered, not as "no".
- Don't: show the selected choice by colour alone; the border, the filled
  radio or the check carries it too.
- Don't: use a link-styled card as a toggle.

### 8.7 Status, Badge, Count and FilterChip

**Status** is a dot and a word: an 8px dot in the status colour, 6px gap,
the word in `small` `ink`. Tones: `neutral` (`ink-3` dot), `positive`,
`warning`, `negative`, `info`. Where statuses repeat in a grid, the dot is
replaced by a 16px shape in the same colour (check, exclamation, ×, dash),
so colour is never the only signal. A thing has one status per screen,
said once.

**Badge** labels a kind, not a state (LLC, Trust, Partner, Staff only):
20px tall, 8px padding, `caption` 500 `ink-2` on `sunken`, radius full,
with an optional 12px leading icon (a lock for Staff only). There are no
coloured or outlined badges.

**Count:** a number on a pill, 20px tall, 20px minimum width, 6px padding,
`caption` 500 tabular. Neutral: `ink-2` on `sunken`. Attention (things that
need the person): `warning` on `warning-tint`. Never red. Over 99 reads
"99+". A count appears once, where its items live.

**FilterChip** shows an active filter: 28px tall (with a 44px hit area on
touch), radius full, 1px `edge` border, `small` `ink` label, and a trailing
× that removes it.

- Do: show exceptions only. "Online", "Connected", "Mapped" and "No
  change" show nothing.
- Do: use one word per state across the app ("Dormant" everywhere, not
  "dormant", "inactive" and "no activity").
- Don't: say a status twice (a pill and a sentence), or pair a dot with a
  coloured sentence.
- Don't: pulse a dot. A live state is shown by its word.
- Don't: colour a Badge by category, or use a Badge as a button.

### 8.8 Card

The container for a group of related content.

- `raised` fill, 1px `line` border, radius 12, no shadow.
- **Header:** at least 52px tall (56 on touch), padding 20px (16 on touch)
  across and 12px down. The title in `section`, `ink`; an optional Count
  after it; an optional (i) after that, which reveals the card's
  explanation under the header (`small` `ink-2`, 68ch). On the right, at
  most one action (a `quiet` Button or a standalone link) and an optional
  "…" IconButton.
- **Body:** padded 20px (16 on touch), or `flush` for a list or table,
  whose rows carry the same side padding so text lines up with the title.
  A hairline separates header and body only when the body is flush.
- **Footer** (optional): a hairline, then a right-aligned action or a "View
  all" link.
- On phones, cards keep their border and radius inside the 16px gutter
  (inset grouped).
- Don't: nest cards. A subsection is a subhead (`small` 600 `ink`) over its
  rows, with a hairline above.
- Don't: put a kicker line above the title or a paragraph under it.

### 8.9 ListRow

The standard row for lists on every screen size, and for tables on phones.

- **Heights:** `--row-1` (40/48) for one line, `--row-2` (56/64) for two.
- **Leading** (optional): a 16/20px icon in `ink-2`, or an Avatar (24 for
  one line, 32 for two).
- **Title:** `body` `ink`, 400; 600 when unread. Wraps to two lines before
  truncating.
- **Secondary line:** `small` `ink-2`, one line.
- **Meta** (optional, top right): `caption` `ink-3`, tabular (a time).
- **Trailing:** a value (`body` 500 `ink`, tabular, right-aligned), a
  chevron (16px `ink-3`) when the row opens something, or both.
- **Unread:** an 8px `accent` dot in a 16px gutter before the leading slot,
  plus the 600 title. Nothing else (no fill, no glow).
- **Hover:** `hover` fill. **Selected:** `selected` fill and a checked
  checkbox. **Pressed:** `selected` fill.
- **Dividers:** 1px `line`, starting at the title's left edge and running to
  the right edge.
- **Actions:** the whole row opens. At most one inline action, and only
  when the row's state calls for it; everything else is in the row's "…"
  menu. On touch there are no hover-only controls: use "…" or a swipe, and
  a swipe that removes something shows an Undo toast.
- Do: keep the trailing column for the one figure that matters (a
  balance, an amount, a date), always in the same place.
- Do: in lists grouped by day, put the date in the group header and only
  the time on the rows.
- Don't: render a list as stacked label-and-value cards on a phone.
- Don't: repeat a trash icon or a "Delete" word down every row.
- Don't: show raw text from a feed. Names and memos pass through the
  owning area's tidy-up (title case for shouting text, no reference
  numbers in the title).

### 8.10 Table

Desktop and tablet only; on phones every table renders as ListRows.

- **Head:** 32px, `caption` 500 `ink-2`, sentence case, 1px `line-strong`
  rule below; sticky inside its card on `raised`.
- **Rows:** `--row-1` (40), `body`. Cell padding 12px; the first and last
  columns take the card's 20px.
- **Alignment:** text and dates left; numbers right, tabular, one precision
  per column; the head follows its column.
- **Sorting:** the head is a button; a 12px caret shows only on the sorted
  column; `aria-sort` set.
- **Hover:** `hover` fill only when the row opens something. **Selected:**
  `selected` fill and a 40px checkbox column.
- **Group band:** a 32px row on `sunken`, `small` 600 `ink`, with the group's
  count and total.
- **Totals:** a subtotal row is 600 weight with a 1px `line-strong` rule
  above. A statement's final total has a 1px `ink` rule above and a double
  rule (3px double `ink`) below.
- **Empty values:** zero is "—" in `ink-3`; no data is a blank cell
  (§10.2).
- **Long text:** wraps to two lines in the first column, then truncates.
- **Wide tables** (months across) may scroll sideways on desktop, with the
  first column sticky on `raised` and a 1px `line` on its right edge. No
  zebra stripes, no shadows.
- **On phones:** each row becomes a ListRow (name, one secondary line, the
  key amount) that opens a detail sheet; a month-by-account matrix becomes
  a list of rows with their totals, and the months are in the sheet.
- Loading shows eight skeleton rows at the real column widths.
- Do: hide a column whose value is the same on every row; say it once
  above the table.
- Do: make every figure in a column reachable as a link to its detail
  when it has one (a P&L cell opens its transactions).
- Don't: scroll a money table sideways on a phone.
- Don't: mix whole dollars and cents in one column, or parentheses and
  minus signs in one table.

### 8.11 Tabs

For sections of one page or record, where the URL changes (Overview,
Documents, Owners).

- Under the page header; 40px tall (44 on touch); `body` 500 `ink-2`; the
  current tab `ink` with a 2px `ink` underline on the bar's bottom hairline.
  24px between tabs. An optional Count after the label.
- **Phones:** up to four tabs show as tabs. Five or more collapse into a
  section button (the current tab's name and a chevron) that opens a sheet
  listing every section with its count.
- No tabs inside tabs.
- Route tabs are links with `aria-current`; in-page tabs are a `tablist`
  with arrow keys.
- Do: use the same count rule on the tab and inside it (a tab's Count is
  the number of things in it that need the person).
- Don't: use Tabs to filter a list (that is a Segmented control), or put
  an accent fill on the current tab.

### 8.12 Toolbar and filters

Above a list or table, in this order: SearchField (flexible width), filter
Selects, then the view switch (a Segmented control) at the right. On
phones: the SearchField and one "Filter" button with a Count of active
filters, which opens a sheet; active filters show below as FilterChips with
"Clear all".

### 8.13 Empty

- **Page or card body with nothing yet:** a top-aligned column, 400px wide
  at most, 64px under the header (24 inside a card): a title in `section`
  `ink` ("No notes yet"), one or two sentences in `body` `ink-2` that say
  what will be here and who can see it, and one primary Button (omitted for
  people who can't add).
- **A section with nothing:** one line of `body` `ink-2` inside the card's
  padding, with an optional standalone link.
- **Filtered to nothing:** "No entities match “Northwind”." and a `quiet`
  "Clear filters".
- No illustrations, no glowing icons, no grids of placeholder tiles. A
  count is never shown before the data arrives ("0 rules" while loading).

### 8.14 Loading

- **Skeletons** mirror the final layout: the header, the rows, the card.
  Bars are `sunken`, radius 4, 75% of the text's size tall, at varied
  widths. They appear only after 300ms, leave the moment data arrives, and
  never hold for a minimum time.
- **Spinners** (16px, `currentColor`) appear only inside a busy button or
  an inline refresh control.
- **Route progress:** a 2px `accent` bar along the top of the content,
  after 300ms.
- Never a bare "Loading…" line.

### 8.15 Error and Banner

**Banner:** a message about a region, at the top of the region it concerns
(under the page header, or at the top of a card's body). The tone's tint as
fill, no border, radius 12, 12px by 16px padding; a 16px icon in the tone's
colour; the text in `body` `ink` (an optional 500 first sentence); an
optional `quiet` action ("Try again") and an optional dismiss ×. Tones:
`info`, `warning`, `negative`, `positive`.

**Errors:**
- Field errors sit under the field (§8.3).
- A failed load shows a `negative` Banner in the region that failed, with
  "Try again". The rest of the page keeps working.
- A failed action keeps the person's input, shows a Banner (or the field
  error) saying what happened and what to do, and offers to try again.
- A page that can't render at all uses the Error page (§8.18).
- Errors are never toasts. Raw messages, codes and JSON never reach the
  screen; they sit behind a "Technical details" disclosure.

### 8.16 Toast

Confirms something that just happened, and offers Undo when it can be
undone.

- `overlay` fill, 1px `line-strong` border, `--elevation-2`, radius 12,
  12px by 16px padding, at least 44px tall, at most 420px wide (the screen
  width less 32px on phones).
- One line of `body` `ink` (two at most), and one optional action as a
  standalone link on the right ("Undo"). No icon.
- **Position:** bottom centre of the content column, 24px up, on desktop;
  on phones, centred above the Ask button's row (16 + 48 + 12px plus the
  safe area).
- **Time:** 5 seconds, 8 with an action; paused while hovered or focused.
  One at a time; a new toast replaces the current one. `role="status"`.
- Don't: use a toast for an error or for anything the person must read
  later.

### 8.17 Avatar, Tooltip, Keycap, Disclosure, InfoToggle

**Avatar:** a circle of 24, 32 or 40px; `sunken` fill; one or two initials
in Geist 500 (`caption`, `small` or `body`) in `ink-2`; a photo, when there
is one, fades in over the initials. Organisations get a building glyph. No
colours, no serif.

**Tooltip:** desktop only, after 500ms of hover or at once on keyboard
focus. `ink` fill, `ink-inverse` text in `caption`, radius 8, 4px by 8px
padding, 240px wide at most. It names or explains; it never holds an action
or anything the person needs to finish a task.

**Keycap:** 20px tall, 20px minimum width, `caption` 500 `ink-2` on
`sunken`, 1px `line-strong` border, radius 4. Shown only with a fine
pointer. ⌘ on Apple devices, Ctrl elsewhere. A sequence is joined by "then"
in `ink-2`.

**Disclosure:** a row with a 16px chevron-right (turning 90° over 200ms),
a `small` 500 `ink-2` label and an optional count; 44px tall on touch. Use
it for long lists ("Done · 10") and technical details.

**InfoToggle (i):** a `quiet` IconButton with the info icon in `ink-2`; at
most one per card header, and one per row only where a label is genuinely
unclear. It reveals text in place; it never opens a tooltip.

### 8.18 Page templates

- **Document** (Terms, Privacy, the e-signature disclosure, help): the
  `reading` container; the title and "Effective Nov 6, 2026 · Earlier
  versions"; a list of linked sections; `reading` text at 68ch; numbered
  `section` headings; a footer linking the sibling documents. On the door
  (signed out) it uses the door's header with the wordmark and a back link;
  signed in, it uses the app shell.
- **Not found and Error:** one component for the in-app route and the root
  error boundary, following the theme. A title ("We couldn't find that
  page" or "Something went wrong"), one plain sentence, a primary "Go to
  Home" (or "Reload" for an error, with "Go to Home" as secondary), a
  standalone "Search BFO" link, and "Technical details" for errors.

### 8.19 Overlays

One overlay system with six kinds. Everything below applies to every kind
unless it says otherwise.

**Shared behaviour**

- **Portalled** to a single `#overlays` element at the end of `<body>`,
  above everything, through one manager (§14.4).
- **Solid:** `overlay` fill, 1px `line-strong` border, `--elevation-2`.
- **Modal kinds** (Dialog, Confirm, Sheet, the drawer, the command palette)
  have a `scrim`, carry `role="dialog"` (or `alertdialog`) and
  `aria-modal="true"`, are labelled by their title and described by their
  message, make the app behind `inert`, and lock the page's scroll without
  shifting it. Scrims never stack: an overlay opened over another adds none.
- **Focus moves in** on open, to the first of these the overlay has:
  `initialFocus`; the type-to-confirm field (§11.2); Cancel, for a
  destructive, billed or binding confirm; the narrowest choice, when the
  dialog offers a scope; the action, for a routine confirm; the first field
  of a form (a popover's first control); the checked item in a menu or
  listbox, or its first item; otherwise the title. **Focus is trapped** while open
  and **returned** to the opener on close (or to `<main>` if the opener has
  gone).
- **Escape** closes the topmost overlay only. A scrim tap closes it too.
  When the overlay holds unsaved input, Escape and the scrim ask "Discard
  changes?" instead of closing.
- **The Ask button hides** while any modal overlay is open, and so does any
  other floating bar.
- **Z order** (one ladder, as tokens; nothing else sets a z-index). Every
  overlay renders into the one root, `<div id="overlays" data-overlay-root>`,
  which sits above the page; inside it overlays stack in the order they
  open, so a Select opened from a Dialog is above the Dialog. Until the flip
  the root's own z-index is 1000, above the legacy layers (`z-[60]` to
  `z-[300]`); at the flip it takes `popover`. Toasts and tooltips keep their
  ladder values inside it. An overlay with a modal above it is inert, and a
  tap outside the top one acts on the top one only.

| Layer | z |
|---|---:|
| `sticky` (sticky heads inside a page) | 10 |
| `shell` (sidebar, top bar) | 30 |
| `fab` (the Ask button, a selection bar) | 40 |
| `popover` (menus, popovers, selects) | 50 |
| `modal` (scrim plus dialog, sheet, drawer, palette) | 60 |
| `toast` | 70 |
| `tooltip` | 80 |

**Dialog** (desktop and tablet, 640px wide and up)

- Widths: `sm` 400 (confirms), `md` 520 (forms), `lg` 640 (results, long
  content). Height at most min(85dvh, 720px).
- Radius 16. Padding 24. Centred in the window.
- Header: title (`title`, `ink`); optional description (`body` `ink-2`); a
  32px × IconButton at the top right (none on a confirm, where Cancel is
  the way out). The header and footer stay put; the body scrolls.
- Footer: buttons `md`, right-aligned, secondary then primary.
- Under 640px wide, a Dialog renders as a bottom Sheet with the same
  content.

**Confirm** (`confirm()`; a `sm` Dialog)

- **Title:** the question, naming the action and the kind of thing ("Delete
  this rule?"). **Object line:** the thing's name in `body` 500 `ink`, on
  its own line, with what tells it apart in `small` `ink-2` ("Created Mar 3
  · matches 48 transactions"). Lists of names go one per line (five, then
  "and 4 more").
- **Message:** one or two sentences of consequence in `body` `ink-2`, ending
  with "This can't be undone." when that is true.
- **Details** (optional): up to five facts as a list, or a receipt (§11.3).
- **Scope** (optional): ChoiceTiles with the narrowest choice preselected
  ("Only this transaction" / "All 48 from this vendor").
- **Type to confirm** (when §11.2 requires it).
- **Buttons:** Cancel (`secondary`) and the action, named with its verb and
  object ("Delete rule", "Void request", "File for $129.00"). Never "OK",
  "Yes" or "Confirm". When the dialog is itself about stopping something,
  Cancel becomes "Keep editing" or "Keep request".
- **Tones:**
  - `default`: a routine choice. Primary button. Focus on the primary.
  - `commit`: binding, billed or sent outside the office. Primary button,
    no red. Focus on Cancel.
  - `danger`: destroys or removes. `danger` button. Focus on Cancel.
- No decorative icon in any tone.

**Sheet**

- **Bottom sheet** (phones): full width, the top corners 16px, at most 90%
  of the visible height. A grabber (36×4, `line-strong`, 8px from the top),
  and the sheet really drags: release past a quarter of its height, or with
  a downward flick, to dismiss. Header: title in `title`, left-aligned, and
  a 44px × at the right. Rows 48px in `body`. A sticky footer with stacked
  full-width `lg` buttons, primary on top, 16px padding plus the bottom safe
  area. It sizes to the visual viewport, so the footer rides above the
  keyboard.
- **Full-screen sheet** (phones; composing, long forms, the palette): covers
  the viewport. A 52px top bar inside the safe area: "Cancel" (`quiet`) on
  the left, the title in `title` centred, and the action (`primary` `sm`)
  on the right.
- **Side sheet** (tablet and desktop; detail drawers): from the right, 480px
  wide (640 for `lg`), full height, square corners, a 64px header with the
  title and ×, and a sticky footer.

**Menu**

- Anchored below the trigger's start edge, 4px away; flips when there's no
  room; never covers its trigger. Width fits the content, 200 to 320px.
  Radius 12, 4px inner padding. No scrim on desktop.
- Items: `--row-menu` (32/44) tall, radius 8, 8px side padding. An optional
  16px icon column, used only when icons differ meaningfully from row to
  row, and then for every item in that group. Label in `small` on desktop,
  `body` on touch, `ink`. A trailing hint in `caption` `ink-3`, or an
  `accent` check on the chosen item. Highlight: `hover` fill.
- Groups: an optional label (`caption` 500 `ink-2`, 28px), separated by a
  1px `line` with 4px above and below.
- Destructive items come last, after a divider, in `negative` (icon too).
- Disabled items are `ink-disabled` and show why as their hint.
- `role="menu"`: focus on open, ↑ ↓ Home End, type-ahead, Enter or Space
  chooses, Escape closes and returns focus to the trigger, Tab closes.
- **Touch:** a menu opens as a bottom sheet titled with the trigger's name,
  with 48px rows.

**Popover**

For anchored content that isn't a list of commands: a filter panel, a date
picker, an explanation card. The Menu's surface and placement, 280 to 400px
wide, 16px padding. Focus moves to its first control if it has one;
otherwise focus stays on the trigger (`aria-expanded`). Escape and an
outside click close it. On touch it is a bottom sheet.

**Command palette**

- A Dialog at the top: 12vh from the top edge, 640px wide.
- An input row 52px tall: a 20px magnifier, the input in 16px, and an "Esc"
  keycap (fine pointer only).
- Results: at most 60dvh, rows 40px (48 on touch); group labels in
  `caption` 500 `ink-2`; each row a 16px icon in `ink-2`, a `body` label,
  and a `caption` `ink-3` hint or keycap at the right. The highlighted row
  has the `hover` fill. With an empty query it shows recent places.
- No results: "Nothing matches “…”." and one suggestion.
- ⌘K or Ctrl+K toggles it. On phones it is a full-screen sheet with the
  input in its top bar and Cancel.

**Do and don't, for every overlay**

- Do: size an overlay to its content within its kind's widths; a confirm
  is 400px whatever its text.
- Do: name the record being edited in the overlay's title ("Edit owner:
  Alex Rivera"), so the person knows what they are changing.
- Do: put a long form on a phone in a full-screen sheet, with its action in
  the top bar, so the keyboard never covers it.
- Don't: open a modal from a modal unless it is a confirm for the first
  one's action.
- Don't: put a decorative icon at the top of a dialog, or a × on a confirm.
- Don't: show a grabber on a sheet that doesn't drag.
- Don't: let a menu's scrim (phones) dim the trigger it belongs to, or a
  menu clip its own labels; it grows to 320px and then wraps.
- Don't: render any overlay inside `<main>`; it always goes through the
  portal.

---

## 9. Navigation

### 9.1 The desktop sidebar (1024px and up)

**Two states, chosen by the person and remembered: expanded (240px) and
collapsed (64px).** Default: expanded from 1280px up, collapsed from 1024
to 1279. There is no hover expansion and no width animation: the width and
the labels change together, in one frame.

Why: today the rail's width animates over 180ms while its labels switch
instantly, so every collapse passes through a 240px rail of centred icons
(two captures caught it), and a rail that changes shape as the pointer
passes isn't calm.

**Expanded, top to bottom**

- A 56px header: the wordmark (vector, `ink`, 20px from the left edge) and
  a "Collapse sidebar" IconButton at the right. Shortcut `[`.
- A "Search" row (32px): magnifier, "Search", a ⌘K keycap; opens the
  palette. Not shown to partners or email-only members.
- The nav. Groups of items are separated by 16px of space; there are no
  section headings.
- At the foot, pinned: the account row (§9.4).

**Rows:** 32px (44 on touch), 12px side padding, radius 8. A 16px icon (20
on touch) and the label in `body`, both `ink-2`, 400. Hover: `hover` fill,
`ink`. **Current page:** `selected` fill, label and icon `ink`, label 500.
That is the only current-page signal: no sliver, no accent tick. A Count
sits at the right.

**Groups** (Mail, Books): the row has a 16px chevron-down in `ink-3` that
turns 180° when open. Children are label-only rows (no icons, no tree
lines), indented so their labels line up with the parent's label (36px),
32px tall (44 on touch). The group holding the current page opens by
itself; other open groups are remembered.

**Collapsed (64px):** the wordmark, sized to fit the rail, and an "Expand
sidebar" IconButton at the top; then 44×44 icon buttons with 20px icons, centred,
each with a tooltip naming it (and its count). A count shows as an 8px
`accent` dot at the icon's top right. A group's icon opens a Menu to its
right listing the group's pages with their counts, instead of jumping to
the first page. The account is a 32px Avatar button.

**Surface:** `page` fill, a 1px `line` on its right edge, full height; the
nav scrolls if it must, the account row stays. The content's left margin
equals the sidebar's width; expanding pushes the content, it never covers
it.

### 9.2 Tablets (768–1023px)

The collapsed 64px rail is always on screen. Expanding it opens the
expanded sidebar as a modal drawer over the content, with the scrim. Touch
sizes apply whenever the pointer is coarse. There is no top bar.

### 9.3 Phones (under 768px)

**Top bar,** on every page, Mail included: 52px plus the top safe area,
`page` fill, and a 1px `line` along its bottom once content has scrolled
under it. Left: a 44px menu button (20px icon). Centre: the wordmark
(vector, `ink`, 16px tall), linking to Home. Right: a 44px search button
that opens the palette (not shown to partners or email-only members).

**Drawer:** from the left, min(85vw, 320px) wide, following the theme
(`overlay` fill, 1px `line-strong` right edge, `--elevation-2`), over the
scrim. A 56px header with the wordmark and a 44px ×. Rows 44px with 20px
icons and labels in `body`; children 44px, label only, indented to the
parent's label. Only the group holding the current page is open; saved
open groups aren't restored on a phone. At the foot, the account row (56px)
above the bottom safe area. It closes on ×, the scrim, a leftward swipe,
Escape or choosing a page, and traps focus while open.

### 9.4 The account row and menu

**Account row:** an Avatar (28px in the expanded sidebar, 32 in the
drawer), the person's name (`body` 500, `ink`), their role in `small`
`ink-2` (drawer only), and a 16px chevron, aligned to the nav rows' left
edge. It opens the account menu: a Menu 280px wide above the row on
desktop, a bottom sheet on phones.

**The account menu holds:**

1. The person's name (`body` 600) and email (`small` `ink-2`, wrapping),
   then other accounts signed in on this device (Avatar 24, name, email; a
   check on the current one), then "Add another account".
2. Settings, Appearance, Notifications.
3. A divider, then "Log out of Alex" (`ink`, not red: signing out isn't
   destructive).
4. A footer row: "Terms · Privacy" (`caption` links, `ink-2`).

Moved out of it: People (to Settings, for admins); installing the app, the
push test and App lock (to Settings › This device); Games and the
front-door gallery (to Settings › Labs, for the owner).

**Appearance** holds one choice: Theme, as a Segmented control (Automatic |
Light | Dark). The Glass and Rows settings go: surfaces are solid and there
is one density per kind of device.

### 9.5 The Ask button

- A 48px circle: `overlay` fill, 1px `line-strong` border,
  `--elevation-2`, a 20px sparkle icon in `ink`. Hover: `hover` fill. Its
  name is "Ask BFO".
- Fixed at the bottom right: 24px from the window's edges on desktop; on
  phones 16px plus the safe areas. z `fab`.
- **Hidden** while any modal overlay is open, while the on-screen keyboard
  is up, while a selection bar or a task page's bottom bar is showing, on
  Ask itself, and for partners and email-only members.
- It doesn't move or hide on scroll; every page reserves 96px of bottom
  padding so nothing sits under it.
- A page may claim the corner for its own primary floating action (Mail's
  Compose on phones); the Ask button doesn't show there. One floating
  button per screen.

Why the change: the cream disc was the brightest thing on every page. On a
solid surface with a hairline it is findable without shouting.

### 9.6 Keyboard

⌘K (Ctrl+K) opens the palette, `[` toggles the sidebar, `?` opens the
shortcuts sheet, and Escape closes the top overlay. Shortcut hints appear
only when the device has a fine pointer.

---

## 10. Numbers, money and dates

All formatting goes through `app/ui/format.ts` (§14.5). No page builds its
own `Intl.NumberFormat`.

### 10.1 Currency

- US dollars, `en-US`: "$12,480.00". The $ sits on every amount, in every
  row. Why: on a phone a row is read on its own.
- Tabular figures; right-aligned in columns; one precision per column.
- Other currencies show their ISO code before the amount ("EUR 1,250.00").

### 10.2 Signs, precision and zero, by context

Each context has one convention, and a page never mixes two in one table.

| Context | Precision | Negative | Positive | Zero | Colour |
|---|---|---|---|---|---|
| Ledger rows: transactions, account activity | Cents | −$84.00 (true minus) | +$1,250.00 (money in) | — | Money in `positive`, but only when the list mixes in and out; out stays `ink` |
| Account balances (Treasury rows, an account's page) | Cents | −$45.20 | $12,480.00 | $0.00 | `ink`; `negative` only for an overdrawn asset account |
| Liabilities (cards, loans owed) | Cents | n/a | Shown as owed, under a heading or label that says so ("Owed $2,140.00") | $0.00 | `ink` |
| Statements: P&L, balance sheet, cash flow | Whole dollars | ($2,140) | $18,240 | — | `ink` only |
| Working schedules: reconciliations, trial balance, 1099 and wage lists, loan schedules | Cents | ($2,140.55) | $18,240.10 | — | `ink` only |
| KPI strips and headline figures | Whole dollars | −$18,240 | $18,240 | $0 | `ink`; a signed result (Net) may take `positive` or `negative` |
| Changes against a prior period | Whole dollars (cents under $100) | ↓ $2,800 · 12.5% | ↑ $3,400 · 11.0% | "No change" | The arrow carries the direction and the figures are unsigned. `positive`/`negative` only where up is unambiguously good (balances, net position, income); otherwise `ink-2` |
| Prices, fees, costs, receipts | Cents, always | n/a | $90.00, $4.50, $94.50 | $0.00 | `ink` |
| Chips and chart axes | Compact | −$12K | $240K, $1.2M | $0 | as the context |

- **Parentheses or a minus, never both** in one context. Percentages in a
  statement follow the statement: "(12.5%)".
- **The minus is a true minus** (U+2212), not a hyphen.
- **Zero and nothing are different.** In tables and statements zero is "—"
  in `ink-3`, decided after rounding; no data (a future month, a value not
  on record) is a blank cell, or "Not on record" in a label-and-value row.
- **Statements foot.** In whole-dollar statements each line is rounded and
  every subtotal and total is the sum of the lines as shown. When that sum
  differs from the rounded true total, a "Rounding" line carries the
  difference. The report code does this, not the formatter.
- **Compact figures** ($240K) appear only where space requires it, and the
  exact figure is always one tap or hover away. Never in a table or a
  statement.
- **Negatives aren't red by default.** Red marks a negative only when it is
  an exception the person must act on.

### 10.3 Percentages

| Kind | Format |
|---|---|
| Ownership | As recorded, up to two decimals, trailing zeros dropped: "50%", "33.33%". A set of shares shows its total and flags any total that isn't 100% in `warning` |
| Changes, margins | One decimal: "8.6%" |
| Rates (interest, the AFR) | Two decimals: "4.25%" |
| Scores and completeness | Whole numbers: "76%" |

The % sign follows the number with no space, always.

### 10.4 Counts

Numerals, always, with the noun ("3 entities", "1 entity"); plurals through
`Intl.PluralRules`. "7 of 9" says what it is out of. Zero in prose is "No
entities". A count is shown once per screen.

### 10.5 Dates and times

| Style | Example | Use |
|---|---|---|
| Short | Nov 6 (this year); Nov 6, 2025 (any other year) | Lists, rows, meta lines |
| Medium | Nov 6, 2026 | Fields, headers, anything that must not be ambiguous |
| Long | November 6, 2026 | Documents, legal text, generated PDFs, signed instruments |
| Date and time | Nov 6, 2026, 3:14 PM | Events, sync stamps |
| Audit | Nov 6, 2026, 3:14 PM EST | Signatures, filings, consent records, activity logs: always with the zone |
| Relative | 12 min ago; 3 hours ago | Only under 24 hours old, and the exact time is on hover and on the detail |

- Never ISO dates ("2026-07-01") or ordinals ("Nov 6th") on screen.
- Times are in the viewer's time zone; audit stamps add the zone's
  abbreviation.
- Durations in plain words: "about 3 minutes".

**Ranges** use an en dash: "Jan 1 – Nov 5, 2026" (spaced, because the ends
contain spaces); "Nov 1–5, 2026" within a month; "Dec 15, 2025 – Jan 10,
2026" across years; "2024–2026" for years.

### 10.6 Periods and basis

- **Every report states its scope, period and accounting basis in its
  context line, never only in a footer:** "All entities · Jan 1 – Nov 5,
  2026 · Cash basis".
- The period picker offers named presets (This month, Last month, This
  quarter, This year, Last year, Custom); the header always shows the
  explicit dates.
- The default period for totals is **this year**. "All time" may be chosen
  for lists; when it is, a net figure is labelled "Cumulative".
- A non-calendar fiscal year reads "FY ending Jun 30, 2026".
- Titles and line labels use terms that match the basis; the CPA's
  glossary governs the words (§12.4).
- Exports and prints carry the same scope line at the top.

### 10.7 "As of" and freshness

- Every figure from a sync or a snapshot shows when it is from, in the
  same card or header: "As of Nov 6, 2026, 7:00 AM". Show the time when the
  source updates during the day (balances, holdings); the date alone for
  daily or slower sources.
- When rows in one view are from different times, each row whose time
  differs shows its own stamp (`caption` `ink-3` on its secondary line), and
  the footer gives the earliest.
- **Stale:** past its expected refresh (24 hours for balances and
  transactions; 7 days for state records), the stamp turns `warning` and
  says why and what to do: "Last updated Nov 2 · Reconnect".
- **A failed sync** shows a `warning` Banner on the pages that depend on it
  ("2 accounts haven't updated since Nov 3"), linking to the fix. Freshness
  is the last *successful* sync, not the newest row's time.

### 10.8 Masking

| Number | Shown | Who can see more |
|---|---|---|
| Bank and brokerage account numbers | Last four only: "•• 4821", appended to the account's name everywhere ("Operating checking •• 4821") | Nobody; full numbers are never shown |
| EIN | "••-•••6789" | Owner, admin and member roles, with a "Show" IconButton that re-masks after 30 seconds or on leaving the page; Copy for the same roles. Viewers and partners see the mask. Search matches the full number |
| SSN and ITIN | Never displayed | Typed only where a form must send one on (the EIN application goes straight to Palm); the field masks as typed with a "Show" toggle for the person typing, and is never prefilled or echoed back. An EIN field rejects the NNN-NN-NNNN pattern with a plain message |
| A vendor's TIN | "•••-••-6789" (SSN-type) or "••-•••6789" (EIN-type) | Admins, with "Show" |
| One-time codes (Phone) | In full for 10 minutes after arrival, then "••••••" | Admins, with "Show" |
| Phone numbers | "(555) 010-0142"; international numbers in international format | Not masked |

The mask character is the bullet "•" (U+2022). Masked values are set in
the sans, tabular; an EIN shown in full uses Geist Mono.

**Account names** read: nickname, else the institution's name for the
account tidied up (underscores to spaces, title case, acronyms kept), then
the mask. Account types come from a label map (Checking, Savings, IRA, Roth
IRA, 401(k), Credit card), never from CSS `capitalize` or `uppercase`.

---

## 11. Legal and consent patterns

Written with the lawyer's and the CPA's findings. These are presentation
rules; the records behind them (what is logged, kept and sent) are the
owning area's job, and the copy never claims a record that isn't written.

**The record behind the pattern.** Server code writes each consequential
action to the shared audit trail (`lib/audit.ts`, table `audit_log`): one
append-only row saying who, what, to what, how many and when. One line in
an endpoint, after the action succeeds:
`await audit({ actor: user, action: "entity.archive", target: { type: "entity", id, label: name }, summary: "Archived " + name })`.
It never throws into the request, and it drops secrets, codes, bodies and
SSN-shaped text. A confirm that says "this is recorded" is true only once
its endpoint makes that call.

### 11.1 Choosing the pattern for a consequential action

| The action | Pattern |
|---|---|
| Reversible (archive, hide, mark read, turn off a switch, move) | Act at once; Undo toast (8 seconds) |
| Irreversible, one item, ordinary stakes (delete a draft, a rule, a note) | Confirm, `danger` tone |
| Irreversible with legal or tax standing, or wide reach (§11.2) | Confirm, `danger` tone, typed confirmation |
| Binding, billed or sent outside the office (file with a state, sign, pay, send for signature, request an EIN) | Confirm, `commit` tone, with the facts and any receipt |
| Changes many records at once | States the count and span before ("Refile 48 transactions, Dec 2024 – Nov 2026") and after ("Refiled 48 · Undo") |
| Changes someone's access or role | Confirm, saying in one sentence what the new role can see and do |

**Keep, don't delete.** When a record must be kept (an entity with an EIN
or filed documents, an executed signature, anything under a legal hold),
the interface offers **Archive** and doesn't offer Delete.

**Never silently.** Choosing from a picker never rewrites past records
without a confirm that states the scope. A rename or default that applies
to history saves on an explicit Save, not on blur.

### 11.2 When typed confirmation is required

Typing is required to:

1. permanently delete a record with legal or tax standing, where deletion
   is allowed at all (an entity, a completed signature request, an executed
   or filed document);
2. remove, or change the role of, an Owner or an Admin;
3. disconnect a bank or brokerage, or anything else that deletes synced
   history;
4. make any irreversible change to more than 100 records.

What is typed is the thing's name as shown ("Northwind Holdings, LLC"), or,
for a bulk change, the count ("48"). The match ignores case, surrounding
spaces and the difference between curly and straight quotes. The field is
labelled "Type Northwind Holdings, LLC to confirm", uses 16px text, gets
focus when the dialog opens, and shows a check when it matches; until then
the action button is disabled (the instruction is its reason).

### 11.3 Stating consequences

Every destructive or binding confirm says, in this order and in under 40
words plus its details:

1. **What happens, to what:** named, and counted when more than one.
2. **What else changes:** related records, documents kept or removed,
   access lost, who is notified.
3. **Cost**, as a receipt: label on the left, amount on the right in cents,
   tabular; a hairline; the total in 600. Estimates say "About". Then the
   mode: "Live: the card on file is charged" or, as an `info` line, "Test
   mode: nothing is charged".
4. **Whether it can be undone:** "This can't be undone." as the last
   sentence when true. When there is a safer alternative, the dialog names
   it ("Archive keeps its documents and can be undone") and offers it as a
   second button.

**Destructive verbs have one meaning each:** Delete destroys a record or
file. Remove takes something off a list or relationship (it still exists
elsewhere). Archive hides and keeps. Disconnect stops a feed. Void cancels
a sent signature request. Revoke ends someone's access. Discard drops
unsaved changes.

### 11.4 Consent

- **Affirmative and recorded.** Consent is an unchecked checkbox the person
  checks, or a button whose label states the agreement ("Agree and
  continue"). Never pre-checked, never implied by scrolling. Each consent
  component takes a `version` and sends it with the action, so the server
  can record what was agreed to, when and by whom.
- **At the point of collection.** Sign-in's phone step carries, directly
  under the field and above the button, in `small` door ink 2: "We'll text
  a 6-digit code to this number. Message and data rates may apply." and
  "Terms · Privacy" as links. The first sign-in after the Terms change
  shows a door screen with a two-line summary, both links, and "Agree and
  continue".
- **Electronic records and signatures.** Before a signer's first signature
  on a request: a Dialog (a sheet on phones) titled "Use electronic records
  and signatures", with four short bullets (what the consent covers; the
  right to a paper copy and how to ask; how to withdraw; what's needed to
  open the document), a link to the full disclosure, an unchecked
  checkbox "I agree to use electronic records and signatures for this
  document", and "Continue to sign". Declining is always one step away and
  says what happens next.
- **One-time acknowledgements** (an AI feature's first use, the notice that
  office mailboxes are monitored, lock-screen previews of notifications)
  use the acknowledgement sheet: a title, two to four bullets, a link to the
  full policy, "Continue" and "Not now". Recorded with its version.

### 11.5 Disclosures

- **Where:** next to the control or result they concern, visible without
  any interaction. Not behind an (i), not in a tooltip, not in a banner.
  `small` `ink-2`, links underlined. The (i) is for explanations; it is
  never where a required disclosure lives.
- **Short in place, full one link away.** In place: one line. Behind the
  link: the whole text, on a Document page.
- **Processors are named in disclosures** (and in Settings › Connections),
  even though product labels don't name vendors (§12.3). Example: "Answers
  come from Anthropic's Claude, using BFO's records."
- **Who can see this.** For staff, any card a partner can't see carries a
  "Staff only" Badge with a lock in its header. Partners never receive
  that content; the Badge is the visible half of that rule.

### 11.6 AI output

- **Every AI-made thing is labelled where it appears:** a 16px sparkle in
  `ink-2` and the words, in `small` `ink-2`: "Read by AI from Operating
  Agreement", "Drafted by AI", "Summary by AI".
- **AI-read facts are proposals until a person accepts them.** A value read
  by AI shows a "Proposed" Status (`info`) and a source line, with "Accept"
  and "Edit"; it is not written into the record as fact before that.
- **Ask BFO** keeps one line under its composer, always visible, in
  `caption` `ink-3`: "Answers come from BFO's records and can be wrong. Not
  legal or tax advice." The first use of text or voice shows the
  acknowledgement sheet naming who processes what (text to Anthropic;
  voice to OpenAI).
- **AI drafts** (improving an email, generated documents) carry "Drafted by
  AI · review before sending" above the draft until the person edits or
  accepts it.

### 11.7 Where Terms and Privacy are linked

- The landing page and every door screen: a footer line, "Terms ·
  Privacy", in door ink 2.
- Sign-in, at the point of collection (§11.4).
- The account menu's footer, for every role, partners and email-only
  members included.
- Settings › About and legal.
- The public signing page's footer and its consent dialog.
- The footer of every email BFO sends.
- The command palette ("Terms", "Privacy").

Pages that handle a sensitive kind of record (Mail, Phone, Paper mail, Ask)
also carry a quiet footer link to the relevant section of the Privacy page
("How mail is handled").

---

## 12. Voice and copy

### 12.1 The voice

Plain, warm, brief. Write the way a trusted member of the office would
say it to the family across a desk: short sentences, everyday words, no
jargon unless it is the right legal or accounting term, and then the exact
one. Address the reader as "you". "We" appears only where the office or the
app acts ("We'll text a code").

- Sentence case everywhere (§3.3).
- Typographic punctuation: ’ “ ” … and – for ranges; × for close.
- Numerals for numbers ("6-digit", "3 entities").
- No exclamation marks. No "Successfully". No "Oops".
- No parentheses in labels; no em dashes in status lines.
- No developer voice ("As designed", "Null", "Request failed with 500"),
  no internal history ("since the tools were retired"), no in-jokes.
- Say only what the app does. If changes aren't queued offline, don't say
  "Changes will save when you reconnect".
- Device-neutral verbs: "choose", "open", "select". Not "click" or "tap";
  never "Drop a file" (say "Choose a file").

### 12.2 Patterns

| Thing | Rule | Example |
|---|---|---|
| Button | Verb and object; sentence case; no "OK", "Submit", "Yes" | "Add owner", "Send for signature" |
| Destructive confirm button | The verb and the thing | "Delete rule", "Void request" |
| Billed confirm button | The verb and the amount | "File for $129.00" |
| Empty state | What will be here, who sees it, the action | "No notes yet. Notes you add to an entity appear here; only staff can see them." [Add note] |
| Filtered empty | What matched nothing, and the way out | "No entities match “Alder”." [Clear filters] |
| Error | What happened, then what to do; keep their input | "Couldn't save the address. Check your connection and try again." |
| Toast | The past tense, with the count | "Refiled 48 transactions" [Undo] |
| Confirm title | The question | "Delete this rule?" |
| Disabled reason | What's missing | "Add a name to continue" |
| Status | One or two words, a fact | "Overdue", "Filed", "Needs review" |
| Freshness | When, then the fix if stale | "As of Nov 6, 2026, 7:00 AM"; "Last updated Nov 2 · Reconnect" |
| Lists in prose | Joined by a list formatter | "Your signature and the date go where the page is marked." |

### 12.3 Names

- **One name per thing,** the same in the nav, the page title, back links,
  the tab title and the palette.
- **No vendor or infrastructure names in labels, buttons or status lines**
  (Plaid, Vercel, buckets, environment variables). Vendors are named in
  disclosures and in Settings › Connections, and wherever the person must
  act in the vendor's own product.
- The product is "BFO"; the assistant is "Ask BFO".

### 12.4 Words

| Use | Not |
|---|---|
| Entities | Assets |
| People (the app's accounts) | Users |
| Inbox, Sent | In, Out |
| Paper mail | Physical |
| Intercompany | Roll-up |
| No entity | Unmapped |
| Load older transactions | Backfill |
| Distribution (from a trust, to a beneficiary) | Trustee draw |
| Opened | Read (in signature evidence) |
| Records (completeness of facts and documents) | Compliance (that word is for state standing and deadlines) |

The CPA's and the lawyer's review findings own the accounting and legal
vocabulary; this table follows them.

---

## 13. Decorative pieces

| Piece | Decision | Why |
|---|---|---|
| The door's backdrops (the orrery's orbits and the four others in `app/home-animations/`) | **Stay, on the landing page only.** Sign-in and finish setup show the same sky as a still frame. The film grain becomes static. The dark pocket behind the mark softens (about 0.5 alpha, fading out by 85%). Reduced motion gets a still frame. The landing page gains one quiet "Sign in" link ("Open BFO" when signed in) and the Terms · Privacy footer | The door is the one place with no work to do, so motion there is a welcome. Behind a form it competes with the form |
| The front-door gallery (`/home-animations`) | **Stays,** as the owner's tool for choosing the backdrop, under Settings › Labs. Always dark (door world). Its strip, arrows and button rebuilt from system parts at 44px; sans for its labels; on phones, one centred caption with arrows and position dots | It serves a real choice the owner makes |
| The app's aurora (the drifting `landing-orb`s behind every page) | **Goes** | Decoration under data; it tints the surfaces |
| The particle constellation (`ParticleCanvas` behind the app, sign-in and finish setup) | **Goes;** `app/particles.tsx` is deleted | Motion behind work, and it crosses the text |
| Home's backdrop (`HomeBackground`: the grid, drifting lights and travelling packets) | **Goes;** Home is a plain page | A finance home should be still |
| Home's hero decoration (gradient hairline, glow, dot grid, the `animate-ping` pulses) | **Goes** | Nothing inside a card decorates |
| The voice globe (`app/particle-globe.tsx`) | **Stays** on the voice stage, as the indicator of listening, thinking and speaking. Still when idle; drawn in `ink` for the theme | It explains state |
| Games (`/games`) | **Stay,** reached from Settings › Labs and from the signing-mode picker ("Preview"), not from the account menu. Rebuilt with system components; one secondary "Play" per card; on phones, "Open on a computer to play" in place of the button | A preview of what a signer sees has a purpose; it doesn't belong in the account menu |
| The 3D logo (`app/logo-3d.tsx`) | **Door only,** if the owner chooses it. The app's chrome uses the flat vector wordmark | Chrome repeats on every screen |
| Metallic lockup finishes (gold, silver) | **Door only.** In the app the wordmark is `ink` (`brand-ivory` on the door) | As above |
| Glass cards and panels, the Glass slider | **Go** (§6.3) | |
| Treasury's bank-tinted glass cards, sheen and live pulse | **Go;** accounts are rows with the institution's mark on a white tile | Brand colour per bank is noise |
| Mail's aurora, per-mailbox hues, envelope, seal and plane animations, unread glow, Compose glow | **Go;** skeletons for loading, toasts for "sent", a dot and weight for unread | No loops outside a live state |
| The compliance map's breathing cards and marching connectors; the wizard's glows and gradient radios | **Go;** the wizard's short step fade-and-rise stays (it explains the step change) | |
| The rainbow route-progress bar | **Becomes** a 2px `accent` bar after 300ms | |
| The unused `.pnl-statement` style block in `app.css` (with its own fonts) | **Deleted** | Dead code |

---

## 14. Implementation notes

For the foundation engineer first, then for every area.

### 14.1 `app/app.css`

**Replace lines 1–6** (the import and the old `@theme`) with the block
below, and **replace the focus rules** (today's emerald outline, lines
~2775–2799) with the one in the base layer. Keep everything else for now;
§14.8 says when it goes.

```css
@import "tailwindcss";

/* ── Variants (docs/DESIGN.md §2.1, §8.0) ───────────────────────────── */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
@custom-variant touch {
  @media (width < 48rem), (pointer: coarse) {
    @slot;
  }
}

/* ── Tokens. Light values here; dark values in the base layer below. ── */
@theme {
  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-brand: "Playfair Display", ui-serif, Georgia, serif;

  --text-caption: 12px;
  --text-caption--line-height: 16px;
  --text-small: 13px;
  --text-small--line-height: 18px;
  --text-body: 14px;
  --text-body--line-height: 20px;
  --text-field: 14px;
  --text-field--line-height: 20px;
  --text-reading: 16px;
  --text-reading--line-height: 26px;
  --text-section: 15px;
  --text-section--line-height: 20px;
  --text-section--font-weight: 600;
  --text-section--letter-spacing: -0.005em;
  --text-title: 17px;
  --text-title--line-height: 22px;
  --text-title--font-weight: 600;
  --text-title--letter-spacing: -0.01em;
  --text-heading: 22px;
  --text-heading--line-height: 28px;
  --text-heading--font-weight: 600;
  --text-heading--letter-spacing: -0.015em;
  --text-display: 28px;
  --text-display--line-height: 34px;
  --text-display--font-weight: 600;
  --text-display--letter-spacing: -0.02em;

  --color-page: #f7f7f8;
  --color-raised: #ffffff;
  --color-sunken: #efeff1;
  --color-overlay: #ffffff;
  --color-field: #ffffff;
  --color-hover: #f1f1f3;
  --color-selected: #e9e9ec;
  --color-ink: #18181b;
  --color-ink-2: #52525b;
  --color-ink-3: #64646d;
  --color-ink-disabled: #64646d;
  --color-ink-inverse: #ffffff;
  --color-line: #e4e4e7;
  --color-line-strong: #d4d4d8;
  --color-edge: #85858e;
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-accent-tint: #eef0fe;
  --color-on-accent: #ffffff;
  --color-primary-hover: #3f3f46;
  --color-primary-pressed: #52525b;
  --color-positive: #047857;
  --color-positive-tint: #ecf8f2;
  --color-negative: #b91c1c;
  --color-negative-tint: #fdf1f1;
  --color-warning: #a35200;
  --color-warning-tint: #fdf6e9;
  --color-info: #0b6aa2;
  --color-info-tint: #edf6fb;
  --color-danger: #b91c1c;
  --color-danger-hover: #991b1b;
  --color-on-danger: #ffffff;
  --color-scrim: rgb(9 9 11 / 0.32);
  --color-chart-1: #4f46e5;
  --color-chart-2: #0f8a7e;
  --color-chart-3: #c27c0e;
  --color-chart-4: #c2416b;
  --color-chart-5: #64748b;
  --color-chart-other: #85858e;
  --color-brand-ivory: #f4ede0;
  --color-brand-ink: #0a0a0a;
  --color-door: #05060b;
  --color-door-ink: #f4ede0;
  --color-door-ink-2: #aca8a0;
  --color-door-ink-3: #888580;
  --color-door-edge: #716e6b;
  --color-door-error: #f2a0a0;
  --color-door-success: #d8b56a;

  --radius-mark: 4px;
  --radius-control: 8px;
  --radius-card: 12px;
  --radius-dialog: 16px;

  --container-reading: 720px;
  --container-workspace: 1200px;
  --container-dialog-sm: 400px;
  --container-dialog-md: 520px;
  --container-dialog-lg: 640px;
}

/* z-index ladder (§8.19). Inline, so z-modal is the number itself. */
@theme inline {
  --z-index-sticky: 10;
  --z-index-shell: 30;
  --z-index-fab: 40;
  --z-index-popover: 50;
  --z-index-modal: 60;
  --z-index-toast: 70;
  --z-index-tooltip: 80;
}

@layer base {
  :root {
    color-scheme: light;
    --control-sm: 32px;
    --control-md: 36px;
    --control-lg: 44px;
    --row-menu: 32px;
    --row-1: 40px;
    --row-2: 56px;
    --icon: 16px;
    --gutter: 32px;
    --fab-clearance: 96px;
    --sidebar-expanded: 240px;
    --sidebar-collapsed: 64px;
    --elevation-1: 0 1px 2px rgb(9 9 11 / 0.08);
    --elevation-2: 0 1px 2px rgb(9 9 11 / 0.06), 0 12px 32px -8px rgb(9 9 11 / 0.18);
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-in: cubic-bezier(0.4, 0, 1, 1);
    --ease-standard: cubic-bezier(0.2, 0, 0, 1);
    --dur-1: 120ms;
    --dur-2: 160ms;
    --dur-3: 200ms;
    --dur-4: 240ms;
  }

  [data-theme="dark"] {
    color-scheme: dark;
    --color-page: #0b0b0c;
    --color-raised: #141416;
    --color-sunken: #070708;
    --color-overlay: #1b1b1e;
    --color-field: #101012;
    --color-hover: #1e1e22;
    --color-selected: #25252a;
    --color-ink: #f4f4f5;
    --color-ink-2: #a8a8b1;
    --color-ink-3: #8e8e97;
    --color-ink-disabled: #8e8e97;
    --color-ink-inverse: #0b0b0c;
    --color-line: #2a2a2e;
    --color-line-strong: #3a3a40;
    --color-edge: #717179;
    --color-accent: #8b93f8;
    --color-accent-hover: #a5acfa;
    --color-accent-tint: #1f2040;
    --color-on-accent: #0b0b0c;
    --color-primary-hover: #d4d4d8;
    --color-primary-pressed: #a8a8b1;
    --color-positive: #4cc38a;
    --color-positive-tint: #11261c;
    --color-negative: #f47a7a;
    --color-negative-tint: #2c1515;
    --color-warning: #e8b04e;
    --color-warning-tint: #2a2010;
    --color-info: #6cb6e6;
    --color-info-tint: #0f2230;
    --color-danger: #d42a2a;
    --color-danger-hover: #b82222;
    --color-on-danger: #ffffff;
    --color-scrim: rgb(0 0 0 / 0.6);
    --color-chart-1: #8b93f8;
    --color-chart-2: #3fbfb0;
    --color-chart-3: #e0a43c;
    --color-chart-4: #ec7aa0;
    --color-chart-5: #94a3b8;
    --color-chart-other: #717179;
    --elevation-1: 0 1px 2px rgb(0 0 0 / 0.5);
    --elevation-2: 0 1px 2px rgb(0 0 0 / 0.4), 0 16px 40px -8px rgb(0 0 0 / 0.7);
  }

  /* Touch: phones, and any device whose primary pointer is coarse. */
  @media (width < 48rem), (pointer: coarse) {
    :root {
      --text-body: 15px;
      --text-body--line-height: 22px;
      --text-field: 16px;
      --text-field--line-height: 22px;
      --text-section: 17px;
      --text-section--line-height: 22px;
      --control-sm: 44px;
      --control-md: 44px;
      --control-lg: 48px;
      --row-menu: 44px;
      --row-1: 48px;
      --row-2: 64px;
      --icon: 20px;
    }
  }
  @media (width < 48rem) {
    :root {
      --gutter: 16px;
    }
  }
  @media (48rem <= width < 64rem) {
    :root {
      --gutter: 24px;
    }
  }

  /* The new scale, switched on per subtree while pages migrate (§4.2).
     Every app/ui component root and every <Page> carries `ds`. */
  .ds {
    --spacing: 4px;
    --text-xs: 12px;
    --text-xs--line-height: 16px;
    --text-sm: 13px;
    --text-sm--line-height: 18px;
    --text-base: var(--text-body);
    --text-base--line-height: var(--text-body--line-height);
    --text-lg: 17px;
    --text-lg--line-height: 22px;
    --text-xl: 17px;
    --text-xl--line-height: 22px;
    --text-2xl: 22px;
    --text-2xl--line-height: 28px;
    --text-3xl: 28px;
    --text-3xl--line-height: 34px;
    --text-4xl: 28px;
    --text-4xl--line-height: 34px;
    --radius-xs: 4px;
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 8px;
    --radius-xl: 12px;
    --radius-2xl: 12px;
    --radius-3xl: 16px;
    --container-3xs: 256px;
    --container-2xs: 288px;
    --container-xs: 320px;
    --container-sm: 384px;
    --container-md: 448px;
    --container-lg: 512px;
    --container-xl: 576px;
    --container-2xl: 672px;
    --container-3xl: 768px;
    --container-4xl: 896px;
    --container-5xl: 1024px;
    --container-6xl: 1152px;
    --container-7xl: 1280px;
  }

  /* One focus ring, everywhere (§2.2). */
  :where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  tr[tabindex]:focus-visible {
    outline-offset: -2px;
  }

  @media (prefers-reduced-motion: reduce) {
    :root {
      --dur-1: 100ms;
      --dur-2: 100ms;
      --dur-3: 100ms;
      --dur-4: 100ms;
    }
  }
}
```

Notes on the block:

- As built, three details differ from the block above, on purpose. The
  `@theme` is `@theme static`, so every token is in the stylesheet even
  when no class names it (a chart or a canvas reads `var(--color-chart-2)`
  from script). The focus rule sits outside the layers: unlayered rules
  outrank every utility, so a legacy `focus:outline-none` can't remove the
  ring; a component that needs it inset writes `outline-offset-[-2px]!`.
  And the ring's selector skips `[tabindex="-1"]` (an element focused by
  script, such as a dialog's title, shows no ring) and includes
  `[role="option"]`. The `paper` token (§2.2) is added.
- Every token above compiles to a utility: `bg-page`, `text-ink-2`,
  `border-edge`, `text-section`, `rounded-card`, `max-w-reading`, `z-modal`.
  The dark block redefines the same variables, so `[data-theme="dark"]` on
  any subtree (the door, the media viewer) flips it.
- Tailwind inlines `--shadow-*` theme values into its utilities, so a dark
  override wouldn't apply; that is why elevations are plain variables, used
  as `shadow-(--elevation-2)`.
- Component sizes use the variables directly: `h-(--control-md)`,
  `min-h-(--row-1)`, `size-(--icon)`, `px-(--gutter)`.
- `hover:` in Tailwind v4 already applies only on devices that hover, so no
  extra variant is needed.
- Use the `touch:` and `dark:` variants; never `isDark ? … : …`. The
  `dark:` variant now follows the app's theme instead of the device's
  setting (one existing use, `dark:bg-white`, changes meaning on purpose).

**Also in the foundation pass:**

- Lines 8–33: keep `font-size: 11.9px` on `html` and `body` until the flip
  (§14.8); replace the fixed backgrounds (`#000`, `rgb(249 250 251)`,
  `bg-white dark:bg-gray-950`) with `background-color: var(--color-page)`.
- The `html.light` rescue layer (lines 35–157) stays, but append
  `:not([data-theme="dark"], [data-theme="dark"] *)` to each of its
  selectors, so a region that declares itself dark, and its own root, are
  never repainted. That alone fixes the invisible
  close button on the paper-mail viewer and the white-on-white signing
  controls as soon as those regions, which are drawn dark today, set
  `data-theme="dark"` on their root. (The signing page then moves to tokens
  and to Automatic, §2.1, when the sign area migrates it.) Migrated code
  needs no exemption: the layer only rewrites raw palette classes, which
  migrated files can't contain (§14.7).
- There is no light region inside a dark page. If one is ever needed,
  repeat the light values under `[data-theme="light"]` in the base layer.

### 14.2 Theme

- `app/theme.tsx`: the setting becomes `"auto" | "light" | "dark"`
  (default `"auto"`), stored as `bfo-theme`; the resolved theme follows
  `matchMedia("(prefers-color-scheme: dark)")` and its changes when the
  setting is Automatic. It sets `data-theme` on `<html>` and, until the
  rescue layer is deleted, still toggles the `light` class. `setOverride`
  and `overridden` go; Mail stops overriding.
- The boot script (`app/sidebar.ts`) does the same before paint, sets
  `<meta name="theme-color">` (#f7f7f8, #0b0b0c), drops the
  `bfo-mail-theme` branch and the glass and density lines from
  `APPEARANCE_BOOT`.
- `app/appearance.ts`: glass and density go. If anything still reads them
  during the migration, they return the defaults.
- Door routes set `data-theme="dark"` on their root and theme-color
  #05060b.
- `confirm-dialog.tsx`'s `isDarkNow()` goes; components read tokens.
- Already done in the foundation pass, because the tokens need it:
  `theme.tsx` and the boot script set `data-theme` on `<html>` beside the
  `light` class, and theme-color is #f7f7f8 or #0b0b0c. The three-way
  setting, Mail's override and the Appearance panel are the shell's.

### 14.3 `app/ui/`: the shared components

One file per component, each opening with a block comment saying what it
is for and pointing at its section here. Every component root carries the
`ds` class. All are exported from `app/ui/index.ts`.

```ts
// icon.tsx — §8.0
type IconName = "chevronLeft" | "chevronRight" | "chevronDown" | "x" | "more" | "edit" | "trash" | "plus"
  | "search" | "sync" | "upload" | "download" | "copy" | "external" | "info" | "check" | "warning"
  | "error" | "lock" | "sparkle" | "sidebar" | "menu" | "eye"; // the set grows here, and nowhere else
function Icon(p: { name: IconName; className?: string }): JSX.Element; // size-(--icon), stroke 1.75

// button.tsx — §8.1, §8.2, §3.4
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger"; // default "secondary"
  size?: "sm" | "md" | "lg";                               // default "md"
  icon?: IconName;
  busy?: boolean;
  busyLabel?: string;          // "Saving…"
  disabledReason?: string;     // rendered as a visible hint by the caller's layout, and aria-describedby
  full?: boolean;              // full width
};
function Button(p: ButtonProps): JSX.Element;
function LinkButton(p: Omit<ButtonProps, "busy" | "busyLabel"> & { to: string }): JSX.Element;
function IconButton(p: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName; label: string; variant?: "quiet" | "secondary"; size?: "sm" | "md"; pressed?: boolean;
}): JSX.Element;
function TextLink(p: { to: string; children: React.ReactNode; inline?: boolean; external?: boolean }): JSX.Element;

// field.tsx — §8.3
function Field(p: { label: string; hint?: React.ReactNode; error?: string; optional?: boolean;
  children: React.ReactElement; id?: string }): JSX.Element; // wires id, aria-describedby, aria-invalid
function Input(p: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean;
  prefix?: React.ReactNode; suffix?: React.ReactNode }): JSX.Element;
function MoneyInput(p: { value: number | null; onChange: (v: number | null) => void; invalid?: boolean }): JSX.Element;
function DateInput(p: { value: string | null; onChange: (iso: string | null) => void; invalid?: boolean }): JSX.Element;
function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }): JSX.Element;
function SearchField(p: { value: string; onChange: (v: string) => void; placeholder: string; label: string }): JSX.Element;

// select.tsx — §8.4
type Option<T extends string> = { value: T; label: string; hint?: string; disabled?: boolean; disabledReason?: string };
function Select<T extends string>(p: { value: T | null; onChange: (v: T) => void; options: Option<T>[];
  label: string; placeholder?: string; invalid?: boolean; size?: "sm" | "md" }): JSX.Element;
function MultiSelect<T extends string>(p: { value: T[]; onChange: (v: T[]) => void; options: Option<T>[];
  label: string; placeholder?: string }): JSX.Element;

// segmented.tsx — §8.5
function Segmented<T extends string>(p: { value: T; onChange: (v: T) => void; label: string;
  options: { value: T; label: string }[]; full?: boolean }): JSX.Element;

// choice.tsx — §8.6
function Checkbox(p: { checked: boolean | "mixed"; onChange: (v: boolean) => void; label: React.ReactNode;
  hint?: React.ReactNode; disabled?: boolean }): JSX.Element;
function ChoiceTiles<T extends string>(p: { value: T | null; onChange: (v: T) => void; label: string;
  options: { value: T; title: string; description?: string }[] }): JSX.Element;
function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: string;
  hint?: React.ReactNode; disabled?: boolean }): JSX.Element;

// status.tsx — §8.7
type Tone = "neutral" | "positive" | "warning" | "negative" | "info";
function Status(p: { tone: Tone; children: React.ReactNode; shape?: boolean }): JSX.Element;
function Badge(p: { children: React.ReactNode; icon?: IconName }): JSX.Element;
function Count(p: { n: number; tone?: "neutral" | "attention" }): JSX.Element | null; // null at 0
function FilterChip(p: { children: React.ReactNode; onRemove: () => void }): JSX.Element;

// card.tsx — §8.8
type MenuItem =
  | { label: string; onSelect: () => void; icon?: IconName; hint?: string; danger?: boolean;
      checked?: boolean; disabled?: boolean; disabledReason?: string }
  | { divider: true }
  | { group: string };
function Card(p: { title?: React.ReactNode; count?: number; countTone?: "neutral" | "attention";
  info?: React.ReactNode; action?: React.ReactNode; menu?: MenuItem[]; flush?: boolean;
  footer?: React.ReactNode; staffOnly?: boolean; id?: string; children?: React.ReactNode }): JSX.Element;

// list.tsx — §8.9
function List(p: { children: React.ReactNode; label?: string }): JSX.Element;
function ListRow(p: { title: React.ReactNode; secondary?: React.ReactNode; leading?: React.ReactNode;
  meta?: React.ReactNode; trailing?: React.ReactNode; to?: string; onClick?: () => void;
  selected?: boolean; onSelect?: (v: boolean) => void; unread?: boolean; menu?: MenuItem[] }): JSX.Element;

// table.tsx — §8.10
type Column<R> = { key: string; header: string; align?: "left" | "right"; width?: string;
  render: (row: R) => React.ReactNode; sort?: (a: R, b: R) => number };
function Table<R>(p: { caption: string; columns: Column<R>[]; rows: R[]; rowKey: (r: R) => string;
  onRowClick?: (r: R) => void; selection?: { selected: Set<string>; onChange: (s: Set<string>) => void };
  groups?: (r: R) => string; totals?: React.ReactNode[]; grandTotal?: boolean;
  phoneRow: (r: R) => React.ComponentProps<typeof ListRow>; // how the row reads on a phone
  empty?: React.ReactNode; loading?: boolean }): JSX.Element;

// tabs.tsx — §8.11
function Tabs(p: { label: string; items: { to: string; label: string; count?: number }[] }): JSX.Element;

// toolbar.tsx — §8.12
function Toolbar(p: { search?: React.ReactNode; filters?: React.ReactNode; view?: React.ReactNode;
  activeFilters?: { label: string; onRemove: () => void }[]; onClearFilters?: () => void }): JSX.Element;

// states.tsx — §8.13–8.15
function Empty(p: { title?: string; children: React.ReactNode; action?: React.ReactNode;
  size?: "page" | "section" }): JSX.Element;
function Skeleton(p: { kind: "line" | "rows" | "card" | "table"; rows?: number; columns?: string[] }): JSX.Element;
function Spinner(): JSX.Element;
function Banner(p: { tone: "info" | "warning" | "negative" | "positive"; children: React.ReactNode;
  action?: React.ReactNode; onDismiss?: () => void }): JSX.Element;
function Disclosure(p: { label: React.ReactNode; count?: number; defaultOpen?: boolean;
  children: React.ReactNode }): JSX.Element;
function InfoToggle(p: { label: string; children: React.ReactNode }): JSX.Element;

// toast.tsx — §8.16
function toast(p: { message: string; action?: { label: string; run: () => void }; duration?: number }): void;

// misc.tsx — §8.17
function Avatar(p: { name: string; src?: string; kind?: "person" | "organisation"; size?: 24 | 32 | 40 }): JSX.Element;
function Tooltip(p: { label: string; children: React.ReactElement }): JSX.Element;
function Keycap(p: { keys: string[] }): JSX.Element | null; // null on coarse pointers
function Money(p: { value: number | null; precision?: "cents" | "dollars" | "compact";
  sign?: "auto" | "always" | "accounting" | "none"; zero?: "dash" | "value";
  tone?: "none" | "direction" }): JSX.Element; // tabular; colours per §10.2
function DateText(p: { value: string | Date; style?: "short" | "medium" | "long" | "time" | "audit" | "relative" }): JSX.Element;
function AiNote(p: { kind: "read" | "drafted" | "summary"; source?: string }): JSX.Element; // §11.6
function LegalLinks(p: { tone?: "app" | "door" }): JSX.Element; // "Terms · Privacy"

// page.tsx — §5
function Page(p: { width?: "reading" | "workspace" | "full"; header?: React.ReactNode;
  children: React.ReactNode }): JSX.Element; // adds ds, text-body text-ink, the container
function PageHeader(p: { title: string; context?: React.ReactNode; back?: { to: string; label: string };
  primary?: React.ReactNode; secondary?: React.ReactNode; menu?: MenuItem[];
  create?: { label: string; onClick: () => void } }): JSX.Element;
function ErrorPage(p: { kind: "not-found" | "error"; detail?: string }): JSX.Element;

// overlay.tsx — §8.19, §14.4
function Dialog(p: { open: boolean; onClose: () => void; title: string; description?: React.ReactNode;
  size?: "sm" | "md" | "lg"; footer?: React.ReactNode; initialFocus?: React.RefObject<HTMLElement | null>;
  dirty?: boolean; children?: React.ReactNode }): JSX.Element | null;
function Sheet(p: { open: boolean; onClose: () => void; title: string; side?: "bottom" | "full" | "right";
  size?: "md" | "lg"; footer?: React.ReactNode; action?: React.ReactNode; dirty?: boolean;
  children?: React.ReactNode }): JSX.Element | null;
function Menu(p: { trigger: React.ReactElement; items: MenuItem[]; label: string;
  align?: "start" | "end" }): JSX.Element;
function Popover(p: { trigger: React.ReactElement; label: string; children: React.ReactNode;
  width?: number }): JSX.Element;
type ConfirmOptions = {
  title: string;
  object?: { name: string; detail?: string } | { names: string[] };
  message?: React.ReactNode;
  details?: React.ReactNode[];
  receipt?: { lines: { label: string; cents: number; estimate?: boolean }[]; mode?: "live" | "test" };
  scope?: { label: string; options: { value: string; title: string; description?: string }[] }; // narrowest first
  confirmLabel: string;            // required: the verb and object
  cancelLabel?: string;            // "Cancel" unless the dialog is about stopping something
  tone?: "default" | "commit" | "danger";
  irreversible?: boolean;          // appends "This can't be undone."
  typeToConfirm?: string;          // §11.2
  alternative?: { label: string; value: string }; // a safer second action ("Archive instead")
  version?: string;                // for consent-like confirms the server records
};
function confirm(o: ConfirmOptions): Promise<false | true | { scope?: string; alternative?: string }>;
```

`app/confirm-dialog.tsx` keeps exporting `confirmDialog` and `alertDialog`
for existing callers, re-implemented on `confirm()`; `requireText` maps to
`typeToConfirm`, `tone: "default"` keeps its meaning, and a missing
`confirmLabel` is a type error in new code. A legacy caller with no label
gets "Delete" (danger) or "Continue", never "Confirm"; an alert's one button
reads "Close".

**As built.** The signatures above hold; these were added where building
showed a need, and each is optional:

- Files: the manager is `overlay-manager.ts` (`useOverlay`, `usePresence`,
  `useAnchor`), `confirm()` is `confirm.ts`, the pure rules are
  `overlay-rules.ts` (tested), `toast()` is `toast.ts`, the tab title is
  `page-title.ts` (`useDocumentTitle("Northwind Holdings, LLC",
  "Entities")`), DateInput is `date-input.tsx`, the Button's skin is
  `button-style.ts` (`buttonClasses()`, and `ButtonLayout`, the context a
  phone footer sets so its buttons are `lg` and full width).
- `Icon`: `size` (12, 16, 20, 24) where one size is meant on every device.
- `IconButton`: `noTooltip` where the label is already visible.
  `TextLink`: `onClick`. `LinkButton`: `replace`, `state`.
- `Card`: `CardSection` (a subhead over a hairline inside a card) and
  `Rows` (hairlines between `Row`s). A `Row` with no value reads "Not on
  record" in `ink-3`; `Row` takes `hint` and `action`.
- `Option`: `group` (a sticky heading), `icon` (only where marks differ
  meaningfully) and `short` (the closed trigger's text). `Select` and
  `MultiSelect`: `footnote`, `disabled`, `size`. `useListbox()` with
  `ListboxPanel` opens the system's list from a trigger a legacy control
  keeps (Books' pill uses it).
- `Segmented`: an option may carry an `icon`, and `iconOnly`.
- `ChoiceTiles`: `stacked` (always one column) and `hideLabel`.
- `Checkbox` and `Switch`: `hint`, `disabled`.
- `Empty`: inside a Card a page-size Empty sits 24px under the header
  (the Card's padding plus 4), not 64.
- `Table`: `groupTotal` (the band's figure) and `stickyFirst` (months
  across).
- `Money`: `tone="in"` (money in is `positive`, out stays `ink`, for a
  ledger that mixes both) beside `direction` (a signed result).
  `DateText`: `style="asof"` and `"time"`.
- `Dialog` and `Sheet`: `description`; `Sheet` also `size` for the right
  sheet. `Popover`: `open`/`onOpenChange` to control it, and `align`.
- `ConfirmOptions`: `focus` ("cancel" or "confirm", overriding the tone's
  rule) and `acknowledge` (one button: the legacy alert). The result
  carries `version` when one was given.
- `ErrorPage`: `home`; its "Search BFO" dispatches the `bfo:open-palette`
  window event, which the shell's palette listens for.

**Legacy exports that already draw with the system.** So pages look like the
system before their owners rebuild them: `app/entity/ui.tsx`'s `Button`
(ghost is `quiet`; a legacy danger is a quiet button in `negative`),
`IconButton`, `Input`, `Select` (its `<option>` children become options;
`onChange` still gets `{ target: { value } }`) and `Textarea` render the
app/ui components; its `Section`, `Field`, `Empty` and `Disclosure` take the
system's look but keep the legacy spacing their rows were written for (no
`ds` on their roots, so the rows inside don't move). Books' `Menu` keeps its
pill and opens `ListboxPanel`; Books' `ConfirmDialog` renders `ConfirmView`;
Mail's `Segmented` renders the system's.

The entity area's `app/entity/ui.tsx` (`Button`, `IconButton`, `Section`,
`Row`, `Field`, `Input`, `Switch`, `Dot`, `Count`) and Books'
`app/books-shared.tsx` tokens (`tiers`, `BTN_BASE`, `TAP`, `Menu`, `Toast`)
become thin re-exports of `app/ui` during their areas' migration, then go.
`Row` (label and value) moves into `app/ui/card.tsx` as `Row`: a 144px
label column of `small` `ink-2` on desktop, stacked above the value on
phones, the value in `body` `ink`, at least 44px on touch.

### 14.4 The overlay manager

`app/ui/overlay.tsx` owns every modal and popover:

- **One portal root,** `<div id="overlays">`, appended to `<body>` once.
- **A stack.** Opening pushes; Escape and scrim taps act on the top entry
  only. While the stack holds a modal: `<html data-overlay="modal">`,
  `inert` on the app's root element, and the page scroll locked (with
  `scrollbar-gutter: stable` on `<html>` so nothing shifts).
- **The Ask button and floating bars** hide with
  `html[data-overlay="modal"] .ask-fab { visibility: hidden }`, and the same
  for `html[data-keyboard="open"]` (set from `visualViewport` on touch) and
  `html[data-selection]`. A floating bar opts in with a `data-floating`
  attribute. With only a menu or popover open, `<html data-overlay="popover">`.
- **Inert, as built:** the children of `<body>` other than the overlay root
  are made inert when the first modal opens, and given back when the last
  closes; anything a legacy component appends to `<body>` after that stays
  live, so a legacy popup opened inside a new dialog still works.
- **Toasts** centre on the content column using `--content-inset` (the
  sidebar's width, which the shell sets on `<html>`), falling back to the
  legacy `--inset`.
- **`useOverlay({ open, onClose, modal, initialFocus, dirty })`** returns
  the panel ref and the ids for `aria-labelledby` and `aria-describedby`;
  it handles focus in, the trap, Escape, the scrim, the dirty-check and
  focus return.
- Every existing `role="dialog"` or `aria-modal` implementation (about 20
  today, in 16 files) and every hand-made popover moves onto it as its area
  migrates; foundation moves
  its own (the palette, Appearance, the shortcuts sheet, App lock, the doc
  viewer, the account menu, the drawer, `confirm-dialog.tsx`).

### 14.5 `app/ui/format.ts`

Pure functions, with tests in `tests/format.test.ts`. `app/currency.ts`
re-exports from here until its callers move.

```ts
type Sign = "auto" | "always" | "accounting" | "none";
function money(n: number | null | undefined, o?: { precision?: "cents" | "dollars" | "compact";
  sign?: Sign; zero?: "dash" | "value"; currency?: string }): string; // null → "", zero → "—" with zero:"dash"
function percent(n: number | null | undefined, o?: { decimals?: 0 | 1 | 2; trim?: boolean; sign?: Sign }): string;
function count(n: number, one: string, other?: string): string;            // "1 entity", "3 entities"
function list(items: string[], type?: "conjunction" | "disjunction"): string; // Intl.ListFormat
function date(d: Date | string, style?: "short" | "medium" | "long"): string;
function dateTime(d: Date | string, o?: { zone?: boolean }): string;
function dateRange(a: Date | string, b: Date | string): string;            // "Jan 1 – Nov 5, 2026"
function asOf(d: Date | string, o?: { time?: boolean }): string;           // "As of Nov 6, 2026, 7:00 AM"
function relative(d: Date | string, now?: Date): string;                   // under 24h only, else date()
function maskAccount(last4: string): string;                               // "•• 4821"
function maskEin(ein: string): string;                                     // "••-•••6789"
function maskTin(tin: string, kind: "ssn" | "ein"): string;
function looksLikeSsn(s: string): boolean;                                 // for EIN fields
function phone(e164: string): string;                                      // "(555) 010-0142"
function accountLabel(a: { nickname?: string; name?: string; mask?: string }): string;
function accountType(subtype: string): string;                             // "Roth IRA"
```

As built: `n` for `percent()` is already in percent (12.5 is "12.5%").
`count(0, …)` reads "No entities" (pass `{ zero: "numeral" }` for "0
entities"). A calendar date ("2026-11-06") never shifts with the viewer's
time zone; a timestamp shows in the viewer's zone. `date()`, `dateTime()`,
`dateRange()`, `asOf()` and `relative()` take `{ now, timeZone }` for tests.
Added: `time()` ("3:14 PM"), `duration()` ("about 3 minutes"),
`isoDate()`, `parseDate()` (typed dates in common forms, for DateInput),
`parseMoney()` (for MoneyInput) and `initials()` (for Avatar).

### 14.6 Moving a page: the checklist

For the area that owns the page. One pull request per page or small group;
title in the house style ("Treasury: calmer, larger type, solid cards").

1. **Wrap** the page in `<Page width=…>` with a `<PageHeader>` (§5.5).
   Remove the page's own container, title markup and back link.
2. **Spacing:** inside `ds` every rem utility is now 4px-based. Walk the
   page and set each to the grid and the rhythm in §5.3. Replace every rem
   arbitrary value (`pb-[5.5rem]`) with px or a token.
3. **Type:** replace with tokens using this map, then check hierarchy by
   eye.

   | Legacy | Token |
   |---|---|
   | `text-[9px]` … `text-[11.5px]`, `text-xs` | `text-caption` |
   | `text-[12px]`, `text-[12.5px]`, `text-sm` | `text-small` (or `text-caption` for meta) |
   | `text-[13px]` … `text-[14px]` | `text-body` |
   | `text-[15px]`, `text-[16px]` titles | `text-section` |
   | `text-[17px]` … `text-[20px]` | `text-title` |
   | `text-[22px]` … `text-[24px]`, `text-2xl` page titles | `text-heading` |
   | `text-[26px]` and up, `text-3xl` figures | `text-display` |
   | `MICRO`, `uppercase tracking-[…]` | `text-small font-medium text-ink-2`, sentence case |
   | `font-bold` | `font-semibold` |
   | `font-mono` on dates, money, scores | remove (tabular sans) |
   | `font-brand` / Playfair in the app | remove (sans) |

4. **Colour:** replace with tokens, and delete the `isDark` branch.

   | Legacy | Token |
   |---|---|
   | `text-gray-900`, `text-white`, `text-gray-100` (main text) | `text-ink` |
   | `text-gray-600`/`700` (light), `text-gray-300`/`400` (dark) | `text-ink-2` |
   | `text-gray-400`/`500` (light), `text-gray-500`/`600` (dark) | `text-ink-3` (or `ink-2` if it carries information) |
   | `bg-white`, `bg-gray-50`, `bg-black`, `bg-gray-950` (page) | `bg-page` |
   | `glass-card`, `bg-white/[0.03]`, `#111113` and other card hexes | `<Card>` (`bg-raised border-line`) |
   | `glass-panel`, `#0f0f16` at 85% and other floating hexes | the overlay components (`bg-overlay`) |
   | `bg-white/5`, `bg-gray-50`/`100` as wells, tracks, chips | `bg-sunken` |
   | `hover:bg-white/5`, `hover:bg-gray-50` | `hover:bg-hover` |
   | `border-white/10`, `border-gray-100`/`200` (dividers, cards) | `border-line` |
   | `border-white/15`, `border-gray-200`/`300` (inputs, outline buttons) | `border-edge` |
   | `text-emerald-*`, `text-green-*` | `text-positive`, only for money in and done |
   | `text-red-*`, `text-rose-*` | `text-negative` |
   | `text-amber-*`, `text-yellow-*` | `text-warning` |
   | `text-indigo-*`, `#4f46e5`, `#818cf8`, `#a5b4fc` | `text-accent` for links and selection; otherwise `text-ink` |
   | `bg-red-500`/`600` buttons | `<Button variant="danger">` in a confirm; a `danger` menu item elsewhere |
   | emerald or indigo focus borders and outlines | remove (the global ring) |
   | `useTone()`, `tiers()`, `toneText()`, `Dot` | tokens, `<Status>` |
   | per-entity, per-mailbox, per-bank hues | neutral (§2.4) |

5. **Components:** replace hand-rolled buttons, inputs, native selects,
   segmented controls, switches, pills, rows, tables, tabs, empty and
   loading states, toasts and every pop-up with `app/ui`. Remove
   `max-sm:h-[40px]`, `TAP.*` and per-call-site 44px fixes; the components
   size themselves. Remove `z-[…]` values; use the ladder.
6. **Numbers and dates** through `format.ts`, following §10.
7. **Decoration** in §13 removed from the page. No `backdrop-blur-*`, no
   `animate-ping`/`animate-pulse`, no custom infinite keyframes.
8. **Copy** read against §12.
9. **Check:** `npm run check:design -- <files>` reports nothing; `npm run
   lint`, `npm run typecheck` and `npm test` pass; look at both themes at
   390 and 1440 wide, and at a touch iPad size (820×1180).

### 14.7 `npm run check:design`

Foundation adds `scripts/check-design.mjs` and the npm script. It scans
`app/**/*.tsx` and reports, per file and line:

- raw palette colours: `(text|bg|border|divide|ring|fill|stroke|from|to|via)-(gray|zinc|slate|neutral|stone|white|black|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)\b`, and hex colours in class names or `style`;
- legacy type: `text-(xs|sm|base|lg|xl|[2-9]xl)\b` and `text-\[\d` (any px literal);
- `uppercase` with `tracking-`;
- rem in arbitrary values or inline styles;
- `glass-card`, `glass-panel`, `backdrop-blur`, `animate-ping`, `animate-pulse`;
- `isDark ?`, `useTone(`, `tiers(`, `isDarkNow(`;
- `z-[`, `rounded-(sm|md|lg|xl|2xl|3xl)\b`, `max-w-(xs|sm|md|lg|xl|[2-7]xl)\b`;
- half steps: `-(0\.5|1\.5|2\.5|3\.5)\b` on spacing utilities;
- `role="dialog"` or `aria-modal` outside `app/ui/`;
- native `<select`, `window.confirm`, `window.prompt`.

A file that imports `Page` from `app/ui` is **strict**: any finding fails
CI. Other files are reported but don't fail. After the flip, every file is
strict.

As built (`scripts/check-design.mjs`, tested in `tests/check-design.test.ts`):
`npm run check:design` checks every file; `-- <files>` checks those;
`-- --quiet` (CI) prints findings for strict files and a count per file for
the rest; `-- --all-strict` treats every file as strict (the flip's test).
Comments are skipped. The colour rule also covers `border-x|y|t|b|l|r`,
`outline`, `placeholder`, `caret` and `shadow`; the overlay rule also
`role="alertdialog"`; the native rule also `window.alert`. A false alarm
in a strict file is fixed by rewriting the line, not by an exemption.

### 14.8 Order of work, and when the rescue layer goes

**Foundation, first and alone:**

1. `app/app.css`: §14.1. No page changes appearance.
2. `app/ui/`: the components, the overlay manager and `format.ts`, with
   tests for `format.ts` and the overlay manager's focus and stack rules.
3. `app/confirm-dialog.tsx` on `confirm()`.
4. The shell, in `ds`: `app/routes/app-layout.tsx` and
   `app/sidebar-nav.tsx` (§9: the two-state sidebar, the tablet rail, the
   phone top bar and drawer, the account row and menu, the Ask button, the
   `<main>` padding as `--gutter`, 16/32px top and 96px bottom); remove the
   aurora, the particle field and the 3D logo from the chrome.
5. `app/theme.tsx`, `app/sidebar.ts`, `app/appearance.ts`,
   `app/appearance-panel.tsx` (§14.2, §9.4).
6. The palette, the shortcuts sheet, App lock, the offline banner, the doc
   viewer, `routes/not-found.tsx` and `root.tsx`'s error boundary as one
   `ErrorPage`, the door screens it owns (`door*.tsx`).
7. Fonts: Geist, Geist Mono and Playfair Display as woff2 files in
   `public/fonts/`, declared with `@font-face` and `font-display: swap`;
   the Google Fonts links in `root.tsx` and Inter removed. (This also stops
   sending every visitor's IP address to Google, which the Privacy page
   would otherwise have to disclose.)
8. `scripts/check-design.mjs` and its CI step.

**Then every area,** at the same time, page by page (§14.6). Requests for
new components or variants go to foundation.

**The flip and the rescue layer.** The `html.light` rescue layer (lines
35–157 of `app.css`) stays until every area has migrated, because legacy
pages depend on it. It is deleted, in one pull request by foundation, when:

- `npm run check:design` reports zero findings across `app/` (every file
  strict);
- every route renders inside `<Page>` or is a door screen;
- no file reads `html.light` or the `light` class.

That pull request:

- sets `html { font-size: 16px }` and gives `body` `font-size:
  var(--text-body)`, `line-height: var(--text-body--line-height)`, `color:
  var(--color-ink)` and `background: var(--color-page)`;
- changes the `.ds` selector to `:root, .ds` (so the scale is the default;
  the class can then be dropped at leisure);
- deletes the rescue layer, every `html.light` rule in `app.css`,
  `.glass-card`, `.glass-panel`, `--glass`, `--row-scale` and the density
  rules, the `.treasury-card*`, `.cmp-*` animation, `.fab-glass`,
  `.app-aurora`, `.landing-orb*`, `.pnl-statement*`, `.particle-field` and
  the other retired families in §13;
- clears Tailwind's default palette by starting the colour tokens with
  `--color-*: initial;`, so raw greys no longer compile;
- stops toggling the `light` class in `theme.tsx` and the boot script;
- deletes `app/particles.tsx` and `app/home-background.tsx` (by then no
  page imports them).

### 14.9 Documents to update at the flip

- `CLAUDE.md`, Conventions: replace "Tailwind v4; root font is 11.9px…"
  with "Tailwind v4 with the tokens in docs/DESIGN.md; sizes are tokens or
  the 4px grid."
- `docs/CONTRIBUTING.md`, Styling: the same, and point at this file and
  `npm run check:design`.
- `docs/ARCHITECTURE.md`: `app.css` is "Tailwind v4 and the design tokens".
