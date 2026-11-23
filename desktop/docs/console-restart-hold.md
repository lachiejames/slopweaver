# A normal update's console restart never raises the note

The "could not start its console" note and the blank "The console is not serving" page that can come up during an
update and clear again within seconds are noise: the floating note for fleet recovery is held back while the outage
is still within the normal desktop-update time range.

## Why the console stops answering during an update

A pull swaps the console onto its new build (`scripts/docs-site.sh` `refresh_round`): the next build compiles while
the old server serves, the old server is then frozen and ended, and the record moves only once the new one answers a
page. So for the swap's gap every read fails — and while the build runs, the old server, starved of CPU, can miss
the shell's 5s `/queue` probe for seconds at a time. `--serve` during a refresh is a no-op, so the shell's one
recovery attempt cannot help; before this hold it raised the note at once.

## What the shell does

`consoleRestartHold.ts` decides, `consoleRecoveryShell.ts` acts. A console found not answering is held quiet for
`RESTART_HOLD_MS` from that **first** failed read:

- the menu reads "Slopweaver: the console is restarting onto a new build…", with the dimmed icon and no Retry;
- a tab shows "Slopweaver is updating — this page comes back by itself" instead of "The console is not serving";
- the console is read again every two seconds (`RESTART_POLL_MS`) — **read only**, never a second `--serve`; a page
  failing to load meanwhile starts nothing, and only your Retry ever runs another attempt;
- the moment a read answers, the tabs and the voice window come back; only past the window does the note come up.

A missing or invalid checkout is never held — no update brings one back.

The window is measured from when that first failed read **began**, on a monotonic clock (`performance.now()`): a
`--status` that times out at 20s has spent 20s of it, and a wall clock that steps or jumps by a whole sleep on wake
would raise the note early. A `--serve` that hangs still raises the note only when it settles, at its own 300s bound.

## The window, and how to re-measure it

`RESTART_HOLD_MS` is 120s: `docs-site.sh`'s own `wait_for_production` budget for a new build to answer a page. A
restart that has not answered by then is one the script itself gave up on. Measured on the owner's Mac:
a whole refresh round ran 94s from build start to the new server ready, and the old server missed the 5s probe for
5–30s at a time while a build ran. On one round read by a candidate app, the build-starved stretch came back after
27.0s and the swap after 12.1s, both held with no note. A cold `--serve` after a `--stop` rebuilds from nothing and
ran past the window twice (raised at 120.7s and 120.9s, then adopted back unasked) — that is not an update. The repro
is in `consoleRestartHold.ts`.

Every outage is logged to `~/Library/Logs/Slopweaver/desktop-events.jsonl` as a `console-outage` line: `held` when
the hold begins, then `back` or `raised`, each with `downMs` from the first failed read. A `back` line is one measured
real restart, so the window is re-sized off the installed app's own record rather than a guess.
