/**
 * What the call leg reads off the wire and the page, as values: the call ids the console's answers and the page's
 * transcript batches carry, and whether a transcript holds the owner's turn and an answer to it. Pure; the listeners and the
 * page reads are `src/cli/commands/desktop/e2eCallPage.ts`.
 */
import { isRecord } from "#lib/parsers.js";
import { OWNER_SPEAKER } from "../talk/callRecord.js";

/**
 * The plan call id a successful `/api/talk/offer` answer carries (`site/app/api/talk/offer/route.ts`'s `minted`).
 *
 * @param body the answer's JSON
 * @returns the id, or `undefined` for a refusal or anything else
 */
export function offerCallIdOf({ body }: { body: unknown }): string | undefined {
  if (!isRecord(body) || body["ok"] !== true || typeof body["callId"] !== "string") {
    return undefined;
  }
  return body["callId"];
}

/**
 * The transcript call id a `/api/talk/transcript` batch names.
 *
 * @param body the request's raw body, `null` for none
 * @returns the id, or `undefined` when the body names none
 */
export function transcriptCallIdOf({ body }: { body: string | null }): string | undefined {
  if (body === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed["callId"] !== "string") {
    return undefined;
  }
  return parsed["callId"];
}

/**
 * Add an id once, keeping first-seen order.
 *
 * @param into the list
 * @param id the id, `undefined` for none
 */
export function addOnce({ into, id }: { into: string[]; id: string | undefined }): void {
  if (id !== undefined && !into.includes(id)) {
    into.push(id);
  }
}

/**
 * The selector for the live call's settled rows. Carried history, however late it renders, is a `data-row="earlier:…"`
 * row (`site/components/voice/StageHistory.tsx`'s `earlierRows`), so this selector never reads it.
 */
export const E2E_LIVE_ROWS = 'ol[aria-label="what was said"] li[data-row^="live:"][data-final="true"]';

/**
 * The selector for every row of the live call, settled or still being heard: what one snapshot reads to tell a
 * settled row from one still growing.
 */
export const E2E_ANY_LIVE_ROWS = 'ol[aria-label="what was said"] li[data-row^="live:"]';

/** One snapshot of the live call's rows: those settled, in order, and how many were still being heard. */
export interface LiveSnapshot {
  readonly rows: readonly E2eRow[];
  readonly unsettled: number;
}

/**
 * Split one read of every live row into the settled rows and a count of those still being heard, the owner's
 * or the voice's only.
 *
 * @param raw each row's `data-who`, `data-medium`, `data-final` and text, as the page gave them
 * @returns the settled rows, and how many rows were not yet settled
 */
export function liveSnapshotOf({
  raw,
}: {
  raw: readonly {
    readonly who: string | null;
    readonly text: string | null;
    readonly medium: string | null;
    readonly final: string | null;
  }[];
}): LiveSnapshot {
  const spoken = raw.filter((row) => speakerOf({ who: row.who }) !== undefined);
  return {
    rows: rowsOf({ raw: spoken.filter((row) => row.final === "true") }),
    unsettled: spoken.filter((row) => row.final !== "true").length,
  };
}

/** One settled row of the transcript the page shows for the call up now. */
export interface E2eRow {
  readonly who: typeof OWNER_SPEAKER | "voice";
  readonly text: string;
}

/**
 * The mark a row of a typed conversation opens with (`site/components/voice/StageHistory.tsx`'s `TYPED_LABEL` span),
 * which `textContent` runs straight into the row's words: a typed "FOUND" reads `typedFOUND` (measured on the real
 * app).
 */
const TYPED_MARK = "typed";

/**
 * Keep the rows that are the owner's or the voice's, typed, each row's words without the mark a typed conversation's row
 * opens with.
 *
 * @param raw each row's `data-who`, `data-medium` and text, as the page gave them
 * @returns the rows, in order
 */
export function rowsOf({
  raw,
}: {
  raw: readonly { readonly who: string | null; readonly text: string | null; readonly medium: string | null }[];
}): readonly E2eRow[] {
  const rows: E2eRow[] = [];
  for (const row of raw) {
    const who = speakerOf({ who: row.who });
    if (who !== undefined) {
      const text = String(row.text);
      const marked = row.medium === "typed" && text.startsWith(TYPED_MARK);
      rows.push({ text: marked ? text.slice(TYPED_MARK.length) : text, who });
    }
  }
  return rows;
}

/** A row's speaker, the owner's or the voice's; `undefined` for any other row. */
function speakerOf({ who }: { who: string | null }): E2eRow["who"] | undefined {
  if (who === OWNER_SPEAKER || who === "voice") {
    return who;
  }
  return undefined;
}

/**
 * Whether two reads of the transcript show the same rows, word for word, so a voice still speaking — a row growing,
 * or a correction appended after the answer — reads as a change.
 *
 * @param before the earlier read
 * @param after the later read
 * @returns true when nothing was added, removed or rewritten between them
 */
export function sameRows({ before, after }: { before: readonly E2eRow[]; after: readonly E2eRow[] }): boolean {
  return (
    before.length === after.length &&
    before.every((row, at) => row.who === after[at]!.who && row.text === after[at]!.text)
  );
}

/**
 * Whether rows hold a turn of the owner's matching a test and a voice row after it.
 *
 * @param rows the live call's final rows
 * @param ownerText what the owner's turn must contain, `undefined` for any owner turn
 * @returns the owner's turn, and the answer after it
 */
export function turnAndAnswer({ rows, ownerText }: { rows: readonly E2eRow[]; ownerText: string | undefined }): {
  readonly ownerTurn: boolean;
  readonly voiceAnswer: boolean;
} {
  const at = rows.findIndex((row) => row.who === "owner" && (ownerText === undefined || row.text.includes(ownerText)));
  if (at === -1) {
    return { ownerTurn: false, voiceAnswer: false };
  }
  return { ownerTurn: true, voiceAnswer: rows.slice(at + 1).some((row) => row.who === "voice") };
}
