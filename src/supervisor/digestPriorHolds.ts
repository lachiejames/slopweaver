/**
 * What the previous tick held, read off its filled `tick.json`, so `tick open`'s `seatable:` block leaves those rows
 * out. Pure: the edge that reads the file is `../cli/commands/supervisor/tickDigestEdge.ts`.
 */
import { listOf, type PriorHolds } from "./digestRead.js";
import { type AuthoredJudgement, authoredJudgementSchema } from "./tickAuthoredJudgement.js";

/**
 * The board rows a filled `tick.json`'s `hold-rationale` judgements held, by EXACT id — the subject and every
 * related subject of kind `handover`, the same match `tick close`'s starving-row gate makes
 * (`../cli/commands/supervisor/tickRecordGates.ts`). A row a claim names only in prose ("and the EEEE-861 stack")
 * is not held here: name each row as a related subject to hold it.
 *
 * Each judgement is read in the AUTHORED shape `tick close` accepts, never the ledger row's: the file carries no
 * `recordedIso`, because the close stamps it. Read with the row schema, every draft judgement failed and every tick
 * read its predecessor's holds as unknown (measured: 18 of 18 judgements failed in one tick).
 *
 * @param tick the previous tick's number
 * @param value the parsed `tick.json`
 * @returns what it held, each id with the claim that held it, or unreadable when the file carries no judgements
 *   list or a judgement `tick close` would refuse — read as empty, either would hold nothing and every row it
 *   held would be offered a seat
 */
export function priorHoldsOf({ tick, value }: { tick: number; value: unknown }): PriorHolds {
  const judgements = listOf({ key: "judgements", value });
  if (judgements === undefined) {
    return { kind: "unreadable", tick, why: "its tick.json carries no judgements list" };
  }
  const parsed = judgements.map((judgement) => authoredJudgementSchema.safeParse(judgement));
  const read = parsed.flatMap((one) => (one.success ? [one.data] : []));
  if (read.length < parsed.length) {
    const malformed = String(parsed.length - read.length);
    return { kind: "unreadable", tick, why: `${malformed} of its judgement(s) do not match the tick schema` };
  }
  const held = new Map<string, string>();
  for (const judgement of read.filter((one) => one.kind === "hold-rationale")) {
    for (const id of handoverIds({ judgement })) {
      if (!held.has(id)) {
        held.set(id, judgement.claim);
      }
    }
  }
  return { held, kind: "read", tick };
}

/**
 * The handover rows one judgement names: its subject and each related subject of kind `handover`.
 *
 * @param judgement one judgement `tick close` accepted
 * @returns the row ids
 */
function handoverIds({ judgement }: { judgement: AuthoredJudgement }): readonly string[] {
  const subjects = [judgement.subject];
  if (judgement.relatedSubjects !== undefined) {
    subjects.push(...judgement.relatedSubjects);
  }
  return subjects.filter((subject) => subject.kind === "handover").map((subject) => subject.id);
}
