# Deploy brief — publish phases 1–5 to the live site

This is the only operation in this project that touches production. Read it all
before starting.

**Why now:** live players are on `2026.08.28-5`, which still loses a purchased
Rainbow charge in ~84% of short runs. Every fix since has sat on a branch. Also,
the Playables interest form wants a link, and it should point at the good build.

---

## What gets deployed

The **Pages** build, not the Playables build. `main` publishes the repo as-is:
manifest, icons, service worker and `?dev=1` all stay. That is correct — those
serve the standalone site. `dist/playables/` is a separate artefact for
submission and is gitignored.

---

## Steps

### [ ] 1. Confirm the branch is clean and green

Both suites pass on `playables` before anything else. If either is red, stop.

### [ ] 2. Merge `playables` into `main`

Fast-forward if possible. Do not rebase or squash — the phase-by-phase history
is the record of what was verified and when.

### [ ] 3. Bump `BUILD_VERSION` to `2026.08.28-6`

**Do not skip this, and do not do it after the push.**

`BUILD_VERSION` in `js/constants.js` derives the service worker's cache name.
Deploy without bumping it and the service worker keeps serving the previous
build to every returning player — the deploy lands, the site looks unchanged,
and hours get lost wondering why. That exact confusion already cost this project
an afternoon.

Commit the bump on `main` as its own commit.

### [ ] 4. Push `main`

This triggers `deploy-pages.yml`. Watch the Actions run to completion; do not
assume it succeeded.

### [ ] 5. Verify what is actually live

- Fetch `js/constants.js` from the live site with a cache-busting query string
  and confirm it reads `2026.08.28-6`.
- Open the site in a **private window** and read the version stamp in the
  bottom-right of the HUD. It must say `-6`.
- Play one run: drop a few fruit, make a merge, confirm sound and the squash and
  particles.

Both checks matter. The fetch proves the server has it; the private window
proves a fresh browser gets it.

### [ ] 6. Then check the service worker did the right thing

Open the site again in a **normal** window — one that has the old build cached.
Confirm it also ends up on `-6`, reloading once if it must. This is the check
that proves the cache-name bump worked, and it is the one that cannot be done
from a private window.

---

## If something looks wrong after deploying

Do not push a hurried fix. `git revert` the merge on `main` and push that — the
site returns to `-5`, which is a known-working build, and the branch is
untouched for a second attempt.

---

## Report back

- The commit hash on `main`, the Actions run result, and the exact
  `BUILD_VERSION` string the live site returns.
- Confirm the normal-window check in step 6, not just the private one.
