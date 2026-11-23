# Judge brief

Fill this per batch and save it as `judge/<batch>/BRIEF.md`. Only the blind set and the brief go in the judge's folder. The key stays outside.

```
# Blind design review, batch <n> (<surface>)

You are the independent reviewer for a design pass on <the family>. Score the evidence against the rubric. Read-only: change no file, run no server, make no network call. Look only inside <absolute path to judge/<batch>/> for evidence.

## Read
- The rubric: <absolute path to the skill's references/rubric.md>.
- The owner's rules: <the design policy>, and the owner calls in the rubric<, and .agents/design-hillclimb.md>.

## Evidence
<The groups and their case ids, plus what each stress case is.>
Each case has two captures, A and B, of the same frozen inputs. The order is shuffled per case.
- index.html: A beside B at display size. Click an image for full size.
- <case>-A.png, <case>-B.png: full size, for crops.
- <metrics.json, if the run has per-case measurements: width, height, smallest label and headline at display size. Thresholds: labels < 6 px warn, < 5 severe; headlines < 12 warn, < 10 severe. Locators are not evidence.>

Notes:
- <How many cases and controls render identically on both sides, so there's nothing to check there.>
- <Layout facts the judge needs, e.g. "a row splits its width equally among its cells".>
- Frozen recognition tasks: <per group, at display size>.
- Role map: <headline vs label and detail; declared equal tracks>.

## What to do
For each group:
1. Look at A and B for at least <cases>, plus any whose sizes differ sharply. Use full-size crops where the display view isn't enough.
2. Score A and B on R1 to R8 (0, 1 or 2). Every 0 or 1 names a region and one concrete visible reason.
3. Say which side is better, or that it's a tie or a taste call, and cite the visible defect behind it, not a preference. Name any case where the better side is worse on some criterion, and any new clipping, overlap, misalignment, staggered icons or text starts, hole, extra height for no gain, or unreadable text.
4. Run the recognition tasks on both sides of <cases> and say where one side is slower or fails.

Reply with one section per group: the vectors, the verdict, and the region-by-region findings with case ids. Under 900 words. Don't guess what changed or why; judge what you see.
```
