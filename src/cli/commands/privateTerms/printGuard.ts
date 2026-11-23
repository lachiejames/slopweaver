/**
 * Every line a `private-terms` verb prints, judged against the home's private terms as they stand when it prints.
 *
 * The verbs build their lines from ids, counts and paths, and the meaning and where-it-is-fine already pass
 * `printableUnderTerms` on their own. A path is the one value built from outside: the state home is the owner's
 * choice, so a term can match it. This edge closes that whole class rather than one line: a line any term matches
 * prints as `WITHHELD_REFUSAL_LINE`, which no term may match. The terms are loaded on each line, so the line
 * `confirm` prints is judged against the row it just landed. A file that does not load has no terms to withhold
 * against, and its own refusal names a path and a line number, never a pattern.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { loadPrivateTerms, type PrivateTerm, printableUnderTerms } from "../../../hygiene/privateTerms.js";

/** The two print edges every private-terms verb holds. */
export interface PrivateTermsPrintEdges {
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
}

/**
 * Pure: one printed line as it may leave, each of its own lines judged and then the whole once more.
 *
 * @param line what a verb is about to print, possibly several lines joined
 * @param terms the loaded terms
 * @returns the line, with any line a term matches as the withheld stand-in
 */
export function linePrintedUnderTerms({ line, terms }: { line: string; terms: readonly PrivateTerm[] }): string {
  const judged = line
    .split("\n")
    .map((piece) => printableUnderTerms({ line: piece, terms }))
    .join("\n");
  return printableUnderTerms({ line: judged, terms });
}

/**
 * Pure: every state home a verb's argv could act on, the environment's first and then each `--home` it names, in
 * either spelling. A verb's own parse picks one of them; the guard judges against all, so help, a usage refusal
 * and a malformed flag are guarded before any parse has run.
 *
 * @param argv the verb's arguments as given
 * @param ambient the home the environment resolves to
 * @returns the homes, the ambient one first
 */
export function homesNamedInArgv({ argv, ambient }: { argv: readonly string[]; ambient: string }): readonly string[] {
  const named: string[] = [];
  argv.forEach((arg, index) => {
    const next = argv[index + 1];
    if (arg === "--home" && next !== undefined) {
      named.push(next);
    }
    if (arg.startsWith("--home=")) {
      named.push(arg.slice("--home=".length));
    }
  });
  return [ambient, ...named];
}

/**
 * The same edges, every line judged first against the private terms of every home the verb's argv could act on.
 * A verb wraps its edges with this on its first line, before help or a usage refusal can print.
 *
 * @param deps the verb's edges; every other field is kept as given
 * @param argv the verb's arguments, read for each `--home` they name
 * @returns the edges, guarded
 */
export function printEdgesUnderArgvHomes<T extends PrivateTermsPrintEdges>({
  deps,
  argv,
}: {
  deps: T;
  argv: readonly string[];
}): T {
  return printEdgesUnderHomeTerms({ deps, homes: homesNamedInArgv({ ambient: slopweaverHome(), argv }) });
}

/**
 * The same edges, every line judged against each named home's private terms first.
 *
 * @param deps the verb's edges; every other field is kept as given
 * @param homes the state homes whose terms a line is judged against
 * @returns the edges, guarded
 * @internal
 */
export function printEdgesUnderHomeTerms<T extends PrivateTermsPrintEdges>({
  deps,
  homes,
}: {
  deps: T;
  homes: readonly string[];
}): T {
  const guard = ({ line }: { line: string }): string =>
    homes.reduce((judged, home) => {
      const load = loadPrivateTerms({ home });
      if (load.kind !== "loaded") {
        return judged;
      }
      return linePrintedUnderTerms({ line: judged, terms: load.terms });
    }, line);
  return {
    ...deps,
    out: ({ line }) => {
      deps.out({ line: guard({ line }) });
    },
    writeDiagnostic: ({ line }) => {
      deps.writeDiagnostic({ line: guard({ line }) });
    },
  };
}
