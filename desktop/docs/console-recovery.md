# Console recovery

How the desktop shell checks the console it shows and brings it back, and what you see when it cannot. The wiring is
`src/consoleRecoveryShell.ts`; the decisions are pure in `src/consoleHealth.ts`, `src/consoleRestartHold.ts` and
`src/windowRole.ts`.

- **A console that stops answering is brought back once**, through `docs-site.sh --serve`, and a recovery that
  fails waits for your Retry rather than trying again. One recovery runs at a time, so a timer check, a Retry and a
  failed page load never start three. Residue, named: a console whose static file answers while a window's page
  keeps failing to load at the network level is recovered once per failed load, each one ending in that reload.
- **A slow console is not a dead one** (a slow one mid-call would otherwise read as an update forcing
  itself). The fifteen-second check asks a static file (`site/app/icon.svg`, never a rendered page) and recovers only
  after two failed reads in a row. Reads run one at a time, and a read that settles after a recovery started or the
  console was adopted is dropped. A page that fails to load still recovers at once, unless a restart is being held
  or the note already stands (then only the hold's reads or your Retry act); an aborted load (`ERR_ABORTED`, code -3, a
  navigation another one replaced) starts no recovery.
- **A recovery does not blind the voice.** The voice's window is judged against the origin the shell last loaded it
  from (`overlayOrigin`), so it keeps its role while the console's own origin is unset mid-recovery, and a look at
  your screen is not refused for that. Residue, named: a console that comes back at a DIFFERENT address reloads the
  voice onto it, and `overlayOrigin` moves when that load is asked, so the old page is refused in the moment before
  the new one replaces it. A console back at the same address leaves a loaded voice page where it is; only a page
  whose own load failed, which cleared `overlayOrigin`, is loaded again.
- **A console that cannot be brought back raises one floating note** (`consoleNote.ts`): what failed, in which
  build, the failure's own sentence and what to do — Retry, unless the checkout is the problem and Retry cannot fix
  it; in a dev build, Quit this dev build; and Not now, which holds until the next failure. It sits under the
  fleet's note when that one is up and goes the moment the console serves again.
- **A normal update's restart never raises it.** A failed recovery is held quiet as "updating" for 120s from the
  outage's first failed read, read every two seconds, and the note comes up only past that window:
  [restart hold](console-restart-hold.md).
