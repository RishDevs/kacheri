# Kacheri Court: visual design spec (binding)

Direction: **an engineering case docket**. It should read as a court filing typeset by people who build developer tools: Linear's density, GitHub checks' clarity, Sentry's evidence navigation, legal-document hierarchy. It's quiet, precise and typographic. The product's credibility comes from showing evidence, not decoration.

## Banned (AI-slop tells)
Purple/indigo/blue gradients; glassmorphism and backdrop blur; glows; emoji anywhere in the UI; sparkles; centered marketing hero; uniform rounded cards with drop shadows everywhere; `rounded-2xl`; pill-shaped everything; gavel/scale icons or clip-art; animated avatars or "agent" characters; Inter; default shadcn look; random accent colours per section; lorem-like filler copy ("Unlock the power of…"); progress spinners as decoration; more than one animation.

## Type
- UI: **IBM Plex Sans** 400/500/600. Code, numbers, SHAs, logs: **IBM Plex Mono** 400/500. Rulings, case titles, verdict: **Newsreader** 500/600 (italic for quoted reasoning). Google Fonts.
- Scale (px / line-height): 11/16 mono uppercase +0.06em labels, 13/20 mono code, 14/22 body, 16/24 section heads, 22/28 charge titles (serif), 32/38 verdict and case title (serif). Tabular numerals everywhere numbers align.

## Colour tokens
| Token | Light | Dark |
|---|---|---|
| canvas | #F7F6F2 | #0F1110 |
| surface | #FFFFFF | #161917 |
| raised | #FBFAF7 | #1C201D |
| rule (hairline) | #DEDCD5 | #2A2F2B |
| text | #1A1C1A | #E9ECE7 |
| muted | #6B6F69 | #8E958D |
| accent (seal amber, links/focus/interactive only) | #9A5B13 | #E2A54B |
| convicted | #B42318 | #FF8A80 |
| convicted-bg | #FDF0EE | #2A1513 |
| pass | #23663F | #6FCF97 |
| fail | #B42318 | #FF8A80 |
| inadmissible/dismissed | #5E6670 | #9AA3AD |
Colour is never the only signal: every state also has text (PASS/FAIL/ERROR, CONVICTED/DISMISSED).

## Layout
4px base unit, 24px gutters, max content 1440px. Square corners (radius 2px max on inputs/buttons), 1px hairline rules, no shadows except a 1px rule under the sticky header.
Case view: sticky **telemetry header** (case title in serif, base..head SHAs mono, model lineage `Nano ×2 → Super → Ultra`, tokens and $ cost ledger to 4 decimals, elapsed, "Replay of recorded Token Factory run" label when mode=replay). Below it a two-pane workbench: **left 46% docket** (charges in filing order, each a section separated by rules: claim in serif, `file:line` mono link, severity label, evidence register, defense, ruling); **right 54% sticky diff** (split or unified, line numbers, charge markers in the gutter). Clicking a charge scrolls and highlights its diff line, and vice versa.

## Evidence register (per charge)
A small table, not chips-in-cards:
```
            run 1   run 2   run 3
BASE        PASS    PASS    PASS     3/3 pass
HEAD        FAIL    FAIL    FAIL     3/3 fail
ADMISSIBLE  fails on head 3/3, passes on base 3/3
```
Mono 12px cells, PASS in pass colour, FAIL in fail colour, ERROR/TIMEOUT in muted with strike-through on the row label. Inadmissible charges collapse to one muted line with the reason and are visually struck (line-through on the claim). Each cell opens the raw log in a right-side drawer. The witness code is collapsible below, with a **copy repro** button whose command checks out head and runs the witness.

## The conviction moment (the only animation)
When a ruling arrives with `convicted`, a boxed serif stamp `CONVICTED` (2px convicted-colour border, letter-spaced) appears on that charge with a 160ms scale 1.04→1 and opacity 0→1. Disabled under `prefers-reduced-motion`.

## Pages
- **Cases**: dense docket rows (title, SHAs, charges filed / admissible / convicted, cost, date), no cards.
- **Benchmark**: aligned comparison table first (system × hit rate, false positives per PR, precision, $/PR, p50 latency, n), then a horizontal bar per metric drawn with plain rules (no chart-library look), then the per-item table. A sample-data banner whenever data is not from a real run.

## Craft details that must exist
1. Synchronized diff anchors between charges and diff lines.
2. Provenance everywhere: short SHAs, model ids on hover, "recorded on <date>" for replays.
3. Copyable repro strip for every convicted charge.
