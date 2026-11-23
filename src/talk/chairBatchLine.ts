/**
 * The one line a quiet stretch of the owner's reaches the pinned chair as — and its exact reading back out of a
 * transcript.
 *
 * The chair waits an interval of at least a couple of minutes before it acts, so that a correction made mid-steer
 * lands beside what it corrects. Everything the owner said since the chair last read — every stretch on a call, every
 * relay the voice registered — reaches it as ONE turn, two quiet minutes after the owner's last word
 * (`./chairWake.ts`).
 *
 * ## A pointer line, never the owner's words
 *
 * One paste is bounded at {@link RELAY_INLINE_MAX_CHARS}: past it Claude Code can silently drop the middle
 * (`../cmux/relayFile.ts`, measured). A relay's own line already fills that, so two of them cannot share a turn
 * verbatim. The line therefore names every item by its anchor, in the order the owner said them — a stretch by its
 * `talk-call:<callId>#<segmentId>` pointer, a relay by its board slug — and carries none of the owner's words, as the
 * wake always has (the chair reads the call file, not a reading of it). Anchors past the bound are
 * counted, `+N more` — stretches first, since `talk unread` prints every unread one by cursor, while a relay is listed
 * whenever there is room, and one there is no room for stays held for the next batch (`./chairWake.ts`); `talk log`
 * prints every relay with the batch its delivery rode.
 *
 * Pure: no filesystem, no clock.
 */
import { RELAY_INLINE_MAX_CHARS } from "../cmux/relayFile.js";

import { SEGMENT_ID_MAX_CHARS } from "./callRecord.js";
import { formatCallPointer, parseCallPointer } from "./unreadWords.js";

/** The longest line a batch is typed as: the bound counts the newline the paste appends. */
const LINE_MAX_CHARS = RELAY_INLINE_MAX_CHARS - 1;

/** A relay row's slug as `relaySlug` mints it (`./relayDraft.ts`). */
const RELAY_SLUG = /^talk-[0-9a-f]{12}$/u;

/** The whole grammar, every count and the anchor list captured; the list's members are validated after. */
const BATCH_LINE =
  /^\[voice batch\] the owner went quiet two minutes after (\d+) stretch\(es\) and (\d+) relay\(s\) — read the stretches with slopweaver talk unread and the relays with slopweaver talk log, rule them and mark them; in order: (.*?)(?: \+(\d+) more)?; this line carries none of the owner's words\.$/u;

/** One thing the owner said, as the batch line names it: a stretch on a call, or a relay the voice registered. */
export type BatchAnchor =
  { readonly kind: "stretch"; readonly pointer: string } | { readonly kind: "relay"; readonly slug: string };

/** What a batch line names, read back. */
export interface BatchMembers {
  /** How many stretches the line says the batch holds, listed or not. */
  readonly stretches: number;
  /** How many relays it holds, listed or not. */
  readonly relays: number;
  /** The anchors the line lists, in the order the owner said them. */
  readonly listed: readonly BatchAnchor[];
}

/**
 * The anchor as the line writes it.
 *
 * @param anchor a stretch or a relay
 * @returns its pointer or its slug
 */
export function anchorText({ anchor }: { anchor: BatchAnchor }): string {
  if (anchor.kind === "stretch") {
    return anchor.pointer;
  }
  return anchor.slug;
}

/**
 * The line for counts and an already-chosen list — the one place the grammar is written, so the parser re-renders
 * what it read and compares.
 *
 * @param members the counts and the listed anchors
 * @returns the line
 */
function renderBatchLine({ members }: { members: BatchMembers }): string {
  const listed = members.listed.map((anchor) => anchorText({ anchor })).join(", ");
  const hidden = members.stretches + members.relays - members.listed.length;
  const more = hidden > 0 ? ` +${String(hidden)} more` : "";
  return (
    `[voice batch] the owner went quiet two minutes after ${String(members.stretches)} stretch(es) ` +
    `and ${String(members.relays)} relay(s) — read the stretches with slopweaver talk unread and the relays with ` +
    `slopweaver talk log, rule them and mark them; in order: ${listed}${more}; this line carries none of ` +
    `the owner's words.`
  );
}

/**
 * The anchors kept when a line cannot list them all: every relay first, then the stretches said first, each kept in
 * the order the owner said it. A stretch left off is still printed by `talk unread`, which reads by cursor; a relay is named
 * nowhere else the chair is told to look, so it goes first.
 *
 * @param anchors everything in the batch, in order
 * @param keep how many to keep
 * @returns the kept anchors, in order
 */
function kept({ anchors, keep }: { anchors: readonly BatchAnchor[]; keep: number }): readonly BatchAnchor[] {
  const ranked = [
    ...anchors.filter((anchor) => anchor.kind === "relay"),
    ...anchors.filter((anchor) => anchor.kind === "stretch"),
  ].slice(0, keep);
  const chosen = new Set(ranked);
  return anchors.filter((anchor) => chosen.has(anchor));
}

/**
 * The line one batch is typed as, and the anchors it lists: every anchor in order while the line stays bounded, the
 * rest counted.
 *
 * @param anchors everything in the batch, in the order the owner said it
 * @returns the line, at most {@link LINE_MAX_CHARS} characters, and the anchors it names
 */
export function chairBatch({ anchors }: { anchors: readonly BatchAnchor[] }): {
  readonly line: string;
  readonly listed: readonly BatchAnchor[];
} {
  const stretches = anchors.filter((anchor) => anchor.kind === "stretch").length;
  const relays = anchors.length - stretches;
  for (let keep = anchors.length; keep > 0; keep -= 1) {
    const listed = kept({ anchors, keep });
    const line = renderBatchLine({ members: { listed, relays, stretches } });
    if (line.length <= LINE_MAX_CHARS) {
      return { line, listed };
    }
  }
  return { line: renderBatchLine({ members: { listed: [], relays, stretches } }), listed: [] };
}

/**
 * The line one batch is typed as — {@link chairBatch}'s line.
 *
 * @param anchors everything in the batch, in the order the owner said it
 * @returns the line, at most {@link LINE_MAX_CHARS} characters
 */
export function chairBatchLine({ anchors }: { anchors: readonly BatchAnchor[] }): string {
  return chairBatch({ anchors }).line;
}

/**
 * One listed anchor read back, or `undefined` when it is neither a call pointer in its one written form nor a minted
 * relay slug.
 *
 * @param text one comma-separated entry
 * @returns the anchor, or `undefined`
 */
function anchorOf({ text }: { text: string }): BatchAnchor | undefined {
  if (RELAY_SLUG.test(text)) {
    return { kind: "relay", slug: text };
  }
  const pointer = parseCallPointer({ text });
  if (pointer === undefined || pointer !== text) {
    return undefined;
  }
  return { kind: "stretch", pointer };
}

/**
 * The longest anchor of each kind a line could list next — a minted slug, every one this length, and a call pointer
 * whose segment id is as long as a pointer may carry. The cap counts code points and a line's length counts UTF-16
 * units, so that segment id is astral: each character counts once against the cap and twice in the line.
 */
const LONGEST_NEXT: Readonly<Record<BatchAnchor["kind"], BatchAnchor>> = {
  relay: { kind: "relay", slug: "talk-000000000000" },
  stretch: {
    kind: "stretch",
    pointer: formatCallPointer({
      callId: "00000000-0000-4000-8000-000000000000",
      segmentId: "\u{1D41A}".repeat(SEGMENT_ID_MAX_CHARS),
    }),
  },
};

/**
 * The most anchors one list can hold — a JavaScript array's maximum length, 2^32 - 1 (ECMA-262 § Array exotic objects)
 * — so a line counting more was written by no generator, however consistent its arithmetic.
 */
const MAX_ANCHORS = 2 ** 32 - 1;

/**
 * Whether {@link chairBatchLine} could have chosen exactly this list for these counts: relays are listed before any
 * stretch, and a line that counts anchors `+N more` had no room for the next one at its longest. A list it could never
 * choose — a short line claiming hidden anchors — is a forgery, however consistent its counts. The LONGEST, not the
 * shortest: the generator stops at the next pointer in order, as long as its segment id, so a line it wrote can end
 * with room for a shorter pointer than the one it left off — forty `segment-0000`-shaped pointers leave exactly that,
 * which `src/__tests__/unit/talk/chairBatchLine.test.ts` reads back.
 *
 * @param members the counts and the listed anchors, read back
 * @returns whether the generator could have written that list
 */
function generatorChose({ members }: { members: BatchMembers }): boolean {
  if (members.stretches + members.relays > MAX_ANCHORS) {
    return false;
  }
  const listedStretches = members.listed.filter((anchor) => anchor.kind === "stretch").length;
  const listedRelays = members.listed.length - listedStretches;
  if (listedStretches > members.stretches || listedRelays > members.relays) {
    return false;
  }
  if (listedStretches > 0 && listedRelays < members.relays) {
    return false;
  }
  if (members.listed.length === members.stretches + members.relays) {
    return true;
  }
  // A hidden stretch's pointer is as long as its segment id, which the line never shows, so it is judged at the longest
  // a pointer may be: a line with room even for that one stopped where no generator would.
  const next = listedRelays < members.relays ? LONGEST_NEXT.relay : LONGEST_NEXT.stretch;
  const wider = renderBatchLine({ members: { ...members, listed: [...members.listed, next] } });
  return wider.length > LINE_MAX_CHARS;
}

/**
 * The one paste wrapper a batch line may arrive in, as Claude Code writes it: bare, or a lowercase hex `id` — the
 * shape it mints, `b2c9` — on the opening tag and optionally the closing one (`../transcripts/spawnPickupLine.ts`'s
 * `PASTE_WRAPPER`). Any other attribute, or an id of any other shape, could carry words the line itself does not, so it
 * is not unwrapped. A hex id that happens to spell a word, `beef`, is still read as the id it is shaped
 * as: no reader of text can tell the two apart (judged residue). Two anchored tags rather than one pattern spanning
 * the body, which would backtrack over a long turn (`redos-check`).
 */
const PASTE_OPEN = /^<pasted_content(?: id="([0-9a-f]+)")?>/u;

/** The wrapper's closing tag, at the very end of the turn. */
const PASTE_CLOSE = /<\/pasted_content(?: id="([0-9a-f]+)")?>$/u;

/**
 * A turn's text with its one paste wrapper taken off, the text itself when it holds no wrapper, or `undefined` when it
 * holds a wrapper of any other shape, or a closing id that is not its opening one. Whitespace around the turn, and
 * inside the wrapper around the line, is dropped on purpose: a stored turn carries its paste's own newlines, and
 * whitespace holds none of the owner's words, so such a turn is judged as the line it surrounds (judged residue).
 */
function unwrapped({ text }: { text: string }): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.includes("pasted_content")) {
    return trimmed;
  }
  const opened = PASTE_OPEN.exec(trimmed);
  const closed = PASTE_CLOSE.exec(trimmed);
  if (opened === null || closed === null || closed.index < opened[0].length) {
    return undefined;
  }
  const [openTag, opening] = opened;
  const closing = closed[1];
  if (closing !== undefined && closing !== opening) {
    return undefined;
  }
  return trimmed.slice(openTag.length, closed.index).trim();
}

/**
 * What a chair turn's batch line names, when the turn is EXACTLY one — bare or inside a paste wrapper, nothing before
 * or after it, its counts agreeing with its list, and its list one {@link chairBatchLine} could have chosen. A turn
 * that opens like one and goes on in anyone's words is not one, so it stays a turn of the owner's to witness.
 *
 * It reads TEXT, so it cannot tell a line the console typed from the same exact line typed by anyone else — a valid
 * relay slug swapped for another valid one included. That is the residue every transcript reader here carries
 * (`./relayLine.ts`'s `relayLineSlug` alike; `.claude/rules/cross-session-messages.md`: no transcript shape clears
 * "could the bot have produced it"). What closes it is checking the listed relays against the `relayTurnIds` of the
 * wake that typed the line, which the store keeps for the last wake only (judged residue).
 *
 * @param text the turn's text
 * @returns the members, or `undefined` when the turn is not a batch line
 */
export function chairBatchMembers({ text }: { text: string }): BatchMembers | undefined {
  const opened = unwrapped({ text });
  // The generator never writes past the bound, so a line over it is no line it chose, however consistent.
  if (opened === undefined || opened.length > LINE_MAX_CHARS) {
    return undefined;
  }
  const match = BATCH_LINE.exec(opened);
  if (match === null) {
    return undefined;
  }
  return membersOf({ match, opened });
}

/**
 * The members one grammar match names, when its list is one the generator could have chosen and re-renders to
 * exactly the line.
 *
 * @param match the grammar's match, counts and list captured
 * @param opened the line the match was taken from
 * @returns the members, or `undefined` when the line is no generator's
 */
function membersOf({ match, opened }: { match: RegExpExecArray; opened: string }): BatchMembers | undefined {
  const [, stretchCount, relayCount, list] = match;
  const listed: BatchAnchor[] = [];
  for (const entry of list === "" ? [] : list!.split(", ")) {
    const anchor = anchorOf({ text: entry });
    if (anchor === undefined) {
      return undefined;
    }
    listed.push(anchor);
  }
  const members: BatchMembers = { listed, relays: Number(relayCount), stretches: Number(stretchCount) };
  if (!generatorChose({ members }) || renderBatchLine({ members }) !== opened) {
    return undefined;
  }
  return members;
}
