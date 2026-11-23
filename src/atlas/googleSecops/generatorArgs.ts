/**
 * The command line of `tools/generateGoogleSecopsSurfaces.ts`, read as a pure function so a misread flag
 * cannot quietly drop `--verify --spec-dir <dir>` to the committed-only check and still print success.
 */
import { err, ok, type Result } from "#lib/result.js";

/** What the generator was asked to do. */
export interface GoogleSecopsGeneratorArgs {
  /** Check, never write. */
  readonly verifyOnly: boolean;
  /** The directory `--fetch` downloads the pinned files into, when it was given. */
  readonly fetchInto: string | undefined;
  /** Where the pinned files are read from — `--fetch`'s directory or `--spec-dir`'s — or neither, for the committed table alone. */
  readonly specDirectory: string | undefined;
}

/** The flags that take a directory. */
const DIRECTORY_FLAGS: ReadonlySet<string> = new Set(["--fetch", "--spec-dir"]);

/**
 * Read the generator's arguments, refusing anything it would otherwise have to guess at.
 *
 * @param argv the arguments after the script path
 * @returns what to do, or why the command line names no one thing
 */
export function parseGoogleSecopsGeneratorArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<GoogleSecopsGeneratorArgs> {
  const directories = new Map<string, string>();
  let verifyOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--verify") {
      verifyOnly = true;
      continue;
    }
    if (!DIRECTORY_FLAGS.has(flag)) {
      return err([`unknown argument ${flag} — the generator takes --verify, --fetch <dir> and --spec-dir <dir>`]);
    }
    const directory = argv[index + 1];
    if (directory === undefined || directory.startsWith("--") || directories.has(flag)) {
      return err([`${flag} takes exactly one directory, given once`]);
    }
    directories.set(flag, directory);
    index += 1;
  }
  const fetchInto = directories.get("--fetch");
  const specGiven = directories.get("--spec-dir");
  if (fetchInto !== undefined && specGiven !== undefined) {
    return err(["--fetch and --spec-dir each name where the pinned files are read — give one"]);
  }
  if (fetchInto !== undefined) {
    return ok({ fetchInto, specDirectory: fetchInto, verifyOnly });
  }
  return ok({ fetchInto, specDirectory: specGiven, verifyOnly });
}
