/**
 * The reader for the Alignment page's cut-ins chart: `talk cut-ins --json` (`src/talk/scriptedCutIns.ts`), each time
 * what reads as the console's own progress line cut into an answer the voice was already giving.
 *
 * Strict in `./read.ts`'s sense: one cut-in that does not read refuses the whole reading — a chart missing a point
 * would draw a fall that did not happen, which is the one thing this chart exists to show honestly.
 */

import { type Bag, bags, instant, isBag, num, str, strings } from "../../lib/bag";

/** What reads as one progress line spoken inside an answer. */
export interface ScriptedCutIn {
  readonly anchor: string;
  readonly atIso: string;
  /** The progress line's words as the transcript has them. */
  readonly line: string;
  /** The voice's own words it landed after. */
  readonly before: string;
}

/** The whole reading. */
export interface ScriptedCutIns {
  readonly observedAtIso: string;
  readonly sinceIso: string;
  /** The voice calls read: a typed conversation speaks no progress line, so it is not in the rate. */
  readonly calls: number;
  readonly cutIns: readonly ScriptedCutIn[];
  /** What did not read whole, so a zero beside one may not be a zero. */
  readonly gaps: readonly string[];
}

/** One cut-in, or `undefined` when any field will not read. */
function cutInOf({ bag }: { bag: Bag }): ScriptedCutIn | undefined {
  const anchor = str({ bag, key: "anchor" });
  const atIso = instant({ bag, key: "atIso" });
  const line = str({ bag, key: "line" });
  const before = str({ bag, key: "before" });
  if (anchor === undefined || atIso === undefined || line === undefined || before === undefined) {
    return undefined;
  }
  return { anchor, atIso, before, line };
}

/**
 * Project `talk cut-ins --json`.
 *
 * @returns the reading, or `undefined` when the payload or any cut-in in it does not read
 */
export function readScriptedCutIns(payload: unknown): ScriptedCutIns | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = instant({ bag: payload, key: "observedAtIso" });
  const sinceIso = instant({ bag: payload, key: "sinceIso" });
  const calls = num({ bag: payload, key: "calls" });
  const list = bags({ bag: payload, key: "cutIns" });
  const gaps = strings({ bag: payload, key: "gaps" });
  if (observedAtIso === undefined || sinceIso === undefined || calls === undefined) {
    return undefined;
  }
  if (list === undefined || gaps === undefined) {
    return undefined;
  }
  const cutIns: ScriptedCutIn[] = [];
  for (const one of list) {
    const cut = cutInOf({ bag: one });
    if (cut === undefined) {
      return undefined;
    }
    cutIns.push(cut);
  }
  return { calls, cutIns, gaps, observedAtIso, sinceIso };
}
