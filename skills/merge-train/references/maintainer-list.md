# A list for the maintainer

When the user wants something to send whoever merges (the maintainer named in the project's AGENTS.md or CONTRIBUTING.md, or whoever they say), give one plain-text block in a code fence, ready to paste. PR numbers only: no titles, bold or explanations beyond a few words. Check each PR's state with `gh pr view <n> --json state` first, so nothing closed or merged is listed.

```
Ready, any order:
#101 #102 #103

Ready, in this order (they touch the same code):
- #104 -> #105 -> #106
- #107, then #108 -> #109 and #110
- #111 last

Needs you:
- #112, #113: re-review, your changes are in
- #114: keep the old flag name or rename it?

Not ready:
- #115, #116: being redone on main
- #117: closing
```

(Placeholder numbers. List only real, open PRs.)

- **Ready, any order:** every PR that merges cleanly and has nothing ordered against it.
- **In this order:** one line per chain, with arrows. Stacks and conflicting pairs go here.
- **Needs you:** a few words per PR, ending in the question when it's a choice.
- **Not ready:** grouped by reason.

The user sends it. Don't post it anywhere yourself.
