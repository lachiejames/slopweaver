/**
 * The effectful half of `./steering.ts`'s steers: the relay ledger read ONCE per status read and indexed by recipe,
 * each steer's answer read off the one board row its relay recorded — never a board listing. A relay turn file is opened only for a relay already known to be about an automation.
 *
 * Its own module beside `./readOutputs.ts` because the two read different stores for different card sections.
 */
import { settledAskOf } from "../handover/askRow.js";
import { readExactDoc } from "../handover/store.js";
import { unsetFieldAsNull } from "../lib/absent.js";
import { stateHomePaths } from "../stateHome.js";
import { readRelayLedger, readTurn, type TurnRecord } from "../talk/relayStore.js";
import { undecodedGap } from "./readOutputs.js";
import type { SteerView } from "./steering.js";

/** The `about` prefix a steer of an automation carries. */
const RECIPE_ABOUT = "recipe:";

/** One relay turn, as it stands now: its own file, or the receipt with the reason the file would not read. */
function currentTurn({ home, receipt, issues }: { home: string; receipt: TurnRecord; issues: string[] }): TurnRecord {
  const turn = readTurn({ home, turnId: receipt.turnId });
  if (turn.isErr()) {
    issues.push(
      `${turn.error.message} — the steer ${receipt.turnId} shows its receipt, whose delivery is never current`,
    );
    return receipt;
  }
  return turn.value;
}

/**
 * One relay about an automation, with the supervisor's recorded answer read off its board row. A row that would not
 * read is an unreadable answer, kept apart from a row that is not there — the one is a failed read, the other data.
 */
function steerOf({ home, turn }: { home: string; turn: TurnRecord }): SteerView {
  let words = turn.heard;
  if (words === "") {
    words = turn.words;
  }
  const base = {
    delivery: turn.delivery,
    sentAtIso: turn.stagedAtIso,
    slug: turn.slug,
    turnId: turn.turnId,
    words,
  };
  const read = readExactDoc({ handoverDir: stateHomePaths({ home }).handovers, slug: turn.slug });
  if (read.isErr()) {
    return { ...base, answer: null, answerUnreadable: read.error.message, boardRowMissing: false };
  }
  if (read.value === undefined) {
    return { ...base, answer: null, answerUnreadable: null, boardRowMissing: true };
  }
  const settled = settledAskOf({ doc: read.value.doc });
  if (settled === undefined) {
    return { ...base, answer: null, answerUnreadable: null, boardRowMissing: false };
  }
  const witness = unsetFieldAsNull({ key: "witness", record: settled });
  return {
    ...base,
    answer: { settlement: settled.settlement, witness },
    answerUnreadable: null,
    boardRowMissing: false,
  };
}

/**
 * Every steer about an automation, grouped by the row it names.
 *
 * @param home the state home
 * @param issues where an unreadable relay ledger or turn is said
 * @returns steers by recipe id, and why the relay ledger would not read when it would not
 */
export function steersByRecipe({ home, issues }: { home: string; issues: string[] }): {
  rows: ReadonlyMap<string, readonly SteerView[]>;
  gap: string | null;
} {
  const ledger = readRelayLedger({ home });
  const byRecipe = new Map<string, SteerView[]>();
  if (ledger.isErr()) {
    const gap = `${ledger.error.message} — no card shows the steers sent about it`;
    issues.push(gap);
    return { gap, rows: byRecipe };
  }
  // A turn re-receipted is one steer: it is read and drawn once.
  const seen = new Set<string>();
  for (const receipt of ledger.value.rows) {
    if (!receipt.about.startsWith(RECIPE_ABOUT) || seen.has(receipt.turnId)) {
      continue;
    }
    seen.add(receipt.turnId);
    const recipeId = receipt.about.slice(RECIPE_ABOUT.length);
    const steer = steerOf({ home, turn: currentTurn({ home, issues, receipt }) });
    const list = byRecipe.get(recipeId);
    if (list === undefined) {
      byRecipe.set(recipeId, [steer]);
    } else {
      list.push(steer);
    }
  }
  return { gap: undecodedGap({ issues, undecoded: ledger.value.undecoded, what: "relay receipt" }), rows: byRecipe };
}
