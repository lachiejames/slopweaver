/**
 * What `talk unread` prints as the quiet batches: the owner's unread stretches and the relays held for the chair,
 * split wherever the owner went quiet for {@link QUIET_BEFORE_DELIVERY_MS} — the same floor the chair's wake waits out
 * (`./chairWake.ts`). A batch whose last word is that old is DUE, so the chair has been, or is about to be, typed one
 * turn for it; the newest batch is HOLDING while the owner may still be speaking, with the instant it falls due.
 *
 * Only the presentation splits. The wake still types ONE line for everything unread once the owner is quiet, so a
 * chair that fell behind reads two quiet stretches as two batches here and one turn there — each a stretch of the
 * owner's own, in order.
 *
 * ## A held relay is headed with the owner's words, not its slug alone
 *
 * A bare slug left an approval filed over no card unread for three days: the head said only `relay(s) held in
 * it: talk-<12 hex>`, the row carrying their "take the set", and nothing on the line said a word of theirs sat
 * behind it. So each held relay is headed with the words on its turn. They are bounded by the output `talk unread`
 * already allows ({@link UNREAD_BATCH_BYTES}): every held relay is headed on every whole batch it prints, so all of them
 * SHARE {@link HELD_RELAY_WORDS_BYTES}, half of it, leaving the other half for the stretches the batch exists to print.
 * A quote is never shown as more than its turn record kept: each end the record lost carries "…" there, read end by
 * end (`./relayHeardCut.ts`), and a record that never said about an end is flagged. Marks and flag come out of the
 * relay's own share, so a record that never said costs the print no more than one that did.
 *
 * Pure: no filesystem, no clock.
 */
import type { OwnerWordsEdges } from "../profile/ownerWordsEdges.js";
import { type HeldRelay, QUIET_BEFORE_DELIVERY_MS } from "./chairWake.js";
import { RELAY_ROW_QUOTE_LIMIT } from "./relayRowQuote.js";
import { UNREAD_BATCH_BYTES } from "./unreadBatch.js";
import type { UnreadWord } from "./unreadWords.js";

/**
 * The UTF-8 bytes every held relay's quoted words share in one `talk unread` print, escapes counted: half of
 * {@link UNREAD_BATCH_BYTES}. Split evenly, each share capped at {@link RELAY_ROW_QUOTE_LIMIT} — so one relay quotes at
 * most what its own board row does, and forty quote a hundred bytes each.
 */
export const HELD_RELAY_WORDS_BYTES = UNREAD_BATCH_BYTES / 2;

/** What opens a quote cut to its newest words, and marks an end its record lost. */
const CUT_MARK = "…";

/** What follows a quote whose record never said whether it kept one of its ends. */
const UNSAID_FLAG = " (maybe not all their words)";

/** One relay held in a quiet batch: its board slug and the owner's words on its turn, fitted to its share. */
export interface QuietBatchRelay {
  readonly slug: string;
  /**
   * The newest of the owner's words on its turn that fit its share of {@link HELD_RELAY_WORDS_BYTES} — every word when
   * they fit — or empty on a record that never carried them.
   */
  readonly words: string;
  /** Whether fitting to the share kept only the TAIL of {@link words}: the steer is what they said last. */
  readonly cut: boolean;
  /** Whether the turn record itself kept each end of the owner's words, before any fitting (`./relayHeardCut.ts`). */
  readonly heardEdges: OwnerWordsEdges;
}

/** One quiet stretch of the owner's, as `talk unread` heads it. */
export interface QuietBatch {
  /** The owner's last word in it: the newest snapshot of any stretch, or the newest relay held. */
  readonly lastWordIso: string;
  /** When it falls due: {@link QUIET_BEFORE_DELIVERY_MS} after its last word. */
  readonly dueAtIso: string;
  /** Whether that instant has passed. */
  readonly due: boolean;
  /** The pointers of its stretches, in the order the owner said them. */
  readonly stretches: readonly string[];
  /** The relays held in it, in the order they were held. */
  readonly relays: readonly QuietBatchRelay[];
}

/** One thing the owner said, at the instant that counts toward their quiet. */
type Item =
  | { readonly kind: "stretch"; readonly atMs: number; readonly pointer: string }
  | { readonly kind: "relay"; readonly atMs: number; readonly relay: QuietBatchRelay };

/** The UTF-8 bytes `text` takes once escaped into a JSON string, its two quotes left out. */
function quotedBytes({ text }: { text: string }): number {
  return Buffer.byteLength(JSON.stringify(text), "utf8") - 2;
}

/**
 * The owner's words fitted to `bytes`, escapes and the cut mark counted: every word when they fit, else the longest
 * tail of whole code points that does. Only the newest `bytes` code units are split into code points — each costs at
 * least a byte per unit, and the cut mark three more, so no earlier one could fit — and for the same reason the
 * window's first element, which may be the second half of a pair the window cut through, is never kept. A turn record
 * is any JSON string, so a surrogate already lone in it is read as U+FFFD first: the quote holds whole code points only.
 *
 * @param heard every word the owner said on the turn
 * @param bytes the share this relay may quote
 * @param opened whether the quote opens with the cut mark whatever the fit does — its record lost its start — so the
 *   mark is paid once, whole or cut
 * @returns the words and whether they are only the tail
 */
export function fittedHeard({ heard, bytes, opened = false }: { heard: string; bytes: number; opened?: boolean }): {
  words: string;
  cut: boolean;
} {
  const whole = heard.toWellFormed();
  const openingBytes = opened ? quotedBytes({ text: CUT_MARK }) : 0;
  if (quotedBytes({ text: whole }) + openingBytes <= bytes) {
    return { cut: false, words: whole };
  }
  if (bytes <= quotedBytes({ text: CUT_MARK })) {
    return { cut: true, words: "" };
  }
  const points = Array.from(whole.slice(-bytes));
  let spent = quotedBytes({ text: CUT_MARK });
  let start = points.length;
  while (start > 0) {
    const cost = quotedBytes({ text: points[start - 1]! });
    if (spent + cost > bytes) {
      break;
    }
    spent += cost;
    start -= 1;
  }
  return { cut: true, words: points.slice(start).join("") };
}

/** Whether a record never said whether it kept one of its ends. */
function unsaid({ heardEdges }: { heardEdges: OwnerWordsEdges }): boolean {
  return heardEdges.start === "unknown" || heardEdges.end === "unknown";
}

/**
 * The bytes of a relay's share its record's closing marks take — "…" when it lost its end, and the flag when it never
 * said about an end — so its words fit what is left and the whole phrase stays inside the share. A lost start's "…" is
 * the same mark a fit opens with, so {@link fittedHeard} pays for it once.
 *
 * @param heardEdges what the turn record says about each end
 * @returns the bytes to hold back
 */
function recordMarkBytes({ heardEdges }: { heardEdges: OwnerWordsEdges }): number {
  const closing = heardEdges.end === "lost" ? quotedBytes({ text: CUT_MARK }) : 0;
  const flag = unsaid({ heardEdges }) ? Buffer.byteLength(UNSAID_FLAG, "utf8") : 0;
  return closing + flag;
}

/**
 * The batch one run of items makes.
 *
 * @param items a run with no quiet gap inside it, oldest first
 * @param nowMs the instant judged at
 * @returns the batch
 */
function batchOf({ items, nowMs }: { items: readonly Item[]; nowMs: number }): QuietBatch {
  const lastMs = Math.max(...items.map((item) => item.atMs));
  const stretches: string[] = [];
  const relays: QuietBatchRelay[] = [];
  for (const item of items) {
    if (item.kind === "stretch") {
      stretches.push(item.pointer);
    } else {
      relays.push(item.relay);
    }
  }
  return {
    due: nowMs - lastMs >= QUIET_BEFORE_DELIVERY_MS,
    dueAtIso: new Date(lastMs + QUIET_BEFORE_DELIVERY_MS).toISOString(),
    lastWordIso: new Date(lastMs).toISOString(),
    relays,
    stretches,
  };
}

/**
 * Split the owner's unread stretches and the held relays into quiet batches, oldest first. A stretch counts at its newest
 * snapshot, a relay at the instant it was held; a gap of {@link QUIET_BEFORE_DELIVERY_MS} or more between two
 * consecutive instants starts a new batch. Each relay's words are fitted to an equal share of
 * {@link HELD_RELAY_WORDS_BYTES}, so the `--json` shape is bounded exactly as the printed one is.
 *
 * @param words the unread stretches
 * @param relays the relays held for the chair's batch
 * @param nowIso the instant a batch is judged due at
 * @returns the batches, empty when there is nothing
 */
export function quietBatches({
  words,
  relays,
  nowIso,
}: {
  words: readonly UnreadWord[];
  relays: readonly HeldRelay[];
  nowIso: string;
}): readonly QuietBatch[] {
  const share = Math.min(RELAY_ROW_QUOTE_LIMIT, Math.floor(HELD_RELAY_WORDS_BYTES / Math.max(1, relays.length)));
  const items: Item[] = [
    ...words.map((word): Item => ({ atMs: Date.parse(word.latestAtIso), kind: "stretch", pointer: word.pointer })),
    ...relays.map((relay): Item => ({
      atMs: Date.parse(relay.heldAtIso),
      kind: "relay",
      relay: {
        heardEdges: relay.heardEdges,
        slug: relay.slug,
        ...fittedHeard({
          bytes: share - recordMarkBytes({ heardEdges: relay.heardEdges }),
          heard: relay.heard,
          opened: relay.heardEdges.start === "lost",
        }),
      },
    })),
  ].toSorted((a, b) => a.atMs - b.atMs);
  const nowMs = Date.parse(nowIso);
  const batches: QuietBatch[] = [];
  let run: Item[] = [];
  for (const item of items) {
    const previous = run.at(-1);
    if (previous !== undefined && item.atMs - previous.atMs >= QUIET_BEFORE_DELIVERY_MS) {
      batches.push(batchOf({ items: run, nowMs }));
      run = [];
    }
    run.push(item);
  }
  if (run.length > 0) {
    batches.push(batchOf({ items: run, nowMs }));
  }
  return batches;
}

/**
 * One held relay as its batch's head names it: the slug, then the owner's words as one JSON string, so a quote or a
 * line break in them never ends the line. It opens with "…" when only their tail is shown — fitted to its share, or
 * all its record kept — and closes with one when the record was cut before they finished, each end read on its own;
 * a record that never said about an end is flagged. A turn record carrying none of their words is said to, never
 * quoted as `""`.
 *
 * @param relay the held relay
 * @returns its slug and words
 */
export function heldRelayPhrase({ relay }: { relay: QuietBatchRelay }): string {
  if (relay.words === "" && !relay.cut) {
    return `${relay.slug} (no words of theirs on its turn record — read it with slopweaver talk log)`;
  }
  const opened = relay.cut || relay.heardEdges.start === "lost" ? CUT_MARK : "";
  const closed = relay.heardEdges.end === "lost" ? CUT_MARK : "";
  const flag = unsaid({ heardEdges: relay.heardEdges }) ? UNSAID_FLAG : "";
  return `${relay.slug} ${JSON.stringify(`${opened}${relay.words}${closed}`)}${flag}`;
}

/**
 * The line that heads one quiet batch in `talk unread`: its stretch count, each held relay with the owner's words on
 * it ({@link heldRelayPhrase}), and whether it is due.
 *
 * @param index its place, from one
 * @returns the line
 */
export function quietBatchLine({ batch, index }: { batch: QuietBatch; index: number }): string {
  const named = batch.relays.map((relay) => heldRelayPhrase({ relay }));
  const relays = named.length === 0 ? "" : `, relay(s) held in it: ${named.join(", ")}`;
  const state = batch.due
    ? `due — the owner went quiet after ${batch.lastWordIso}`
    : `holding until ${batch.dueAtIso} — the owner's last word was at ${batch.lastWordIso}, and they may still be speaking`;
  return `quiet batch ${String(index)}: ${String(batch.stretches.length)} stretch(es)${relays}; ${state}`;
}
