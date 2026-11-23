/**
 * Whether a Codex pass is allowed to spend money — the effectful edge around `./duplicate.ts`'s exact key.
 *
 * ## Where this runs, and why not in `runPass.ts`
 *
 * `runBoundedPass` takes a prompt and a bound and has neither the pass's scope nor the historical record
 * set, so putting a filesystem scan there would be policy in the wrong layer. Admission belongs where the
 * scope exists and BEFORE anything is spent: the CLI shell (`cli/commands/codex/passRoute.ts`), ahead of the
 * routing read, the scratch workspace, the snapshot and the model turn. A refusal that fires after the
 * snapshot has been cut has already paid for most of what it was refusing.
 *
 * ## Three outcomes, and the third one PROCEEDS
 *
 * `allowed` and `duplicate` are the obvious pair. `unchecked` is the third: a scan that could not read the
 * orchestration root has established nothing about whether a duplicate exists. It is kept apart from
 * `allowed` — treating "we could not look" as "there is none" is the substitution this repository rejects
 * everywhere else — but it **does not refuse**, and that is a correction.
 *
 * It refused, and a Codex review of that version supplied the counterexample: no pass had ever run for a
 * repository, `$SLOPWEAVER_HOME/orchestration` was a regular file rather than a directory, and the scan's
 * `ENOTDIR` refused a first-ever pass with no duplicate anywhere on the machine. This gate exists to stop an
 * EXACT REPEAT of a conclusive pass; refusing on the absence of evidence inverts it into a gate that blocks
 * all Codex work whenever one directory is damaged, which is far more expensive than the duplicate spend it
 * was built to save. So the fault is reported loudly on stderr and the pass runs. A MISSING root is
 * different again and reads as `allowed` — no runs have ever happened here, which is knowledge rather than
 * its absence.
 *
 * ## The hatch is OR-ed with the caller's flag, never read as a default
 *
 * `src/devLint/hatchRelease.ts` refuses a hatch read written as a parameter default anywhere in the tree,
 * because `spent-plan` once printed a refusal naming the very variable the operator had just set — a
 * default initialiser is skipped whenever a caller passes the argument at all. {@link duplicateHatchOpen}
 * is the named OR that shape requires.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusalLines } from "../hatch/render.js";
import { logger } from "../lib/logger.js";
import { duplicatePassDetail, type ExactPassKey, findExactDuplicate } from "./duplicate.js";
import { scanPassRecords } from "./ledgerStore.js";
import type { CodexArtifactRecord } from "./types.js";

/**
 * The environment variable that lets an exact duplicate pass run anyway.
 *
 * Exported because the refusal names it and a test asserts the refusal names it.
 */
export const ALLOW_DUPLICATE_CODEX_PASS_ENV = "SLOPWEAVER_ALLOW_DUPLICATE_CODEX_PASS";

/**
 * Whether the duplicate hatch is open — the caller's own flag OR the ambient variable, never one instead of
 * the other, and never as a parameter default (see this module's header).
 *
 * @param flag the caller's own escape, already parsed; `false` when the caller has no flag to type one on
 * @param env the raw value of {@link ALLOW_DUPLICATE_CODEX_PASS_ENV}, or undefined when unset
 * @returns true when a pass may run despite having an exact conclusive duplicate on file
 */
export function duplicateHatchOpen({ flag, env }: { flag: boolean; env: string | undefined }): boolean {
  return flag || env === "1";
}

/** What admission decided. */
export type PassAdmission =
  /** No conclusive duplicate, the hatch was open, or this pass could not be keyed at all. */
  | { readonly kind: "allowed"; readonly reason: string }
  /** An exact conclusive record exists. `refusal` is the four-line registered refusal, already rendered. */
  | {
      readonly kind: "duplicate";
      readonly duplicate: CodexArtifactRecord;
      readonly refusal: readonly string[];
    }
  /**
   * The ledger could not be read, so nothing was established either way — and the pass runs anyway.
   *
   * Separate from `allowed` so a caller can say which of the two it is, never so it can refuse. See the
   * module header for the counterexample that made this proceed rather than block.
   */
  | { readonly kind: "unchecked"; readonly reason: string };

/** Mints {@link AdmittedPass}; declared and never exported, so no other module can spell the brand. */
declare const ADMITTED: unique symbol;

/**
 * An admission that let a pass through, as only {@link admittedPass} can produce it. `runPlanPass` and
 * `runReviewProperty` require one, so no caller can run a pass without first asking admission — and a
 * `duplicate` cannot become one at all.
 */
export type AdmittedPass = Exclude<PassAdmission, { kind: "duplicate" }> & { readonly [ADMITTED]: true };

/**
 * The admission as proof a pass may run, or nothing when it is an exact conclusive duplicate.
 *
 * @returns the branded admission for a pass admission let through, else undefined
 */
export function admittedPass({ admission }: { admission: PassAdmission }): AdmittedPass | undefined {
  return letThrough(admission) ? admission : undefined;
}

/**
 * Whether admission let the pass through — the one place the brand is granted, kept private to this module.
 *
 * @param admission the decision admission made
 * @returns true for every kind but `duplicate`
 */
function letThrough(admission: PassAdmission): admission is AdmittedPass {
  return admission.kind !== "duplicate";
}

/**
 * Decide admission from records already read. Pure, so every branch is testable without a filesystem.
 *
 * @param key the pass about to run, or undefined when it cannot be keyed (a detached HEAD, no provenance)
 * @param records every pass record in THIS checkout
 * @param hatchOpen whether {@link duplicateHatchOpen} said the escape is open
 * @returns the admission decision
 */
export function admitPass({
  hatchOpen,
  key,
  records,
}: {
  hatchOpen: boolean;
  key: ExactPassKey | undefined;
  records: readonly CodexArtifactRecord[];
}): PassAdmission {
  if (key === undefined) {
    return {
      kind: "allowed",
      reason: "this pass carries no branch or HEAD to key on, so no duplicate could be established",
    };
  }
  const duplicate = findExactDuplicate({ key, records });
  if (duplicate === undefined) {
    return { kind: "allowed", reason: "no conclusive record exists for this exact pass" };
  }
  if (hatchOpen) {
    return {
      kind: "allowed",
      reason: `an exact duplicate (${duplicate.artifactId}) was overridden by the escape hatch`,
    };
  }
  return {
    duplicate,
    kind: "duplicate",
    refusal: hatchRefusalLines({
      detail: duplicatePassDetail({ duplicate, key }).join(" "),
      hatch: hatchFor({ id: "codex-duplicate-pass" }),
    }),
  };
}

/**
 * Read this checkout's records and decide whether the pass may run.
 *
 * @param hatchOpen whether the escape hatch is open (build it with {@link duplicateHatchOpen})
 * @param key the pass about to run, or undefined when it cannot be keyed
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param repoRoot the checkout whose records count — a worktree has its own root
 * @returns the admission decision; a scan failure is `unchecked` — loud, but never a refusal
 */
export function admitCodexPass({
  hatchOpen,
  key,
  orchestrationRoot,
  repoRoot,
}: {
  hatchOpen: boolean;
  key: ExactPassKey | undefined;
  orchestrationRoot: string;
  repoRoot: string;
}): PassAdmission {
  const scan = scanPassRecords({ orchestrationRoot });
  if (scan.isErr()) {
    // A root that has never existed never lands here: `scanPassRecords` reads it as an empty ledger.
    // No hatch branch here, and its absence is the point: there is nothing to escape, because this outcome
    // does not refuse. An earlier version returned a refusal releasable by the duplicate hatch, which meant a
    // damaged orchestration root blocked every first-ever pass until an operator discovered a variable.
    return {
      kind: "unchecked",
      reason: `the pass ledger could not be read, so no duplicate could be established either way: ${scan.error.message}`,
    };
  }
  return admitPass({
    hatchOpen,
    key,
    records: scan.value.records.filter((record) => record.repoRoot === repoRoot),
  });
}

/**
 * Print an admission's refusal or its warning, whichever it carries.
 *
 * @param admission what {@link admitCodexPass} decided
 * @returns true only for a `duplicate` — the ONE outcome that stops the caller
 */
export function reportAdmission({ admission }: { admission: PassAdmission }): boolean {
  if (admission.kind === "allowed") {
    return false;
  }
  if (admission.kind === "unchecked") {
    // A fact, not a policy refusal, and it does not stop anything — so it carries no escape hatch and must
    // not be written in the registered four-line shape, which would claim a rule caught this pass.
    logger.error({ msg: `codex: ${admission.reason}` });
    logger.error({ msg: "codex: running WITHOUT the duplicate check — fix the orchestration root to restore it." });
    return false;
  }
  for (const line of admission.refusal) {
    logger.error({ msg: line });
  }
  return true;
}
