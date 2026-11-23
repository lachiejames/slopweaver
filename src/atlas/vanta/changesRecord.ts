/**
 * The step a Vanta sync takes just before it publishes: compare what it is about to publish with what the
 * store held, and write that down for a visible session to judge (`changes.ts`, `changesStore.ts`).
 *
 * Before, not after: a sync killed between the two then leaves a record of a generation that never
 * published, and the next sync, comparing against the generation that did, records those changes again — a
 * duplicate, never a lost window. A publish that FAILS voids the record (`voidVantaSyncChanges`).
 *
 * It never fails the sync. A record that cannot be written is REPORTED — and once the atlas publishes it is
 * lost: the next sync compares against what this one published, so the window this sync covered has no other
 * record. Home git commits catch the atlas only at a supervisor tick.
 */
import { diffVantaGeneration, type VantaChangeTotals, type VantaKindTransition, vantaChangeTotals } from "./changes.js";
import { removeVantaChangeRecord, writeVantaChangeRecord } from "./changesStore.js";
import type { VantaEntity, VantaKind, VantaKindFile, VantaManifest } from "./model.js";
import type { KindSyncResult } from "./syncKind.js";

/** What became of this sync's change record. */
export type VantaSyncChanges =
  | { readonly outcome: "recorded"; readonly at: string; readonly path: string; readonly totals: VantaChangeTotals }
  | { readonly outcome: "not-recorded"; readonly reason: string }
  | { readonly outcome: "failed"; readonly reason: string };

/**
 * When the stored generation of one kind was read: the latest `lastSeenAt` its observed Manage API entities
 * carry, since a merge stamps every entity it observed with the sync's instant.
 *
 * Read off the entities rather than the manifest's `lastSuccessAt`, which does not advance when the sync
 * publishes a read and still calls it failed; a window named from it would start a sync too early. A kind
 * holding no observed entity falls back to `lastSuccessAt`, which is right for a read that returned none.
 *
 * @param lastSuccessAt the manifest's last successful read of the kind, or `null` when it has none
 * @returns the instant the window starts, or `null` when the kind has never been read
 */
export function vantaWindowStart({
  before,
  lastSuccessAt,
}: {
  before: readonly VantaEntity[];
  lastSuccessAt: string | null;
}): string | null {
  let latest: string | null = null;
  for (const entity of before) {
    const channel = entity.channels["manage-api"];
    if (channel?.state === "observed" && (latest === null || channel.lastSeenAt > latest)) {
      latest = channel.lastSeenAt;
    }
  }
  if (latest === null) {
    // No observed entity carries an instant, so the manifest's last successful read is the window's start.
    return lastSuccessAt;
  }
  return latest;
}

/**
 * Record what one sync is about to publish.
 *
 * A kind is compared whenever its entities were read and published, and the sync's own verdict rides along.
 * A vendor read whose companion write failed is published but marked failed: listed unread, its changes would
 * be lost, because the next sync compares against what this one published. So it is compared, carrying the
 * write's reason as a note, and its window starts where the stored entities say (`vantaWindowStart`), not
 * at the manifest's `lastSuccessAt`, which that failure leaves behind.
 *
 * @param storedFiles the generation the sync merged against
 * @param manifest the manifest that generation carried, whose `lastSuccessAt` starts a window holding no entity
 * @param results every kind the sync ran, carrying the file it published
 * @param outcomes the sync's verdict per kind — the report's own `kinds`, one per result
 * @param credentialsConfigured `false` when no kind could have been read at all
 * @returns where the record went, why none was written, or why writing it failed
 */
export function recordVantaSyncChanges({
  home,
  at,
  storedFiles,
  manifest,
  results,
  outcomes,
  credentialsConfigured,
}: {
  home: string;
  at: string;
  storedFiles: Readonly<Record<VantaKind, VantaKindFile>>;
  manifest: VantaManifest;
  results: readonly KindSyncResult[];
  outcomes: readonly { readonly kind: VantaKind; readonly complete: boolean; readonly reasons: readonly string[] }[];
  credentialsConfigured: boolean;
}): VantaSyncChanges {
  if (!credentialsConfigured) {
    return { outcome: "not-recorded", reason: "credentials are not configured, so this sync read no kind" };
  }
  const verdicts = new Map(outcomes.map((outcome) => [outcome.kind, outcome]));
  const transitions = results.map((result): VantaKindTransition => {
    // The sync builds one outcome per result, so a missing verdict is a broken invariant, not an absence.
    const verdict = verdicts.get(result.kind)!;
    const before = storedFiles[result.kind].entities;
    return {
      after: result.file.entities,
      before,
      complete: result.complete,
      kind: result.kind,
      notes: verdict.complete ? [] : verdict.reasons,
      reasons: verdict.reasons,
      since: vantaWindowStart({ before, lastSuccessAt: manifest.kinds[result.kind].lastSuccessAt }),
    };
  });
  const record = diffVantaGeneration({ at, transitions });
  const written = writeVantaChangeRecord({ home, record });
  if (written.isErr()) {
    return { outcome: "failed", reason: written.error.message };
  }
  return { at, outcome: "recorded", path: written.value, totals: vantaChangeTotals({ record }) };
}

/**
 * Void the record of a sync whose publish failed, so no session judges a generation that never published.
 *
 * @param changes what `recordVantaSyncChanges` answered for that sync
 * @returns nothing to add when there was no record or it was removed, else the line naming the one left behind
 */
export function voidVantaSyncChanges({ changes }: { changes: VantaSyncChanges }): readonly string[] {
  if (changes.outcome !== "recorded") {
    return [];
  }
  const removed = removeVantaChangeRecord({ path: changes.path });
  return removed.isErr() ? [removed.error.message] : [];
}
