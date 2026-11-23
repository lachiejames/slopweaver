/**
 * The workstreams the synthetic stated outcomes (`../../../statedCandidatesFixture.ts`) become when the owner KEEPS
 * them, built the way the console's keep builds them — the catalog, the first register document, one planned yes per
 * id — and each judged by the store's own judge, so a coverage test reads what a real keep writes rather than a
 * hand-built workstream, and a shape the store would refuse fails here.
 */
import { unwrap } from "#lib/result.js";
import { candidateCatalog } from "../../../../workstreams/candidateCatalog.js";
import { firstRegister, planReactions } from "../../../../workstreams/promotion.js";
import { judgeProposedAggregate } from "../../../../workstreams/store/judge.js";
import type { WorkstreamAggregate } from "../../../../workstreams/store/types.js";
import { SYNTHETIC_STATED } from "../../../statedCandidatesFixture.js";
import { countingMintId } from "../../workstreams/storeRegisterFixture.js";

/**
 * The workstreams a register started from the stated outcomes alone holds once the named ones are kept.
 *
 * @param ids stated candidate ids, kept in this order
 * @returns the workstreams the keep adds, each one the store accepts
 */
export function keptStated({ ids }: { ids: readonly string[] }): readonly WorkstreamAggregate[] {
  const catalog = unwrap(candidateCatalog({ mined: null, stated: SYNTHETIC_STATED }));
  const planned = unwrap(
    planReactions({
      anchor: null,
      bySession: "test",
      catalog,
      definitions: new Map(),
      heard: null,
      held: [],
      meta: firstRegister({ catalog }),
      mintId: countingMintId(),
      nowIso: "2026-11-04T09:00:00.000Z",
      picks: ids.map((candidate) => ({ candidate, reaction: "yes" as const })),
      reason: null,
      via: "console",
      workstreams: [],
    }),
  );
  return planned.added.map((aggregate) => unwrap(judgeProposedAggregate({ aggregate })));
}

/**
 * The register with nothing kept yet: what the first keep starts from.
 *
 * @returns no workstreams
 */
export function nothingKept(): readonly WorkstreamAggregate[] {
  return [];
}
