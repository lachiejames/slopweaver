/**
 * Whether the code THIS INVOCATION is about to run has been superseded upstream — the pure half.
 *
 * ## The defect, measured
 *
 * A cmux seat runs the CLI out of its own worktree: the `slopweaver` shell function resolves
 * `git rev-parse --show-toplevel` and pins `SLOPWEAVER_CLI_DIR` to it, so every verb a seat types is that
 * seat's code. One seat sat 258 commits behind `origin/main`, and through
 * its own CLI `autonomy list` refused all 522 rows, `automation due` printed 47 REJECTED, and
 * `codex status --check` reported 1320 unreadable fallback receipts. Through main's binary, against the same
 * `$SLOPWEAVER_HOME` in the same minute: `autonomy list` reads, `automation due` reads 67 rows with zero
 * rejections, `codex status` refuses on UNREVIEWED. All three had been fixed upstream days earlier.
 *
 * The seat diagnosed a repository that no longer exists, and it cost three board rows, a p0 relay to the
 * pinned chair, two repair acts on live state that needed no repair, and a page published to the owner asserting
 * all of it.
 *
 * ## What actually goes wrong, stated precisely
 *
 * Not "old code" in general. **A seat runs PER-SEAT CODE against a SHARED, ALWAYS-CURRENT STATE HOME.**
 * `$SLOPWEAVER_HOME` is one directory for the whole machine — every seat's ledgers, receipts and board are
 * the same files, written by whichever seat is newest. The code interpreting them is whatever that seat's
 * worktree carries. So the failure is old code reading new state, which is why all three verbs lied in the
 * same direction: each reads a register whose writers had moved on. A verb touching no shared state cannot
 * fail this way however old it is.
 *
 * That is why the criterion here is an OVERLAP and not a distance. A commit-count threshold was weighed and
 * dropped: it contradicts the owner's standing ruling recorded in `../cmux/baseFreshness.ts` (*"sometimes
 * it's fine if your base is a little drifted depending on your changes"*), no measurable number maps a
 * commit count onto "this verb will lie" — commits-behind tracks the fleet's landing rate, not risk — and it
 * is simultaneously too loud (fires on `slack when` at 258 behind) and too quiet (silent on `autonomy list`
 * at 30). Measured on this repository at three realistic distances, the overlap criterion discriminates
 * where a threshold cannot (repro at the foot of this block):
 *
 * ```text
 *   behind   recipe  autonomy  codex  slack  compact
 *       10        1         0      1      2        0
 *       30        6         0      1     13        0
 *       80       36         5      2     43       14
 * ```
 *
 * ## The criterion
 *
 * For `slopweaver <noun> <verb>`, compare the seat's HEAD to the already-fetched trunk and ask whether the
 * commits it LACKS changed any path under the module trees that verb's own code reads. An overlap means the
 * code about to produce this verdict has been superseded — say so, naming the paths. No overlap, and the
 * seat stays quiet apart from one honest lower-bound line per session.
 *
 * The trees are DISCOVERED from the command directory's own import specifiers rather than guessed from the
 * noun, and that is not a refinement — it is what makes the guard fire on its own motivating case. `recipe`
 * has no `src/recipe`; its domain tree is `src/live/automation`, which is exactly where the evidence path
 * `src/live/automation/definitionStore.ts` lives. A noun-to-`src/<noun>` guess is silent on the incident this
 * module exists for.
 *
 * ## The hole, stated rather than discovered later
 *
 * Discovery is DEPTH ONE. A fix that lands in a module the verb reaches only transitively — and whose own
 * directory the command files never name — is invisible here. Closing that needs an import graph, which
 * `../devLint/namedObjectParamsHeap.ts`'s history warns is the expensive kind (the one gate needing a
 * whole-repo `ts.Program`, with a measured heap budget). So {@link staleSeatCadence} returns
 * `once-per-session` whenever the seat is behind at ALL with no overlap, and {@link staleSeatLines} says
 * "lower bound" in those words. **Silence from this module never means the seat is current.**
 *
 * Two further limits that are construction, not oversight. The comparison is against whatever trunk ref was
 * last fetched, so the true distance can only be LARGER — understating is the safe direction and the render
 * carries the ref's own age the way `../checkouts/freshness.ts`'s fetch clause does. And this guard is a
 * seat's own code: a seat stale enough to matter runs a stale copy of it, so it catches every seat cut after
 * it landed and nothing before.
 *
 * ## The hole in the OTHER direction, which is why the printed line is worded as it is
 *
 * Reducing an import to its directory over-reports by construction: the verb reads one file and the guard
 * watches its neighbours. That is deliberate where the neighbours are one module — the fix for a bug a
 * command names in `src/live/automation/definitionStore.ts` frequently lands in a sibling of it — and plainly
 * wrong where the directory is a REGISTRY of unrelated leaves, which {@link resolveImportPathspec} therefore
 * refuses to widen into. MEASURED against 105 command directories: 46 of them import a SIBLING
 * verb group, and 104 import `src/lib`. So the surviving over-report is bounded to genuine module
 * directories, and {@link staleSeatLines} says "inside the tree(s) this verb reads" rather than claiming the
 * verb reads each named path — a distinction the earlier wording collapsed, and the reason the review pass
 * on this branch (`overlap-is-exact`, r1) came back BROKEN.
 *
 * Reproduce the `autonomy` column — {@link verbModuleTrees} resolves that noun to exactly the six pathspecs
 * below (measured; the counts move as the trunk does, the DISCRIMINATION is what the table shows):
 *
 * ```bash
 * for b in main~10 main~30 main~80; do git diff --name-only "$b...origin/main" -- \
 *   src/cli/commands/autonomy src/autonomy src/lib/logger.ts \
 *   src/cli/defineCommand.ts src/cli/exitCodes.ts src/cli/parseFlags.ts | wc -l; done
 * ```
 *
 * Pure: every count and path a caller could only get by running git is passed in already-read.
 */
import { pathsOverlap } from "../cmux/baseFreshness.js";

/** How the seat's own tree stands for the verb it is about to run. */
export interface StaleSeatAssessment {
  /** Commits the trunk carries that this seat does not. */
  readonly behind: number;
  /** The changed paths that fall inside this verb's own module trees — the "you are about to be lied to" set. */
  readonly overlapping: readonly string[];
  /** How many trees were examined, so an empty overlap reads as evidence rather than as silence. */
  readonly treeCount: number;
}

/** How often a given assessment should be printed. */
export type StaleSeatCadence = "silent" | "once-per-session" | "every-invocation";

/** The environment variable that silences this advisory, shared with `bin/slopweaver`'s own `advise()`. */
export const ADVISORY_QUIET_ENV = "SLOPWEAVER_LAUNCHER_QUIET";

/**
 * Whether a directory holds unrelated leaves rather than one module, so widening an import into it would
 * watch code the verb does not read.
 *
 * Two shapes, each carrying its own measurement (105 command directories): another VERB GROUP
 * under `src/cli/commands/`, imported sideways by 46 of them — one verb reaching into another's module says
 * nothing about that group's other verbs — and `src/lib`, the leaf-utility directory 104 of them import, so
 * widening it would make an unrelated utility change fire the advisory on very nearly every verb there is.
 * Reproduce the second with `grep -rl 'from "../../../lib/' src/cli/commands | xargs -n1 dirname | sort -u |
 * wc -l`.
 */
function isRegistryDirectory({ directory }: { directory: string }): boolean {
  return directory === "src/lib" || directory.startsWith("src/cli/commands/");
}

/**
 * Resolve one relative import specifier, as written in a command file, to the repo-relative PATHSPEC the
 * guard hands to git.
 *
 * Three decisions live here. `.js` becomes `.ts` because this is ESM source importing its own emitted
 * extension. An import landing in a bounded module directory is reduced to that DIRECTORY, deliberately — a
 * fix often lands in a sibling of the file a command names, inside the same module, and naming only the
 * imported file would miss it.
 *
 * Widening is refused in exactly two shapes, and BOTH were measured wrong rather than reasoned about.
 * When the imported file’s directory is an ANCESTOR of the command directory, widening to it names a tree
 * that contains the verb and every sibling verb: `../../defineCommand.js` from `src/cli/commands/autonomy`
 * resolves to `src/cli/defineCommand.ts`, and widening that to `src/cli` made `autonomy list` report a
 * change in `src/cli/commands/github/landingCore.ts` as its own. When the directory is a REGISTRY of
 * unrelated leaves — another verb group, or `src/lib` — the same thing happens one level narrower:
 * `cmux todo list` named `src/cli/commands/supervisor/scratchCore.ts` as a path it reads, on the strength of
 * `takeover.ts`'s single `../supervisor/ownerTurnsRun.js` import, which no `cmux todo` code path touches.
 * Both were caught by running the real CLI; the pure tests had asserted the shape of the rule
 * rather than its effect, and the second survived a first fix aimed only at the first. Those imports keep
 * their FILENAME, which is precisely what the verb reads.
 *
 * @param fromDir the repo-relative directory the specifier was written in (`src/cli/commands/automation`)
 * @param specifier the raw specifier text, without quotes (`../../../live/automation/definitionStore.js`)
 * @returns the pathspec, or `undefined` when the specifier is not a relative import landing under `src/`
 */
export function resolveImportPathspec({
  fromDir,
  specifier,
}: {
  fromDir: string;
  specifier: string;
}): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const segments: string[] = [];
  for (const segment of [...fromDir.split("/"), ...specifier.split("/")]) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const resolved = segments.join("/").replace(/\.js$/u, ".ts");
  if (!resolved.startsWith("src/")) {
    return undefined;
  }
  const directory = segments.slice(0, -1).join("/");
  if (directory === fromDir) {
    // The verb's own command directory, which is already the first tree — return it so the set dedupes
    // rather than gaining a redundant filename under a pathspec that covers it.
    return directory;
  }
  const widensPastTheVerb = fromDir.startsWith(`${directory}/`);
  if (widensPastTheVerb || isRegistryDirectory({ directory })) {
    return resolved;
  }
  return directory;
}

/**
 * The module trees one verb's code reads — its own command directory, plus every directory its command
 * files import directly.
 *
 * @param noun the CLI noun being dispatched, which names its command directory
 * @param specifiers every import specifier found in that directory's files, in any order
 * @returns the deduplicated pathspecs, the command directory always first
 */
export function verbModuleTrees({
  noun,
  specifiers,
}: {
  noun: string;
  specifiers: readonly string[];
}): readonly string[] {
  const commandDir = `src/cli/commands/${noun}`;
  const trees = new Set<string>([commandDir]);
  for (const specifier of specifiers) {
    const pathspec = resolveImportPathspec({ fromDir: commandDir, specifier });
    if (pathspec !== undefined) {
      trees.add(pathspec);
    }
  }
  return [...trees];
}

/**
 * Assess one invocation: how far behind the seat is, and which of the changed paths land in this verb's
 * own trees.
 *
 * @param behind commits the trunk carries that this seat does not
 * @param changedPaths the paths those commits changed
 * @param trees the verb's module trees (see {@link verbModuleTrees})
 * @returns the assessment
 */
export function staleSeatAssessment({
  behind,
  changedPaths,
  trees,
}: {
  behind: number;
  changedPaths: readonly string[];
  trees: readonly string[];
}): StaleSeatAssessment {
  const overlapping = changedPaths.filter((changed) => trees.some((tree) => pathsOverlap({ changed, docPath: tree })));
  return { behind, overlapping: [...new Set(overlapping)], treeCount: trees.length };
}

/**
 * How often this assessment should be printed.
 *
 * An overlap prints every single time, because every one of those invocations is a verdict computed by
 * superseded code. Drift with no overlap prints ONCE per session: it is the honest statement that the
 * overlap test is a lower bound (see this module's header), and repeating it on every call would train a
 * reader to ignore the loud case too.
 *
 * @param assessment the measured invocation
 * @returns the cadence
 */
export function staleSeatCadence({ assessment }: { assessment: StaleSeatAssessment }): StaleSeatCadence {
  if (assessment.behind === 0) {
    return "silent";
  }
  return assessment.overlapping.length === 0 ? "once-per-session" : "every-invocation";
}

/** How stale the compared ref itself is, so a report never claims to be fresher than its own evidence. */
function fetchAgeClause({ fetchedAtMs, nowMs }: { fetchedAtMs: number | undefined; nowMs: number }): string {
  if (fetchedAtMs === undefined) {
    return "last fetch: unknown — the true distance can only be larger";
  }
  const minutes = Math.max(0, Math.round((nowMs - fetchedAtMs) / 60_000));
  return `last fetch: ${String(minutes)} min ago`;
}

/** How many overlapping paths one advisory names before it stops listing and says how many it held back. */
export const OVERLAP_PATHS_SHOWN = 5;

/**
 * Render one assessment as the lines the CLI prints to stderr before the verb runs.
 *
 * @param assessment the measured invocation
 * @param noun the CLI noun being dispatched
 * @param verb the CLI verb being dispatched
 * @param upstreamRef the trunk ref the seat was compared against
 * @param fetchedAtMs when that ref was last fetched, or undefined when it could not be read
 * @param nowMs the current wall-clock, passed in so this stays pure
 * @returns the lines to print, empty when the seat is current
 */
export function staleSeatLines({
  assessment,
  noun,
  verb,
  upstreamRef,
  fetchedAtMs,
  nowMs,
}: {
  assessment: StaleSeatAssessment;
  noun: string;
  verb: string;
  upstreamRef: string;
  fetchedAtMs: number | undefined;
  nowMs: number;
}): readonly string[] {
  const cadence = staleSeatCadence({ assessment });
  if (cadence === "silent") {
    return [];
  }
  const head = `slopweaver ${noun} ${verb}: this seat is ${String(assessment.behind)} commit(s) behind ${upstreamRef}`;
  const age = `  ${fetchAgeClause({ fetchedAtMs, nowMs })}`;
  if (cadence === "once-per-session") {
    return [
      head,
      `  none of the ${String(assessment.treeCount)} tree(s) this verb reads changed upstream — but that is a LOWER BOUND:`,
      "  the check is depth-one, so a fix in a module this verb reaches only transitively is invisible to it",
      age,
    ];
  }
  const shown = assessment.overlapping.slice(0, OVERLAP_PATHS_SHOWN);
  const heldBack = assessment.overlapping.length - shown.length;
  const more = heldBack === 0 ? [] : [`    …and ${String(heldBack)} more`];
  return [
    head,
    `  and it changed ${String(assessment.overlapping.length)} path(s) inside the tree(s) this verb reads:`,
    ...shown.map((path) => `    ${path}`),
    ...more,
    "  the verdict below is computed by code that has been superseded — confirm it against the trunk before acting on it",
    age,
  ];
}
