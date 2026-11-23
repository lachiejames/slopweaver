/**
 * One bounded page of a call's thread journal, for `slopweaver talk call-thread`, and the text it prints. Pure. One
 * entry by default: a stored entry can be 8 MiB (`./callThreadFit.ts`), so a reader asks for more on purpose.
 */
import { isRecord } from "../lib/parsers.js";
import type { StoredCallThreadEntry } from "./callThreadEntry.js";

/** Entries a page carries when `--limit` is not given. */
export const CALL_THREAD_LIMIT_DEFAULT = 1;

/** The most entries one page may carry. */
export const CALL_THREAD_LIMIT_MAX = 10;

/** One page of a call's journal. */
export interface CallThreadPage {
  readonly callId: string;
  /** The first entry's zero-based index. */
  readonly from: number;
  /** How many entries the whole journal holds. */
  readonly total: number;
  /** How many journal lines did not parse — torn by a crash, most likely. */
  readonly skipped: number;
  /** The `--from` of the next page, `null` on the last. */
  readonly nextFrom: number | null;
  readonly entries: readonly { readonly index: number; readonly entry: StoredCallThreadEntry }[];
}

/**
 * Cut one page out of a call's journal.
 *
 * @param entries every stored entry, in journal order
 * @param skipped how many lines did not parse
 * @param from the first entry's zero-based index
 * @param limit how many entries at most
 * @returns the page
 */
export function callThreadPage({
  callId,
  entries,
  skipped,
  from,
  limit,
}: {
  callId: string;
  entries: readonly StoredCallThreadEntry[];
  skipped: number;
  from: number;
  limit: number;
}): CallThreadPage {
  const shown = entries.slice(from, from + limit).map((entry, offset) => ({ entry, index: from + offset }));
  const end = from + shown.length;
  return { callId, entries: shown, from, nextFrom: end < entries.length ? end : null, skipped, total: entries.length };
}

/**
 * A capture's identifiers worth a header: its method, thread, turn, item type and id, tool, whichever it carries.
 *
 * @param entry the stored entry
 * @returns `key=value` pairs, in a fixed order
 */
function headerFields({ entry }: { entry: StoredCallThreadEntry }): string[] {
  const capture = entry.capture;
  if (!isRecord(capture)) {
    return [];
  }
  const params = isRecord(capture["params"]) ? capture["params"] : {};
  const item = isRecord(params["item"]) ? params["item"] : {};
  const fields: [string, unknown][] = [
    ["method", capture["method"]],
    ["thread", capture["threadId"]],
    ["thread", params["threadId"]],
    ["turn", capture["turnId"]],
    ["turn", params["turnId"]],
    ["item", item["type"]],
    ["id", item["id"]],
    ["tool", capture["tool"]],
  ];
  return fields.filter(([, value]) => typeof value === "string").map(([key, value]) => `${key}=${String(value)}`);
}

/**
 * What sanitising did to an entry, in one line, or nothing when it is kept as it arrived.
 *
 * @param entry the stored entry
 * @returns the line, or `undefined`
 */
function alteredLine({ entry }: { entry: StoredCallThreadEntry }): string | undefined {
  const said: string[] = [];
  if (entry.withheld !== null) {
    said.push(
      `WITHHELD (${entry.withheld.reason}${entry.withheld.labels.length > 0 ? `: ${entry.withheld.labels.join(", ")}` : ""})`,
    );
  }
  if (entry.redactions.length > 0) {
    said.push(`masked ${entry.redactions.map((r) => `${String(r.count)} ${r.label}`).join(", ")}`);
  }
  if (entry.binaryStandIns > 0) {
    said.push(`${String(entry.binaryStandIns)} inline binary replaced by its digest`);
  }
  if (entry.truncation !== null) {
    said.push(
      `${String(entry.truncation.truncatedBytes)} bytes cut to fit a ${String(entry.truncation.originalBytes)}-byte line`,
    );
  }
  return said.length === 0 ? undefined : `    altered: ${said.join("; ")}`;
}

/**
 * A page as text: a header per entry, what sanitising did to it, then its capture as indented JSON.
 *
 * @returns the lines to print
 */
export function callThreadLines({ page }: { page: CallThreadPage }): readonly string[] {
  const torn = page.skipped > 0 ? `; ${String(page.skipped)} line(s) unreadable` : "";
  if (page.entries.length === 0) {
    return [
      `talk call-thread: call ${page.callId} has ${String(page.total)} entr(ies); --from is past the last${torn}`,
    ];
  }
  const shown = `${String(page.from)}–${String(page.from + page.entries.length - 1)}`;
  const next = page.nextFrom === null ? "the last of them" : `next page --from ${String(page.nextFrom)}`;
  const lines = [`talk call-thread: call ${page.callId}, entries ${shown} of ${String(page.total)} — ${next}${torn}`];
  for (const { index, entry } of page.entries) {
    lines.push(
      `[${String(index)}] ${entry.receivedAtIso}  ${entry.kind}  ${headerFields({ entry }).join(" ")}`.trimEnd(),
    );
    const altered = alteredLine({ entry });
    if (altered !== undefined) {
      lines.push(altered);
    }
    lines.push(
      ...JSON.stringify(entry.capture, null, 2)
        .split("\n")
        .map((line) => `    ${line}`),
    );
  }
  return lines;
}
