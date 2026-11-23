/**
 * The effectful shell around `./rulingGate.ts` — read the standing gates a verb is about to be judged by,
 * and rebuild that projection from the journals that own it.
 *
 * Two readers, and the split is the cost budget `./rulingGateIndex.ts` measures:
 *
 * - {@link readStandingGates} opens ONE small file. This is what the dispatch boundary calls, on every verb.
 * - {@link rebuildStandingGates} walks every run journal (measured 728 ms on 2144 of them). This is what an
 *   explicit verb calls, and what `handover rule --gates` calls to keep the projection true.
 *
 * Neither reads `./store.ts`'s `scanBoard`: the 2678 row DOCUMENTS are 52 MB and cost 6.4 seconds, and a
 * gate is keyed on nothing only a document knows.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { ensureDirectory, writeFileAtomic } from "#lib/writeAtomic.js";

import { parseLedger } from "./ledger.js";
import type { StandingGate } from "./rulingGate.js";
import { standingGatesOf } from "./rulingGate.js";
import { type RulingGateError, RulingGateErrors } from "./rulingGateErrors.js";
import { parseRulingGateIndex, renderRulingGateIndex } from "./rulingGateIndex.js";

/** The `.jsonl` suffix a run journal carries. */
const JOURNAL_SUFFIX = ".jsonl";

/**
 * A journal that MAY carry a ruling, whatever whitespace its writer put around the colon. A literal
 * `"kind":"ruling"` substring missed `"kind": "ruling"`, so a hand-written or re-serialised ruling placed no gate.
 */
const RULING_KIND = /"kind"\s*:\s*"ruling"/;

/**
 * Every standing gate the projection holds.
 *
 * **Fails OPEN by construction** — a missing, unreadable or unparseable index is no gates, never a refusal.
 * `./rulingGateIndex.ts`'s header says why at length: refusing every verb on a corrupt 2 KB file wedges the
 * whole CLI, and nobody could then run the verb that fixes it.
 *
 * @param indexPath the projection's own file, from `stateHome.ts`'s `rulingGatesJson`
 * @returns the gates, oldest first; empty when nothing readable is recorded
 */
export function readStandingGates({ indexPath }: { indexPath: string }): readonly StandingGate[] {
  let text: string;
  try {
    text = readFileSync(indexPath, "utf8");
  } catch {
    return [];
  }
  const parsed = parseRulingGateIndex({ path: indexPath, text });
  return parsed.isOk() ? parsed.value.gates : [];
}

/**
 * Every standing gate the RUN JOURNALS hold — the source of truth, read the slow way.
 *
 * A journal that does not parse contributes nothing and does not fail the walk: one hand-edited file must
 * not be able to hide every other row's gates, and the honest report of that is the divergence a check pass
 * prints rather than a rebuild that refuses.
 *
 * @param runsDir the run journals directory, from `stateHome.ts`'s `runs`
 * @returns the gates, grouped by row in directory order
 */
export function rebuildStandingGates({ runsDir }: { runsDir: string }): readonly StandingGate[] {
  const walk = walkStandingGates({ runsDir });
  return walk.kind === "read" ? walk.gates : [];
}

/** What a walk of the run journals found: the gates, and every journal it could not read whole. */
export type StandingGateWalk =
  | { readonly kind: "read"; readonly gates: readonly StandingGate[]; readonly gaps: readonly string[] }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * The same walk as {@link rebuildStandingGates}, saying what it could not read instead of passing over it.
 *
 * A reader that SHOWS the gates to the owner needs this: a journal that would not open, or a ruling journal with a
 * line that would not decode, may hold a gate in force, so it is a gap rather than nothing. A runs directory that
 * is genuinely absent is a home with no runs, so no gates; one that is there and would not list is unreadable.
 *
 * @param runsDir the run journals directory, from `stateHome.ts`'s `runs`
 * @returns the gates in directory order with each gap named, or why the directory would not list
 */
export function walkStandingGates({ runsDir }: { runsDir: string }): StandingGateWalk {
  let names: readonly string[];
  try {
    names = readdirSync(runsDir).filter((name) => name.endsWith(JOURNAL_SUFFIX));
  } catch (error) {
    if (isAbsentError({ error, path: runsDir })) {
      return { gaps: [], gates: [], kind: "read" };
    }
    return { kind: "unreadable", why: `the run journals would not list: ${errorMessage({ error })}` };
  }
  const gates: StandingGate[] = [];
  const gaps: string[] = [];
  for (const name of names.toSorted()) {
    let text: string;
    try {
      text = readFileSync(join(runsDir, name), "utf8");
    } catch (error) {
      gaps.push(`${name}: ${errorMessage({ error })}`);
      continue;
    }
    // Cheap pre-filter before the decoder: 170 of 2144 journals on this install carry a ruling at all, and
    // `parseLedger` over the other 1974 is the whole of the 728 ms this walk costs.
    if (!RULING_KIND.test(text)) {
      continue;
    }
    const slug = name.slice(0, -JOURNAL_SUFFIX.length);
    const ledger = parseLedger({ text });
    if (ledger.unreadable.length > 0) {
      gaps.push(`${name}: line ${ledger.unreadable.join(", ")} would not decode`);
    }
    for (const gate of standingGatesOf({ events: ledger.events, slug })) {
      gates.push(gate);
    }
  }
  return { gaps, gates, kind: "read" };
}

/**
 * Write the projection.
 *
 * @param indexPath the projection's own file
 * @param gates the standing gates to record
 * @param builtAtIso when this projection was taken
 * @returns the path written, or the one reason it was not
 */
export function writeStandingGates({
  indexPath,
  gates,
  builtAtIso,
}: {
  indexPath: string;
  gates: readonly StandingGate[];
  builtAtIso: string;
}): Result<string, RulingGateError> {
  try {
    ensureDirectory({ directory: dirname(indexPath) });
    writeFileAtomic({ contents: renderRulingGateIndex({ builtAtIso, gates }), path: indexPath });
  } catch (cause) {
    return err(RulingGateErrors.indexWriteFailed({ detail: errorMessage({ error: cause }), path: indexPath }));
  }
  return ok(indexPath);
}
