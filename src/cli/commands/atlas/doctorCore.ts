/**
 * Pure argument handling, grading and rendering for `slopweaver atlas doctor` — the verification an atlas
 * pull request owes, with no bot and no credential.
 *
 * ## What this verb is FOR
 *
 * An atlas nothing can use is decorative, so done means seeing the atlas
 * work through the bot in the real world, without spinning a bot up per atlas, which is heavy-handed.
 * This is the lighter half: it asks every registered atlas the ONE question
 * the bot's first turn would ask it, through the very same read path, and grades the answer.
 *
 * It does not replace using an atlas for a real question, and the definition of done says so. It makes the
 * failure that produced the steer — twelve atlases holding real data and answering nothing — impossible to
 * ship past unnoticed, which no amount of reviewing a diff was going to do.
 *
 * Rendering lives here rather than in the shell so every line is testable without a home directory.
 */
import type { AtlasAnswerGrade } from "../../../atlas/kit/answerable.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type AtlasCommandError, AtlasCommandErrors } from "./errors.js";

/** Every flag this verb accepts. */
const ATLAS_DOCTOR_FLAGS: FlagSpec = {
  boolean: ["json", "repair"],
  string: ["home"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const ATLAS_DOCTOR_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_DOCTOR_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_DOCTOR_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_DOCTOR_USAGE =
  "usage: slopweaver atlas doctor [<platform>] [--repair] [--json] [--home <dir>]\n" +
  "  <platform>   grade one atlas; omitted grades every atlas this build has\n" +
  "  --repair     rewrite any generation still in the pre-`.jsonl` on-disk layout, archiving the old\n" +
  "               documents under _superseded; makes no network call and fetches nothing\n" +
  "  reads only what a sync already stored, through the same read path the bot uses\n" +
  "  exits non-zero when an atlas holds a generation it cannot read back, and — when a platform is\n" +
  "  NAMED — when that atlas cannot answer at all\n" +
  "  prints, per atlas, which kinds are fenced by permissions, which were attempted and never acquired,\n" +
  "  which no run has tried, and which hold only records an AUTHORITATIVE surface never revealed — a kind\n" +
  "  that can be FULL and still establish the platform offers a thing and nothing about what this\n" +
  "  organisation holds; a permission boundary is the atlas working and never fails this verb";

/** The resolved invocation.
 * @internal
 */
export interface AtlasDoctorOptions {
  readonly platform: string | undefined;
  readonly repair: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * How one atlas graded, in the shape both the table and the `--json` report are built from.
 *
 * `unreadable` is this verb's own grade rather than `kit/answerable.ts`'s: an atlas whose STORE refuses —
 * a foreign schema version, a file that will not parse — never produces a snapshot to grade, and collapsing
 * that into `dark` would report a corrupt generation as a format problem.
 */
export interface AtlasDoctorRow {
  readonly platform: string;
  readonly grade: AtlasAnswerGrade | "unreadable";
  readonly readable: number;
  readonly vouchedFor: number;
  readonly darkKinds: readonly string[];
  /**
   * Kinds this credential is not permitted to read, and the two ways of holding nothing that are NOT that.
   *
   * Declared on the row rather than left to ride in on the spread of `gradeAtlasAnswerability`'s result,
   * because `--json` publishes this row and a field nothing declares is a field nothing can be relied on.
   * The rule (`atlas/kit/kindReason.ts` carries it verbatim): this verb is where an agent
   * asks whether an atlas is usable, so it is the last place a permission boundary may be left implicit.
   */
  readonly permissionBlockedKinds: readonly string[];
  /** Kinds the provider answered this organisation has no such product for — nothing would fill them. */
  readonly productAbsentKinds: readonly string[];
  /** Kinds attempted and never acquired, with no boundary explaining it — a fix, not a grant. */
  readonly gapKinds: readonly string[];
  /** Kinds no run has ever attempted — neither broken nor fenced. */
  readonly notAttemptedKinds: readonly string[];
  /**
   * Kinds holding records that answer about the PLATFORM and not about this organisation's estate.
   *
   * The fourth member of the family above, and the only one that fires on a kind that is FULL. The
   * Datadog atlas's `monitor` kind held only SDK operations and no monitor while this verb printed
   * `datadog ANSWERABLE` over thousands of entities — the criterion, the measurement and why it is generic are in
   * `atlas/kit/estateEvidence.ts`.
   */
  readonly estateNotEstablishedKinds: readonly string[];
  readonly because: string;
  /** What `--repair` did to this atlas, when it ran and found something to do. */
  readonly repairedKinds: readonly string[];
}

/**
 * Parse the verb's tail.
 *
 * @param rest the argv tail after `atlas doctor`
 * @returns the resolved invocation, or every reason it cannot be run
 */
export function parseAtlasDoctorArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<AtlasDoctorOptions, AtlasCommandError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: ATLAS_DOCTOR_FLAGS });
  if (parsed.isErr()) {
    return err(AtlasCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  if (positionals.length > 1) {
    return err(AtlasCommandErrors.doctorMultiplePlatforms({ platforms: positionals }));
  }
  const home = values["home"];
  const platform = positionals[0];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    platform,
    repair: values["repair"] === true,
  });
}

/** A grade that means this atlas cannot answer a question today. */
const UNUSABLE: readonly AtlasDoctorRow["grade"][] = ["dark", "unpublished", "unreadable"];

/**
 * A grade that means an atlas holds a generation it cannot read back — the state a pull request must never
 * introduce, as opposed to an atlas nobody has synced on this machine.
 */
const BROKEN: readonly AtlasDoctorRow["grade"][] = ["dark", "unreadable"];

/**
 * Whether the run failed, and why.
 *
 * A sweep is graded on BREAKAGE only: an atlas nobody has synced on this install is not a defect, and a
 * sweep that went red for every unsynced platform would be red permanently and therefore ignored. Naming a
 * platform is the opposite question — "is the atlas I just shipped usable" — so there, anything but an
 * answerable atlas fails.
 *
 * **A permission boundary never fails this verb, in either mode**, and that is the ruling rather
 * than a leniency: a surface the owner's credential does not open is the atlas working correctly, so failing on one
 * would make the fleet chase a grant as though it were a bug. `kindReasonLines` is where a boundary is
 * reported, and reporting is all it does.
 *
 * @param rows every atlas graded
 * @param named whether the caller named one platform rather than sweeping
 * @returns the platforms that fail this run, in the order they were graded
 */
export function atlasDoctorFailures({
  rows,
  named,
}: {
  rows: readonly AtlasDoctorRow[];
  named: boolean;
}): readonly AtlasDoctorRow[] {
  const failing = named ? UNUSABLE : BROKEN;
  return rows.filter((row) => failing.includes(row.grade));
}

/**
 * The `--json` report: the rows, plus the verdict a caller would otherwise recompute.
 *
 * @param rows every atlas graded
 * @param named whether the caller named one platform rather than sweeping
 * @returns the rows, the platforms failing this run, and whether the run passed
 */
export function atlasDoctorJson({ rows, named }: { rows: readonly AtlasDoctorRow[]; named: boolean }): {
  atlases: readonly AtlasDoctorRow[];
  failing: readonly string[];
  ok: boolean;
} {
  const failures = atlasDoctorFailures({ named, rows });
  return { atlases: rows, failing: failures.map((row) => row.platform), ok: failures.length === 0 };
}

/** The one-word column, padded so the reasons line up. */
function gradeLabel({ grade }: { grade: AtlasDoctorRow["grade"] }): string {
  return grade.toUpperCase().padEnd("unpublished".length);
}

/**
 * How many kind names one reason line spells before it starts counting instead.
 *
 * The other three classes name every kind because they are small by construction — a fenced or
 * never-attempted kind is the exception in an atlas. This one is not, and a live pass is not what shrinks
 * it: MEASURED, all but three of the Datadog atlas's kinds stand in this class AFTER a full
 * live pass, because filling an operation entity's `api` channel annotates a declaration rather than
 * revealing a record. The three that clear are the three `estateAcquisition.ts` fills. So the honest line
 * is a sample plus a remainder. Re-derive the width that matters with
 * `slopweaver atlas doctor --json | grep -o '"estateNotEstablishedKinds":\[[^]]*\]'`.
 */
const KIND_SAMPLE_CAP = 8;

/**
 * Name a few kinds and count the rest, so one class cannot turn the sweep into a wall of text.
 *
 * @param kinds the kind names to report, already sorted
 * @returns the sample, with an explicit remainder when the list was capped
 */
function kindSample({ kinds }: { kinds: readonly string[] }): string {
  if (kinds.length <= KIND_SAMPLE_CAP) {
    return kinds.join(", ");
  }
  const shown = kinds.slice(0, KIND_SAMPLE_CAP).join(", ");
  return `${shown}, and ${String(kinds.length - KIND_SAMPLE_CAP)} more`;
}

/**
 * The reachability lines one atlas earns, printed under its grade.
 *
 * A grade is one word about the WHOLE atlas, and the ruling is about a kind: an agent
 * never has to guess whether coverage is missing because the atlas is wrong or because of
 * permissions. An atlas can be ANSWERABLE and still be fenced out of half its surfaces, so the grade
 * alone cannot carry that — these lines can, and each one names its own remedy rather than only its
 * symptom, so the three never read alike.
 *
 * Emitted only when non-empty, so a fully-reachable atlas stays one line and the sweep stays scannable.
 *
 * @param row the atlas as it graded
 * @returns the lines to print beneath this atlas's own, in a fixed order, possibly none
 */
function kindReasonLines({ row }: { row: AtlasDoctorRow }): readonly string[] {
  const lines: string[] = [];
  if (row.permissionBlockedKinds.length > 0) {
    lines.push(
      `  ${row.platform}: ${String(row.permissionBlockedKinds.length)} kind(s) NOT PERMITTED under the` +
        ` current credential (${row.permissionBlockedKinds.join(", ")}) — a grant would fill them, the` +
        ` atlas is not missing them`,
    );
  }
  if (row.productAbsentKinds.length > 0) {
    lines.push(
      `  ${row.platform}: ${String(row.productAbsentKinds.length)} kind(s) this organisation has NO SUCH PRODUCT` +
        ` for (${row.productAbsentKinds.join(", ")}) — excluded as unreachable, the atlas is not missing them`,
    );
  }
  if (row.gapKinds.length > 0) {
    lines.push(
      `  ${row.platform}: ${String(row.gapKinds.length)} kind(s) attempted and never acquired, with no` +
        ` permission boundary explaining it (${row.gapKinds.join(", ")}) — a fix, not a grant`,
    );
  }
  if (row.notAttemptedKinds.length > 0) {
    lines.push(
      `  ${row.platform}: ${String(row.notAttemptedKinds.length)} kind(s) no run has ever attempted` +
        ` (${row.notAttemptedKinds.join(", ")}) — neither broken nor fenced`,
    );
  }
  if (row.estateNotEstablishedKinds.length > 0) {
    lines.push(
      `  ${row.platform}: ${String(row.estateNotEstablishedKinds.length)} kind(s) NOT ANSWERABLE ABOUT THE` +
        " ESTATE — every record they hold was declared by a discovery surface, and an authoritative one has" +
        " never revealed one that a declaration did not already carry, so they establish that the platform" +
        " offers these and nothing about what this organisation holds" +
        ` (${kindSample({ kinds: row.estateNotEstablishedKinds })}); an authoritative pass is what fills them`,
    );
  }
  return lines;
}

/**
 * Render the table a reader sees.
 *
 * @param rows every atlas graded
 * @param named whether the caller named one platform rather than sweeping
 * @returns the lines, in order, without trailing newlines
 */
export function renderAtlasDoctor({
  rows,
  named,
}: {
  rows: readonly AtlasDoctorRow[];
  named: boolean;
}): readonly string[] {
  const width = Math.max(...rows.map((row) => row.platform.length), 1);
  const lines = rows.flatMap((row) => [
    `${row.platform.padEnd(width)}  ${gradeLabel({ grade: row.grade })}  ${row.because}`,
    ...kindReasonLines({ row }),
  ]);
  const fenced = rows.reduce((total, row) => total + row.permissionBlockedKinds.length, 0);
  if (fenced > 0) {
    lines.push(
      `${String(fenced)} kind(s) across ${String(rows.filter((row) => row.permissionBlockedKinds.length > 0).length)}` +
        ` atlas(es) are fenced by permissions, not missing — each names the grant that would lift it`,
    );
  }
  const repaired = rows.filter((row) => row.repairedKinds.length > 0);
  for (const row of repaired) {
    lines.push(`repaired ${row.platform}: ${row.repairedKinds.join(", ")}`);
  }
  const failures = atlasDoctorFailures({ named, rows });
  if (failures.length === 0) {
    lines.push(`${String(rows.length)} atlas(es) graded, none broken`);
    return lines;
  }
  lines.push(
    `${String(failures.length)} of ${String(rows.length)} atlas(es) cannot answer: ${failures
      .map((row) => row.platform)
      .join(", ")}`,
  );
  return lines;
}
