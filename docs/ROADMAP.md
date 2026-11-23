# Roadmap

Everything in the README's tables is drafted, linted and has its scripts tested on scratch or public repos. Next comes running each one on real work, per STYLE.md's "Before adding a skill".

## Next

- **Run every skill on real tasks**, one easy and one messy, and fix what reads wrong cold. The ones that haven't run end to end yet: pr-describe, explain-diff, perf-review, design-hillclimb's judge step, and review-replies' hook in a live Claude Code session (`/hooks` should list it after the skill runs once).

## Ideas not drafted

- **brief-check**: checks a prompt for a long, delegated or overnight run before it launches (pin the base, exact verify commands, gates that don't contradict). Part of it is already in unattended.
- **voice**: builds a voice profile from your own writing samples, then writes in it. It would ship with an empty profile.
