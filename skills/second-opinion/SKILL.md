---
name: second-opinion
description: Get a second opinion that isn't anchored on yours. Hand a plan, diff, finding list or report to a fresh agent or another model with the material and the question but not your conclusion, then reconcile the two answers item by item and check every disagreement against the code before acting. Use it for "get a second opinion", "sanity check this", "fresh eyes", "have another agent look", "ask Codex", "double-check with another model", "am I missing something", "is this plan sound", and before acting on a risky plan or pushing a diff you aren't sure of. Not for splitting work across parallel agents (use split-threads) or a full pre-push review of your branch (use self-review).
---

# Second opinion

Get one question answered by an agent that hasn't seen your answer, then decide item by item who's right. An agent handed your hypothesis tends to hand it back confirmed, so most of the value is in what you leave out of the brief.

## 1. Pick one question

Write the question in one sentence before you gather anything. Ask for defects, gaps or evidence, not a verdict: "is this good?" gets a polite yes.

- "What correctness bugs does this diff have? Give each one's file:line."
- "What does this migration plan miss before it runs on production data?"
- "Is each of these five findings real?"
- "Is every caller of `parseConfig` updated, as this report claims?"

One question per opinion. "Is it correct and is it fast?" is two opinions, and they can run side by side.

## 2. Gather the material, not your summary

Give it:

- **The code itself:** paths to read, the diff command (`git diff <base>...HEAD`), the branch. A summary of the code carries your reading of it.
- **The task as stated:** the user's words, the issue or the spec, quoted.
- **Facts already established,** each with its source: "`getUser` returns null for a deleted user (`api/users.ts:42`)", "the flaky test also fails on main (run on `a1b2c3d`)". This is the only way to say what's been ruled out.
- **Claims to check,** when the material is a finding list or a report: each one as `file:line: claim`, without your severity, reasoning or confidence.

Leave out your conclusion, your findings (unless they're the claims to check), your hypothesis about the cause, which option you favor, how sure you are, and commit messages or PR text that argue for the change.

## 3. Pick the reviewer

Prefer another model, since it has different blind spots. A fresh agent of the same model is the fallback, and still worth it.

- **T3 Code:** `delegate_task` with role `review`. Call `orchestrator_capabilities` once and pick another provider, such as Codex, if one is listed.
- **Claude Code:** the Agent tool with a fresh general-purpose agent, never a fork: a fork inherits your context, conclusion included. If the Codex CLI is installed, `codex exec --sandbox read-only --output-last-message <tmp>/answer.md - < <tmp>/brief.md` from the repo root is another model.
- **Otherwise:** give the user the brief to paste into another model, and wait for the answer.

The reviewer only reads. Run it in the background when you have other work, and wait for its result instead of polling.

## 4. Write the brief

```
<The question, one sentence.>

Material: <paths, or the diff command and its base>. Read the code itself; don't trust names, comments or commit messages.
Task as stated: <the user's words or the spec>.
Established facts: <fact (source)>; <fact (source)>.
Claims to check: <file:line: claim>, one per line. (Only for a finding list or report.)

Read-only: change no files, run nothing that writes, push or post nothing.
Reply with one line per item: <defect or claim> | <evidence: file:line, or a command and its output> | confirmed, refuted or unsure.
If you find nothing, say so. Under 400 words.
```

Don't put secrets or credentials in a brief.

## 5. Reconcile item by item

Lay the two answers side by side. Every item gets one label:

- **Agree:** both of you found it. Act on it.
- **Disagree:** one says real and the other says not, or the fixes differ. Open the cited lines, run the test or the code, and settle it with evidence. Write down which side the evidence supports.
- **New:** only the second opinion has it. Verify it against the source exactly like a disagreement. A mistake comes back in the same confident tone as a finding.
- **Only mine:** only you had it. Recheck it too. Don't drop it because the reviewer missed it, and don't keep it because you found it first.

An item the code can't settle goes to the user with both positions and the evidence for each. It doesn't become a fix.

## 6. Report

Lead with what changes because of the opinion. Then the table, then anything the user has to decide.

```
Second opinion on fix/session-expiry (Codex, read-only): 2 to fix, 2 dropped.
Question: what correctness bugs does this diff have?

| # | Item                                             | Me  | It  | Checked                                         | Result               |
| 1 | refresh() retries forever on 401 (session.ts:88) | yes | yes | -                                               | Agree: fix           |
| 2 | expiresAt is seconds, Date.now() is ms (:41)     | no  | yes | token exp is seconds per jwt.ts:12              | New, confirmed: fix  |
| 3 | missing await on clearCookie (logout.ts:19)      | no  | yes | clearCookie is synchronous (cookies.ts:7)       | New, refuted: drop   |
| 4 | two tabs can refresh at once                     | yes | no  | both take the same lock (session.ts:60)         | Only mine, refuted   |

Fixing 1 and 2 now. Nothing left for you.
```

## Rules

- **Give it the code, not your summary.** Paths and diffs, never your paraphrase.
- **One question per opinion.** A brief with three questions gets three shallow answers.
- **Say what's ruled out only as facts,** each with its source, never as "I already checked X and it's fine".
- **Verify every disagreement and every new item against the source before acting.** Confidence is not evidence, on either side.
- **Don't re-run it until it agrees.** Rewording the brief until the answer matches yours is anchoring by another route. Ask again only when the material changed (a new diff), and say that you did.
- **Its answer is input, not a verdict.** Decisions that were the user's stay the user's.
