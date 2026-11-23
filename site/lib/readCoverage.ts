/**
 * How much of its source one tool answer carried, read off the answer itself — ONE rule for every read tool, at the
 * one place every tool answer on a plan call passes (`PlanCallTools.answer`, `./talkPlanCallTools.ts`).
 *
 * The rule: keep fetching the rest when a tool response is cut off, and have each tool report exactly how much it
 * returned, since a read taken for the full thing that was not is the failure to prevent. Every tool marks a cut its
 * own way — a file read's `nextFrom`, a verb answer's `stdout.truncated` and `spill`, a briefing's `read: "partial"`
 * and `rest`, `action_items`' `complete` and `beyondCap`. Nothing else reads them together, so nothing could say the turn still had a cut read open when it answered.
 *
 * So this reads the markers those tools print, wherever in the answer they sit: the closing ones here, each with the
 * call that resumes it, and every other at the fields its own tool sets (`./toolCuts.ts`). It names each cut as a
 * {@link ReadGap}: the source, how much came back of how much where the answer says, and the exact call that reads on
 * — or none, when no tool can read the rest (a capped Queue list, a verb cut with no spill). It never guesses past a
 * marker: an answer carrying none of them is `whole`, which is what it already claimed to be. Pure.
 */

import { isBag } from "./cutProbe";
import type { PlanContentItem } from "./talkPlanProtocolItems";
import { toolCutsOf } from "./toolCuts";

/** A JSON value a tool answer carried. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** The call that reads on from where a cut answer stopped — a real tool and the arguments it takes. */
export interface ReadContinuation {
  readonly tool: string;
  readonly arguments: Readonly<Record<string, string | number | boolean>>;
}

/** One part of a source an answer did not carry. */
export interface ReadGap {
  /** The source as the model would name it again: a path, else the tool's own name. */
  readonly source: string;
  /** How much came back, and of how much where the answer says, in one clause. */
  readonly what: string;
  /** The call that reads on, or `undefined` when no tool can read the rest. */
  readonly continuation: ReadContinuation | undefined;
}

/**
 * What one answer carried of its source: all of it, part of it, or none — a refusal, which read nothing, so it never
 * counts as having read on past a cut.
 */
export type ReadCoverage =
  | { readonly kind: "whole" }
  | { readonly kind: "partial"; readonly gaps: readonly ReadGap[] }
  | { readonly kind: "refused"; readonly gaps: readonly ReadGap[] };

/** The tools whose own `path` and `from` arguments resume a window where its `nextFrom` stopped. */
const RESUMABLE = new Set(["file_read", "code_read", "read_page"]);

/** How deep the walk goes: every marker these tools print sits within three levels; ten is slack, never a cut. */
const MAX_DEPTH = 10;

/**
 * What one tool answer carried of its source.
 *
 * @param tool the tool the model called
 * @param args the arguments it called it with, as the model wrote them
 * @param contentItems the answer's items; only text items are read, an image carries no marker
 * @returns `whole`, `partial` with every gap the answer's markers name, or `refused` with the refusal as its gap
 */
export function readCoverageOf({
  tool,
  args,
  contentItems,
}: {
  tool: string;
  args: Readonly<Record<string, unknown>>;
  contentItems: readonly PlanContentItem[];
}): ReadCoverage {
  // A refusal answers `{ refused }` and carries nothing of its source, so it is a cut of its own. It is kept apart from
  // `partial` because it names the path and `from` of the read it refused: read as a read, it would close that gap
  // (`./coverageHold.ts`).
  const refusals = contentItems.flatMap((item) => {
    const value = item.type === "inputText" ? parsed({ text: item.text }) : null;
    const refused = field({ key: "refused", value });
    return isBag(value) && typeof refused === "string" ? toolCutsOf({ answer: value, tool }) : [];
  });
  if (refusals.length > 0) {
    return { gaps: refusals.map((what) => ({ continuation: undefined, source: tool, what })), kind: "refused" };
  }
  const gaps: ReadGap[] = [];
  for (const item of contentItems) {
    if (item.type === "inputText") {
      const value = parsed({ text: item.text });
      walk({ args, depth: 0, gaps, tool, value });
      const marked = isBag(value) ? toolCutsOf({ answer: value, tool }) : [];
      gaps.push(...marked.map((what) => ({ continuation: undefined, source: tool, what })));
    }
  }
  if (gaps.length === 0) {
    return { kind: "whole" };
  }
  return { gaps, kind: "partial" };
}

/**
 * A tool call's arguments as the object the model wrote, or an empty one when they are not an object — the relay
 * carries them as the JSON text the model wrote.
 *
 * @param text the arguments' JSON text
 * @returns the arguments
 */
export function toolArgsOf({ text }: { text: string }): Readonly<Record<string, unknown>> {
  const value = parsed({ text });
  return isBag(value) ? value : {};
}

/** A text item as JSON, or `null` when it is prose — prose carries no marker. */
function parsed({ text }: { text: string }): Json {
  try {
    const value: Json = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}

/** An object's field, or `undefined` when the value is no object. */
function field({ value, key }: { value: Json | undefined; key: string }): Json | undefined {
  return isBag(value) ? value[key] : undefined;
}

/** UTF-8 bytes of a string. */
function bytesOf({ text }: { text: string }): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The gap one object's own markers name, or `undefined` when it carries none of the ones that end the walk — a file or
 * code window, a partial briefing, a verb's cut stdout. Each of those is the whole of what its subtree says.
 */
function closingGap({
  value,
  tool,
  args,
}: {
  value: Json;
  tool: string;
  args: Readonly<Record<string, unknown>>;
}): ReadGap | undefined {
  const rest = field({ key: "rest", value });
  const restPath = field({ key: "path", value: rest });
  const restFrom = field({ key: "from", value: rest });
  if (field({ key: "read", value }) === "partial" && typeof restPath === "string" && typeof restFrom === "number") {
    const slug = field({ key: "slug", value });
    const what = `only the first part of the ${typeof slug === "string" ? slug : restPath} briefing`;
    const continuation = { arguments: { from: restFrom, path: restPath, words: true }, tool: "file_read" };
    return { continuation, source: restPath, what };
  }
  const paged = recordPageGap({ value });
  if (paged !== undefined) {
    return paged;
  }
  const nextFrom = field({ key: "nextFrom", value });
  const path = field({ key: "path", value });
  if (typeof nextFrom === "number" && nextFrom > 0 && typeof path === "string") {
    return windowGap({ args, nextFrom, path, tool, value });
  }
  const stdout = field({ key: "stdout", value });
  if (field({ key: "truncated", value: stdout }) === true) {
    return stdoutGap({ stdout, tool, value });
  }
  return undefined;
}

/**
 * A record `recall_open` paged (`src/talk/recallOpen.ts`): its `page.nextFrom`, in code points, resumes it under the
 * same pointer. `undefined` for anything else, or a last page.
 */
function recordPageGap({ value }: { value: Json }): ReadGap | undefined {
  const pointer = field({ key: "pointer", value });
  const page = field({ key: "page", value });
  const nextFrom = field({ key: "nextFrom", value: page });
  if (field({ key: "mode", value }) !== "open" || typeof pointer !== "string" || typeof nextFrom !== "number") {
    return undefined;
  }
  const start = field({ key: "from", value: page });
  const from = typeof start === "number" ? start : 0;
  const what = `characters ${String(from)} to ${String(nextFrom)} of the record ${pointer}`;
  return { continuation: { arguments: { from: nextFrom, pointer }, tool: "recall_open" }, source: pointer, what };
}

/** A file or code window that stopped at `nextFrom`, resumed by the same tool where it can be. */
function windowGap({
  value,
  tool,
  args,
  nextFrom,
  path,
}: {
  value: Json;
  tool: string;
  args: Readonly<Record<string, unknown>>;
  nextFrom: number;
  path: string;
}): ReadGap {
  const size = field({ key: "size", value });
  const start = field({ key: "start", value });
  const from = typeof start === "number" ? start : 0;
  const of = typeof size === "number" ? ` of ${String(size)}` : "";
  const what = `bytes ${String(from)} to ${String(nextFrom)}${of} of ${path}`;
  const kept: Record<string, string | number | boolean> = { path };
  if (RESUMABLE.has(tool) && args["words"] === true) {
    kept["words"] = true;
  }
  // A page's reading names the content it was cut from, so reading on is refused once the page moves (`./pageVoice.ts`).
  const reading = field({ key: "reading", value });
  if (tool === "read_page" && typeof reading === "string") {
    kept["reading"] = reading;
  }
  const resumeWith = RESUMABLE.has(tool) ? tool : "file_read";
  return { continuation: { arguments: { ...kept, from: nextFrom }, tool: resumeWith }, source: path, what };
}

/** A verb answer whose stdout was cut: paged on from its spill when one was kept, else no tool reads the rest. */
function stdoutGap({ stdout, value, tool }: { stdout: Json | undefined; value: Json; tool: string }): ReadGap {
  const text = field({ key: "text", value: stdout });
  const total = field({ key: "bytes", value: stdout });
  const kept = typeof text === "string" ? bytesOf({ text }) : 0;
  const of = typeof total === "number" ? ` of ${String(total)}` : "";
  const what = `${String(kept)}${of} bytes of what the verb printed`;
  const spillPath = field({ key: "path", value: field({ key: "spill", value }) });
  if (typeof spillPath === "string") {
    return { continuation: { arguments: { from: kept, path: spillPath }, tool: "file_read" }, source: spillPath, what };
  }
  return { continuation: undefined, source: tool, what };
}

/** Walk one value, recording every gap its markers name. */
function walk({
  value,
  tool,
  args,
  gaps,
  depth,
}: {
  value: Json;
  tool: string;
  args: Readonly<Record<string, unknown>>;
  gaps: ReadGap[];
  depth: number;
}): void {
  if (typeof value !== "object" || value === null || depth > MAX_DEPTH) {
    return;
  }
  if (!isBag(value)) {
    for (const entry of value) {
      walk({ args, depth: depth + 1, gaps, tool, value: entry });
    }
    return;
  }
  const closing = closingGap({ args, tool, value });
  if (closing !== undefined) {
    gaps.push(closing);
    return;
  }
  for (const entry of Object.values(value)) {
    walk({ args, depth: depth + 1, gaps, tool, value: entry });
  }
}

/**
 * The line the server adds to a cut answer, so the model reads how much it got and where the rest is in the same
 * place every time, whichever tool cut it.
 *
 * @param gaps the answer's gaps, at least one
 * @returns the line
 */
export function coverageLine({ gaps }: { gaps: readonly ReadGap[] }): string {
  const parts = gaps.map((gap) => {
    if (gap.continuation === undefined) {
      return `${gap.what} (no tool reads the rest)`;
    }
    const call = `${gap.continuation.tool} ${JSON.stringify(gap.continuation.arguments)}`;
    return `${gap.what} (read on with ${call})`;
  });
  return (
    `READ COVERAGE: this answer is partial: ${parts.join("; ")}. Before saying you read all of it, or giving a total, ` +
    "read on with the call named for the part you need; where no tool reads the rest, say you read only part. Read " +
    "on only as far as the answer needs: a heading or section that answers the question is enough."
  );
}
