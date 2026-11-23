/**
 * `slopweaver dev lint` — the composed static-analysis bar (prettier + oxlint + knip + constraints +
 * hygiene + the bespoke ratchets + door-coverage) with a single non-zero exit. `--lane local` drops the one
 * check too heavy for a developer machine. Thin CLI edge over `runDevLint`; the logic + tests live in
 * `src/devLint/`.
 *
 * The one thing this edge adds is the lap-lock read: the seat lane withholds its oxlint while a lap holds the
 * machine, and `src/devLint/` may not import `github lap-seat show`'s own read (`cli-command-boundary`), so the
 * command reads it and hands it in.
 */
import { runDevLint } from "../../../devLint/devLint.js";
import { slopweaverHome } from "../../../homeDir.js";
import { defineCommand } from "../../defineCommand.js";
import { readStandingLapLock } from "../github/lapLock.js";

export const devLintCommand = defineCommand({
  run: (argv) => runDevLint({ argv, readLapHolder: () => readStandingLapLock({ home: slopweaverHome() }) }),
});
