/**
 * The candidate half of `talk relay`: the owner's ruling on the workstream candidate the voice read the owner, written to that
 * candidate once the row carrying the owner's words is on the board (`../../../talk/candidateRuling.ts`). Split from
 * `./relayRun.ts`, which decides when it runs, and beside `./relayRuling.ts`, its check-in twin.
 */
import { logger } from "../../../lib/logger.js";
import { applyCandidateRuling, type CandidateRuling } from "../../../talk/candidateRuling.js";
import type { RelayDraft } from "../../../talk/relayDraft.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import type { RelayArgs } from "./relayArgs.js";

/** What became of a ruling on a candidate: the row now on it, or why none was written. */
export type CandidateRulingOutcome =
  | { readonly kind: "recorded"; readonly ruling: CandidateRuling }
  | { readonly kind: "refused"; readonly candidate: string; readonly reaction: string; readonly why: string };

/**
 * Record the candidate ruling a relay carries — on a replay too, which finishes one a crash cut short and writes
 * nothing twice. A ruling that cannot be recorded is said, never fatal: the row already carries every word, and the
 * candidate simply stays open for the next walk.
 *
 * @param args the relay's flags; only the candidate verdict is read
 * @param draft the relay's turn: its anchor, the owner's heard words, and its id
 * @param home the state home whose candidates ledger is written
 * @param nowIso when the ruling is recorded
 * @param hold why the relay's words may end before the owner did (`../../../talk/relayCutHold.ts`); a held ruling is
 *   refused before anything is written, so the candidate stays open for the next walk
 * @param store the workstream register a yes promotes into
 * @param mintId the fresh canonical UUID each written entry takes
 * @returns what was recorded or why not, or `undefined` when the relay carried no candidate ruling
 */
export async function recordCandidateRuling({
  args,
  draft,
  home,
  nowIso,
  hold,
  store,
  mintId,
}: {
  args: Pick<RelayArgs, "candidateVerdict">;
  draft: Pick<RelayDraft, "anchor" | "heard" | "turnId">;
  home: string;
  nowIso: string;
  hold: string | undefined;
  store: WorkstreamStore;
  mintId: () => string;
}): Promise<CandidateRulingOutcome | undefined> {
  const verdict = args.candidateVerdict;
  if (verdict === undefined) {
    return undefined;
  }
  if (hold !== undefined) {
    logger.error({ msg: `talk relay: no candidate ruling recorded — ${hold}` });
    return { ...verdict, kind: "refused", why: hold };
  }
  const applied = await applyCandidateRuling({
    anchor: draft.anchor,
    heard: draft.heard,
    home,
    mintId,
    nowIso,
    store,
    turnId: draft.turnId,
    verdict,
  });
  if (applied.isErr()) {
    logger.error({ msg: `talk relay: no candidate ruling recorded — ${applied.error.message}` });
    return { ...verdict, kind: "refused", why: applied.error.message };
  }
  return { kind: "recorded", ruling: applied.value };
}

/**
 * The candidate ruling as the `--json` document carries it, so the voice knows whether the candidate is now closed.
 *
 * @returns the document's `candidateRuling` field, or `null` when the relay carried none
 */
export function candidateRulingField({
  outcome,
}: {
  outcome: CandidateRulingOutcome | undefined;
}): Readonly<Record<string, unknown>> | null {
  if (outcome === undefined) {
    return null;
  }
  if (outcome.kind === "refused") {
    return { candidate: outcome.candidate, reaction: outcome.reaction, recorded: false, why: outcome.why };
  }
  const { candidate, reaction, written, promotionOwed } = outcome.ruling;
  return { candidate, promotionOwed, reaction, recorded: true, written };
}

/**
 * The operator's line for a candidate ruling.
 *
 * @returns the line, or `undefined` when the relay carried none
 */
export function candidateRulingLine({ outcome }: { outcome: CandidateRulingOutcome | undefined }): string | undefined {
  if (outcome === undefined) {
    return undefined;
  }
  if (outcome.kind === "refused") {
    return `  ${outcome.candidate} still open, no ruling recorded — ${outcome.why}`;
  }
  const { candidate, reaction, written, promotionOwed } = outcome.ruling;
  const how = written ? "now carries" : "already carried";
  const line = `  candidate ${candidate} ${how} the owner's ruling: ${reaction}`;
  if (promotionOwed === null) {
    return line;
  }
  return `${line} — ${promotionOwed}`;
}
