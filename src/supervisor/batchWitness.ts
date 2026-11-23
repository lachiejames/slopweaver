/**
 * The witness of a chair turn that is exactly a quiet batch line (`../talk/chairBatchLine.ts`), split from
 * `./intake.ts`, whose `witnessFor` asks it after a wake and before the ledger marks.
 */
import { anchorText, chairBatchMembers } from "../talk/chairBatchLine.js";
import type { TurnWitness } from "./intake.js";

/**
 * The witness of a chair turn that is exactly a quiet batch line: the anchors it lists. Like a wake it carries none of
 * the owner's words — the stretches are the call files', and every relay it names was registered before it was held — so only
 * a line whose every listed relay has its row on the board is witnessed; a slug with no row stays unwitnessed, as an
 * orphaned delivery line does.
 *
 * @param fromRelayRows the slugs of the relay rows on the board
 * @param text the chair turn's whole text
 * @returns the anchors it lists as a wake witness, or `undefined` for a turn that is no batch line or names an orphan
 */
export function batchWitness({
  fromRelayRows,
  text,
}: {
  fromRelayRows: ReadonlySet<string>;
  text: string;
}): TurnWitness | undefined {
  const members = chairBatchMembers({ text });
  if (members === undefined) {
    return undefined;
  }
  const orphaned = members.listed.some((anchor) => anchor.kind === "relay" && !fromRelayRows.has(anchor.slug));
  if (orphaned) {
    return undefined;
  }
  const listed = members.listed.map((anchor) => anchorText({ anchor })).join(", ");
  if (listed === "") {
    return { kind: "wake", witness: "talk unread" };
  }
  return { kind: "wake", witness: listed };
}
