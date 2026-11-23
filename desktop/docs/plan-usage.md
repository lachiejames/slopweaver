# Each plan's usage in the menu bar

The menu bar carries one line under the fleet's: how many plans need a sign-in, and when the numbers were read.
Behind it sits one line per registered Claude and Codex plan, giving each week's percentage and its reset. Instead of
a percentage, a plan's line may say:

- it needs a sign-in;
- it is paused;
- it is a monthly plan that nothing here measures;
- it has no reading.

## Where the numbers come from

Every five minutes the shell asks the console's `plan-usage` read (`site/lib/liveVerbs.ts`). That read runs
`slopweaver plans usage --json`, which asks no model host anything. It reads only what this machine already recorded:

- the gauge snapshots and probe records `claude gauge` left;
- each Codex store's own rollout logs;
- the last filed `codex` live read of each store.

The verb and its rules are in [skills/plans](../../skills/plans/SKILL.md).

No model host is asked, and the read files no record of its own. Its one connection beyond the console on localhost is
the install's own store, always local: a remote store URL is refused with no hatch (`src/store/config.ts`).

The shared code it runs keeps its own side effects, as it does for every verb and live read. This list holds the ones
the reviews found, and is not a proof that there are no others:

- the console's live route saves the answer as `plan-usage@<epochMs>.json`, only when
  `SLOPWEAVER_CONSOLE_SAVED_READINGS_DIR` names a directory (`site/lib/savedReadings.ts`);
- a live request starts the talk-pack keeper (`site/lib/packKeeper.ts`), which does what `talk pack` does, its
  local cmux socket read included;
- the CLI's dispatch records its once-per-session stale-seat notice (`src/cli/staleSeatEffects.ts`);
- the store's own migrations, named in `src/plans/planUsageRead.ts`.

## What the menu will not say

- **A number from before a sign-out.** A plan that needs a sign-in shows the sign-in and no percentage, because a
  number from before the sign-out is no longer what the plan has left.
- **0% for a missing reading.** A window with no reading says so rather than showing 0%.
- **An old reading as a current one.** A Claude reading older than an hour keeps its number but is labelled stale,
  with when it was read. So is a Codex reading from a scan that met a rollout file or session directory it could not
  open, since either may hold a later one.
- **A reopened week as its old number.** The menu is drawn again every 30 seconds and every window is judged at
  that instant, so a reset that passes between two polls reads as "reset <time>, no reading since". The same check
  marks a Claude reading stale once it crosses its hour. A window with no recorded reset always prints when it was
  read ("week 42% (read <weekday> <time>, reset unrecorded)"), and reads "no reading" once that is more than a week ago.
  The bound is one redraw, not zero: a reset passing in the instant between judging the menu and showing it, or while
  the menu is open, keeps the old number until the next redraw.
- **A frozen menu as a live one.** After two polls with no answer, the headline says its numbers are stale. A console
  that cannot answer reads "Plans: unavailable", with its reason behind it.

## Why five minutes

One read was measured on a home with nine plans: 7.37s wall and 6.57s CPU, most of it the Codex rollout
scan. A one-minute poll would hold a tenth of a core for a figure that moves over hours. Reproduce it with
`/usr/bin/time -p ./bin/slopweaver plans usage --json`.

## The code

- `planUsage.ts` parses the console's answer and checks every field. A document with one malformed row is refused
  whole, never drawn in part.
- `planUsageTray.ts` turns the answer into the headline and the per-plan lines. It is pure; its tests are in
  `__tests__/unit/`.
- `planUsageShell.ts` runs the timer, never two asks at once, and keeps the last answer. It hands `main.ts` the menu
  items to draw, and starts asking only when a tray draws its first menu, so an app with no tray never runs the read.
