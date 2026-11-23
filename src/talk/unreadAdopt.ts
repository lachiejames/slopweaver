/**
 * Adopting a reader's unread backlog before one instant — the pure half of `slopweaver talk unread-adopt`.
 *
 * `talk unread --mark` records one printed batch at a time, sized to fit a tool result (`./unreadBatch.ts`). That is
 * the right shape for a live call and the wrong one for a backlog: a home carried from another machine, whose
 * supervisor already read every word, arrives with hundreds of stretches unmarked here, and the courier stays off
 * until they are. Adopting marks them read WITHOUT printing them, so it never happens by accident: it names an
 * instant, previews what it would pass, and is applied only with the digest that preview printed.
 *
 * ## What is adopted, per call file
 *
 * The longest PREFIX of the unread lines whose every line is stamped strictly before the instant. The frontier moves
 * to the end of that prefix and nowhere else, so:
 *
 * - a call that straddles the instant keeps every line from the first one at or after it unread, and a stretch whose
 *   early snapshots fall before the instant and whose final falls after it still prints, whole, on the next read;
 * - a line the call schema refused is adopted only when it is still a JSON object with a canonical `atIso` before the
 *   instant — MEASURED on the carried home: six `card-move` lines whose card key the carry's name rewrite put a space
 *   in, which stopped four calls and kept hundreds of their lines unread (a preview, `slopweaver talk unread-adopt
 *   --before <the carry's instant>`, printed them). Every such line is carried in
 *   `unparseablePassed` and printed whole, so none is adopted unseen; a line with no readable instant stops the
 *   prefix, since it may be the owner's words;
 * - a line stamped before the instant that sits AFTER a later one is left unread with everything past it — the byte
 *   order is the one a cursor can record, and stopping at the first later line is the only cut that never passes a
 *   line stamped after the instant;
 * - a frontier standing inside a line read in parts (`CallFrontier.part`) keeps its part when nothing is adopted, and
 *   loses it when the frontier moves: the new frontier is the adopted line's own `after`, which carries none. A part
 *   bound to a later line not adopted is therefore printed again from its first part — a re-read, never a skip.
 *
 * Pure: no filesystem, no clock. The read is `./unreadRead.ts`; the receipt store is `./unreadAdoptReceipts.ts`.
 */
import { createHash } from "node:crypto";

import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";

import type { CallFrontier, CallTail, TailLine, UnparseableLine, UnreadCursor, UnreadRead } from "./unreadWords.js";
import { advancedCursor, selectUnreadWords } from "./unreadWords.js";

/** The prefix every adopt digest carries, so a digest from another verb is never mistaken for one. */
const DIGEST_PREFIX = "adopt-";

/** How many hex characters of the sha256 a digest keeps — enough that a typo never matches. */
const DIGEST_HEX = 16;

/** What adopting does to one call file. */
interface AdoptedCall {
  readonly callId: string;
  /** Where the reader stood in it before, `undefined` for a call it has never read. */
  readonly from: CallFrontier | undefined;
  /** Where it stands once adopted. */
  readonly to: CallFrontier;
  /** How many whole lines the frontier passes. */
  readonly lines: number;
  /** How many stretches of the owner's speech those lines carry. */
  readonly stretches: number;
  /** The earliest and latest instant on a passed line. */
  readonly firstAtIso: string;
  readonly lastAtIso: string;
  /** How many whole lines stay unread in it past the new frontier. */
  readonly linesLeft: number;
}

/** Everything one adopt would record, and the digest an apply must quote. */
export interface AdoptPlan {
  /** The instant every adopted line is stamped strictly before. */
  readonly beforeIso: string;
  /** The calls whose frontier moves, in the read's order. */
  readonly calls: readonly AdoptedCall[];
  /** Stretches of the owner's speech passed, across every call. */
  readonly stretches: number;
  /** Owner-side stretches a console that is not the owner's recorded, passed with them. */
  readonly foreignStretches: number;
  /** Stretches still unread once adopted — everything at or after the instant. */
  readonly stretchesLeft: number;
  /**
   * Lines the call schema refused that still carry an instant before the cutoff, passed WITH the backlog — so every
   * one is printed whole by the preview and the apply, never adopted unseen.
   */
  readonly unparseablePassed: readonly UnparseableLine[];
  /** Lines that will not parse, left unread. */
  readonly unparseableLeft: number;
  /** The cursor the apply writes, stamped with the instant it is recorded at. */
  readonly cursor: UnreadCursor;
  /**
   * `adopt-` and 16 hex: the sha256 of the instant, the reader, the reason, the cursor as read, every quarantined call
   * and every new frontier — never the clock, so a preview and its apply a minute later agree.
   */
  readonly digest: string;
}

/**
 * The instant a line carries: a call line's own, or — for a line the call schema refused — an `atIso` it still holds
 * as a JSON object, which is how a line rewritten by a carry (a card key with a renamed organisation in it) reads.
 * A line that is not a JSON object with a canonical instant carries none, and so is never adopted.
 *
 * @param line one whole line past a frontier
 * @returns its `atIso`, or `undefined`
 */
function lineInstant({ line }: { line: TailLine }): string | undefined {
  if (line.kind === "entry") {
    return line.entry.atIso;
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "talk unread-adopt line", text: line.line.text });
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || !("atIso" in value) || typeof value.atIso !== "string") {
    return undefined;
  }
  const ms = Date.parse(value.atIso);
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== value.atIso) {
    return undefined;
  }
  return value.atIso;
}

/**
 * How many of a tail's leading lines are call lines stamped strictly before the instant.
 *
 * @param tail one call file past the frontier
 * @param beforeMs the instant, in epoch milliseconds
 * @returns the length of the adoptable prefix
 */
function adoptablePrefix({ tail, beforeMs }: { tail: CallTail; beforeMs: number }): number {
  const stop = tail.lines.findIndex((line) => {
    const atIso = lineInstant({ line });
    return atIso === undefined || !(Date.parse(atIso) < beforeMs);
  });
  if (stop === -1) {
    return tail.lines.length;
  }
  return stop;
}

/**
 * The digest an apply must quote: everything that decides what is written, and nothing that does not — the instant the
 * cursor is recorded at is left out, so a preview and the apply a minute later agree.
 *
 * @param beforeIso the adopt instant
 * @param name the reader whose cursor moves, so one reader's approval never moves another's
 * @param why the reason the receipt will carry, so an approval covers the words put on the record too
 * @param read the read the plan was taken from
 * @param calls every frontier the plan moves
 * @returns `adopt-` and 16 hex characters
 */
function adoptDigest({
  beforeIso,
  name,
  why,
  read,
  calls,
}: {
  beforeIso: string;
  name: string;
  why: string;
  read: UnreadRead;
  calls: readonly AdoptedCall[];
}): string {
  const material = safeJsonStringify({
    label: "talk unread-adopt digest",
    value: {
      before: beforeIso,
      calls: calls
        .map((call) => ({ callId: call.callId, to: call.to }))
        .toSorted((a, b) => a.callId.localeCompare(b.callId)),
      cursor: read.cursor === undefined ? null : read.cursor.calls,
      name,
      // A call quarantined between preview and apply changes what the read went past, so it forces a new preview.
      quarantined: read.quarantined.map((row) => row.callId).toSorted(),
      version: "talk-unread-adopt/v1",
      why,
    },
  });
  return `${DIGEST_PREFIX}${createHash("sha256").update(material).digest("hex").slice(0, DIGEST_HEX)}`;
}

/**
 * Plan adopting every line stamped before an instant, for the read given.
 *
 * @param read everything past the reader's frontier, from a read with the first-read floor lifted
 * @param beforeIso the instant every adopted line is stamped strictly before
 * @param name the reader whose cursor the read was taken for
 * @param why the reason the receipt will carry
 * @param recordedAtIso the instant the new cursor is stamped with
 * @returns the plan, with the digest its apply must quote
 */
export function planUnreadAdopt({
  read,
  beforeIso,
  name,
  why,
  recordedAtIso,
}: {
  read: UnreadRead;
  beforeIso: string;
  name: string;
  why: string;
  recordedAtIso: string;
}): AdoptPlan {
  const beforeMs = Date.parse(beforeIso);
  const lifted: UnreadRead = { ...read, bootstrapFloorIso: undefined };
  const adopted: CallTail[] = [];
  const left: CallTail[] = [];
  const calls: AdoptedCall[] = [];
  for (const tail of lifted.tails) {
    const take = adoptablePrefix({ beforeMs, tail });
    const passed = tail.lines.slice(0, take);
    adopted.push({ ...tail, lines: passed });
    left.push({ ...tail, lines: tail.lines.slice(take) });
    const last = passed.at(-1);
    if (last === undefined) {
      continue;
    }
    const instants = passed.map((line) => Date.parse(lineInstant({ line })!));
    const words = selectUnreadWords({ read: { ...lifted, tails: [{ ...tail, lines: passed }] } });
    calls.push({
      callId: tail.callId,
      firstAtIso: new Date(Math.min(...instants)).toISOString(),
      from: tail.start,
      lastAtIso: new Date(Math.max(...instants)).toISOString(),
      lines: passed.length,
      linesLeft: tail.lines.length - take,
      stretches: words.words.length,
      to: last.after,
    });
  }
  const passedWords = selectUnreadWords({ read: { ...lifted, tails: adopted } });
  const leftWords = selectUnreadWords({ read: { ...lifted, tails: left } });
  return {
    beforeIso,
    calls,
    cursor: advancedCursor({ read: { ...lifted, tails: adopted }, recordedAtIso }),
    digest: adoptDigest({ beforeIso, calls, name, read, why }),
    foreignStretches: passedWords.foreign.reduce((sum, call) => sum + call.stretches, 0),
    stretches: passedWords.words.length,
    stretchesLeft: leftWords.words.length,
    unparseableLeft: leftWords.unparseable.length,
    unparseablePassed: passedWords.unparseable,
  };
}

/**
 * Whether a typed approval is shaped like an adopt digest at all — checked before anything is read.
 *
 * @param approve what was typed after `--approve`
 * @returns whether it is `adopt-` and 16 lowercase hex characters
 */
export function isAdoptDigest({ approve }: { approve: string }): boolean {
  return new RegExp(`^${DIGEST_PREFIX}[0-9a-f]{${String(DIGEST_HEX)}}$`, "u").test(approve);
}
