# Reviewer prompt

Fill every `<...>` and send one per area. Give each reviewer absolute paths, since it starts with none of your context.

```
Perf review of <repo>, area: <area name>. Read-only: don't edit files, start services, run builds or benchmarks, or call external services.

Checkout: <absolute path>, at <commit> (<default branch>). Paths in scope: <paths>. Out of scope, even if you pass through it: <other areas' paths>.

Read these first:
- <absolute path to this skill>/references/checklist.md: the eleven questions, the floors, and how to size a finding.
- <absolute path to .agents/perf-review.md, or "none: estimate frequencies from the code and say so">: production load, hard limits, hot paths, and what's already covered.
<extra notes from the user, or "none">

1. Find the hot paths in your area: what runs per request, per job, per item, and once at startup. Spend your reading there. Search for the shapes the checklist names (rg or grep), then read the code around each hit.
2. Go through all eleven questions. For each, give findings or write "checked, clean" with the places you looked.
3. A finding must clear the checklist's floors. Estimate it with the checklist's reference costs and the context file's frequencies, and label numbers "est.". If it's in the context file's covered or dismissed list, give it only as "known: <finding or PR>" in one line, plus anything that list doesn't say.
4. Recommend the fix that removes the cost at its source and keeps required behavior, and say why it's the right one. A rewrite, a bigger diff or a new library isn't a reason to pick a lesser fix; list it as effort. When a change would add a dependency or change responses, stored data, ordering or an external contract, mark it "needs OK".

Return at most 12 findings, best first. Each one has:
- title, and which checklist question(s) it answers;
- file:line for each place;
- path and frequency (per request, per job, per day, startup);
- what happens now, in two sentences or fewer;
- the change;
- est. win, with the arithmetic;
- effort (XS/S/M/L), risk (low/med/high), and output change (none / needs OK);
- confidence (high/med/low), and what would raise it.

Then the "checked, clean" list for each question, and anything you couldn't check.
```
