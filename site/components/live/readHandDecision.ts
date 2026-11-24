/*
 * The decision a hand step carries in its own record (`hand post --decision`, `src/hand/decisionContext.ts`), read off
 * the register's published row whole or not at all. Its own module beside `./read.ts`, the way `./readChecklist.ts` is.
 */
import { isBag, str, sub } from "../../lib/bag";

/** A decision carried on a hand step, exactly as the register publishes it (`src/hand/decisionContext.ts`). */
export interface HandStepDecision {
  readonly problem: string;
  readonly options: readonly {
    readonly letter: string;
    readonly option: string;
    readonly tradeoff: string;
    readonly command?: string;
  }[];
  readonly lean: string;
  readonly stakes: { readonly risk: string; readonly blastRadius: string; readonly stillReal: string };
}

/**
 * Read a step's carried decision, whole or not at all.
 *
 * @param value the raw `decision` field
 * @returns `{ decision }`, its `decision` undefined when absent, or `undefined` when present and not whole
 */
export function readHandDecision({
  value,
}: {
  value: unknown;
}): { readonly decision: HandStepDecision | undefined } | undefined {
  if (value === undefined) {
    return { decision: undefined };
  }
  if (!isBag(value)) {
    return undefined;
  }
  const problem = str({ bag: value, key: "problem" });
  const lean = str({ bag: value, key: "lean" });
  const stakes = sub({ bag: value, key: "stakes" });
  const listed = value["options"];
  if (problem === undefined || lean === undefined || stakes === undefined || !Array.isArray(listed)) {
    return undefined;
  }
  const risk = str({ bag: stakes, key: "risk" });
  const blastRadius = str({ bag: stakes, key: "blastRadius" });
  const stillReal = str({ bag: stakes, key: "stillReal" });
  if (risk === undefined || blastRadius === undefined || stillReal === undefined) {
    return undefined;
  }
  const options: HandStepDecision["options"][number][] = [];
  for (const one of listed as readonly unknown[]) {
    if (!isBag(one)) {
      return undefined;
    }
    const letter = str({ bag: one, key: "letter" });
    const option = str({ bag: one, key: "option" });
    const tradeoff = str({ bag: one, key: "tradeoff" });
    if (letter === undefined || option === undefined || tradeoff === undefined) {
      return undefined;
    }
    const command = str({ bag: one, key: "command" });
    options.push({ ...(command === undefined ? {} : { command }), letter, option, tradeoff });
  }
  return { decision: { lean, options, problem, stakes: { blastRadius, risk, stillReal } } };
}
