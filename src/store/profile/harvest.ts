/**
 * What happens to the 90 history files in the owner's archived profile unit — the pure half.
 *
 * Useful data is used rather than re-derived in the store; data that is not useful is not carried. So the
 * answer is neither "ingest everything" nor "freeze it": it is a per-file disposition, and
 * this module is the manifest that carries one.
 *
 * ## Why a manifest rather than a heuristic
 *
 * "Useful" is a judgement about content and no rule computes it. A directory rule would be wrong in both
 * directions on this tree — `archive/team-model-2026-05.md` says in its own text to keep its rationale
 * after supersession, while `projects/e2e-overnight-KICKOFF-PROMPT.md` is an execution entrance whose
 * instructions ("never auto-undraft") CONTRADICT current doctrine and would be retrievable as advice. So
 * a human or a session decides, once, and writes the decision down with its reason.
 *
 * ## Why every entry is hash-pinned
 *
 * A manifest is a set of claims about files, and files move. Pinning each entry to the sha256 of the file
 * it judged means a manifest applied against a changed tree REFUSES rather than importing content nobody
 * read — which is the only way a disposition recorded weeks ago can still be trusted. It is also what
 * makes "dropped" auditable: the row names what was rejected and the hash proves which version.
 *
 * ## What "dropped" means, stated because the word is ambiguous
 *
 * Excluded from the import and from future profile context, with the reason recorded. It does NOT mean
 * deleting the original, wiping the `self` corpus lane, or removing rows already stored — the origin
 * survival constraint in `docs/constraints/hard.md` wants evidence before anything rebuilds or erases a
 * scanned lane, and a disposition is not that evidence.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

import { issuePath } from "./types.js";

/** The manifest-file version. A manifest at another version is refused, not reinterpreted. */
const HARVEST_MANIFEST_SCHEMA_VERSION = 1;

/** What a manifest says to do with one file. */
const harvestDispositionSchema = z.enum(["harvest", "drop"]);

/** Either keep the file's content reachable in the store, or exclude it with a reason. *
 * @internal
 */
export type HarvestDisposition = z.infer<typeof harvestDispositionSchema>;

/** One file's disposition, pinned to the version that was judged. */
const harvestEntrySchema = z.object({
  /** The file's path relative to the manifest's `root`. */
  path: z.string().min(1),
  /** The sha256 of the file as judged, so a changed tree refuses rather than importing unread content. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/u, "sha256 must be 64 lowercase hex characters"),
  disposition: harvestDispositionSchema,
  /** Why. Required on both dispositions — a keep with no reason is as unreviewable as a drop with none. */
  reason: z.string().min(1, "every entry needs a reason"),
  /** For a drop, what supersedes it, when something does. */
  replacedBy: z.string().default(""),
});

/** One file's disposition. *
 * @internal
 */
export type HarvestEntry = z.infer<typeof harvestEntrySchema>;

/** A whole disposition manifest. */
const harvestManifestSchema = z.object({
  schemaVersion: z.literal(HARVEST_MANIFEST_SCHEMA_VERSION),
  /** The absolute directory the paths are relative to — the owner's archived profile unit. */
  root: z.string().min(1),
  /** The subdirectories this manifest claims to cover completely. */
  covers: z.array(z.string().min(1)).min(1),
  entries: z.array(harvestEntrySchema),
});

/** A whole disposition manifest, parsed. */
export type HarvestManifest = z.infer<typeof harvestManifestSchema>;

/** One file as it actually stands on disk, which is what a manifest is checked against. */
export interface MeasuredFile {
  readonly path: string;
  readonly sha256: string;
}

/** A validated plan: which files to harvest, which to drop, and how many of each. */
export interface HarvestPlan {
  readonly harvest: readonly HarvestEntry[];
  readonly drop: readonly HarvestEntry[];
  readonly root: string;
}

/**
 * Parse a manifest, naming every schema issue at once.
 *
 * @param value the manifest file's contents, unvalidated
 * @returns the manifest, or every issue
 */
export function parseHarvestManifest({ value }: { value: unknown }): Result<HarvestManifest> {
  const parsed = harvestManifestSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issuePath({ path: issue.path })}: ${issue.message}`));
  }
  return ok(parsed.data);
}

/**
 * Check a manifest against what is actually on disk, refusing on any of four disagreements.
 *
 * All four are reported together rather than the first one, because a manifest is edited as a whole and a
 * validator that stops at the first problem costs one round trip per problem. The four are deliberately
 * symmetrical: a file the manifest does not mention, a file the manifest mentions that is not there, a
 * file whose content moved since it was judged, and the same file judged twice.
 *
 * @param manifest the parsed manifest
 * @param measured every file actually under the covered directories, with its current hash
 * @returns the plan, or every disagreement
 */
export function validateHarvestManifest({
  manifest,
  measured,
}: {
  manifest: HarvestManifest;
  measured: readonly MeasuredFile[];
}): Result<HarvestPlan> {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (seen.has(entry.path)) {
      problems.push(`${entry.path} is judged twice — one file, one disposition`);
    }
    seen.add(entry.path);
  }
  const onDisk = new Map(measured.map((file) => [file.path, file.sha256]));
  for (const entry of manifest.entries) {
    const actual = onDisk.get(entry.path);
    if (actual === undefined) {
      problems.push(`${entry.path} is in the manifest and not under ${manifest.root}`);
      continue;
    }
    if (actual !== entry.sha256) {
      problems.push(
        `${entry.path} has changed since it was judged (${entry.sha256.slice(0, 12)} → ${actual.slice(0, 12)})`,
      );
    }
  }
  for (const file of measured) {
    if (!seen.has(file.path)) {
      problems.push(`${file.path} is under a covered directory and no entry judges it`);
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    drop: manifest.entries.filter((entry) => entry.disposition === "drop"),
    harvest: manifest.entries.filter((entry) => entry.disposition === "harvest"),
    root: manifest.root,
  });
}

/**
 * The plan as lines, leading with the counts and then naming every drop.
 *
 * Drops are named individually and keeps are counted, because a keep is the default outcome and a drop is
 * a decision somebody has to be able to challenge. A report that summarised both would make the reviewable
 * half the hard half to read.
 *
 * @param plan the validated plan
 * @returns the report
 */
export function harvestPlanLines({ plan }: { plan: HarvestPlan }): readonly string[] {
  return [
    `harvest plan over ${plan.root}`,
    `  harvest: ${String(plan.harvest.length)} file(s)`,
    `  drop:    ${String(plan.drop.length)} file(s)`,
    ...plan.drop.map((entry) => {
      const replaced = entry.replacedBy.length > 0 ? ` (replaced by ${entry.replacedBy})` : "";
      return `    - ${entry.path}: ${entry.reason}${replaced}`;
    }),
  ];
}

/**
 * The absolute paths a plan harvests, which is what selects records out of the `self` bronze lane.
 *
 * A `self` bronze record's `url` is the absolute path of the file it was scanned from, so an absolute path
 * set is the join key. Built here rather than in the runner so the selection rule is testable without a
 * filesystem.
 *
 * @param plan the validated plan
 * @returns the absolute path of every harvested file
 */
export function harvestedPaths({ plan }: { plan: HarvestPlan }): ReadonlySet<string> {
  return new Set(plan.harvest.map((entry) => `${plan.root}/${entry.path}`));
}
