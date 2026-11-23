/**
 * The coverage floor's own typed error union — the `<Domain>Error` + `<Domain>Errors` pair
 * `.claude/rules/error-handling.md` mandates, for the one bounded module made of `coverageFloor.ts` and
 * `coverageRatchet.ts`.
 *
 * It exists because the floor's failures multiplied past the line that rule draws. This change added two
 * more of them — a per-file summary entry that carries no statement counts, and one that sits outside the
 * repository root — and `error-shape-threshold` refused the directory for it, which is exactly the boundary
 * that gate was built to hold. Fourteen plain shapes moved in here rather than a fifteenth being added to a
 * list, so `src/devLint`'s standing debt falls instead of growing. Reproduce the count:
 * `yarn tsx src/devLint/errorShapeThreshold.entry.ts`.
 *
 * Nothing branches on `code` today — every one of these is displayed by the gate's shell and by nothing
 * else. The code is carried anyway because it is what a caller would branch on, and because a variant added
 * without one would be the first crack in the union the directory now has.
 */

/** A summary or floor file that could not be parsed at all, or whose decoded shape is not the one expected. */
export interface FloorMalformedError {
  readonly code: "FLOOR_MALFORMED";
  readonly message: string;
  readonly file: "summary" | "baseline";
}

/** One per-file entry in a V8 summary that the per-directory aggregation cannot use. */
export interface SummaryFileEntryError {
  readonly code: "SUMMARY_FILE_ENTRY";
  readonly message: string;
  readonly path: string;
}

/** A rebaseline asked to record a fall — a policy refusal of the write, not a failure to read anything. */
export interface RebaselineWouldLowerError {
  readonly code: "REBASELINE_WOULD_LOWER";
  readonly message: string;
  readonly subjects: readonly string[];
}

/** The floor file in the working tree: absent, or present and unreadable. */
export interface FloorFileError {
  readonly code: "FLOOR_FILE";
  readonly message: string;
  readonly path: string;
}

/** The floor as it exists at the comparison commit: unreachable commit, missing path, or unreadable blob. */
export interface FloorAtCommitError {
  readonly code: "FLOOR_AT_COMMIT";
  readonly message: string;
  readonly sha: string;
}

/** The source tree coverage includes could not be listed, so a partial report cannot be told from a whole one. */
export interface SourceTreeUnreadableError {
  readonly code: "SOURCE_TREE_UNREADABLE";
  readonly message: string;
}

/** Every way reading or writing a coverage floor can fail. */
export type CoverageFloorError =
  | FloorMalformedError
  | SummaryFileEntryError
  | RebaselineWouldLowerError
  | FloorFileError
  | FloorAtCommitError
  | SourceTreeUnreadableError;

/** The committed floor, repo-relative. Named once — it is both a filesystem path and a git pathspec. */
export const BASELINE_FILE = "coverage-baseline.json";

/** Every failure the coverage floor can report, constructed here and nowhere else. */
export const CoverageFloorErrors = {
  baselineMalformed: ({ detail }: { detail: string }): FloorMalformedError => ({
    code: "FLOOR_MALFORMED",
    file: "baseline",
    message: `coverage baseline: ${detail}`,
  }),
  baselineShape: (): FloorMalformedError => ({
    code: "FLOOR_MALFORMED",
    file: "baseline",
    message:
      "coverage baseline: unexpected shape (expected version + summary.{branches,functions,lines,statements} + directories.<dir>.statements)",
  }),
  fileAbsent: ({ path }: { path: string }): FloorFileError => ({
    code: "FLOOR_FILE",
    message: `floor file missing at ${path}`,
    path,
  }),
  fileMalformed: ({ detail, path }: { detail: string; path: string }): FloorFileError => ({
    code: "FLOOR_FILE",
    message: `${detail} (at ${path})`,
    path,
  }),
  fileUnreadable: ({ path, reason }: { path: string; reason: string }): FloorFileError => ({
    code: "FLOOR_FILE",
    message: `floor file at ${path} is unreadable: ${reason}`,
    path,
  }),
  rebaselineWouldLower: ({ subjects }: { subjects: readonly string[] }): RebaselineWouldLowerError => ({
    code: "REBASELINE_WOULD_LOWER",
    message: `rebaseline refused — would lower: ${subjects.join(", ")}`,
    subjects,
  }),
  shaMalformed: ({ detail, sha }: { detail: string; sha: string }): FloorAtCommitError => ({
    code: "FLOOR_AT_COMMIT",
    message: `${BASELINE_FILE} at commit ${sha} is malformed: ${detail}`,
    sha,
  }),
  shaPathMissing: ({ sha }: { sha: string }): FloorAtCommitError => ({
    code: "FLOOR_AT_COMMIT",
    message: `${BASELINE_FILE} does not exist at commit ${sha}`,
    sha,
  }),
  shaUnreachable: ({ sha }: { sha: string }): FloorAtCommitError => ({
    code: "FLOOR_AT_COMMIT",
    message: `commit ${sha} is unreachable in this checkout — fetch it (CI: git fetch --no-tags --depth=1 origin ${sha})`,
    sha,
  }),
  shaUnreadable: ({ sha }: { sha: string }): FloorAtCommitError => ({
    code: "FLOOR_AT_COMMIT",
    message: `${BASELINE_FILE} at commit ${sha} could not be read`,
    sha,
  }),
  sourceTreeUnreadable: ({ reason }: { reason: string }): SourceTreeUnreadableError => ({
    code: "SOURCE_TREE_UNREADABLE",
    message: `could not list the source tree coverage includes: ${reason}`,
  }),
  summaryFileEntryCounts: ({ path }: { path: string }): SummaryFileEntryError => ({
    code: "SUMMARY_FILE_ENTRY",
    message: `coverage summary: file entry ${path} lacks statements.{covered,total}`,
    path,
  }),
  summaryFileEntryOutsideRoot: ({ path, root }: { path: string; root: string }): SummaryFileEntryError => ({
    code: "SUMMARY_FILE_ENTRY",
    message: `coverage summary: file entry ${path} is outside the root ${root}`,
    path,
  }),
  summaryMalformed: ({ detail }: { detail: string }): FloorMalformedError => ({
    code: "FLOOR_MALFORMED",
    file: "summary",
    message: `coverage summary: ${detail}`,
  }),
  summaryShape: (): FloorMalformedError => ({
    code: "FLOOR_MALFORMED",
    file: "summary",
    message: "coverage summary: unexpected shape (expected total.{branches,functions,lines,statements}.pct)",
  }),
} as const;
