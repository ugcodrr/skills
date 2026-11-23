# Thread prompt template

Fill every `<…>` and delete the lines that don't apply.

```
You're one of <N> parallel threads for <feature>. Your branch is <type/feature-slice>, based on <type/feature> at <hash>.

First: <`git switch -c <type/feature-slice>`, if the host didn't create your branch>. Check you're on the base: `git merge-base --is-ancestor <hash> HEAD` must succeed; if it doesn't, stop and report. <If the worktree has no dependencies yet: `<install or setup command>`.>

Goal: <the user-visible result, e.g. "the settings page lists active sessions, each with a Revoke button">.

Already on the base, don't redo it: <types, fields, routes, translation keys and constants by exact name, e.g. "`Session.lastSeenAt` in packages/db/src/session.ts", "`settings.sessions.title` in locales/en/app.json">.

You own: <exact globs, e.g. apps/web/src/settings/sessions/**>. You may also add new keys to <translation files>. Put each one next to a related key, not at the end of a block, because end-of-block appends are what collide.

Don't edit: <other threads' globs>, <what the lead owns: lockfiles, shared config, the one-agent-at-a-time paths>. Don't add or upgrade dependencies. If you need a change there, say so in your report and don't make it.

Done when your work is committed on your branch and `<verify command>` passes<, and you've looked at every screen you changed>. Don't merge, rebase or push.

End with a report to the lead:
- the outcome in one or two lines
- decisions the lead or the user has to make, each with your recommendation
- branch, worktree path and full commit SHAs
- each check you ran and its result, and anything you couldn't check
- anything you needed outside your paths
```
