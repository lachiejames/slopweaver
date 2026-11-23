/**
 * This atlas's per-kind merge, and the proof that has to exist before anything may be staled.
 *
 * The lifecycle is the kit's `mergeKind`. What is JumpCloud's own is the guard around it and the fold.
 *
 * ## Staling takes a proof, not a boolean
 *
 * "This record was not returned, so it is gone" is only true when the read that did not return it actually
 * FINISHED. A paged read that stopped early, a 429 halfway through a fan-out, and a genuinely empty result
 * look identical to a merge that takes `complete: boolean` — and a wrong `true` marks live devices stale,
 * which is the one error here a reader cannot spot, because a stale system looks exactly like a
 * decommissioned one. So {@link mergeJumpcloudKind} takes a {@link CompleteFamilyRead}, which every caller
 * obtains from {@link provenCompleteRead}, which checks rather than trusts. An incomplete read merges what it
 * saw and stales nothing.
 *
 * ## The fold is per CHANNEL, never per entity
 *
 * A successful Directory API read replaces the `directory-api` channel and leaves `admin-console` exactly
 * as it was, and the reverse. Replacing the whole entity would make each surface erase the other's
 * knowledge on every run, which is the two-surface design defeated by its own merge.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import { JumpcloudAtlasErrors, jumpcloudAtlasErrorLines } from "./atlasErrors.js";
import type { JumpcloudEntity } from "./entities.js";
import type { JumpcloudKind, JumpcloudSurfaceName } from "./model.js";

/**
 * Evidence that one kind's read reached the end of its own result set.
 *
 * Callers obtain one from {@link provenCompleteRead}, the only function in this tree that builds one. The
 * compiler does not enforce that: `provenBy` is a plain string literal, so what it buys is visibility — a
 * hand-built object has to spell the factory's name, which a reviewer sees. The `proof` is a sentence a coverage reason quotes, so the evidence
 * survives into what a reader sees rather than staying an internal boolean.
 * @internal
 */
export interface CompleteFamilyRead {
  readonly kind: JumpcloudKind;
  readonly observed: number;
  readonly proof: string;
  readonly provenBy: "provenCompleteRead";
}

/**
 * Prove that a family read finished, or say why it did not.
 *
 * Three independent conditions, all required. Every admitted operation for the kind must have completed —
 * one refused fan-out means the entities behind it were never looked for. The paging must have terminated
 * on its own. And where the provider declared a total, the number observed must reach it: a short page with
 * a shortfall is exactly what an unstable page order produces, and treating it as the end of the walk is
 * how an offset walker silently omits records.
 *
 * @param kind the kind this read covered
 * @param observed how many entities the read produced
 * @param declaredTotal the provider's own total, or `null` when it declared none
 * @param pagesExhausted whether paging ended because the provider offered no further page
 * @param operationsRefused how many admitted operations for this kind did not complete
 * @returns the proof, or every reason the read may not be treated as complete
 */
export function provenCompleteRead({
  kind,
  observed,
  declaredTotal,
  pagesExhausted,
  operationsRefused,
}: {
  kind: JumpcloudKind;
  observed: number;
  declaredTotal: number | null;
  pagesExhausted: boolean;
  operationsRefused: number;
}): Result<CompleteFamilyRead> {
  const problems: string[] = [];
  if (operationsRefused > 0) {
    problems.push(
      `${String(operationsRefused)} admitted ${kind} operation(s) did not complete, so records behind them were never looked for and none may be staled`,
    );
  }
  if (!pagesExhausted) {
    problems.push(
      `the ${kind} read stopped before the provider ran out of pages, so entities it did not reach must not be staled`,
    );
  }
  if (declaredTotal !== null && observed < declaredTotal) {
    problems.push(
      `the ${kind} read produced ${String(observed)} of the ${String(declaredTotal)} the provider declared, so it is incomplete`,
    );
  }
  if (problems.length > 0) {
    return err(problems);
  }
  // The same floor `../kit/completeness.ts` states: an excess is accepted, and the proof says "exceeding" rather
  // than claiming a match between two numbers that differ.
  let against = `matching the ${String(declaredTotal)} the provider declared`;
  if (declaredTotal === null) {
    against = "the provider declared no total, so completeness rests on paging alone";
  } else if (observed > declaredTotal) {
    against = `exceeding the ${String(declaredTotal)} the provider declared, consistent with a record created mid-read`;
  }
  return ok({
    kind,
    observed,
    proof: `read ${String(observed)} ${kind} record(s) to the end of paging, ${against}`,
    provenBy: "provenCompleteRead",
  });
}

/** The channels an entity starts from: the stored generation's when there is one, else both empty. */
function baseChannels({ prior }: { prior: JumpcloudEntity | undefined }): JumpcloudEntity["channels"] {
  if (prior == null) {
    return { "admin-console": null, "directory-api": null };
  }
  return prior.channels;
}

/**
 * When one channel first saw an entity: kept from the stored generation once that channel has seen it, and
 * this run's instant for a first sighting — a new entity, or a stored one this channel never saw before.
 *
 * @param prior the entity as the stored generation holds it, or `undefined` when it is new
 * @param channel the channel this run refreshed
 * @param at this run's ISO timestamp
 * @returns the instant the channel first saw the entity
 */
function firstSeenOn({
  prior,
  channel,
  at,
}: {
  prior: JumpcloudEntity | undefined;
  channel: JumpcloudSurfaceName;
  at: string;
}): string {
  if (prior === undefined) {
    return at;
  }
  const held = prior.channels[channel];
  if (held === null) {
    return at;
  }
  return held.firstSeenAt;
}

/**
 * Merge this run's freshly projected entities for one kind into what the store already holds.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities, each carrying exactly the channel that saw it
 * @param channel which surface produced this run's observations, so only that channel is replaced
 * @param complete the proof that the read finished, or `null` when it did not — a `null` merges what was
 *   seen and leaves every unobserved entity exactly as it was
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeJumpcloudKind({
  stored,
  observed,
  channel,
  complete,
  at,
}: {
  stored: readonly JumpcloudEntity[];
  observed: readonly JumpcloudEntity[];
  channel: JumpcloudSurfaceName;
  complete: CompleteFamilyRead | null;
  at: string;
}): Result<readonly JumpcloudEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: prior, observed: fresh, at: when }): Result<JumpcloudEntity> => {
      const incoming = fresh.channels[channel];
      if (incoming === null) {
        return err(
          jumpcloudAtlasErrorLines({ error: JumpcloudAtlasErrors.channelEmpty({ channel, kind: fresh.kind }) }),
        );
      }
      return ok({
        channels: {
          ...baseChannels({ prior }),
          [channel]: { ...incoming, firstSeenAt: firstSeenOn({ at: when, channel, prior }) },
        },
        id: fresh.id,
        kind: fresh.kind,
        providerId: fresh.providerId,
      });
    },
    observed,
    staleEntity: ({ stored: entity }): JumpcloudEntity | null => {
      const seen = entity.channels[channel];
      if (complete === null || seen === null || seen.state === "stale") {
        return null;
      }
      return { ...entity, channels: { ...entity.channels, [channel]: { ...seen, state: "stale" } } };
    },
    stored,
  });
}
