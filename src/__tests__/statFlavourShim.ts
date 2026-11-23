/**
 * A `stat` on PATH that behaves like the named platform's, so a shell script's portability is testable on
 * either machine instead of only on the one whose `stat` it happens to have been written against.
 *
 * Why this exists rather than a comment saying "be careful with stat": `stat -f %m` is BSD's mtime and GNU's
 * `--file-system`, where `%m` is no directive at all. On Linux that form therefore exits 0 printing a
 * human-readable block opening `File: "..."`, so a `stat -f … || stat -c …` chain never reaches its second
 * arm and the block reaches whatever consumed it. MEASURED on the CI runner against
 * `scripts/plugin-mirror-sync.sh`: `line 88: File: unbound variable` killed five of six concurrent runs,
 * while every local darwin run of the same commit was green — the class is invisible on the machine the
 * script is written on, which is exactly the class a shim can hold down.
 *
 * **The shim answers from a SUPPLIED epoch and never execs the real `stat`.** That is the whole reason it
 * works on both platforms, and the first version got it wrong: it delegated its mtime arm to
 * `/usr/bin/stat -f %m`, which is the real GNU binary on the runner, so the gnu shim printed a file-system
 * block where it meant to print a number and both cases failed on Linux for the very reason they exist. What
 * is under test is which FORM the script asks first and whether it rejects a non-numeric answer — neither
 * needs a real mtime, and taking one made the fixture platform-shaped.
 *
 * A shell script on PATH is a real program the script under test really execs. It is a seam, not a mock.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The variable the shim reads its answer out of, so the test owns the mtime rather than the filesystem. */
const MTIME_VAR = "SLOPWEAVER_STAT_SHIM_MTIME";

/** GNU coreutils: `-c %Y` is the mtime, and `-f` is `--file-system`, which has no `%m` directive. */
const GNU = `#!/bin/sh
case "$1" in
  -c) printf '%s\\n' "\${${MTIME_VAR}}"; exit 0 ;;
  -f) printf '  File: "%s"\\n  ID: 1 Namelen: 255\\n' "$3"; exit 0 ;;
esac
echo "stat: this shim answers only -c and -f" >&2
exit 1
`;

/** BSD stat: there is no `-c` at all, and `-f %m` is the mtime. */
const BSD = `#!/bin/sh
case "$1" in
  -c) echo "stat: illegal option -- c" >&2; exit 1 ;;
  -f) printf '%s\\n' "\${${MTIME_VAR}}"; exit 0 ;;
esac
echo "stat: this shim answers only -c and -f" >&2
exit 1
`;

/**
 * Mint a throwaway directory holding a `stat` with the named platform's contract, for PATH to find first.
 *
 * The caller owns the directory and must remove it — every lane's temp root is per test FILE, so a caller
 * that forgets leaks only into its own sandbox, but it still leaks.
 *
 * @param flavour which platform's `stat` contract to present
 * @param mtimeSeconds the epoch the mtime arm answers with, whatever the file on disk actually says
 * @returns the directory to prepend to PATH, and the env the shim needs to answer
 */
export function statFlavourShimDir({ flavour, mtimeSeconds }: { flavour: "gnu" | "bsd"; mtimeSeconds: number }): {
  dir: string;
  env: Record<string, string>;
} {
  const dir = mkdtempSync(join(tmpdir(), `sw-stat-${flavour}-`));
  writeFileSync(join(dir, "stat"), flavour === "gnu" ? GNU : BSD, { mode: 0o755 });
  return { dir, env: { [MTIME_VAR]: String(mtimeSeconds) } };
}
