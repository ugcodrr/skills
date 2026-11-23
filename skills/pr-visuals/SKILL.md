---
name: pr-visuals
description: Before/after screenshots for a PR that changes what users see in a web app. It captures the same routes and states on the base and the PR branch and frames each pair in one PNG for the PR description. Use it when a PR changes UI (components, styles, layout, copy, themes), for "before and after", "screenshots for the PR", "visuals", "show what changed", and before calling a UI PR done. Not for proving non-visual output is unchanged (diff-proof) or fixing alignment and padding (gridlines).
---

# PR visuals

Produce one framed image per visible change: the base on one side, the PR on the other, differing only where the code does. A reviewer should see the change in a glance, without checking out the branch.

## Rules

- Uploading images and editing a PR description are public, and most image hosts can't delete. Ask first, every time. Never post the images as a comment unless the user asks for that.
- Playwright goes in a scratch folder, never the project.
- Serve seeded or mocked data, never a live backend. Live data differs between the two runs for reasons that aren't the PR.
- Keep `.agents/pr-visuals/` out of git with a `.gitignore` of `*` inside it. The images belong on the PR, not in the repo.

## 1. Set up once per project

- **Playwright:** `npm i --prefix ~/.cache/pr-visuals/playwright playwright`, then `npx --prefix ~/.cache/pr-visuals/playwright playwright install chromium`. The script looks in `$PW_DIR`, then the project's own dependencies, then that folder. It launches `$CHROMIUM_PATH` when that's set, otherwise Playwright's Chromium, then the installed Google Chrome.
- **`.agents/pr-visuals.json`** says how to build and serve the app. Copy `references/pr-visuals.json`:
  - `setup` runs in a worktree the script creates, and again when it moves to another commit;
  - `build` runs on both sides unless `--no-build`;
  - `serve` starts the app on `$PORT`, and `ready` is the path that answers once it's up;
  - `env` reaches setup, build and the server, along with `TZ`, `PR_VISUALS_SEED` and `PR_VISUALS_NOW` for a seed script to read;
  - capture defaults: `viewport`, `colorScheme`, `locale`, `timezone`, `now`, `seed`.
- **Without `serve`**, each shot's `path` is a file in the checkout, opened directly: a static build (`dist/index.html`) or plain HTML.

## 2. Write the shot list

Put it in `.agents/pr-visuals/<pr>/shots.json` (`<branch, with / as ->` before the PR exists). Copy `references/shots.json`. Top-level fields set defaults for every shot.

| Field | Use |
|---|---|
| `name`, `path` | Required. `path` is the route (`/settings?tab=billing`) or, without `serve`, a file |
| `title` | The window title. Default: the path |
| `viewport`, `colorScheme` | Default 1280x800, light |
| `selector` | Capture just this element. Crop to the component when the rest of the page is noise |
| `fullPage` | Capture the whole scrolling page |
| `prep` | Steps before the capture: `{ "click": sel }`, `{ "hover": sel }`, `{ "fill": [sel, text] }`, `{ "press": "Escape" }`, `{ "waitFor": sel }`, `{ "wait": ms }`, with Playwright selectors (CSS, `text=Save`) |
| `wait` | Settle time after load and after `prep`, in ms (default 300) |
| `only: "after"` | One panel, for a screen the base doesn't have |
| `before`, `after` | Fields that replace the shot's on that side, for a route, label or click that differs |
| `layout`, `theme` | `row` or `column` (default: a row when the pair is under about 1,900 px wide); backdrop `blurple`, `ocean`, `mint`, `sunset` or `graphite` |

Picking shots:

- One shot per visible change, showing exactly what changed, in the state where it shows: the open menu, the filled form, the error, not the landing page.
- Add dark mode or a phone viewport only when the PR touches them.
- Keep the set small. Three sharp shots beat ten that make the reviewer hunt.

## 3. Run it

From the repo root:

```sh
node <this skill's folder>/scripts/pr-shots.mjs --pr 123           # the PR's head against its merge-base
node <this skill's folder>/scripts/pr-shots.mjs                    # this checkout against its merge-base with the default branch
node <this skill's folder>/scripts/pr-shots.mjs --pr 123 --only delete-dialog --no-build
```

- `--pr` uses the worktree that has the PR's branch checked out, or fetches the PR's head, and compares against its merge-base with the PR's base branch. `--base` and `--head` take a ref or a folder instead.
- A ref gets a detached worktree under `~/.cache/pr-visuals/<repo>-<id>/`, reused across runs. The script stops when that worktree has local changes or another run holds the lock.
- A warning that a checkout has uncommitted changes, or isn't at the PR head, means the images show local work the PR doesn't have. Say so in the report.
- It freezes the clock (`Date` stands still, timers still run), `Math.random`, animations and the caret, locale and time zone, and waits for fonts and images. Anything else that moves is yours to fix in step 4.
- `--reframe` redraws the frames from the saved captures, with no build or server. Use it after changing only `title`, `layout` or `theme`.
- Output: `<out>/<name>.png` per shot, raw captures in `<out>/raw/{before,after}/`, and `<out>/README.md` with the commits, what was frozen, and the markdown.
- Exit 0: every pair differs by at least a pixel. 1: a pair is identical. 2: a shot or a side couldn't be captured, and `<out>/raw/` holds that side's setup, build and serve logs.

## 4. Look at every image

Exit 0 doesn't mean a shot shows the change. Open each PNG (the Read tool in Claude Code). Then:

- A shot that "looks the same before and after" doesn't show the change. Pick another state, route or crop, and rerun it with `--only`. If it's still the same after two reruns, drop it and list it in the report.
- Anything still moving (a live timestamp, a random avatar, a spinner mid-fetch) gets fixed at the source: seed the data, add a `waitFor`, or mock the request. Don't crop it out quietly.
- A difference you didn't expect is a finding. Tell the user before the images go anywhere.

## 5. Put them on the PR, only with the user's OK

- Default: hand the user the folder. They drag the PNGs into the PR description on GitHub, which hosts them, and keeps them private on a private repo.
- Use an upload script or a host only when the project has one or the user names it, after their OK.
- Put the images between `<!-- pr-visuals -->` and `<!-- /pr-visuals -->`, so a rerun replaces the block. Add them after every other description edit. When you edit the description later, start from the live body (`gh pr view <n> --json body`), since an older draft drops the images.

## Report

```
pr-visuals for #123: base main at 410996fb, head feat/restyle at 8c6d1bed

- settings: /settings, 1280x800 light → .agents/pr-visuals/123/settings.png
- delete-dialog: /projects/1, after clicking "Delete project" → delete-dialog.png
- footer: looks the same (the PR doesn't touch it), dropped

Not frozen: avatars load from a CDN; they match in this run.
Ready for the PR. Drag them in yourself, or say which host to upload to.
```
