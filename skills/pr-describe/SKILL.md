---
name: pr-describe
description: Write a PR description from the branch's diff, commits and linked issues, ready to paste as one block. The project's PR template wins, and it never creates or edits the PR unless asked. Use it for "write the PR description", "PR body", "describe this PR", "update the description to match the diff", "the description is stale", or before opening a PR. Not for explaining a diff to someone who doesn't code (explain-diff) or answering review comments (review-replies).
---

# PR describe

Produce one block of Markdown the user can paste as the PR body, written from what the branch actually changes. Read-only: don't create or edit the PR unless the user asks.

## 1. Find the rules

The project wins. Look, in order, for:

1. A PR template: `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/PULL_REQUEST_TEMPLATE/*.md`, `docs/pull_request_template.md`, or `pull_request_template.md` at the root (any case). With several, pick the one that fits the change and say which.
2. PR guidance in AGENTS.md, CLAUDE.md or CONTRIBUTING.md.
3. PR rules in the user's own global instructions (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`).

Keep a template's sections and checkboxes. Fill each one, and write "n/a" rather than deleting a section. The defaults in step 3 fill whatever the rules leave open.

## 2. Gather

- **The PR, if there is one:** `gh pr view --json number,title,body,baseRefName,url,closingIssuesReferences`. Its base is the base. Without a PR, use the default branch (`gh repo view --json defaultBranchRef`).
- **The commits and the diff:** `git log --format='%h %s%n%b' <base>..HEAD`, `git diff --stat <base>...HEAD`, then `git diff <base>...HEAD`. Read the files that carry the change, not just the stat. With no commits ahead of the base, say so and stop. Uncommitted changes (`git status --short`) aren't in that diff, so leave them out and say so.
- **Linked issues:** `closingIssuesReferences`, `#123` or `Fixes #123` in the commits, and a number in the branch name (`fix/123-retry`). Read each one: `gh issue view <n> --json title,body`.
- **Stacking:** if the base is another open PR's branch (`gh pr list --head <base>` finds it), the PR is stacked. Name the parent and say it merges first.
- **Evidence:** test runs, screenshots, before and after numbers from this thread or the PR. Use only what exists. If nothing was run, the Testing line says what wasn't checked.
- **The current body:** keep what's still true and what the user added by hand (screenshots, notes to reviewers). Rewrite what the diff no longer matches.

## 3. Write

Defaults, where the project's rules don't say otherwise:

- Open with one or two short sentences: what was wrong or missing, and what changes for the user. Write the least a reviewer needs to understand the PR.
- Keep visible: screenshots, stacking or merge order, known conflicts, and measured numbers that matter.
- One `Testing:` line: what to run and what you see, or what wasn't checked. No setup steps or logs.
- Put useful implementation notes, rationale and detailed verification in a collapsed block: `<details><summary>Agent notes</summary>`, a blank line, the Markdown, a blank line, `</details>`. When you know the model and effort level, use them as the summary text instead. Leave the block out when there's nothing useful to add, and don't repeat the opener in it.
- Plain words and short sentences, in the user's voice (their voice or writing-style skill, if they have one). No headings, bold or tables. Backticks only for commands and paths someone would copy.
- End with any `Closes #N`, `Supersedes #N` and `Depends on #N` lines, one per line.
- If there's no PR yet, give a title too, in the project's commit style.

Describe only what the diff does. Don't list every file, don't claim a check that didn't run, and don't sell the change.

## 4. Hand it back

Give the body as one fenced block, ready to paste. Use a four-backtick fence when the body has code blocks of its own. After it, one or two lines at most: what you changed from the current body, if there was one, and anything the user still has to fill in or that you left out (a screenshot the template asks for, uncommitted changes).

Don't run `gh pr create` or `gh pr edit` unless the user asks. When they do, write the body to a temp file and pass `--body-file`, so the shell doesn't mangle backticks.

## Example

````markdown
Retries kept going after the user canceled a request, so a canceled upload could still finish minutes later. A cancel now stops the retry loop right away.

Testing: `npm test -- retry` passes, and canceling an upload in the dev server stops the network calls at once.

<details><summary>Agent notes</summary>

The loop checks the request's abort signal before each attempt and during the backoff wait, so a cancel in the middle of a 30 s wait returns at once. `retry()` keeps its signature, so callers don't change.

</details>

Closes #123
````
