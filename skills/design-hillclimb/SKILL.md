---
name: design-hillclimb
description: A measured design loop on a UI screen or rendered image. Name one defect, change it, measure it, let a blind judge compare, then keep it, offer an A/B option or drop it. Use it for a "hillclimb", a "design pass", "make this page look better", "tighten the layout", "too much blank space", "the text is too small", "fix the spacing", "give me A/B options", attended or overnight, or to plan one. Not for a pure edge-alignment pass (use gridlines) or PR before and after images (use pr-visuals).
---

# Design hillclimb

Improve a screen or a rendered image one defect at a time. Each change is proved better by measurement and a blind judge, and the owner decides taste calls. The yardstick is `references/rubric.md`.

For a long or unattended run, fill `references/run-template.md` into a prompt first.

## Modes

- **Attended** (the default). Ask the owner (AskUserQuestion in Claude Code, otherwise one message with numbered options), recommendation first, with Skip when the call can wait. Ask about the shortlist at the start, options in batches of up to four, anything that changes what's shown, behavior, an owner call or a shared contract, and any push or PR. Show pictures before any question about looks: one offline HTML page (T3: `html_preview`; otherwise its path to open). Don't ask about what a gate or a measurement settles. Decide it and report it.
- **Unattended** (overnight, scheduled, "while I'm away"). Ask nothing. Commit clear wins on local branches, save taste calls as A/B options, write the morning sheet (`references/morning-sheet.md`), and end with "Decided for you" and "Needs you".
- **Plan only** ("plan a hillclimb on ..."). Read, then write the plan in chat: the family and case matrix, open targets, freeze list, budget, judge plan, branch and run folder. No edits, builds, captures or run folder until the owner says go.

Commits go on the run's local branch only. Nothing is pushed, merged, folded or opened as a PR until the owner says so.

## Set up (before any edit)

1. **Read** the rubric, the project's design policy (fonts, color roles, spacing tokens, minimum sizes), its `AGENTS.md` or `CLAUDE.md`, and `.agents/design-hillclimb.md` if it exists (capture commands, fixtures, controls, maximum height, recorded owner calls; example in `references/settings-example.md`). Read the ledgers of earlier runs on the same family (`.agents/design-hillclimb/*/ledger.md`). Don't propose a target the owner declined.
2. **Pick the capture.** Measure with what the project has: its screenshot or render command, a visual test harness, layout metrics from the browser, a pixel diff. With no deterministic capture (bundled fonts, animations off, a fixed clock and seed), building one is the first candidate, and in attended mode the owner's call.
3. **Branch:** a new local branch, in a new worktree from the default branch when the work is PR-bound. Check the worktree is clean first.
4. **Run folder:** `.agents/design-hillclimb/<date>-<family>/` in the main checkout, with a `.gitignore` of `*` inside it. It holds:
   - `progress.md`: mode, branch, base and tip SHAs, candidates and their states, edited paths, evidence paths, judge calls, the processes you started, and the exact next action. Update it before every long job. On a restart, check git and processes against it before acting.
   - `ledger.md`: the freeze, the baseline register, the targets table, and one row per candidate (target, hypothesis, paths, scope captured, numbers before and after, judge, state).
   - `baseline/`, `captures/`, `options/`, `judge/` and `keys/`.
5. **Budget:** a number of candidates or hours, and the host's usage limits if it shows them. Record both in `progress.md`.
6. **Freeze, then baseline.** Freeze the revision and build, fixture, asset and font hashes, the seed, the clock, the viewports and pixel ratio, the capture settings and any dynamic masks. Freeze the role map, the declared layout relationships and the recognition tasks (rubric R3, R2, R8). Write a case manifest with neutral ids (`<variant>.pNN`). The id to fixture mapping goes in its own file, never into captions. Capture the baseline into `baseline/`, measure it, score it and register the existing violations in `ledger.md`. A baseline showing blanks, `NaN` or a crash the real app never shows means the fixture wasn't built the way the app builds it: fix the capture before scoring.
7. **Shortlist** the 6 to 10 worst defects with the criterion each fails. Attended: ask which to work on, multi-select. Shared-component fixes go first when they help several screens.

## Loop (per candidate)

8. **One defect, one hypothesis** that could be proved wrong. A minimal paired parent-and-child change counts as one. Unrelated fixes are separate candidates. Prefer a change inside the screen itself. Change reading order in the markup, never with CSS `order` or `*-reverse`, which moves the screen but not the focus order. Before the full matrix, capture the target case and confirm the change alters it: a shared rule can pass a whole matrix without ever firing. For a stress case, read the text it actually draws.
9. **Capture and compare.** Capture the whole scope into `captures/<candidate>/` with the same command line as its parent, never a case alone: a renderer seeded once per run draws a different background for a case rendered alone. A shared change needs its whole affected matrix with the controls. Then run:
   ```sh
   node <this skill's folder>/scripts/blind-pairs.mjs <parent captures> <candidate captures>
   ```
   Only the targeted cases may show `changed`. It prints each changed image's size before and after, for the rubric's height ceiling. Exit 1 means a case is missing on one side: capture it again before comparing.
10. **Measure and look.** Measure with the project's tools. On pages, the `gridlines` skill checks edges, if it's installed. Open native crops and display-size views of the 4 to 6 worst cases the numbers name, not whole contact sheets, and run the recognition tasks. Where the project times renders, take warm medians of 5 runs on a few cases. Write down any gate you have no evidence for.
11. **Decide** by the rubric's "Keep, option or drop".
    - **Keep:** one commit per kept candidate, scoped to one screen or one shared component, in the project's commit style. It's provisional until judged, so judge it before stacking dependent work on it.
    - **Option or drop:** stage only the candidate's paths and save them: `git add -- <paths>`, then `git diff --cached --output=<run folder>/options/<id>/change.patch`. Add a README with the one-line question, and the A/B crops. Undo only that candidate with `git apply -R --index <that patch>`, and check `git status` is clean again.
    - Never use the stash (it's shared across worktrees), `reset`, `clean`, `--amend`, rebase or a forced branch move.
12. **Record** the candidate's row in `ledger.md` and update `progress.md`. Repeat from step 8 until a stop rule fires.

## Judge

13. **Batch** about 3 to 5 independent provisional keeps per judge call, sooner when the next edit depends on one.
14. **Build the packet:**
    ```sh
    node <this skill's folder>/scripts/blind-pairs.mjs <parent> <candidate> --out judge/<batch> --key keys/<batch>.json --seed <n>
    ```
    `<parent>` is the captures the batch started from, and `<candidate>` the captures after its last keep. It writes each changed case as a shuffled A and B under a neutral id, an `index.html` of A beside B, and the key outside the folder. Then fill in `references/judge-brief.md` as `judge/<batch>/BRIEF.md`. The judge gets the owner's rules, the frozen tasks, the gate evidence, the rubric, and how many cases and controls rendered identically (the script leaves those out). Never the author, the hypothesis, commit messages, scores or which side is the candidate.
15. **Send it** to a fresh agent that hasn't seen this thread (T3: `delegate_task` with role `review`; Claude Code: the Agent tool with a fresh general-purpose agent, never a fork). Then to another model if one is available, such as Codex (a provider `orchestrator_capabilities` lists, or `codex exec --sandbox read-only` with each image passed by `-i`). When the other model's usage nears its limit, the fresh agent judges the rest of the run. Record which judge saw each batch.
16. **Act on the verdict.** Decode it with the key and save it as `judge/<batch>/VERDICT.md`. Check each objection by looking at the cited region before acting on it. An objection on one state is often fixed by making the change count-driven. That state must then capture byte-identical to its baseline. An unresolved taste call becomes an option. A keep the judge rejects gets `git revert`, then goes in `options/` as an option or a drop. Don't rerun a judge until it agrees.

## Stop

Stop new work when the targeted defects are fixed with no relevant score at 0 and the evidence complete, at the budget, after three distinct hypotheses fail, or near the host's usage limit (attended runs keep room to wrap up, unattended runs stop earlier). Then:

1. Commit the judged keeps and update `progress.md`.
2. Stop the processes you started and check `ps`.
3. Run the project's verify (the `self-review` skill if it's installed), and make PR images with the `pr-visuals` skill if it's installed.
4. Report.

## Machine

- One build or capture process at a time, and one case at a time through a big matrix.
- Note free disk at the start and before each batch, and stop new work when it runs low. Once a batch is judged, delete its throwaway full-matrix captures but keep the baselines, ledgers and option evidence.
- Record every dev server, browser and watcher you start in `progress.md`, and stop only those.

## Report

```
Hillclimb on the invoice cards: 1 kept, 1 option, 1 dropped. Not pushed.

Kept (blind: fresh agent, then Codex)
- a1b2c3d fix(cards): stack the totals under the line items. Invoice card 1,240 -> 860 px wide; labels 4.1 -> 6.0 px at display size; R7 1 -> 2 on 9 of 9 cases.
Option (needs you)
- O1 receipt card with line items in two columns: 30% taller, labels 5.2 -> 6.4 px. Taller or wider? options/O1/
Dropped
- Centered badges: the judge found staggered text starts (R4) on 3 cases, confirmed on the crops.
Scores: images mean 12.1 -> 13.4, worst case 9 -> 11. Judge calls: fresh agent 1, Codex 1.
Next: push fix/cards-layout and open a draft PR?
```

Unattended runs add "Decided for you" and "Needs you", and point to the morning sheet.
