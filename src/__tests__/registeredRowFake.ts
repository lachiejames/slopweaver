/**
 * What a `handover register` that succeeded leaves behind: a board row file by the argv's `--slug`, under its
 * `--home`. A failure hold reads the BOARD to decide whether its finding landed, never the exit code, so a fake
 * registrar answering 0 must leave this too — else the finding reads as owed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stateHomePaths } from "../stateHome.js";

/**
 * Write the board row a successful registration of `argv` would have written.
 *
 * @param argv the `handover register` argv, carrying `--slug` and `--home`
 */
export function writeRegisteredRow({ argv }: { readonly argv: readonly string[] }): void {
  const slug = argv[argv.indexOf("--slug") + 1]!;
  const dir = stateHomePaths({ home: argv[argv.indexOf("--home") + 1]! }).handovers;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n# finding\n`, "utf8");
}
