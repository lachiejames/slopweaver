/**
 * The end of every pass: publish its record, then reclaim its own scratch workspace.
 *
 * In that order, because a scratch is spent only once its artifact exists (`../home/reclaim/roots.ts`'s
 * `finished-scratch`). Nothing ran `home reclaim`, so a pass that cloned, installed or built in its scratch
 * left that tree behind for good, and finished scratch built up until the disk filled. The pass is the one
 * process that knows which workspace is its own, so it takes that one directory itself, through
 * `../home/reclaim/passScratch.ts`, which applies `home reclaim`'s own criterion, checks, witness and ledger
 * to that single entry.
 *
 * The reclaim outcome sits beside the verdict and never inside it. The answer of record is the artifact, and
 * a scratch left behind is disk, not a wrong answer, so a reclaim failure changes neither the verdict,
 * `persistError` nor the exit code. A publish that failed leaves the scratch untouched, because the pass is
 * not finished by that criterion. So does a pass that never got a workspace, since a directory under its name
 * would then be another pass's.
 */
import type { HomeReclaimError } from "../home/reclaim/errors.js";
import { reclaimFinishedPassScratch } from "../home/reclaim/passScratch.js";
import { type ArtifactLocation, writeCodexArtifact } from "./artifactStore.js";
import { liveOriginRepositoryField } from "./originBindingLive.js";
import { toArtifactRecord } from "./passRecord.js";
import type { CodexArtifactRecord } from "./types.js";

/** What became of the pass's own scratch workspace once its artifact was written. */
export type ScratchReclaimOutcome =
  | { readonly kind: "reclaimed"; readonly freedBytes: number }
  | { readonly kind: "not-attempted"; readonly reason: "workspace-unavailable" | "artifact-not-persisted" }
  | { readonly kind: "failed"; readonly error: HomeReclaimError };

/** One completed pass: its record, and where the artifact landed (or why it could not be written). */
export interface CompletedPass {
  readonly record: CodexArtifactRecord;
  readonly location: ArtifactLocation | undefined;
  /** Present when the artifact could NOT be published — a known result that was not persisted. */
  readonly persistError: string | undefined;
  /** Whether the pass's own scratch was reclaimed after the artifact was written. */
  readonly scratchReclaim: ScratchReclaimOutcome;
  /**
   * The pool this pass's own pooled snapshot was leased from, absent on a fresh or live read. Held in memory for
   * this invocation only, as the authority `codex review` removes a description review's one-shot pool by, and
   * never written to the artifact record.
   */
  readonly snapshotPoolRoot?: string | undefined;
}

/**
 * Publish a pass's record, then reclaim the scratch workspace that pass was given.
 *
 * @param fields everything the record is built from, the scratch path the pass was given included
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param reclaimLedgerPath the reclaim ledger the scratch's removal is journalled into
 * @returns the completed pass, carrying where its artifact landed and what became of its scratch
 */
export function persistPass({
  fields,
  orchestrationRoot,
  reclaimLedgerPath,
}: {
  fields: Omit<Parameters<typeof toArtifactRecord>[0], "originRepository">;
  orchestrationRoot: string;
  reclaimLedgerPath: string;
}): CompletedPass {
  // Read here, while the checkout exists: the one binding that re-proves this record once it is deleted.
  const record = toArtifactRecord({ ...fields, ...liveOriginRepositoryField({ repoRoot: fields.repoRoot }) });
  const written = writeCodexArtifact({ orchestrationRoot, record });
  if (written.isErr()) {
    return {
      location: undefined,
      persistError: written.error.message,
      record,
      scratchReclaim: { kind: "not-attempted", reason: "artifact-not-persisted" },
    };
  }
  return {
    location: written.value,
    persistError: undefined,
    record,
    scratchReclaim: reclaimOwnScratch({
      artifactId: fields.artifactId,
      nowIso: () => fields.runtime.nowIso(),
      orchestrationRoot,
      reclaimLedgerPath,
      workspace: fields.workspace,
    }),
  };
}

/**
 * Reclaim the one workspace this pass was given, folding the result into an outcome that never throws.
 *
 * @param artifactId the pass id whose artifact was just published
 * @param nowIso the clock the ledger row is stamped with
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param reclaimLedgerPath the reclaim ledger the removal is journalled into
 * @param workspace the scratch path `createPassScratch` returned to this pass, or null when it had none
 * @returns reclaimed with the bytes freed, not-attempted with why, or failed with the typed error
 */
function reclaimOwnScratch({
  artifactId,
  nowIso,
  orchestrationRoot,
  reclaimLedgerPath,
  workspace,
}: {
  artifactId: string;
  nowIso: () => string;
  orchestrationRoot: string;
  reclaimLedgerPath: string;
  workspace: string | null;
}): ScratchReclaimOutcome {
  if (workspace === null) {
    return { kind: "not-attempted", reason: "workspace-unavailable" };
  }
  const reclaimed = reclaimFinishedPassScratch({
    artifactId,
    deps: { ledgerPath: reclaimLedgerPath, nowIso },
    orchestrationRoot,
    scratchPath: workspace,
  });
  if (reclaimed.isErr()) {
    return { error: reclaimed.error, kind: "failed" };
  }
  return { freedBytes: reclaimed.value.freedBytes, kind: "reclaimed" };
}
