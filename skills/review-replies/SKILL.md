---
name: review-replies
description: Work through review comments on your own open PRs in this GitHub repo. Each one gets a fix committed on the PR branch when it asks for a change, and a reply drafted in chat for the user to post. It never posts. Use it when asked to address, answer or handle review comments, "what did the reviewer say", "they requested changes", "reply to the review", "fix the PR feedback", or which PRs are waiting on the user. Not for reviewing someone else's PR, or polishing one before review (self-review).
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: |
            node -e '
            let c = "";
            try {
              c = JSON.parse(require("fs").readFileSync(0, "utf8")).tool_input.command.replace(/\\\n/g, " ");
            } catch {
              process.exit(0);
            }
            const read = /(-X|--method|--request)[\s=]*GET\b/i.test(c);
            const why =
              (/(?<![\w.-])gh\s+(pr|issue)\s+comment\b/.test(c) && "gh pr/issue comment posts a comment") ||
              (/(?<![\w.-])gh\s+pr\s+review\b/.test(c) && "gh pr review posts a review") ||
              (/(?<![\w.-])gh\s+(pr|issue)\s+close\b[^;&|\n]*\s(-c|--comment)\b/.test(c) && "closing with --comment posts a comment") ||
              (/(?<![\w.-])gh\s+pr\s+edit\b[^;&|\n]*\s--add-reviewer\b/.test(c) && "--add-reviewer requests a review") ||
              (/\/(comments|reviews|replies|reactions|requested_reviewers)\b/.test(c) &&
                (/(-X|--method|--request)[\s=]*(POST|PATCH|PUT|DELETE)\b/i.test(c) ||
                  (!read && /(?<![\w.-])gh\s+api\b[^;&|\n]*\s(-f|-F|--field|--raw-field|--input)[\s=]/.test(c)) ||
                  (!read && /(?<![\w.-])curl\b[^;&|\n]*\s(-d|--data[\w-]*|--json|-F|--form)[\s=]/.test(c))) &&
                "a write to comments, reviews, reactions or review requests") ||
              (/graphql/.test(c) && /\bmutation\b/.test(c) &&
                /\b(add|update|delete|submit|dismiss|minimize|resolve|unresolve|remove)\w*(Comment|Review|Reaction|Thread)|\brequestReviews\b/.test(c) &&
                "a GraphQL mutation on comments, reviews, reactions or threads");
            if (why) {
              console.error("Blocked (review-replies): " + why + ". Never post, resolve, react or request a review. Draft the reply in chat for the user to post. For a read, add --method GET, or split a word in a grep pattern (gh pr [c]omment).");
              process.exit(2);
            }
            '
    - matcher: "mcp__.*__pull_request_(respond|review)"
      hooks:
        - type: command
          command: 'echo "Blocked (review-replies): never post on a PR. Draft the reply in chat for the user to post." >&2; exit 2'
---

# Review replies

Answer every review item that's waiting on the user: a fix committed on the PR branch when it asks for a change, and a reply drafted in chat for the user to post. You draft, the user posts.

## Rules

- Never post a reply, review or comment, react, resolve a thread or request a review, through any tool (gh, gh api, curl, a script, a browser, a host's PR tool such as T3 Code's `pull_request_respond`), even when asked to "reply". Draft it in chat instead.
- In Claude Code, the hook in this skill's frontmatter blocks the gh, curl and T3 Code forms for the rest of the session. It can't see the commands a script runs, so the rule is what holds. When it blocks a read, its message says how to rephrase it.
- Commit fixes only on the user's own PRs. Push only after the user's OK, and never force.

## 1. Collect

From the repo root:

```sh
node <this skill's folder>/scripts/review-threads.mjs [<pr>...]
```

- Without numbers it checks every open PR by the user (`--author`, default `@me`): a few seconds for a handful of PRs, longer on a busy repo. It only reads from GitHub. Locally it fetches each waiting PR's head into `refs/pr/<n>`.
- Waiting on the user means:
  - an unresolved review thread whose last comment isn't theirs;
  - a review with a summary or "changes requested", or a top-level comment, from someone else since they last wrote on the PR. Re-requesting that reviewer's review clears it.
- Bots are skipped (deploy previews, coverage, changelog bots). To answer an AI reviewer as well, list its login under `reviewBots` in `.agents/review-replies.json`, shaped like `references/review-replies.json`.
- For each waiting PR it prints one line and writes `.agents/review-replies/<n>.threads.md`, which it keeps out of git: a header with the branch and head, then each item with its link, diff hunk, comments and the PR's commits since. Read only the files this run printed. An older file belongs to a PR this run didn't check.
- Exit 0 means nothing is waiting, 1 means the files list what is, 2 means gh or git failed (not logged in, not a GitHub repo). Stop on 2 and say why.

## 2. Sort each item

- **Already done:** the commits since the comment include the change. Read that commit (`git show`) to check it does what was asked, then draft a reply naming it.
- **Change asked**, including GitHub `suggestion` blocks (an empty one means delete those lines): make it (step 3).
- **Question:** answer from the code, the PR description and history (`git log -S`, `git blame`). If the honest answer is "no reason", the comment is really asking for a change, so treat it as one.
- **Disagree, out of scope, or bigger than the PR** (a redesign, a new abstraction, a change to a public API): no code. Put it under Needs you with the options and a draft reply for each. Recommend the most correct option even when it's the bigger change, and list its cost beside it. A complete fix for the same concern can span callers outside the diff.

## 3. Fixes

1. Check the PR is the user's. A run without numbers lists only theirs. For a PR you passed by number, compare `gh pr view <n> --json author` with `gh api user -q .login`. On anyone else's PR, report only.
2. Work on the PR branch. If it's checked out here, clean and at `refs/pr/<n>`, work in place. Otherwise add a worktree (`git worktree add ../<repo>-reply-<n> -b reply/<n> refs/pr/<n>`, or the host's own worktree tool) and set it up the way the project's README or AGENTS.md says.
3. Add one new commit per change, in the project's commit style (Conventional Commits when it has none). No amend, rebase or force-push: the reviewer's "changes since your last review" view depends on new commits.
4. Run the project's verify (from AGENTS.md, CLAUDE.md, CONTRIBUTING.md or the package scripts) before calling a fix done. Use the `self-review` skill if it's installed. A fix that still fails verify after two tries goes under Needs you with the failure, and its reply waits. When a reply will say the output didn't change, prove it first (the `diff-proof` skill if installed, otherwise run both versions on the same input).
5. Push only after the user OKs it, or if they asked for the push up front. List the commits and the target branch from the threads file header, then `git push <remote> HEAD:<branch>`, which must fast-forward. A PR from a fork pushes to the fork's remote. If it's rejected, fetch and report. Never `--force`.

## 4. Drafts

- In the user's voice, if they have a voice or writing-style skill. These rules win where they're stricter.
- One or two plain sentences, answer first: "No reason, switched it to `formatDuration` in `9b0e3d2`."
- No thanks, praise or apologies. Don't restate the comment. No headings, bullets or bold.
- Backticks for code, keys and hashes. Name the commit, don't link it. A reply that names an unpushed commit gets posted after the push.
- Don't reply to a review summary unless it asks something. If it requested changes, add a line for the user: re-request review from that reviewer after posting.

## Report

Give it in chat, not in a file, since the user copies the replies straight from it. Per PR: the number and title, then each item's link and its reply as a quote, in the threads file's order, then each fix's commit and whether it's pushed or waiting on the user's OK. Then Needs you, then a reminder that nothing was posted.

```
#123 fix(api): retry on 502

T1 src/retry.ts:42  https://github.com/acme/api/pull/123#discussion_r101
> Done in `4f2a9c1`, the delay comes from `RETRY_DELAYS` now.

Review by alice, changes requested: no reply needed. Re-request review from alice after posting.

Commits on reply/123, not pushed: 4f2a9c1 fix(api): read retry delays from config. Say push and I'll fast-forward fix/retry-502.

Needs you
- T2 src/client.ts:10 asks to split the client per service. Recommended: a follow-up PR, since the split is its own change and would bury the retry fix. Reply: "Agreed, that's its own change, I'll split it in a follow-up." Or do it here (about 12 files): "Split it in `<hash>`."

Nothing was posted. Paste the replies and resolve the threads yourself.
```

If Needs you has decisions and the user is around, ask them in one batch, recommendation first (AskUserQuestion in Claude Code, otherwise one message with numbered options). In an unattended run, don't ask: leave them under Needs you.

After the user posts, rerun the script: an item whose last word is theirs drops out.
