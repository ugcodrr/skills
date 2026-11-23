---
name: design-hillclimb
description: A measured design loop on a UI screen or rendered image. Freeze the inputs, name one defect, change it, measure the change, have a blind judge score before and after without knowing which is which, then keep it, offer it as an A/B option or drop it, and stop on explicit rules. Scores against a bundled rubric of gates, eight criteria and owner calls. Use it for a "hillclimb", a "design pass", "make this page look better", "tighten the layout", "too much blank space", "the text is too small", "fix the spacing", "give me A/B options", attended or overnight, and when asked to plan one. Not for a pure edge-alignment pass (use gridlines) or before and after images for a PR (use pr-visuals).
---

# Design hillclimb

Improve a screen or a rendered image one defect at a time, each change proved better by measurement and a blind judge, with the owner deciding taste calls. The yardstick is `references/rubric.md`: gates that reject a keep, eight criteria scored 0 to 2, and owner calls. For a long or unattended run, fill `references/run-template.md` into a prompt first.

**Project settings.** Read the project's design policy (fonts, color roles, spacing tokens, minimum sizes) and its `AGENTS.md` or `CLAUDE.md`, then `.agents/design-hillclimb.md` if it exists (`references/settings-example.md`): capture commands, fixtures, controls, maximum height and recorded owner calls. Measure with what the project has: its screenshot or render command, a visual test harness, layout metrics from the browser, a pixel diff. With no deterministic capture (bundled fonts, animations off, a fixed clock and seed), building one is the first candidate, and in attended mode the owner's call.

**Run state** lives in `.agents/design-hillclimb/<date>-<family>/` in the main checkout, so it outlives any worktree. Keep it out of git with a `.gitignore` of `*` inside it; captures get big.

## Modes

- **Attended** (the default). Ask the owner (AskUserQuestion in Claude Code, otherwise one message with numbered options), recommendation first, with Skip when the call can wait, about: the shortlist at the start; options, in batches of up to four; anything that changes what's shown, behavior, an owner call or a shared contract; any push or PR. Show pictures before any question about looks: one offline HTML page (T3: `html_preview`; otherwise its path to open). Don't ask about what a gate or a measurement settles; decide it and report it.
- **Unattended** (overnight, scheduled, "while I'm away"). Ask nothing. Commit clear wins on local branches, save taste calls as A/B options, write the rubric's morning sheet, and end with "Decided for you" and "Needs you".
- **Plan only** ("plan a hillclimb on ..."). Read, then write the plan in chat: the family and case matrix, open targets, freeze list, budget, judge plan, branch and run folder. No edits, builds, captures or run folder until the owner says go.

## Setup (before any edit)

1. **Read** the rubric, the design policy, the settings and the ledgers of earlier runs on the same family (`.agents/design-hillclimb/*/ledger.md`). Don't propose a target the owner declined.
2. **Branch:** a new local branch, in a new worktree from the default branch when the work is PR-bound. Check the worktree is clean first.
3. **Budget:** a number of candidates or hours, and the host's usage limits if it shows them. Record both in `progress.md`.
4. **Freeze, then baseline.** Freeze the revision and build, fixture, asset and font hashes, the seed, the clock, the viewports and pixel ratio, and the capture settings. Freeze the role map, the declared layout relationships and the recognition tasks (rubric R3, R2, R8). Write a case manifest with neutral ids (`<variant>.pNN`); the id to fixture mapping goes in its own file, never into captions. Capture the baseline into `baseline/`, measure it, score it and register the existing violations in `ledger.md`.
5. **Shortlist** the 6 to 10 worst defects with the criterion each fails. Attended: ask which to work on, multi-select. Shared-component fixes go first when they help several screens.

## The loop, per candidate

1. **One defect, one hypothesis.** Prefer a change inside the screen itself. Before the full matrix, capture the target case and confirm the change alters it.
2. **Check.**
   - Capture the whole scope into `captures/<candidate>/` with the same command line as its parent. A renderer seeded once per run draws a different background for a case rendered alone than inside the full set.
   - Run `node <this skill's folder>/scripts/blind-pairs.mjs <parent captures> <candidate captures>`. Only the targeted cases may change, and it prints each changed image's size before and after (the height ceiling). Exit 1 means a case is missing on one side: capture it again before comparing.
   - Measure with the project's tools. On pages, the `gridlines` skill checks edges, if it's installed.
   - Open native crops and display-size views of the 4 to 6 worst cases the numbers name, not whole contact sheets, and run the recognition tasks.
   - Where the project times renders, take warm medians of 5 runs on a few cases.
3. **Decide:** keep, option or drop, by the rubric. A shared change needs its whole affected matrix with the controls, and non-target screens unchanged.
4. **Options and drops.** Stage only the candidate's paths and save them: `git add -- <paths>`, then `git diff --cached --output=<run folder>/options/<id>/change.patch`. Add a README with the one-line question, and the A/B crops. Undo only that candidate with `git apply -R --index <that patch>`, and check `git status` is clean again. Never use the stash (it's shared across worktrees), `reset`, `clean`, `--amend`, rebase or a forced branch move.
5. **Keeps.** One commit per kept candidate, scoped to one screen or one shared component, in the project's commit style. Judge a keep before stacking dependent work on it.

## The judge

- **Who:** first a fresh agent that hasn't seen this thread (T3: `delegate_task` with role `review`; Claude Code: the Agent tool with a fresh general-purpose agent, never a fork). Then another model if one is available, such as Codex (a provider `orchestrator_capabilities` lists, or `codex exec --sandbox read-only` with each image passed by `-i`). When the other model's usage nears its limit, the fresh agent judges the rest of the run. Record which judge saw each batch.
- **The packet:** `blind-pairs.mjs <parent> <candidate> --out judge/<batch> --key keys/<batch>.json --seed <n>` writes the blind set and an `index.html` of A beside B, and keeps the key outside. Write `judge/<batch>/BRIEF.md` from the run template's judge brief. The judge gets neutral, shuffled ids, the complete matched set with controls, the owner's rules, the frozen tasks, the gate evidence and the rubric. Never the author, the hypothesis, commit messages, scores or which side is the candidate.
- **Batches:** about 3 to 5 independent provisional keeps per call, sooner when the next edit depends on one.
- **After the verdict:** decode it with the key and save it as `judge/<batch>/VERDICT.md`. Check each objection by looking at the cited region before acting on it. An objection on one state is often fixed by making the change count-driven; that state must then capture byte-identical to its baseline. An unresolved taste call becomes an option. Don't rerun a judge until it agrees.

## Budget and resources

- **Stop new work** at the budget, after three distinct hypotheses fail, or near the host's usage limit (attended runs keep room to wrap up; unattended runs stop earlier). At a stop: commit the judged keeps, update `progress.md`, clean up and report.
- **Machine:** one build or capture process at a time, and one case at a time through a big matrix. Note free disk at the start and before each batch, and stop new work when it runs low. Once a batch is judged, delete its throwaway full-matrix captures but keep the baselines, ledgers and option evidence.
- **Your processes only:** record every dev server, browser and watcher you start in `progress.md`, stop only those at every stop, and check `ps` afterwards.

## Where things go

- `progress.md`: mode, branch, base and tip SHAs, candidates and their states, edited paths, evidence paths, judge calls, owned processes, and the exact next action. Update it after every candidate and before every long job. On a restart, check git and processes against it before acting.
- `ledger.md`: the freeze, the baseline register, the targets table, and one row per candidate (target, hypothesis, paths, scope captured, numbers before and after, judge, state).
- `baseline/`, `captures/`, `options/`, `judge/` and `keys/`.
- **The repo:** commits on the run's local branch only. Nothing is pushed or opened as a PR until the owner says so. Before handing back, run the project's verify (the `self-review` skill if it's installed), and make PR images with the `pr-visuals` skill if it's installed.

## Gotchas

- **Fixture shape:** a baseline showing blanks, `NaN` or a crash the real app never shows means the fixture wasn't built the way the app builds it. Fix the capture before scoring.
- **Rules that never fire:** confirm the target case changes before trusting a clean matrix. For a stress case, read the text it actually draws.
- **Contrast counts** move whenever a background is resized to a new size. Compare the same region by eye.
- **Reading order:** change it in the markup, never with CSS `order` or `*-reverse`, which moves the screen but not the focus order.

## Report

```
Hillclimb on the invoice cards: 3 kept, 1 option, 1 dropped. Not pushed.

Kept (blind: fresh agent, then Codex)
- a1b2c3d fix(cards): stack the totals under the line items. Invoice card 1,240 -> 860 px wide; labels 4.1 -> 6.0 px at display size; R7 1 -> 2 on 9 of 9 cases.
- b2c3d4e fix(cards): title the payment box. R8 1 -> 2; nothing else changed.
- c3d4e5f fix(cards): level the row-mates' bottoms. R2 1 -> 2 on 4 cases.
Option (needs you)
- O1 receipt card with line items in two columns: 30% taller, labels 5.2 -> 6.4 px. Taller or wider? options/O1/
Dropped
- Centered badges: the judge found staggered text starts (R4) on 3 cases, confirmed on the crops.
Scores: images mean 12.1 -> 13.4, worst case 9 -> 11. Judges: 2 batches, 1 each.
Next: push fix/cards-layout and open a draft PR?
```

Unattended runs add "Decided for you" and "Needs you", and point to the morning sheet.
