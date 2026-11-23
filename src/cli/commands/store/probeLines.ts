/**
 * The rendered half of the probe family: the human report each read prints, with no I/O anywhere.
 *
 * Split from `./probeCore.ts`'s parsers along the seam every verb here already has — what a caller asked
 * for, and what it is shown — so each half can be asserted exactly on its own.
 */
import type { AroundPage } from "../../../store/probe/disclose.js";
import type { RecordHead, RecordOpen, RecordPeek } from "../../../store/probe/head.js";
import { cellLine, collapse, type ProbeCell, type ProbeReport, type ProbeRow } from "../../../store/probe/result.js";
import type { GroupFacet, StoreGroup } from "../../../store/probe/run.js";

/**
 * The human report a probe prints: one ladder per subject, narrowest rung first.
 *
 * @param report what the probe found
 * @returns the lines
 */
export function probeLines({ report }: { report: ProbeReport }): readonly string[] {
  const scope = report.source === null ? "the whole store" : `source ${report.source}`;
  const authors = report.includeBots ? "every author, bots included" : "human authors only";
  return [
    ...report.rows.flatMap((row) => ladderLines({ enumerateAtOrBelow: report.enumerateAtOrBelow, row })),
    `probed ${scope} (${authors}) in ${String(report.elapsedMs)} ms`,
  ];
}

/**
 * The line saying how many bot-authored rows the human-only default left out of a subject, if any.
 *
 * Printed only when the number is above zero: a widened probe hid nothing, and a human-only probe whose
 * widest set held no bot rows would not change if widened, so a line in either case would be noise in the
 * one report a detective reads before every other rung.
 *
 * @param row one subject's ladder
 * @returns the line, or nothing
 */
function botsHiddenLine({ row }: { row: ProbeRow }): readonly string[] {
  if (row.botsHidden === 0) {
    return [];
  }
  const set = row.kind === "regex" ? "this pattern's matches" : "the wild-both set";
  return [`  bots: ${String(row.botsHidden)} bot-authored row(s) in ${set} not counted — widen with --include-bots`];
}

/**
 * The lines for one subject's whole ladder, including where its count collapses.
 *
 * @param row one subject's ladder
 * @param enumerateAtOrBelow the cap a cell's ids were fetched at or below
 * @returns the lines, ending in a blank one
 */
function ladderLines({ row, enumerateAtOrBelow }: { row: ProbeRow; enumerateAtOrBelow: number }): readonly string[] {
  const drop = collapse({ row });
  return [
    `${row.kind === "regex" ? "regex" : "keyword"} ${row.subject}   (${String(row.elapsedMs)} ms)`,
    `  ${"shape".padEnd(10)} ${"wildcard".padEnd(24)} ${"rows".padStart(9)}  by source`,
    ...row.cells.flatMap((cell) => [`  ${cellLine({ cell })}`, ...idsLine({ cell, enumerateAtOrBelow })]),
    ...(drop === null
      ? []
      : [`  collapse: ${drop.to} is ${drop.factor.toFixed(1)}x ${drop.from} — read ${drop.from} first`]),
    ...botsHiddenLine({ row }),
    "",
  ];
}

/**
 * The ids line under one cell — the record ids, or why they were not asked for.
 *
 * A cell with `ids: null` prints the cap rather than nothing, because "not asked" and "none found" are the
 * distinction the whole ladder turns on and a blank line makes them look identical.
 *
 * @param cell one rung of the ladder
 * @param enumerateAtOrBelow the cap a cell's ids were fetched at or below
 * @returns the line, or nothing when the cell found no rows at all
 */
function idsLine({ cell, enumerateAtOrBelow }: { cell: ProbeCell; enumerateAtOrBelow: number }): readonly string[] {
  if (cell.ids === null) {
    return [`    ids: not asked — above the ${String(enumerateAtOrBelow)}-row enumeration cap`];
  }
  return cell.ids.length === 0 ? [] : [`    ids: ${cell.ids.join(" ")}`];
}

/**
 * The human report a groups read prints.
 *
 * @param groups what the read found
 * @param facet which column it grouped by
 * @param includeBots whether bot-authored rows were grouped too, which the footer says either way
 * @returns the lines
 */
export function groupLines({
  groups,
  facet,
  includeBots,
}: {
  groups: readonly StoreGroup[];
  facet: GroupFacet;
  includeBots: boolean;
}): readonly string[] {
  const total = groups.reduce((sum, group) => sum + group.rows, 0);
  const authors = includeBots ? "every author, bots included" : "human authors only; --include-bots widens";
  return [
    ...groups.map((group) => `${String(group.rows).padStart(9)}  ${group.value}`),
    `${String(groups.length)} ${facet} group(s) over ${String(total)} listed row(s) — ${authors}`,
  ];
}

/** How much of one neighbour's excerpt a report line carries before it is cut. */
const AROUND_LINE_CHARS = 200;

/**
 * One record as an around report prints it: the marker, when, who, and one line of what.
 *
 * @param record the record to render
 * @param marker the two characters that open the line, saying what this row is
 * @param suffix anything to append to the header line, such as a reply count
 * @returns the two lines this record occupies
 */
function aroundRecordLine({
  record,
  marker,
  suffix,
}: {
  record: { readonly occurredAt: string; readonly author: string | null; readonly excerpt: string };
  marker: string;
  suffix: string;
}): string {
  // An `if` rather than `record.author ?? "(unknown)"`: `no-silent-fallback` bans the coalescing operator
  // outright, and oxlint's `prefer-nullish-coalescing` refuses the ternary that would otherwise stand here.
  let who = "(unknown)";
  if (record.author !== null) {
    who = record.author;
  }
  const oneLine = record.excerpt.replaceAll("\n", " ").slice(0, AROUND_LINE_CHARS);
  return `${marker} ${record.occurredAt}  ${who}${suffix}\n     ${oneLine}`;
}

/**
 * Slack's own "N replies" affordance, as text — and nothing at all for a message that has none.
 *
 * A message with no replies reads as a message; printing "(0 replies)" under every one of them would
 * bury the handful that ARE conversations, which is the only thing this column is here to surface.
 *
 * @param replies how many replies the platform counted
 * @returns the suffix for the header line, empty when there are no replies
 */
function replyAffordance({ replies }: { replies: number }): string {
  if (replies === 0) {
    return "";
  }
  if (replies === 1) {
    return "  (1 reply)";
  }
  return `  (${String(replies)} replies)`;
}

/**
 * The channel band's lines — the top-level messages the anchor's thread hangs among.
 *
 * Each carries its reply count, because that is the affordance a person uses to decide which nearby
 * message is the conversation they were looking for, and the thread the anchor sits in is marked so the
 * reader can see where the two bands join.
 *
 * @param page the anchor and its neighbours
 * @returns the lines, or none when this read has no channel band
 */
function channelBandLines({ page }: { page: AroundPage }): readonly string[] {
  if (page.channel.length === 0) {
    return [];
  }
  return [
    `── the channel around it — ${String(page.channel.length)} top-level message(s), oldest first`,
    "",
    ...page.channel.map((record) =>
      aroundRecordLine({
        marker: record.isAnchorThread ? "**" : "  ",
        record,
        suffix: replyAffordance({ replies: record.replyCount }),
      }),
    ),
    "",
  ];
}

/**
 * The human report an around read prints — the thread the anchor is in, then the channel around it.
 *
 * The two bands are printed apart and labelled, because a channel and a thread are different things to
 * the person reading and merging them is the failure `--mode container` already demonstrates. `->` marks
 * the anchor inside its thread and `**` marks that thread's own row in the channel, so the join between
 * the two bands is visible rather than inferred.
 *
 * @param page the anchor and its neighbours
 * @returns the lines
 */
export function aroundLines({ page }: { page: AroundPage }): readonly string[] {
  const band = page.mode === "conversation" ? "the thread it sits in" : `its ${page.mode}`;
  return [
    `${String(page.records.length)} record(s) around ${page.anchor.id} (${page.mode})`,
    "",
    `── ${band} — ${String(page.records.length)} record(s), oldest first`,
    "",
    ...page.records.map((record) =>
      aroundRecordLine({ marker: record.id === page.anchor.id ? "->" : "  ", record, suffix: "" }),
    ),
    "",
    ...channelBandLines({ page }),
    ...page.limitations.map((limit) => `note: ${limit}`),
  ];
}

/** Who a record's author resolved to — `(unknown)` for a row the store resolved no person for. */
function authorName({ head }: { head: RecordHead }): string {
  if (head.author === null) {
    return "(unknown)";
  }
  return head.author;
}

/**
 * One hit as `store hits` prints it: id, source, instant, author and link.
 *
 * @param hit one record the search rung listed
 * @returns the line
 */
export function hitLine({ hit }: { hit: RecordHead }): string {
  return `${hit.id}  ${hit.source.padEnd(7)} ${hit.occurredAt}  ${authorName({ head: hit })}  ${hit.url}`;
}

/** A peeked record's header container — `(no container)` for a row filed under none. */
function peekContainer({ peek }: { peek: RecordPeek }): string {
  if (peek.container === null) {
    return "(no container)";
  }
  return peek.container;
}

/** A peeked record's title line — `(no title)` for a row that carries none. */
function peekTitle({ peek }: { peek: RecordPeek }): string {
  if (peek.title === null) {
    return "(no title)";
  }
  return peek.title;
}

/**
 * One record as `store peek` prints it: who and where, its title, then the window and where it sits.
 *
 * @param peek one record's window
 * @returns the lines, ending in a blank one
 */
export function peekLines({ peek }: { peek: RecordPeek }): readonly string[] {
  return [
    `${peek.id}  ${peek.source}  ${peek.occurredAt}  ${authorName({ head: peek })}  ${peekContainer({ peek })}`,
    `  ${peekTitle({ peek })}`,
    `  [${String(peek.from)}..${String(peek.from + peek.excerpt.length)} of ${String(peek.bodyChars)}] ${peek.excerpt.replaceAll("\n", "\n  ")}`,
    "",
  ];
}

/** An opened record's container — `(none)` for a row filed under none. */
function openContainer({ record }: { record: RecordOpen }): string {
  if (record.container === null) {
    return "(none)";
  }
  return record.container;
}

/**
 * One record whole, as `store open` prints it, with the URLs its text linked to.
 *
 * @param record the record, body included
 * @returns the lines
 */
export function openLines({ record }: { record: RecordOpen }): readonly string[] {
  return [
    `--- ${record.id}  ${record.source}/${record.kind}  ${record.occurredAt}`,
    `author: ${authorName({ head: record })}   container: ${openContainer({ record })}`,
    `url: ${record.url}`,
    ...(record.title === null ? [] : [`title: ${record.title}`]),
    "",
    record.body,
    "",
    ...(record.refs.length === 0 ? [] : [`links: ${record.refs.join(" ")}`, ""]),
  ];
}
