/**
 * An atlas capability row DERIVES what it advertises, instead of declaring it and hoping.
 *
 * The rule: a profile reads answerability, so a capability fails closed until a generation has earned it.
 * This is the second half of that rule.
 *
 * ## The failure this closes
 *
 * MEASURED on the live install: `capability-profile.json` held **dozens of rows with
 * `sourceClass: atlas`, every one `truthMode: current`, `availability: available`**, and `coverage.kind` /
 * `freshness.kind` were hand-written fields nothing computed. Nothing in `src/route/` read an atlas
 * manifest, a coverage cell or `atlas/kit/answerable.ts`. So whatever a sync had actually acquired, every
 * row kept advertising itself as current, available truth — and the live instance was not hypothetical:
 * `atlas doctor` reported `vanta ANSWERABLE <n> entities`, thousands of them, while its `audit` kind, an `authoritative`
 * surface, had `lastAttempt: null` and had never been acquired at all. Reproduce the count on any install:
 *
 * ```bash
 * python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.slopweaver/capability-profile.json')));print(sum(1 for c in d['capabilities'] if c['sourceClass']=='atlas'))"
 * ```
 *
 * ## Why the reading is injected rather than read here
 *
 * `src/route/` plans; it calls no source. Importing the atlas registry to grade a generation would make
 * planning perform I/O and would couple the router to every platform's Zod model. So a caller grades the
 * atlases it cares about and hands the gradings in as data — the same shape `atlas doctor` already
 * produces — and everything below stays pure and testable with a literal.
 *
 * ## What it does NOT touch
 *
 * `truthMode` stays as declared. An atlas IS a current-truth source by kind, and a mostly-empty one is a
 * current-truth source that cannot answer much — which is what `availability` and `coverage` are for.
 * Rewriting `truthMode` to `history` would make an empty atlas outrank the corpus on a history
 * question, which is a second, worse dishonesty.
 */
import { type SourceCapability, type SourceCoverage } from "./profile.js";

/**
 * What one atlas's published generation was graded as — `atlas/kit/answerable.ts`'s verdict, restated
 * structurally so this module imports no atlas code.
 */
export interface AtlasRouteReading {
  readonly platform: string;
  readonly grade: "answerable" | "dark" | "unpublished";
  /** One sentence the grading already wrote, printed unchanged rather than paraphrased. */
  readonly because: string;
  /** Kinds this credential is fenced out of — a grant would fill them. */
  readonly permissionBlockedKinds: readonly string[];
  /** Kinds the provider answered this organisation has no such product for — nothing would fill them. */
  readonly productAbsentKinds: readonly string[];
  /** Kinds an attempt reached for and never acquired — a FIX would fill them. */
  readonly gapKinds: readonly string[];
  /** Kinds no run has ever attempted — nothing is broken and nothing is fenced. */
  readonly notAttemptedKinds: readonly string[];
}

/**
 * Which atlas a capability row reads, taken from the command it would run.
 *
 * The argv is the only place the platform appears — a row carries no `platform` field, and adding one would
 * put a private installation's provider names into a second place that can disagree with the first. Every
 * atlas row's command runs `… atlas <platform> …`, which is the verb surface this repository owns.
 *
 * @param capability the row to inspect
 * @returns the platform token, or `null` when this row is not an atlas read
 */
export function atlasPlatformOf({ capability }: { capability: SourceCapability }): string | null {
  if (capability.sourceClass !== "atlas") {
    return null;
  }
  const at = capability.command.indexOf("atlas");
  if (at === -1) {
    return null;
  }
  // A command whose argv ends at `atlas` names no platform after the noun, so the row reads no atlas.
  const platform = capability.command[at + 1];
  if (platform === undefined) {
    return null;
  }
  return platform;
}

/**
 * The coverage an answerable generation has actually earned.
 *
 * The four ways a kind can hold nothing are reported SEPARATELY and in a fixed order, because the owner's
 * rule is that an agent must never have to guess which of them it is looking at. Each clause names
 * the remedy rather than only the symptom, because that is what distinguishes them to a reader: a grant, a
 * fix, or a run that has not happened yet. `atlas/kit/kindReason.ts` decides which a kind is; this
 * function only prints it.
 *
 * @param declared the coverage the row declared, kept when the generation supports it
 * @param reading the grading for this row's atlas
 * @returns the coverage to advertise
 */
function derivedCoverage({
  declared,
  reading,
}: {
  declared: SourceCoverage;
  reading: AtlasRouteReading;
}): SourceCoverage {
  const clauses: string[] = [];
  if (reading.permissionBlockedKinds.length > 0) {
    clauses.push(
      `${String(reading.permissionBlockedKinds.length)} surface(s) this credential is not permitted to read` +
        ` (${reading.permissionBlockedKinds.join(", ")}) — reachable if the permissions are widened, not missing`,
    );
  }
  if (reading.productAbsentKinds.length > 0) {
    clauses.push(
      `${String(reading.productAbsentKinds.length)} surface(s) this organisation has no such product for` +
        ` (${reading.productAbsentKinds.join(", ")}) — excluded as unreachable, not missing`,
    );
  }
  if (reading.gapKinds.length > 0) {
    clauses.push(
      `${String(reading.gapKinds.length)} surface(s) attempted and never acquired, with no permission` +
        ` boundary explaining it (${reading.gapKinds.join(", ")}) — a fix, not a grant`,
    );
  }
  if (reading.notAttemptedKinds.length > 0) {
    clauses.push(
      `${String(reading.notAttemptedKinds.length)} surface(s) no run has ever attempted` +
        ` (${reading.notAttemptedKinds.join(", ")}) — nothing is broken and nothing is fenced`,
    );
  }
  if (clauses.length === 0) {
    return declared;
  }
  return { detail: `${declared.detail}; ${clauses.join("; ")}`, kind: "bounded" };
}

/**
 * Rewrite one capability row from what its atlas actually published.
 *
 * A row whose atlas cannot answer is made `unavailable` and its command is CLEARED, because
 * `sourceCapabilitySchema` refuses an unavailable row that still carries a runnable command — an
 * unavailable source that a plan can still invoke is the ambiguity the schema exists to prevent.
 *
 * @param capability the row as declared
 * @param reading the grading for the atlas it reads, or `undefined` when nothing graded it
 * @returns the row to plan with
 * @internal
 */
export function deriveAtlasCapability({
  capability,
  reading,
}: {
  capability: SourceCapability;
  reading: AtlasRouteReading | undefined;
}): SourceCapability {
  if (reading === undefined || capability.availability.kind === "unavailable") {
    return capability;
  }
  if (reading.grade === "answerable") {
    return { ...capability, coverage: derivedCoverage({ declared: capability.coverage, reading }) };
  }
  return {
    ...capability,
    availability: {
      kind: "unavailable",
      reason: `the ${reading.platform} atlas cannot answer: ${reading.because}`,
    },
    command: [],
    coverage: { detail: reading.because, kind: "unknown" },
  };
}

/**
 * Apply {@link deriveAtlasCapability} to every atlas row in a table, leaving every other row untouched.
 *
 * @param capabilities the merged capability table
 * @param readings one grading per platform, keyed by platform name
 * @returns the table with every atlas row derived from its own generation
 */
export function deriveAtlasCapabilities({
  capabilities,
  readings,
}: {
  capabilities: readonly SourceCapability[];
  readings: ReadonlyMap<string, AtlasRouteReading>;
}): readonly SourceCapability[] {
  return capabilities.map((capability) => {
    const platform = atlasPlatformOf({ capability });
    if (platform === null) {
      return capability;
    }
    return deriveAtlasCapability({ capability, reading: readings.get(platform) });
  });
}
