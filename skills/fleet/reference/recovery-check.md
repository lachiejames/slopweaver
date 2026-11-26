# The Recovery check

The owner's spec is "never locked out": when the fleet is down, the owner can find out in plain words which vendor can
still start a session, and what the one step is when neither can. `slopweaver fleet recover` is that check, and when
the supervisor is down it seats a new one on the first plan that passes. It runs from the command line, or when the
owner presses Recovery in the desktop app.

```bash
slopweaver fleet recover [--home <dir>]   # one JSON line; exit 0 both vendors and the supervisor up or starting, 3 one or none, or a down supervisor not restarted, 1 the check itself failed, 4 another check runs
```

## What one pass does

- **It needs the desktop app, and nothing else.** Each vendor gets a throwaway session opened in the app through
  the app session harness (`src/fleet/recoveryHost.ts`). The check opens no cmux connection, so it works when cmux is
  what is down; the one cmux read is whether a chair cmux hosted is still listed, below.
- **Every session is a visible card.** The owner can watch it and stop it (rule 2). The pass tries one session at a
  time, each plan at most once, and closes each card before the next opens (`src/fleet/recoveryPass.ts`).
- **The turn is a challenge, not a hello.** The prompt carries two random halves. A session passes only when its
  last answer is exactly their join, read off the app's own snapshot (`judgeRecoverySnapshot`,
  `src/fleet/recoveryCheck.ts`). A session that answers anything else fails with what it said. One that never
  answers inside two minutes fails on the deadline.
- **The plans are tried best first, the spawn gate's own way.** For Claude that is the register, the repaired probe
  sweep and the ranker (`src/fleet/recoveryClaude.ts`). For Codex it is the fleet read, the ranker and the seat
  preflight (`src/fleet/recoveryCodex.ts`). A plan the gate would refuse is listed as not tried, with its reason. The
  session still passes the credential gate, or the Codex browser door, as it opens, and no hatch is read.
- **Reading the Claude plans can refresh a token.** The probe sweep, and the credential gate each Claude launch
  passes, probe every plan and file the probe register under the home. A plan whose token has merely expired gets
  one `claude` refresh run under its own store, which rewrites that plan's keychain credential, exactly as a spawn's
  gate does.
- **A failing plan falls back to the next one, then the pass moves to the other vendor.** If no vendor starts and a
  plan was left out because it is signed out, the result names that plan's one sign-in command
  (`recoverySignInStep`).
- **Each session runs in an empty directory of its own:**
  `$SLOPWEAVER_HOME/sessions/recovery-scratch/<attempt>/fleet-recovery`. The directory is removed only once its
  session is proven gone. A session the pass cannot prove gone stops the pass, and the result reads
  `infrastructure-failed` with what could not be settled, never a verdict on either vendor. So does a launch the
  app never answered, since its card may still open after the pass gave up on it. The next pass closes whatever an
  earlier one left open before it opens anything.
- **It is bounded and single.** The whole pass gets twelve minutes, and the next attempt starts only if a full
  attempt still fits. Its own lock (`acquireFleetRecoverLock`, `src/fleet/locks.ts`) is separate from `fleet
resume`'s, so a resume pass never holds a check off. A second check gets exit 4.

## The supervisor

- **Read once, after the leftovers are closed** (`readRecoveryChair`, `src/cli/commands/fleet/recoverChair.ts`;
  the pure verdict is `src/fleet/recoveryChairReading.ts`). Live is what the host says, never how recently the chair
  spoke: a pinned app session the app still runs, or a pinned workspace cmux's strict inventory still lists. A
  `fresh-supervisor-handoff-<n>` session already running beside a down chair is starting, so a second press opens no
  second chair. A pin record it cannot read, or a cmux chair cmux will not answer for, restarts nothing and says why.
- **Only a down chair is restarted.** Replacing a running supervisor is the owner's call: press Stop on its card,
  then Recovery. Before opening anything the press reaps the predecessor's run and runs `cmux takeover`'s own
  predecessor gate, so a chair the new one could not take over from is reported, not opened.
- **Seated on the first plan that passes,** through `cmux spawn --harness app --plan <alias>`, from a mechanical doc
  (`src/fleet/recoverySuccessor.ts`): invoke `/slopweaver:supervisor`, arm the sweep, take the pin (`cmux takeover`,
  or a bare `cmux pin` when none was pinned), then read the predecessor's doc. Claude seats on Fable, Codex on its
  pinned model.
- **Restarted means the pin moved** to the new session while the app still runs it (`judgeRecoveryChair`,
  `src/fleet/recoveryChair.ts`); each look reads the pin before it lists the app, so a stale listing never pairs
  with a later pin. A refused spawn, or a chair that ended before it took the pin, has its board row closed and falls
  back to the vendor's next passing plan, then the other vendor's; the result keeps each reason. A chair seen
  holding the pin before it ended is `lost`: its run is a supervisor's own, so its row is left and nothing opens
  after it. The pass keeps no pin history, so one that takes and loses the pin between two looks reads `ended`. A
  restarted chair is looked at once more as the pass ends, and is `lost` if it has since ended or the pin moved off
  it, or `starting` if the app cannot be asked. A spawn that exits non-zero but leaves its seat open, its pickup not
  proven, is watched as an open chair. A spawn whose ledger names no open seat is checked against the app before it
  counts as refused, since that ledger write is best-effort: a running session under the doc's slug is watched as the
  chair, and when the app cannot be asked the restart is `starting` and nothing more opens. The chair is read again
  right before each open, so one that came up during the checks is reported as running and nothing opens beside it. A
  chair still running at the deadline is `starting`, and nothing opens beside it. A restart starts only if five
  minutes of the pass remain (`RECOVERY_RESTART_MS`, `src/fleet/recoveryRestart.ts`).

## The result

One JSON line, `schemaVersion` 2: an overall `status` (`passed`, `partial`, `failed` or `infrastructure-failed`),
one entry per vendor naming the plan it answered on or why it did not start, the plans not tried with each reason,
every attempt in order, the one sign-in command when that is the fix, and `chair`: `live`, `restarted`, `starting`
or `not-restarted`, its reason, and every chair the press opened or tried to, in order (`FleetRecoveryResult`,
`src/fleet/recoveryCheck.ts`).

## Recovery in the desktop app

- **Pressed, never scheduled.** The menu bar's Recovery item and the Sessions page's Recovery button run this verb
  as the app's child (`recoverFleet`, `desktop/src/fleetProcess.ts`), bounded at fourteen minutes. Nothing else
  starts it: not the app's launch, not a timer, not a calendar.
- **One pass at a time.** Both presses go through one press step (`stepFleetRecovery`,
  `desktop/src/fleetRecoveryCheck.ts`), so a press on either while a check runs starts nothing; the item is
  disabled and the button absent until it ends.
- **The one app child that causes model sessions.** Every one is a visible card in the app: the throwaway checks,
  and a restarted chair, which the owner can watch and stop like any other. The no-headless gate recognises exactly
  this call, from `desktop/` alone, by the owner's ruling (rule 2).
- **What it shows.** The Sessions page reads the one stdout line and opens on the supervisor: running, restarted,
  starting or not restarted, with why, then each plan or vendor a restart fell back from, with its reason
  (`desktop/src/fleetRecoveryChair.ts`). Then, per vendor, whether it started a session, the plan, and the reason
  when not, then the sign-in command when that is the fix. A timeout, a line it cannot read or a verb that never
  printed one says no success was recorded. The state is memory only, so the app opens on "not run since the app
  opened".

## What it does not do, stated

- **It runs no check at launch and on no timer.** The supervisor is restarted on a press, and no seat is reseated.
- **A cmux chair reads unknown from the app** when cmux refuses the app's child its socket, so the press restarts
  nothing over it. An absent pin record is not checked against cmux; the successor's `cmux pin` refuses if cmux
  holds a pin. A successor starting in cmux, rather than the app, is not seen as starting.
- **A pass proves one turn, on the plan that answered, at that moment.** A plan the ranker placed later is not
  proven.
