/**
 * The voice's live edit of the parked draft on the card the owner has open: the three tools' runs, and the one edit the
 * card draws while it works (`../queue/DraftEditing.tsx`). The card shows a moving border, the owner's words quoted,
 * and the voice's reading of them as a checklist; then v2, with v1 kept.
 *
 * The page aims every write (`../../lib/draftEdit.ts`): the card open on the owner's Queue, their latest finished turn,
 * this call. The edit is module-scoped, like `../console/settling.tsx`'s settles, so the card the owner has open draws it without a
 * provider between the voice and the Queue, and nothing outlives the call — `clearDraftEdit` runs when one starts.
 */
import { useMemo, useSyncExternalStore } from "react";

import { isBag, str } from "../../lib/bag";
import {
  type DraftEditRow,
  draftEditAnchorOf,
  draftEditTargetOf,
  draftReadingOf,
  latestOwnerWords,
  type TalkDraftWire,
} from "../../lib/draftEdit";
import type { QueueRow } from "../../lib/queueRows";
import type { HeardSegment } from "../../lib/voiceTranscript";
import { refreshLive } from "../live/useLive";

/** Where an edit is: being worked out, being written, written, or refused. */
export type DraftEditPhase = "editing" | "writing" | "saved" | "refused";

/** The one edit the card draws. */
export interface DraftEditing {
  readonly id: string;
  /** The owner's words, quoted as the call heard them. */
  readonly heard: string;
  /** The voice's reading of them, one checklist line each. */
  readonly reading: readonly string[];
  /** The owner's turn the edit was made on, so the write's anchor names it. */
  readonly turn: string;
  readonly phase: DraftEditPhase;
  /** On a refusal, why — the verb's own words. */
  readonly why: string | undefined;
}

let current: DraftEditing | undefined;
const listeners = new Set<() => void>();

/** Replace the edit and tell every card. */
function publish({ next }: { next: DraftEditing | undefined }): void {
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Forget the edit — a new call, or the one in progress ending. */
export function clearDraftEdit(): void {
  publish({ next: undefined });
}

/**
 * The edit the card for `id` draws, or `undefined` when the voice is not editing it.
 *
 * @param id the parked draft the card shows
 * @returns the edit
 */
export function useDraftEditing({ id }: { id: string }): DraftEditing | undefined {
  const edit = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => undefined,
  );
  return edit?.id === id ? edit : undefined;
}

/** What the three tools reach on the page. */
export interface DraftEditSeams {
  /** The `?open=` key of the card the owner has open. */
  readonly open: () => string | undefined;
  /** Every row the Queue draws, as the edit needs them. */
  readonly rows: () => readonly DraftEditRow[];
  /** The call's transcript, oldest first. */
  readonly segments: () => readonly HeardSegment[];
  /** The call's id, `undefined` with none live. */
  readonly call: () => string | undefined;
  /** Post one edit to `/api/talk/draft`. */
  readonly post: (input: { wire: TalkDraftWire }) => Promise<DraftPosted>;
  /** Read the drafts again, so the card draws the new version during the call. */
  readonly refresh: () => void;
}

/**
 * The seams the console voice hands the three tools: the Queue's rows and open card as `open_card` reads them, the
 * call's transcript and id, the route, and a re-read of the drafts.
 *
 * @param call the call's id
 * @param open the open card's key
 * @param rows every row the Queue draws, the post rows carrying their parked draft
 * @param segments the call's transcript
 * @returns the seams
 */
export function draftEditSeamsOf({
  call,
  open,
  rows,
  segments,
}: {
  call: () => string | undefined;
  open: () => string | undefined;
  rows: () => readonly QueueRow[];
  segments: () => readonly HeardSegment[];
}): DraftEditSeams {
  return {
    call,
    open,
    post: postDraftEdit,
    refresh: () => {
      refreshLive({ slug: "slack-drafts" });
    },
    rows: () => rows().map((row) => ({ key: row.key, post: row.record.kind === "post" ? row.record.post : undefined })),
    segments,
  };
}

/**
 * `draftEditSeamsOf`, held for the provider's life: the rows from `open_card`'s cards, the segments from what the call
 * heard.
 *
 * @param call the call's id, off its transcript
 * @param cards `open_card`'s seams, whose cards carry the Queue's rows
 * @param heard the provider's ref to what the call heard
 * @param open the open card's key
 * @returns the seams
 */
export function useDraftEditSeams({
  call,
  cards,
  heard,
  open,
}: {
  call: () => string | undefined;
  cards: { readonly cards: () => { readonly rows: readonly QueueRow[] } };
  heard: { readonly current: { readonly segments: readonly HeardSegment[] } };
  open: () => string | undefined;
}): DraftEditSeams {
  return useMemo(
    () => draftEditSeamsOf({ call, open, rows: () => cards.cards().rows, segments: () => heard.current.segments }),
    [call, cards, heard, open],
  );
}

/** What one post came to. */
export type DraftPosted =
  | { readonly outcome: "done"; readonly out: string }
  | { readonly outcome: "refused" | "unknown"; readonly why: string };

/** What one draft tool came to, as the model is told it. */
export interface DraftToolRan {
  readonly answer: unknown;
  readonly detail: string;
  readonly refused: boolean;
}

/** A refusal the model says out loud. */
function refused({ why }: { why: string }): DraftToolRan {
  return { answer: { refused: why }, detail: why, refused: true };
}

/** The owner's latest finished turn and its id, or why there is none to quote. */
function ownerTurn({ seams }: { seams: DraftEditSeams }): { heard: string; turn: string } | { why: string } {
  const segments = seams.segments();
  const heard = latestOwnerWords({ segments });
  const turn = segments.findLast((segment) => segment.who === "owner" && segment.final && segment.text.trim() !== "");
  if (heard === undefined || turn === undefined) {
    return { why: "the owner has said nothing on this call to edit the draft on" };
  }
  return { heard, turn: turn.id };
}

/**
 * `draft_edit_start`: aim at the card the owner has open, quote the owner, and draw the edit on the card before any word is written.
 *
 * @param args the call's arguments
 * @param seams what it reaches
 * @returns the draft's words and its version, or the refusal
 */
export function runDraftEditStart({
  args,
  seams,
}: {
  args: Record<string, unknown>;
  seams: DraftEditSeams;
}): DraftToolRan {
  const reading = draftReadingOf({ value: args["reading"] });
  if ("why" in reading) {
    return refused({ why: reading.why });
  }
  const target = draftEditTargetOf({ open: seams.open(), rows: seams.rows() });
  if ("why" in target) {
    return refused({ why: target.why });
  }
  const asked = ownerTurn({ seams });
  if ("why" in asked) {
    return refused({ why: asked.why });
  }
  publish({ next: { ...asked, id: target.id, phase: "editing", reading, why: undefined } });
  return {
    answer: { text: target.text, version: target.version },
    detail: `editing ${target.id} at v${String(target.version)}`,
    refused: false,
  };
}

/**
 * `draft_edit` and `draft_restore`: write through the verb, then read the drafts again so the card shows the result.
 * A rewrite needs the edit `draft_edit_start` opened, on the card still open; a restore draws its own, quoting the owner.
 *
 * @param args the call's arguments
 * @param mode which write
 * @param seams what it reaches
 * @returns what the verb came to
 */
export async function runDraftWrite({
  args,
  mode,
  seams,
}: {
  args: Record<string, unknown>;
  mode: "revise" | "restore";
  seams: DraftEditSeams;
}): Promise<DraftToolRan> {
  const target = draftEditTargetOf({ open: seams.open(), rows: seams.rows() });
  if ("why" in target) {
    return refused({ why: target.why });
  }
  const call = seams.call();
  const opened = mode === "revise" ? current : undefined;
  // A saved edit is spent: the owner's next ask is quoted afresh, so the card never shows the last ask over new words.
  if (mode === "revise" && (opened === undefined || opened.id !== target.id || opened.phase === "saved")) {
    return refused({
      why: "call draft_edit_start first, for this ask on the card the owner has open, so their card shows it",
    });
  }
  const asked = opened === undefined ? ownerTurn({ seams }) : { heard: opened.heard, turn: opened.turn };
  if ("why" in asked) {
    return refused({ why: asked.why });
  }
  const anchor = call === undefined ? undefined : draftEditAnchorOf({ call, turn: asked.turn });
  if (anchor === undefined) {
    return refused({ why: "no live call to record the edit against" });
  }
  const write = writeOf({ anchor, args, asked, id: target.id, mode, opened });
  if ("why" in write) {
    return refused({ why: write.why });
  }
  const reading = write.wire.reading;
  publish({ next: { ...asked, id: target.id, phase: "writing", reading, why: undefined } });
  const posted = await seams.post({ wire: write.wire });
  seams.refresh();
  if (posted.outcome === "done") {
    publish({ next: { ...asked, id: target.id, phase: "saved", reading, why: undefined } });
    const version = versionOf({ out: posted.out });
    return {
      answer: { saved: true, sent: false, version },
      detail: `${target.id} now v${String(version)}`,
      refused: false,
    };
  }
  publish({ next: { ...asked, id: target.id, phase: "refused", reading, why: posted.why } });
  return refused({ why: posted.why });
}

/** The wire one write posts, or why its arguments are refused. */
function writeOf({
  anchor,
  args,
  asked,
  id,
  mode,
  opened,
}: {
  anchor: string;
  args: Record<string, unknown>;
  asked: { heard: string };
  id: string;
  mode: "revise" | "restore";
  opened: DraftEditing | undefined;
}): { wire: TalkDraftWire } | { why: string } {
  if (mode === "revise") {
    const text = args["text"];
    if (typeof text !== "string" || text.trim() === "" || opened === undefined) {
      return { why: "text must be the whole new message" };
    }
    return { wire: { anchor, heard: asked.heard, id, mode, reading: opened.reading, text } };
  }
  const version = args["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { why: "version must be the number of an earlier version, 1 being the words the owner first saw" };
  }
  return { wire: { anchor, heard: asked.heard, id, mode, reading: [`Put v${String(version)} back`], version } };
}

/** The version the verb's `--json` line names. */
function versionOf({ out }: { out: string }): number | undefined {
  try {
    const parsed: unknown = JSON.parse(out);
    const version = isBag(parsed) ? parsed["version"] : undefined;
    return typeof version === "number" ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Post one edit to `/api/talk/draft`. A throw — the route down, a body that is not JSON — is an `unknown` outcome
 * carrying the reason, never a rejection.
 *
 * @param wire the edit
 * @returns what the route said
 */
export async function postDraftEdit({ wire }: { wire: TalkDraftWire }): Promise<DraftPosted> {
  try {
    const response = await fetch("/api/talk/draft", {
      body: JSON.stringify(wire),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json();
    const outcome = isBag(body) ? body["outcome"] : undefined;
    const out = isBag(body) ? str({ bag: body, key: "out" }) : undefined;
    const why = isBag(body) ? str({ bag: body, key: "why" }) : undefined;
    if (outcome === "done" && out !== undefined) {
      return { out, outcome: "done" };
    }
    if (outcome === "refused" && why !== undefined) {
      return { outcome: "refused", why };
    }
    if (why !== undefined) {
      return { outcome: "unknown", why };
    }
    return { outcome: "unknown", why: `the route answered ${String(response.status)}` };
  } catch (cause) {
    return { outcome: "unknown", why: cause instanceof Error ? cause.message : String(cause) };
  }
}
