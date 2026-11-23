/**
 * The first-party half of one API-surface sync: every admitted call, every cost-explorer read and every 15-Oct
 * entity kind, made with the owner's signed-in session — split out of `sync.ts`, which publishes what this
 * collected.
 */
import type { TrelicaAiRunInput } from "./aiCoverage.js";
import { readTrelicaAiUsage, trelicaAiUsageAsCall } from "./aiSync.js";
import { trelicaAiWindow } from "./aiUsage.js";
import type { TrelicaCallResult, TrelicaClient } from "./client.js";
import { readTrelicaEntities, type TrelicaEntityRun } from "./entityReads.js";
import type { TrelicaAtlasError } from "./errors.js";
import { TRELICA_FIRST_PARTY_READS } from "./firstPartyBoundaries.js";
import type { TrelicaAtlasPaths } from "./store.js";

/**
 * What the first-party half of one run collected.
 *
 * @internal
 */
export interface TrelicaFirstPartyRun extends TrelicaAiRunInput {
  /** Every call that did not answer, kept so a refusal becomes a gap rather than a silent absence. */
  readonly failures: readonly { readonly callId: string; readonly error: TrelicaAtlasError }[];
  /** The nine 15-Oct kinds, each read whole or carried as the reason it was not. */
  readonly entities: TrelicaEntityRun;
}

/**
 * Make every admitted first-party call and every cost-explorer read, keeping a failure rather than aborting.
 *
 * One call being refused by this account's roles, or answering a shape its strict boundary does not admit, must
 * not cost the atlas the kinds the other calls fill: a per-call failure becomes a gap naming the call, and everything that answered is still published. A
 * usage read also joins `results` as the call it was, so the method map records it like any other.
 *
 * @param client the session-holding client
 * @param paths the atlas paths, read only so an unchanged run's step detail is reused rather than re-read
 * @param at this run's ISO instant, which the cost explorer's window ends on
 * @returns what answered and what did not
 */
export async function runTrelicaFirstPartyCalls({
  client,
  paths,
  at,
}: {
  client: TrelicaClient;
  paths: TrelicaAtlasPaths;
  at: string;
}): Promise<TrelicaFirstPartyRun> {
  const results: TrelicaCallResult[] = [];
  const failures: { callId: string; error: TrelicaAtlasError }[] = [];
  for (const { call, boundary } of TRELICA_FIRST_PARTY_READS) {
    const answered = await client.call({ boundary, call });
    if (answered.isErr()) {
      failures.push({ callId: call.id, error: answered.error });
      continue;
    }
    results.push(answered.value);
  }
  const window = trelicaAiWindow({ at });
  const ai = await readTrelicaAiUsage({ client, window });
  results.push(...ai.usage.map((result) => trelicaAiUsageAsCall({ result })));
  const entities = await readTrelicaEntities({ at, client, paths });
  results.push(...entities.calls);
  return { entities, failures: [...failures, ...ai.failures], results, usage: ai.usage, window };
}
