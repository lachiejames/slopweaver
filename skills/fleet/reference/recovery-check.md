# The Recovery check

The owner's spec is "never locked out": when the fleet is down, the owner can find out in plain words which vendor can
still start a session, and what the one step is when neither can. `slopweaver fleet recover` is that check. It runs
from the command line only: the desktop app has no item or button for it yet.

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

## What it does not do yet, stated

- **The desktop app neither runs it nor shows it.** A menu bar item, a Sessions-page line and button, and the app
  running the verb as its own child wait on the owner's ruling, because no-headless (rule 2) has no allowlist.
- **The app does not start the supervisor itself, and runs no check at launch.** The check neither restarts the
  chair nor reseats a seat.
- **A pass proves one turn, on the plan that answered, at that moment.** A plan the ranker placed later is not
  proven.
