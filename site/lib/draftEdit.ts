/**
 * A live edit of the parked Slack draft on the card the owner has open, aimed by the page and never by the model.
 *
 * The three tools (`src/talk/draftToolSchemas.ts`) take only what is the model's to say: its reading as a checklist,
 * the new words, the version to put back. Which card is the one open on the owner's Queue (`?open=post:<id>`); whose
 * words the card quotes is the owner's latest finished turn from the call's own transcript; and the anchor is the call
 * and that turn. None of the three is an argument, so a file, a row or a card the model read cannot aim an edit at
 * another draft or put words in the owner's mouth.
 *
 * Everything here is pure: the page's store (`../components/voice/draftEditRun.ts`) holds the state, and the route
 * (`../app/api/talk/draft/route.ts`) runs the verb.
 */

import { isBag } from "./bag";
import type { HeardSegment } from "./voiceTranscript";

/** The longest of the owner's words a card quotes and an edit records — the verb's own cap (`REVISION_HEARD_MAX_CHARS`). */
export const DRAFT_HEARD_MAX = 600;

/** The verb's checklist bounds (`REVISION_READING_MAX_ITEMS`, `REVISION_READING_MAX_CHARS`), which `src/` keeps. */
export const DRAFT_READING_MAX_ITEMS = 5;
export const DRAFT_READING_MAX_CHARS = 120;

/** The largest message the route forwards; the verb's own form caps refuse far below it. */
export const DRAFT_TEXT_MAX = 8192;

/** A parked draft id, as the register mints one. */
const DRAFT_ID = /^sd-[0-9a-f]{6,64}$/u;

/** The open card's key for a parked draft. */
const POST_KEY = /^post:(sd-[0-9a-f]{6,64})$/u;

/** What the page needs of one Queue row to aim an edit at it. */
export interface DraftEditRow {
  readonly key: string;
  readonly post:
    | {
        readonly id: string;
        readonly state: string;
        readonly actor: "me" | "bot";
        readonly editableText?: string | undefined;
        readonly versions?: readonly unknown[] | undefined;
      }
    | undefined;
}

/** The draft an edit is aimed at, as the page resolved it. */
export interface DraftEditTarget {
  readonly id: string;
  /** Its words as the voice edits them. */
  readonly text: string;
  /** Which version it reads as now — 1 for a draft never revised. */
  readonly version: number;
}

/**
 * The parked draft on the card the owner has open, or why it is not one the voice may edit.
 *
 * @param open the `?open=` key of the card the owner has open, `undefined` with none
 * @param rows every row the Queue draws
 * @returns the target, or the refusal sentence the model says
 */
export function draftEditTargetOf({
  open,
  rows,
}: {
  open: string | undefined;
  rows: readonly DraftEditRow[];
}): DraftEditTarget | { readonly why: string } {
  const id = open === undefined ? undefined : POST_KEY.exec(open)?.[1];
  if (id === undefined) {
    return { why: "the owner has no parked Slack draft open: open its card first (open_card), then start the edit" };
  }
  const post = rows.find((row) => row.key === open)?.post;
  if (post === undefined || post.id !== id || post.state !== "held") {
    return { why: `${id} is not a draft still waiting on the owner's yes, so there is nothing to edit` };
  }
  if (post.actor !== "me") {
    return {
      why: `${id} posts as the bot, and only a draft that posts under the owner's identity can be edited live; re-record it`,
    };
  }
  if (post.editableText === undefined) {
    return {
      why:
        `${id} cannot be edited now: approved (hold it first), waiting on the owner's pick between two drafts, or a shape ` +
        "the voice cannot edit. Say which you see on the card",
    };
  }
  const version = post.versions === undefined ? 1 : post.versions.length;
  return { id, text: post.editableText, version };
}

/**
 * The owner's latest finished turn, as the card quotes it and the edit records it: whitespace folded, and only its last
 * {@link DRAFT_HEARD_MAX} characters, cut at a word.
 *
 * @param segments the call's transcript, oldest first
 * @returns the owner's words, or `undefined` when they have said nothing yet
 */
export function latestOwnerWords({ segments }: { segments: readonly HeardSegment[] }): string | undefined {
  const last = segments.findLast((segment) => segment.who === "owner" && segment.final && segment.text.trim() !== "");
  if (last === undefined) {
    return undefined;
  }
  const whole = last.text.replace(/\s+/gu, " ").trim();
  if (whole.length <= DRAFT_HEARD_MAX) {
    return whole;
  }
  const tail = whole.slice(-DRAFT_HEARD_MAX);
  const space = tail.indexOf(" ");
  return space === -1 ? tail : tail.slice(space + 1);
}

/**
 * The voice's reading of the owner's words, or why it is refused: one to five non-blank lines, each within the cap.
 *
 * @param value the tool call's `reading`
 * @returns the lines, trimmed, or the refusal sentence
 */
export function draftReadingOf({ value }: { value: unknown }): readonly string[] | { readonly why: string } {
  const why =
    `reading must be 1 to ${String(DRAFT_READING_MAX_ITEMS)} short lines of what you will change, each at most ` +
    `${String(DRAFT_READING_MAX_CHARS)} characters`;
  if (!Array.isArray(value) || value.length < 1 || value.length > DRAFT_READING_MAX_ITEMS) {
    return { why };
  }
  const lines: string[] = [];
  for (const line of value) {
    if (typeof line !== "string" || line.trim() === "" || line.trim().length > DRAFT_READING_MAX_CHARS) {
      return { why };
    }
    lines.push(line.trim());
  }
  return lines;
}

/** What the page posts to `/api/talk/draft`: the verb, the draft the page aimed at, and what records the edit. */
export type TalkDraftWire =
  | {
      readonly mode: "revise";
      readonly id: string;
      readonly text: string;
      readonly heard: string;
      readonly reading: readonly string[];
      readonly anchor: string;
    }
  | {
      readonly mode: "restore";
      readonly id: string;
      readonly version: number;
      readonly heard: string;
      readonly reading: readonly string[];
      readonly anchor: string;
    };

/** An anchor the page mints: `talk-call:<call>#<turn>`, bounded. */
const ANCHOR = /^talk-call:[\w-]{1,80}#[\w-]{1,80}$/u;

/**
 * The anchor an edit records: the call and the turn of the owner's it was made on.
 *
 * @param call the call's id
 * @param turn the owner's turn's transcript id
 * @returns the anchor, or `undefined` when either will not make one
 */
export function draftEditAnchorOf({ call, turn }: { call: string; turn: string }): string | undefined {
  const anchor = `talk-call:${call}#${turn}`;
  return ANCHOR.test(anchor) ? anchor : undefined;
}

/**
 * Parse the body the page posted, refusing anything it would not have built.
 *
 * @param raw the request body
 * @returns the wire, or why it was refused
 */
export function parseTalkDraftRequest({ raw }: { raw: string }): TalkDraftWire | { readonly why: string } {
  if (raw.length > DRAFT_TEXT_MAX * 2) {
    return { why: "the edit is larger than any message the draft can carry" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { why: "the edit is not JSON" };
  }
  if (!isBag(value)) {
    return { why: "the edit is not an object" };
  }
  const bag = value;
  const { anchor, heard, id, mode } = bag;
  const reading = draftReadingOf({ value: bag["reading"] });
  if (typeof id !== "string" || !DRAFT_ID.test(id)) {
    return { why: "id must be a parked draft id" };
  }
  if (typeof heard !== "string" || heard.trim() === "" || heard.length > DRAFT_HEARD_MAX) {
    return { why: `heard must be the owner's words, at most ${String(DRAFT_HEARD_MAX)} characters` };
  }
  if (typeof anchor !== "string" || !ANCHOR.test(anchor)) {
    return { why: "anchor must be talk-call:<call>#<turn>" };
  }
  if ("why" in reading) {
    return reading;
  }
  const allowed =
    mode === "revise"
      ? ["anchor", "heard", "id", "mode", "reading", "text"]
      : ["anchor", "heard", "id", "mode", "reading", "version"];
  if (!Object.keys(bag).every((key) => allowed.includes(key))) {
    return { why: `the edit carries a field the ${String(mode)} route does not take` };
  }
  if (mode === "revise") {
    const text = bag["text"];
    if (typeof text !== "string" || text.trim() === "" || text.length > DRAFT_TEXT_MAX) {
      return { why: `text must be the whole new message, at most ${String(DRAFT_TEXT_MAX)} characters` };
    }
    return { anchor, heard, id, mode, reading, text };
  }
  if (mode === "restore") {
    const version = bag["version"];
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      return { why: "version must be a whole number from 1" };
    }
    return { anchor, heard, id, mode, reading, version };
  }
  return { why: "mode must be revise or restore" };
}

/**
 * The verb an edit runs, as literal argv after `slopweaver`, with the new words on stdin rather than argv — a message
 * is no argv value, and a pipe is read by the child alone.
 *
 * @param wire the parsed edit
 * @returns the argv, and the words the child reads on stdin for a revise
 */
export function talkDraftArgv({ wire }: { wire: TalkDraftWire }): {
  readonly argv: readonly string[];
  readonly stdin: string | undefined;
} {
  const record = ["--heard", wire.heard, "--reading", JSON.stringify(wire.reading), "--anchor", wire.anchor, "--json"];
  if (wire.mode === "revise") {
    return { argv: ["slack", "draft", "revise", wire.id, "--text", "-", ...record], stdin: wire.text };
  }
  return {
    argv: ["slack", "draft", "restore", wire.id, "--version", String(wire.version), ...record],
    stdin: undefined,
  };
}

/** The verb line a failure names — never a value, since a failure prints it. */
export const TALK_DRAFT_ARGV_TITLE = "slopweaver slack draft revise|restore <id>";
