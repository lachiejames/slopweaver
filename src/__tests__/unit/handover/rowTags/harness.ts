/*
 * What the board-row tag test files share: two instants, a `tagged` event builder, the derivable fields of a parsed
 * row, and a run parked on the owner. They moved here when `rowTags.test.ts` was split by behaviour.
 */
import type { RunDisposition } from "../../../../handover/boardTypes.js";
import { parseHandoverDoc } from "../../../../handover/doc.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { fieldsOfDoc } from "../../../../handover/rowTagFold.js";

export const AT = "2026-09-27T08:00:00.000Z";
export const LATER = "2026-09-27T09:00:00.000Z";

/**
 * One `tagged` event.
 *
 * @returns the `tagged` run event
 */
export function tagged({
  set = [],
  drop = [],
  atIso = AT,
}: {
  set?: readonly { key: string; value: string }[];
  drop?: readonly string[];
  atIso?: string;
}): RunEvent {
  return { atIso, drop, kind: "tagged", set, why: "test" };
}

/**
 * The derivable fields of a parsed row, with its run folded only when a case passes one.
 *
 * @returns the fields `fieldsOfDoc` reads off the row
 */
export function fields({
  lines,
  run,
}: {
  lines: readonly string[];
  run?: RunDisposition;
}): ReturnType<typeof fieldsOfDoc> {
  return fieldsOfDoc({ doc: doc({ lines }), run });
}

/**
 * A run parked on the owner, offering a draft only when `drafted` — an unreadable one, the case `action` alone misses.
 *
 * @returns the `waiting-on-owner` disposition
 */
export function waiting({ drafted }: { drafted: boolean }): RunDisposition {
  return {
    action: undefined,
    actionUnreadable: drafted,
    askedIso: AT,
    kind: "waiting-on-owner",
    question: "ship it?",
    shape: undefined,
    shapeIso: undefined,
  };
}

/** A parsed row from front-matter lines. */
function doc({ lines }: { lines: readonly string[] }): ReturnType<typeof parseHandoverDoc> {
  return parseHandoverDoc({
    path: "/h/a-row.md",
    text: ["---", "slug: a-row", "summary: s", "status: ready", "artifact: null", ...lines, "---", "", "body"].join(
      "\n",
    ),
  });
}
