/**
 * The pure half of a row's FURTHER steers (`../../../handover/hisWordsSteers.ts`): what each one needs, and the text
 * that writes one. `./quotePlan.ts` is the same pair for the row's own quote; a steer is judged and written ONE INDEX
 * AT A TIME, so a steer that will not read or write never holds back the row's own quote or a sibling.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { addFrontMatterFields, editFrontMatterFields } from "../../../handover/frontmatter.js";
import { type FrontMatterError, FrontMatterErrors } from "../../../handover/frontmatterErrors.js";
import { bothSpellingsOf, type HisWords, type HisWordsRecord, sameHisWords } from "../../../handover/hisWords.js";
import type { HisWordsError } from "../../../handover/hisWordsErrors.js";
import { recordOfRead } from "../../../handover/hisWordsRecord.js";
import {
  type HisWordsSteer,
  hisWordsSteerFields,
  hisWordsSteerKeys,
  nextHisWordsSteerIndex,
  steerAnchor,
} from "../../../handover/hisWordsSteers.js";
import { damageBeyondTheGroup } from "./quotePlan.js";

/**
 * What one steer needs. `current`, `still-unread` and `defect` write nothing — a defect, even one still declaring the
 * anchor being related, waits for a hand rather than gaining a second group beside it — and `answered` is an anchor
 * the row's own `anchor:` already quotes.
 */
export type SteerVerdict =
  | { readonly kind: "current" | "answered"; readonly index: number }
  | { readonly kind: "still-unread" | "defect"; readonly index: number; readonly why: string }
  | { readonly kind: "add" | "refresh" | "unread"; readonly index: number; readonly record: HisWordsRecord };

/**
 * Where an anchor sits on a row: the row's own, an existing steer, or the number a new steer would take.
 *
 * @param doc the row
 * @param anchor the anchor of the owner's words being related to it
 * @returns where it sits
 */
export function steerSlotFor({
  doc,
  anchor,
}: {
  doc: HandoverDoc;
  anchor: string;
}):
  | { readonly kind: "answered" }
  | { readonly kind: "held"; readonly steer: HisWordsSteer }
  | { readonly kind: "free"; readonly index: number } {
  if (doc.anchor === anchor) {
    return { kind: "answered" };
  }
  const steer = doc.hisWordsSteers.find((one) => steerAnchor({ steer: one }) === anchor);
  if (steer !== undefined) {
    return { kind: "held", steer };
  }
  return { index: nextHisWordsSteerIndex({ steers: doc.hisWordsSteers }), kind: "free" };
}

/**
 * What one steer needs, given what its anchor's record says now.
 *
 * @param index the steer's number
 * @param stored what the row stores at that number, `undefined` when the steer is new
 * @param anchor the steer's anchor
 * @param read the record's words
 * @returns the verdict
 */
export function steerVerdict({
  index,
  stored,
  anchor,
  read,
}: {
  index: number;
  stored: HisWordsSteer["group"] | undefined;
  anchor: string;
  read: Result<HisWords, HisWordsError>;
}): SteerVerdict {
  if (stored?.kind === "defect") {
    return { index, kind: "defect", why: stored.why };
  }
  const record = recordOfRead({ anchor, read });
  if (stored === undefined) {
    return { index, kind: "add", record };
  }
  if (sameHisWords({ read: record, stored })) {
    if (record.kind === "unread") {
      return { index, kind: "still-unread", why: record.why };
    }
    return { index, kind: "current" };
  }
  if (record.kind === "unread") {
    return { index, kind: "unread", record };
  }
  return { index, kind: "refresh", record };
}

/**
 * Whether a steer's verdict writes the row.
 *
 * @param verdict the steer's verdict
 * @returns true for an add, a refresh, or a newly unread record
 */
export function steerWrites({ verdict }: { verdict: SteerVerdict }): boolean {
  return verdict.kind === "add" || verdict.kind === "refresh" || verdict.kind === "unread";
}

/**
 * The line a steer's verdict prints, past or future tense by whether the run writes.
 *
 * @param verdict the steer's verdict
 * @param applied the run writes
 * @returns the phrase after `steer <n>`
 */
export function steerVerdictPhrase({ verdict, applied }: { verdict: SteerVerdict; applied: boolean }): string {
  switch (verdict.kind) {
    case "current":
      return "current";
    case "answered":
      return "already the row's own anchor, quoted as what it answers";
    case "still-unread":
      return `the owner's words still do not read — ${verdict.why}`;
    case "defect":
      return `left as it is — ${verdict.why}; a hand edit repairs it`;
    case "add":
      return applied ? "related: done" : "would relate it";
    case "refresh":
      return applied ? "refresh the quote: done" : "would refresh the quote";
    case "unread": {
      const why = verdict.record.kind === "unread" ? ` — ${verdict.record.why}` : "";
      return applied
        ? `record why the owner's words would not read: done${why}`
        : `would record why the owner's words would not read${why}`;
    }
    default: {
      const never: never = verdict;
      return never;
    }
  }
}

/**
 * The row's text with steer `index` replaced by `record`: that number's keys removed, a duplicate included, and the
 * record written back — refused when the rewrite would touch a line beyond them or would not read back as written.
 *
 * @param text the row's text as read
 * @param path the row's path, for the problems a refusal names
 * @param index the steer's number
 * @param record what to store
 * @returns the new text, or why the front matter refused the edit
 */
export function textWithSteer({
  text,
  path,
  index,
  record,
}: {
  text: string;
  path: string;
  index: number;
  record: HisWordsRecord;
}): Result<string, FrontMatterError> {
  const keys = bothSpellingsOf({ keys: hisWordsSteerKeys({ index }) });
  const damage = damageBeyondTheGroup({ keys, text });
  if (damage.length > 0) {
    return err(FrontMatterErrors.editWouldDamage({ damage }));
  }
  const cleared = editFrontMatterFields({ path, remove: [...keys], set: [], text });
  if (cleared.isErr()) {
    return err(cleared.error);
  }
  const written = addFrontMatterFields({ fields: hisWordsSteerFields({ index, record }), path, text: cleared.value });
  if (written.isErr()) {
    return written;
  }
  const back = parseHandoverDoc({ path, text: written.value }).hisWordsSteers.find((one) => one.index === index);
  if (back !== undefined && back.group.kind !== "defect" && sameHisWords({ read: back.group, stored: record })) {
    return ok(written.value);
  }
  return err(
    FrontMatterErrors.editWouldDamage({
      damage: [`steer ${String(index)} as written would not read back as the same record`],
    }),
  );
}
