# `automation-held-on-you`: an automation stopped on the owner's own word stands on the owner's Queue after the owner's priorities

A stopped automation stays on the owner's
Queue every day it stands, its decision above the fold, named in the chat update, never buried. A held automation
(for example Error Tracking, "disabled for now") is not a blocker, so it comes straight
after the owner's priorities' own cards. The security-fix top-up once stood on the owner's hold with no card anywhere, because
[`recipe-stopped`](recipe-stopped.md) is about a row that stopped ON ITS OWN and deliberately leaves out a held one.
This is the other card; every monitor: [the monitors](the-monitors.md). It stands every day only while the owner has not
answered it: once the owner answers one, it stays down until its hold is lifted or placed again (below).

- **What it reads.** Every definition under `$SLOPWEAVER_HOME/live/recipe/definitions/`, through `standingHoldOf`
  (`src/automations/health.ts`). It fires on a hold answering `owner` — one with no finding, which only the owner's word
  clears — whatever `enabled` says. A row merely disabled with no hold is one the owner switched off for good, and a `fix`
  hold is a broken row a seat repairs: neither fires (`src/monitor/automationHeldOnYou.ts`).
- **One card per held row** (`perSubject`), keyed by the recipe id, its file and the hold's own instant, so a hold
  lifted and placed again is a new card. Each card floats a note on `--fire`.
- **The owner's answer holds the card, not the hold.** A held row is still held after the owner's Done, so the next tick used to post
  it again as `.2`, then `.3` — MEASURED: four cards answered by the owner rose twice
  each in an hour, `placedBy` or not. So a key whose last close was the owner's (`src/monitor/heldKeys.ts`)
  reads `steered` and posts nothing until that hold is lifted or placed again, which is a new key. A
  hand register that will not read is `unmeasurable`, never "nothing closed".
- **The card is the OWNER's choice**, unlike `recipe-stopped`'s: _Decide whether to lift your hold on `<name>` — it stays
  stopped until you say_, with three options — lift it and switch it back on, keep it stopped until the condition the owner's
  hold names, or switch it off for good. The owner's hold's reason is quoted word for word in the details, never paraphrased
  into an option; one too long for every line the note carries ends naming `slopweaver automation status`.
- **Where it stands, until the owner answers it.** The registry entry declares `stopsWork`, so the step carries it and the
  Queue draws it under **Stopped automations**, after the owner's priorities and ahead of every other card, its decision and
  options on its face, even after the owner puts it off ([the owner's priorities](../../../docs/console/queue-focus.md)).
  `recipe-stopped` and `corpus-sync-stopped` declare it too.
- **Who fires it.** The supervisor's tick, before it reads `slopweaver queue stopping --json`, so the digest's first
  line (`queue leader:`) names a card already posted, and the chair raises it straight after the owner's priorities.

```bash
slopweaver monitor check --only automation-held-on-you        # dry: what it would post, and for which holds
slopweaver queue stopping                                     # the cards stopping the owner's work, in the owner's Queue's order
```
