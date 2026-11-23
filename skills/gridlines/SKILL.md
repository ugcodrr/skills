---
name: gridlines
description: Draw vertical guide lines down an interface, find every item that misses its line, and fix paddings so sidebars, toolbars, panels, menus, dialogs and tables share a small set of edges. Use it for "align this", "fix the padding", "the margins are off", "edges don't line up", "do the gridline exercise", "alignment pass", "optical alignment", "icon column", or when a layout "looks off" and the cause is edges. Not for row heights, section spacing or a scored design pass (use design-hillclimb).
---

# Gridlines

Draw the guide lines first, then move the items. When you're done, every container has two or three named lines, and every item sits on one or has a written reason not to. The model is Karri Saarinen's redraw of the Linear sidebar: one line through the icons, one through the labels, one through every trailing item.

**Scope:** horizontal edges and the vertical center of rows, on the pages the user named and every overlay those pages own. It's a padding pass, so leave these alone:

- Row heights, hit areas and control sizes the policy approves. If closing a gap needs one of them, leave the gap, note its size, and ask.
- Semantic elements and behavior.
- Colors, type sizes, radii and section spacing.

## Steps

1. **Read the policy.** Find the project's design policy (`DESIGN.md`, or the design rules in `AGENTS.md` or `CLAUDE.md`). Edge lines it records ("text sits 16px in, controls 8px in") are the target. Don't re-derive them, and don't change them without the owner's approval.
2. **Run the app locally with real data.** Empty and logged-out states hide most of the rows that misalign. If you can only reach empty states, say so in the report.
3. **Draw.** Measure every page, and every overlay it owns (menus, selects, popovers, dialogs, sheets, the command palette), at 1440px and at 390px. Two ways:
   - Headless, once per width and state:
     ```sh
     PW_DIR=<dir with playwright> TAG=<state> node <this skill's folder>/scripts/audit.mjs <url> .agents/gridlines <width> [prep.mjs]
     ```
     `prep.mjs` default-exports `async (page) => {}` that opens the overlay, switches the tab or signs in. `TAG` names an overlay state, so its capture doesn't overwrite the page's. Exit 0 means every row is on its lines, 1 means a row missed, 2 means it couldn't measure. If Playwright is missing, install it into a scratch folder, never the project. The script header lists the other options.
   - In a live browser: run `scripts/probe.js` in the page with the browser tool's evaluate, call `window.__gridlines()`, read `lines` and `outliers` for each container it returns, and take a screenshot.

   Keep captures in `.agents/gridlines/`, with a `.gitignore` holding `*` in that folder.
4. **Read the output.** Each `##` block is one container and its six lines: lead (first ink of a text row), box, icon center, label (first text after a leading icon), trailing and trailing center. Leading values count from the container's left edge, trailing values from its right. On the capture, lead and label are solid red, box is faint red, icon center fainter red, trailing blue and trailing center amber.
   - `MISS y<row> <edge>: <measured>px vs <line>px <item>` is a row off its line. The edge is `leading`, `label`, `icon-column`, `trailing` or `vertical-center`. For `vertical-center`, the first number is how far apart the row's item centers are.
   - The probe measures ink: a text run's bounds, an icon's SVG box, and the box itself for a control with a fill, full border or shadow.
   - Confirm every miss on the capture before acting on it. The probe groups items into rows by center and can put one in the wrong row.
   - A container with no `##` block wasn't measured. The probe looks only inside `aside`, `nav`, `header`, `section`, `article`, dialogs, menus, listboxes and cards, so set `CONTAINERS='<css selectors>'` for anything else. No blocks at all is not a pass, even though the exit code is 0.
5. **Decide each container's lines.** Take the first that applies:
   1. The line the policy names.
   2. The neighbor's line, when the container shares an edge with it (stacked panels, a toolbar over a table).
   3. The line most rows already sit on.

   Then mark every row as edge-positioned or centered. A row is never in between. "Where the lines go" below says which items belong on which line.
6. **Fix.**
   - Move the outlier, never the majority. If 9 rows sit at 8px and the tab strip at 20px, the tab strip moves.
   - Change the container's padding, or a shared inset variable (`--row-inset`) that the rows and the header both read. Never add a one-off margin to one item (`ml-[3px]`): the next row added will miss again.
   - Use the project's spacing tokens. If the line needs a value off the scale, the container's padding is wrong, not the scale.
   - When you remove a padding that a code comment explains, update the comment with the new reason.
7. **Re-draw** the same states at both widths. Pass: every item is within 1px of its line, and at 390px wrapped toolbars still end on the trailing line. Repeat steps 4 to 7 until it passes. A miss that survives two rounds, or needs something outside the scope, goes under "not covered" with its size. Don't nudge the single item.
8. **Record and report.** Add any new line to the design policy, in the section with the existing edge rules, with the date and who set it. If the project has no design policy, list the lines in the report and don't create one. Report a table per page, the guide captures inline, and a "not covered" list: states you couldn't reach, and gaps you left on purpose.

```
Issues page, 1440 and 390
| Where              | Before                   | After                   |
| Sidebar, Views row | icon and label 3px right | on the 24px icon column |
| Toolbar            | title 4.5px above center | one center line         |
Not covered: the command palette (needs sign-in), the empty inbox.
```

## Where the lines go

### Text line and box line

Each container has one text line (labels, headings, values, bare icons) and at most one box line (buttons, selects, inputs, pills, chips). Inset a boxed control at the edge so its own label lands on the text line: box line = text line minus the box's horizontal padding. With a 16px text line and 8px button padding, the box sits at 8px. The probe doesn't measure a label inside a box, so check that sum yourself.

### Sidebars and lists

- **Icons sit on one column:** left-aligned on the box line, or centered on one vertical line. Pick one per sidebar. Icons of different widths (a 14px dot beside a 20px glyph) center on the column, or the labels after them stagger.
- **Labels start on one text line,** after the icon column plus the gap, in every row: nav items, the workspace switcher, favorites, teams.
- **Section headers start on the icon column's leading edge,** not on the label line.
- **Nested items indent by exactly one column:** the child's icon sits where the parent's label starts. A child without an icon starts its label on the child text line. Never indent by an arbitrary 12 or 20px.
- **A logo or avatar wider than the icon column** starts on the box line and still puts its name on the text line. Size the gap after it, not the text line.
- **Trailing badges and counts** sit on the trailing line or the trailing center line, the same one as the toolbar buttons above them.

### Top bars and toolbars

- Every item in a bar centers on one horizontal line. Measure centers, not tops: a 24px button and a 16px icon share a center.
- In a desktop app window, the first bar's line is the window controls' center (the traffic lights on macOS), even when they sit above or below the bar's middle.
- The bar's first item starts on the container's text or box line. Its last item ends on the trailing line or centers on the trailing center line. A toolbar is a row of the panel below it, not its own grid.
- Trailing controls of different widths (a count badge, a 28px icon button, a 20px icon) center on one vertical line. Same-width controls align their trailing edge.

### Panels and the frame

- Panels that share an edge share the line: the filters on a table toolbar end exactly under the trailing edge of the panel above.
- The window frame (navbar, status bar) gets its own line from the window edge, shared by the first and last item of every frame bar.
- Inside one product area, every panel uses the same text line. Areas may differ (dense data panels at 8px, settings pages at 16px) when the policy says so.

### Optical corrections

- **Align the content, not the affordance.** When a select's label must end on a trailing line, put its chevron before the label.
- **Invisible borders count.** A transparent 1px border offsets the label by 1px. Take it back with a -1px margin on that side.
- **Icon viewBox padding counts.** A 24px icon drawn in a 20px area sits 2px in from its box. The probe measures the SVG box, so check the glyph by eye. Correct with the icon's size or the column, not per row.
- **Tabs align their label, not their hit area.** Drop the tab list's padding and pull the strip in so the first label's ink sits on the text line.
- **Round shapes look smaller.** A circle on a line overhangs it by about 1px compared with a square of the same size. A play triangle centers on its visual mass, about 1px toward the point.
- **Text side bearing is 0 to 1px.** Never correct it per glyph.

### Shapes

Buttons and fields in one container are all rounded rectangles or all pills. One special control (the single primary compose button) may differ when the policy says why. Radii are outside this pass, so report a mix instead of changing it.
