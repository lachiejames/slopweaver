# The Recovery check

The owner's spec is "never locked out": when the fleet is down, the owner can find out in plain words which vendor can
still start a session, and what the one step is when neither can. `slopweaver fleet recover` is that check. It runs
from the command line, or when the owner presses Recovery in the desktop app.

```bash
slopweaver fleet recover [--home <dir>]   # one JSON line; exit 0 both vendors, 3 one or none, 1 the check itself failed, 4 another check runs
```

## What one pass does

- **It needs the desktop app, and nothing else.** Each vendor gets a throwaway session opened in the app through
  the app session harness (`src/fleet/recoveryHost.ts`). It opens no cmux connection, so the check works when cmux
  is what is down, and it starts no supervisor.
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

## The result

One JSON line, `schemaVersion` 1: an overall `status` (`passed`, `partial`, `failed` or `infrastructure-failed`),
one entry per vendor naming the plan it answered on or why it did not start, the plans not tried with each reason,
every attempt in order, and the one sign-in command when that is the fix (`FleetRecoveryResult`,
`src/fleet/recoveryCheck.ts`).

## Recovery in the desktop app

- **Pressed, never scheduled.** The menu bar's Recovery item and the Sessions page's Recovery button run this verb
  as the app's child (`recoverFleet`, `desktop/src/fleetProcess.ts`), bounded at fourteen minutes. Nothing else
  starts it: not the app's launch, not a timer, not a calendar.
- **One pass at a time.** Both presses go through one press step (`stepFleetRecovery`,
  `desktop/src/fleetRecoveryCheck.ts`), so a press on either while a check runs starts nothing; the item is
  disabled and the button absent until it ends.
- **The one app child that causes model sessions.** Every one is a visible throwaway card in the app. The
  no-headless gate recognises exactly this call, from `desktop/` alone, by the owner's ruling (rule 2).
- **What it shows.** The Sessions page reads the one stdout line and says, per vendor, whether it started a
  session, the plan, and the reason when not, then the sign-in command when that is the fix. A timeout, a line it
  cannot read or a verb that never printed one says no success was recorded. The state is memory only, so the app
  opens on "not run since the app opened".

## What it does not do yet, stated

- **The app does not start the supervisor itself, and runs no check at launch.** The check neither restarts the
  chair nor reseats a seat.
- **A pass proves one turn, on the plan that answered, at that moment.** A plan the ranker placed later is not
  proven.
