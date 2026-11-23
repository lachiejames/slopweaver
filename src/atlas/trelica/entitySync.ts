/**
 * The publish half of the nine 15-Oct kinds: merge each kind read whole onto the first-party channel, keep
 * what the generation held for each kind that was not, and say which is which.
 *
 * Pure over the snapshot read under the publish lock. A kind read whole replaces its `first-party-api` cell
 * with `synced`; a kind that was not keeps its stored entities exactly — none goes stale over a read that
 * failed — with a `deferred` cell carrying the reason and a `first-party-row-unread` gap. A run list read whole
 * whose step detail fell short is `deferred` too, because the step evidence is what that kind is for.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { TrelicaEntityKind } from "./entityList.js";
import type { TrelicaEntityRun } from "./entityReads.js";
import { openTrelicaGap, type TrelicaGapRecheck } from "./gaps.js";
import { storedTrelicaKindFile, trelicaEntityFileWith } from "./kindFiles.js";
import { mergeTrelicaChannel } from "./merge.js";
import type { TrelicaAtlasGap, TrelicaAtlasKindFile } from "./model.js";
import type { TrelicaAtlasSnapshot } from "./store.js";

/** The scope a run's step-detail gap is keyed on. */
const RUN_STEPS_SCOPE = "workflow-run-steps";

/** What the entity half contributes to one publish. */
export interface TrelicaEntityKindFiles {
  readonly files: Readonly<Partial<Record<TrelicaEntityKind, TrelicaAtlasKindFile>>>;
  /** Each kind that kept its stored entities this run, and why — the manifest stamps these as failed attempts. */
  readonly deferred: ReadonlyMap<TrelicaEntityKind, string>;
  /** How many entities each kind read whole observed this run. */
  readonly counts: Readonly<Partial<Record<TrelicaEntityKind, number>>>;
  readonly observed: readonly TrelicaAtlasGap[];
  readonly rechecks: readonly TrelicaGapRecheck[];
}

/** The gap a kind that kept its stored entities raises. */
function unreadGap({ kind, reason, at }: { kind: TrelicaEntityKind; reason: string; at: string }): TrelicaAtlasGap {
  return openTrelicaGap({
    at,
    condition: "first-party-row-unread",
    fields: [],
    kind,
    reason: `the ${kind} read was not whole, so the kind kept what it held: ${reason}`,
    scope: `entity:${kind}`,
    surfaces: ["first-party-api"],
  });
}

/** The gap a run list read whole, with some runs' step detail unread, raises. */
function stepsGap({ entities, at }: { entities: TrelicaEntityRun; at: string }): TrelicaAtlasGap {
  const { unread, firstFailure } = entities.steps;
  const cause = firstFailure === null ? "" : `; the first said: ${firstFailure}`;
  return openTrelicaGap({
    at,
    condition: "workflow-run-steps-unread",
    fields: [],
    kind: "workflow-run",
    reason: `${String(unread)} run(s) hold their status and no step-by-step evidence this sync${cause}`,
    scope: RUN_STEPS_SCOPE,
    surfaces: ["first-party-api"],
  });
}

/**
 * Build every 15-Oct kind file this run publishes, and the gaps it observed and rechecked.
 *
 * @param snapshot the generation read under the publish lock
 * @param entities what the entity reads returned
 * @param at this run's ISO timestamp
 * @returns the files, the deferred kinds, the counts and the gaps, or the first reason a merge could not be made
 */
export function trelicaEntityKindFiles({
  snapshot,
  entities,
  at,
}: {
  snapshot: TrelicaAtlasSnapshot;
  entities: TrelicaEntityRun;
  at: string;
}): Result<TrelicaEntityKindFiles> {
  const files: Partial<Record<TrelicaEntityKind, TrelicaAtlasKindFile>> = {};
  const deferred = new Map<TrelicaEntityKind, string>();
  const counts: Partial<Record<TrelicaEntityKind, number>> = {};
  const observed: TrelicaAtlasGap[] = [];
  const rechecks: TrelicaGapRecheck[] = [];
  for (const read of entities.reads) {
    const stored = storedTrelicaKindFile({ at, kind: read.kind, snapshot });
    rechecks.push({ condition: "first-party-row-unread", resolved: read.held, scope: `entity:${read.kind}` });
    if (!read.held) {
      deferred.set(read.kind, read.reason);
      observed.push(unreadGap({ at, kind: read.kind, reason: read.reason }));
      files[read.kind] = trelicaEntityFileWith({
        at,
        entities: stored.entities,
        reason: read.reason,
        state: "deferred",
        stored,
      });
      continue;
    }
    const merged = mergeTrelicaChannel({
      at,
      channel: "first-party-api",
      observed: read.entities,
      stored: stored.entities,
    });
    if (merged.isErr()) {
      return err(merged.error);
    }
    const stepsShort = read.kind === "workflow-run" && entities.steps.unread > 0;
    files[read.kind] = trelicaEntityFileWith({
      at,
      entities: merged.value,
      reason: read.reason,
      state: stepsShort ? "deferred" : "synced",
      stored,
    });
    counts[read.kind] = read.entities.length;
    if (read.kind === "workflow-run") {
      rechecks.push({ condition: "workflow-run-steps-unread", resolved: !stepsShort, scope: RUN_STEPS_SCOPE });
    }
    if (stepsShort) {
      // The run list itself was read whole, but the kind is for its step evidence: the manifest attempt fails and
      // keeps its last success, so a reader never sees a short sync dated as a complete one.
      const gap = stepsGap({ at, entities });
      deferred.set(read.kind, gap.reason);
      observed.push(gap);
    }
  }
  return ok({ counts, deferred, files, observed, rechecks });
}
