# Design rubric

The yardstick for a hillclimb on a screen or a rendered image. Gates reject an automatic keep outright. Eight criteria score each case 0, 1 or 2. Owner calls are the taste decisions only the owner makes. The thresholds are starting points calibrated on real renders and blind verdicts; the project's design policy overrides any of them.

Two kinds of surface, scored separately:
- **Images:** anything the project renders to a file (cards, charts, social previews, exports), usually seen scaled down.
- **Pages:** web or app screens, at a phone and a desktop viewport (375×812 and 1440×900 unless the project names others).

## Authority and scope

- **Owner decisions win:** the project's design policy, its ADRs, and the owner calls below or in `.agents/design-hillclimb.md`. Existing screens are the visual reference, but not an excuse for the bugs seen in them.
- **A pass improves a named layout defect without changing what's shown or how it behaves.** These are options, never automatic keeps:
  - a change to visible information, behavior or an owner convention;
  - a dependency;
  - a shared component's contract.
- **Everything renders offline from frozen inputs.** Freeze the inputs and the baseline before editing. No network, nothing published, nothing in production.

## Owner calls

Taste decisions that no gate or score settles. The owner makes them. Record each one, with its date, in the project's design policy or `.agents/design-hillclimb.md`, and never propose a declined one again. Until the owner says otherwise, these starting defaults hold:

- **Row-mates end level.** Panels side by side in one row share a bottom edge. A short one gets the row's height (a blank line where its row-mates have a note, or a taller box), never invented content. This holds within a row only. Independent groups in different rows or columns flow.
- **Short content sits centered** in a box its row made taller.
- **No box inside a box.** A panel never holds another bordered panel.
- **Every box says what it holds.** A box whose content doesn't explain itself gets a title.
- **Height ceiling.** A change that makes a screen much taller (40% unless the settings name another figure), or pushes it past the project's maximum height, is an option, not a keep. The owner decides each case.
- **Hierarchy over a tidy last row.** A headline or overall cell stays apart from its siblings, even if that leaves one item alone in the last row.
- **Color roles stay.** A semantic color that reads poorly on a busy background is registered under R7, not recolored.
- **Minimum text sizes stay.** Never shrink text below the project's minimum to buy density.

## Targets and their status

Keep one table per family in the ledger, and check it before proposing anything:

| | Defect | Status |
|---|---|---|
| T1 | Invoice card 1,240 px wide; line-item labels about 4 px at display size | Fixed (`a1b2c3d`): totals stacked under the line items |
| T2 | Pricing table scrolls sideways on phones | Declined: the table stays |
| T3 | Form labels wrap at 375 px | Open |

**Negative controls,** which must not lose points:
- honest empty and partial states (an empty list, a feature turned off, a new account);
- big summary values;
- columns meant to be unequal (rank, name, value);
- rows of different lengths that each fill the width (two cells over four);
- short content centered in equal-width cells.

Sparse and honest isn't a defect.

## Gates (any new violation rejects an automatic keep)

1. **Information:**
   - **Same values:** the same labels, values, label-to-value pairing, units, precision, signs, color meanings, order and counts, with the same availability explanations and truncation.
   - **Reading order** means the order things read in on screen. A column flow can keep the code order and still change the scan order. That's a trade-off judged under R8, not "same order".
   - **No artifacts:** no raw translation keys, stray format codes, `NaN` or `undefined`.
   - **No new states:** no invented zeros, and nothing dropped to save space. Zero, unavailable, disabled and not-ready stay distinct.
   - **Folding a list or abbreviating** changes information, so it's an option.
2. **Containment and raster:**
   - No new clipping, overlap, collision or horizontal page scroll.
   - No blur or resampling used as a text fix.
   - Record every case's width and height per state. A too-wide screen is a target, not an allowed band, and one past the height ceiling is an option.
3. **Owner style:**
   - The owner calls above.
   - The approved fonts, roles, sizes and color roles. Register the existing exceptions and add no new ones.
   - The project's assets, tokens and banned list.
   - An image renderer's spacing and the web's spacing are separate systems. Don't force one onto the other.
4. **Use:**
   - The same routes, controls and fetches; the same selected, focus and disabled states; the same primary actions; hit areas (44 px on touch); reduced-motion behavior.
   - Main content never gets hidden to buy density.
   - A screenshot can't prove focus, hit areas or speed. Mark those unverified unless existing capture metrics show them.
5. **Coverage and regressions:**
   - Every case in the change's real dependency scope is rendered and inspected, and none gets a new or worse violation.
   - A change in a shared component needs its whole affected matrix, with two well-known screens that use it as controls.
   - An unknown case is listed as unknown, never counted as a pass.
   - An outlier fixture (a placeholder id where a name belongs, wider than any real data) is reported separately. It never decides or blocks a keep.
6. **Cost:** no new network calls, fetches or dependencies, and no repeatable render or encode slowdown over 10% (warm medians of 5 runs on identical inputs; small differences are noise).

**Existing violations:** register them in a baseline list. "Passes" means no new violation, no unrelated registered one gets worse, and the targeted one improves. Where a registered violation blocks a literal pass, compare its severity before and after. Never rewrite the register to excuse a new regression. A relevant gate with no evidence blocks an automatic keep: save the candidate as an option and say what's missing.

## Scores

Each case gets eight scores of 0, 1 or 2:
- **2:** no relevant defect at the size it's displayed, and the measurements pass.
- **1:** a localized visible defect.
- **0:** hard to read or find at a glance, or visibly broken.

Every 0 or 1 names a region and one concrete reason. A metric is evidence, not the score, and "unmeasured" is not a 2.

| | Criterion | What earns 2 |
|---|---|---|
| R1 | Space allocation | No oversized content lane, empty track, gap before the next group, or height added for no gain |
| R2 | Composition | Fitting proportions, intentional final rows, row-mates that end level, groups that stay together when they wrap |
| R3 | Type and hierarchy | Clear identity and headline; a headline cell stays apart from its siblings; each role consistent with itself |
| R4 | Alignment | Same-role baselines, column edges and centers, icon tracks and text starts line up down each column |
| R5 | Spacing | Repeated components keep their gap and padding tokens, and groups stay distinct |
| R6 | Family fit | The same role looks the same across populated, partial and empty cases, and across related sections |
| R7 | Readability | Required text is recognizable at its displayed size against its local background |
| R8 | Findability | Identity, a named headline and detail, the current section and the next choice are easy to find |

### Evidence and thresholds

- **R1:**
  - Measure content bounds over an exact substrate: the same layout with text and icons left unpainted. A flat fill or a blur is not a substrate. Ink coverage is a diagnostic only. There is no global ink target, since one rewards bigger type and clutter.
  - Flag, in a short cell, unused vertical space beyond the padding of more than two text line boxes. Flag, in a group, an unused rectangle over 35% of its area that is taller than two body lines and wider than 25% of its lane. Flag empty grid tracks outside any panel. Report the largest unused rectangle and where it is.
  - A wide, short, centered headline cell isn't a defect without a visible harm (extra scroll, smaller displayed text). Empty slots that mean something, diagram positions, progress-bar capacity, standard gutters and a short page's leftover viewport earn neither points nor penalties.
  - **Height for no gain:** a reflow that neither narrows the screen nor raises its displayed text size adds height and empty lanes, so it's a loss even with the same information. Reflow only where it changes the row that sets the width, which usually makes it count-driven (switch to columns only past a set number of items).
- **R2:**
  - Classify each relationship before measuring: equal cells, label and value tracks, sidebar and main, independent groups, positional diagrams.
  - Equal tracks that differ by more than 2 native px (images) or 1 CSS px (pages) are a defect. In a uniform grid, a short sibling's hole bigger than one line box or 25% of the row height, whichever is larger, warns. A bottom difference over 8 px is a locator, not evidence. An unused final track of 25% of a row or more is a review trigger, not a failure.
  - Check every count-driven layout at its fewest items.
  - Controls that belong together wrap as one unit.
  - Never add dummy items, repeat entries or stretch empty boxes to pass R2.
- **R3:**
  - Freeze a role map first: identity, title, headline label and value, compact label and value, inline fact, item name and detail, meta, diagram.
  - A size ratio between a headline's label and value (twice, say) applies to headline pairs only. Compact and inline pairs keep their own sizes.
  - Report the code's size, the native glyph height and the displayed glyph height separately. A code-compliant size can still fail R7.
  - Making a headline or overall cell one more tile in its siblings' grid closes a hole but drops R3.
- **R4:**
  - Each role has its anchor: the cell center for centered numbers, the right edge in a numeric list, the text start after the icon in an item list. Shadows and ascenders aren't baselines. Compare value baselines, not the tops of wrapped titles.
  - Tolerance: 2 native px on images, 1 CSS px on pages.
  - **Stagger:** stacked item cells (name over value) that a wider sibling centers stagger their icons and text starts from row to row. Measure each column's icon x and text-start x across rows. Holding the cell's content to the left fixes it.
  - On pages, the `gridlines` skill draws these lines and lists the misses, if it's installed.
- **R5:** measure outer panel gaps apart from text gaps and hit areas. Repeated instances of one component that spread more than 2 native px or 1 CSS px without a reason are flagged. Keep deliberate grouping gaps. No glyphs or edges that newly touch, no groups that merge. "All gaps equal" can erase hierarchy.
- **R6:** compare at equal display width. A spread over 20% in one role's displayed cap height triggers review, unless the role has a declared variant. Equal widths alone earn nothing.
- **R7:**
  - **Images:** judge at the size people see them (a chat image on a phone is about 400 px wide; use 320 px as a stress size). Labels under 6 px cap height warn and under 5 are severe; headline values under 12 warn and under 10 are severe. Measure glyph height, not the line box.
  - **Pages:** the project's minimum CSS sizes, plus local contrast of glyph cores against the background right under them: the median, the lower decile and the share under 3:1 and 4.5:1. These are diagnostics, not gates, since an approved palette may already fail them.
  - Dark semantic colors on a busy background lose definition even at a good size. Score them R7=1 on both sides, register them, and leave them alone when the owner keeps the colors. A change must not make them worse.
- **R8:** freeze a task set (find the identity, a named headline, a named detail, the current section, the next choice) and run it on real viewport crops, and on images at display size. A blur at a fixed 4 display px helps, followed by the sharp image. A box with no title whose content doesn't explain itself is an R8 defect.

The maximum is 16 per case. Decide from the criterion vector and the region ledger, never from the total alone. Stress cases are required coverage, not extra points.

## Locators, not evidence

These send you to look. A rise in one never rejects a keep on its own, and a fall never earns one.
- **An odd last row** in a row that splits its width equally means wider cells, not a hole. It's a hole only in a fixed-column grid.
- **Flagged panels** where short content is centered in equal-width cells: the counts rarely match the visible padding.
- **Low-contrast counts** move whenever a background is resized to fit a new size. Compare the same region by eye.
- **Blind spots:** write down what each measuring tool can't see (small gaps, alignment across different components). Anything else needs an annotated crop.

## The matrix and how scores add up

- **States:** every saved state (full, new or empty, partial, feature or permission off), the longest saved strings and the biggest numbers. Mark which settings are really off.
- **Count-driven layouts:** freeze each one's fewest-items state from the start.
- **Stress cases:** missing boundaries get frozen, offline, display-only cases with their provenance written down (the longest name allowed, one item, the most items allowed, an odd last row). Never present them as real data.
- **Shared code:** every affected family, plus the controls.
- **Pages:** the route matrix at both viewports, plus viewport crops where a section starts mid-page.
- **Averaging:** fixtures within a state, then states within a variant, then variants within a surface. Report images and pages apart, and phone and desktop apart, so many empty cases can't swamp the rest. Report outlier fixtures apart. Also report each case's vector and the worst changed case.

## The hillclimb, per candidate

1. **Freeze:** the revision, build, assets and fonts, fixture hashes, seed, clock, viewport, pixel ratio, capture state and dynamic masks. Baseline the matrix, score it and register the existing violations. Set the attempt and time budget first.
2. **Name one defect** (an open target, or one the baseline finds) and a hypothesis that could be proved wrong. Local changes first. A minimal paired parent-and-child change counts as one hypothesis; unrelated fixes are separate candidates.
3. **Check:** first confirm the change alters its target case at all (a shared rule can pass a whole matrix without ever firing). Then render the whole dependency scope and compare matched cases: full images, native crops and display-size views. Run the gates, the measurements and the same recognition tasks. Write down missing evidence.
4. **Decide:**
   - **Provisional keep:** a targeted criterion goes up a full step, no criterion falls on any case, the averaged mean rises, and every relevant gate has evidence.
   - **Option:** a useful trade-off, a change to an owner convention, a screen past the height ceiling, a tie, or missing evidence.
   - **Drop:** an unsupported gain, a new violation, or worse evidence. Never average away a regression.
5. **Judge:** an independent reviewer that doesn't know the author, the score claims or the A/B order scores the complete matched evidence against this rubric. Resolve disagreements by looking at the cited region; unresolved taste trade-offs become options. An objection on one state is often fixed by making the change count-driven, after which that state must render byte-identical to its baseline. Judge provisional keeps before stacking dependent work on them.
6. **Stop:** on success (the targeted defects fixed, no relevant score at 0, the evidence complete), at the budget, or after three distinct hypotheses fail. Report what's left.

## Guarding against score gaming

- **Bigger, darker or busier** doesn't earn space points.
- **Deleting zeros, footnotes or rows** is an information change.
- **Shrinking text or hit areas** is blocked by the size floors.
- **Stretching boxes across independent groups** earns nothing. Row-mates ending level earns R2 only where a hole was visible.
- **Narrowing by growing tall** is capped by the height ceiling.
- **One fixture's gain never pays for another's loss.** Trade-offs become options.
- **One root cause gets one credit,** even when several measurements move.
- **Changing the inputs or the capture framing** voids the comparison. Hash them.
- **Rescoring drifts:** freeze anchor examples and written reasons before trying changes, and never edit an earlier score.
- **The judge must cite a visible defect,** not a preference, and sees sharp full-size crops as well as contact sheets.
- **A data bug found along the way** is recorded separately, not fixed inside a design pass.

## Morning sheet

One offline HTML page:
- matched before and after at display size, native crops, full coverage, criterion vectors, changed regions and sizes;
- gate evidence, the registered baseline violations, the missing checks, and the unchanged negative controls;
- options as A/B, each with one concrete trade-off, saying whether it changes information, behavior or an owner call.

Each pair says which region to look at and which side is today. An idea comes with a rendered attempt or a marked crop, never only today's picture, since an idea can't be judged from today's picture alone. No personal names or ids in captions or ledgers. The owner approves before anything is merged, folded or pushed.
