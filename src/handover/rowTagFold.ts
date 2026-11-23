/**
 * The FOLD half of board-row tags: a row's journalled `tagged` events and its own fields, read into the tags it
 * carries. The vocabulary and every write-side judgement live in `./rowTags.ts`; this module only reads, and never
 * re-validates history against a narrower registry than the one it was written under.
 *
 * Pure: no filesystem, no clock.
 */

import { offeredADraft, type RunDisposition } from "./boardTypes.js";
import type { HandoverDoc } from "./doc.js";
import type { RunEvent } from "./ledger.js";
import { type BoardPriority, type BoardRowKind, effectivePriority, type RowOrigin } from "./rowKind.js";
import {
  type RowTag,
  TAG_KEYS,
  type TagAssignment,
  type TagKeySpec,
  tagKeySpec,
  writableAssignment,
} from "./rowTags.js";

/** The values a key holds so far — none when nothing has set it. */
function valuesHeld({ held, key }: { held: ReadonlyMap<string, readonly string[]>; key: string }): readonly string[] {
  const values = held.get(key);
  if (values === undefined) {
    return [];
  }
  return values;
}

/**
 * Whether a key replaces or accumulates. A key the registry no longer defines ACCUMULATES: the fold cannot know
 * what it meant, and keeping every value it was given loses nothing a later reader could have wanted.
 */
function cardinalityOf({ key }: { key: string }): TagKeySpec["cardinality"] {
  const spec = tagKeySpec({ key });
  if (spec === undefined) {
    return "many";
  }
  return spec.cardinality;
}

/**
 * Fold one `tagged` event's drops, then its sets, into the running declared tags. Nothing is validated here:
 * the write schema refused a bad assignment at the door, so one found on the journal was written under another
 * vocabulary, and {@link declaredTagsOf} marks it rather than this fold erasing it.
 *
 * A one-valued key REPLACES what earlier events held, but a second value for it inside the SAME event — a shape
 * the writer refuses as `TAG_SET_TWICE`, so only a hand-edited line carries it — is kept beside the first rather
 * than overwriting it: which one was meant is not knowable, so neither is chosen.
 *
 * A `key=value` drop removes that one value wherever the key holds it, one-valued keys included. The WRITER
 * refuses it on a one-valued key, so the grammar a session writes stays whole-key; a line carrying one anyway
 * says unambiguously which value it removes, and applying it is the only reading that loses nothing it named
 * (a line that names the value to remove leaves no question about which one).
 */
function foldTagged({
  held,
  event,
}: {
  held: ReadonlyMap<string, readonly string[]>;
  event: Extract<RunEvent, { kind: "tagged" }>;
}): ReadonlyMap<string, readonly string[]> {
  const next = new Map(held);
  for (const text of event.drop) {
    // Split at the FIRST `=` exactly as written, empty halves included: the fold applies what the line says, and
    // `splitPair` refuses an empty half because it judges what a session may WRITE.
    const at = text.indexOf("=");
    if (at < 0) {
      next.delete(text);
      continue;
    }
    const key = text.slice(0, at);
    const pair = { key, value: text.slice(at + 1) };
    next.set(
      pair.key,
      valuesHeld({ held: next, key: pair.key }).filter((value) => value !== pair.value),
    );
  }
  const setHere = new Set<string>();
  for (const written of event.set) {
    const assignment = { key: written.key, value: written.value };
    const before = valuesHeld({ held: next, key: assignment.key });
    const replaces = cardinalityOf({ key: assignment.key }) === "one" && !setHere.has(assignment.key);
    setHere.add(assignment.key);
    if (replaces) {
      next.set(assignment.key, [assignment.value]);
    } else if (!before.includes(assignment.value)) {
      next.set(assignment.key, [...before, assignment.value]);
    }
  }
  return next;
}

/**
 * One held value as a tag: `declared` when today's registry would accept it as a write AND it is its key's only
 * value where the key holds one; otherwise `unrecognised`, so an ambiguous one-valued key offers no value to act on.
 */
function heldTag({ key, value, ambiguous }: TagAssignment & { ambiguous: boolean }): RowTag {
  if (!ambiguous && writableAssignment({ assignment: { key, value } }).isOk()) {
    return { key, source: "declared", value };
  }
  return { key, source: "unrecognised", value };
}

/**
 * The tags sessions have DECLARED on a row, folded from its journal in order: a later write wins.
 *
 * A persisted assignment today's registry refuses — a key since removed, a value since narrowed, a key since
 * made derived — is KEPT, marked `unrecognised`, and placed after the registry's keys in the order it first
 * appeared. Re-validating history against the running build and skipping what failed would silently erase a
 * fact every earlier reader saw.
 *
 * @param events the row's journal, every cycle
 * @returns one tag per key and value, registry keys first in registry order, then any key it no longer defines
 */
export function declaredTagsOf({ events }: { events: readonly RunEvent[] }): readonly RowTag[] {
  let held: ReadonlyMap<string, readonly string[]> = new Map();
  for (const event of events) {
    if (event.kind === "tagged") {
      held = foldTagged({ event, held });
    }
  }
  const registered = TAG_KEYS.map((spec) => spec.key);
  const keys = [...registered, ...[...held.keys()].filter((key) => !registered.includes(key))];
  return keys.flatMap((key) => {
    const values = valuesHeld({ held, key });
    const ambiguous = cardinalityOf({ key }) === "one" && values.length > 1;
    return values.map((value) => heldTag({ ambiguous, key, value }));
  });
}

/**
 * The row fields a derived tag is read from — ONE shape, produced from an authored doc and from a projected
 * Slack-tag row alike, so a filter reads the same derivation whichever kind of row it meets.
 */
export interface TaggedFields {
  readonly kind: BoardRowKind;
  /** The EFFECTIVE band: declared, or the kind's default. */
  readonly priority: BoardPriority;
  readonly origin: RowOrigin | undefined;
  readonly repo: string | undefined;
  /**
   * The row's run disposition, which BOTH `reply=` and `run=` are derived from at tag time, so no caller can hand
   * the fold a draft and a lifecycle that contradict each other. `undefined` when the caller
   * has not folded the journal, which derives neither tag rather than a guessed `none`.
   */
  readonly run: RunDisposition | undefined;
}

/** The values `run=` takes: a run journal's lifecycle, coarser than {@link RunDisposition} and claiming no liveness. */
type RunLifecycle = "open" | "waiting" | "orphaned" | "ended" | "none";

/**
 * A run disposition as `run=` spells it. `active` reads `open`, not "running": it proves an unclosed cycle and
 * never a living seat. An unreadable journal derives nothing.
 *
 * @returns the lifecycle, or `undefined` for an unreadable journal
 */
function runLifecycleOf({ run }: { run: RunDisposition }): RunLifecycle | undefined {
  switch (run.kind) {
    case "never-started":
      return "none";
    case "active":
      return "open";
    case "waiting-on-owner":
      return "waiting";
    case "orphaned":
      return "orphaned";
    case "finished":
    case "closed":
    case "abandoned":
      return "ended";
    case "unreadable":
      return undefined;
    default: {
      const unhandled: never = run;
      return unhandled;
    }
  }
}

/**
 * The derivable fields of an authored row (doc or ask).
 *
 * @param doc the parsed row
 * @param run its run disposition as the board composed it (`BoardModel.run`); `undefined` if not folded
 * @returns the fields its derived tags read
 */
export function fieldsOfDoc({ doc, run }: { doc: HandoverDoc; run: RunDisposition | undefined }): TaggedFields {
  return {
    kind: doc.kind,
    origin: doc.origin,
    priority: effectivePriority({ declared: doc.priority, kind: doc.kind }),
    repo: doc.repo,
    run,
  };
}

/**
 * Whether a run's open question offers a draft, by `offeredADraft` — the one test `list --json` suppresses the doc's
 * options on, so a draft present but unreadable is still a draft rather than `reply=none`.
 *
 * @returns `reply=`'s value
 */
function replyOf({ run }: { run: RunDisposition }): "drafted" | "none" {
  return offeredADraft({ run }) ? "drafted" : "none";
}

/**
 * The derivable fields of a Slack tag projected from the lifecycle stream (`rowOfTag`), which has no doc behind
 * it: kind `tag` at its kind's default band, and nothing else. It takes NO row, so an authored row cannot be
 * passed here and lose its origin, repo and draft; that goes through {@link fieldsOfDoc}.
 *
 * @returns the fields a Slack tag's derived tags read
 */
export function fieldsOfSlackTag(): TaggedFields {
  const priority = effectivePriority({ declared: undefined, kind: "tag" });
  return { kind: "tag", origin: undefined, priority, repo: undefined, run: undefined };
}

/**
 * The last path segment of a checkout path, which is what `repo=` filters on — `undefined` for anything that is
 * not an absolute path. MEASURED over the live board: two rows declare `repo: null`, and deriving
 * `repo=null` from them would file two rows under a checkout that does not exist.
 */
function checkoutName({ path }: { path: string }): string | undefined {
  if (!path.startsWith("/")) {
    return undefined;
  }
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1];
}

/**
 * The tags a row carries by virtue of fields it already has. Never written, so never able to disagree.
 *
 * @param fields what the row's own fields say, from {@link fieldsOfDoc} or {@link fieldsOfSlackTag}
 * @returns the derived tags, in registry order
 */
export function derivedTagsOf({ fields }: { fields: TaggedFields }): readonly RowTag[] {
  const derived: RowTag[] = [
    { key: "kind", source: "derived", value: fields.kind },
    { key: "priority", source: "derived", value: fields.priority },
  ];
  // An unreadable journal proves neither whether a draft is offered nor where the run stands: no tag, never `none`.
  const run = fields.run?.kind === "unreadable" ? undefined : fields.run;
  if (run !== undefined) {
    derived.push({ key: "reply", source: "derived", value: replyOf({ run }) });
  }
  if (fields.origin !== undefined) {
    derived.push({ key: "origin", source: "derived", value: fields.origin });
  }
  const repo = fields.repo === undefined ? undefined : checkoutName({ path: fields.repo });
  if (repo !== undefined) {
    derived.push({ key: "repo", source: "derived", value: repo });
  }
  const lifecycle = run === undefined ? undefined : runLifecycleOf({ run });
  if (lifecycle !== undefined) {
    derived.push({ key: "run", source: "derived", value: lifecycle });
  }
  return derived;
}

/** A row's tags, split by whether anything may act on them. */
export interface RowTags {
  /** What a filter matches and a card reads: the declared tags today's registry accepts, then the derived ones. */
  readonly tags: readonly RowTag[];
  /**
   * Journalled assignments today's registry refuses, kept so a reader can see and fix them and NEVER matched or
   * acted on. An old declared value of a key since made derived lands here, so the derived value is the only one
   * of that key in {@link RowTags.tags} — history cannot contradict what the row's fields say now (a kept
   * `reply=drafted` beside a derived `reply=none` would match both).
   */
  readonly unrecognised: readonly RowTag[];
}

/**
 * Every tag a row carries: what sessions declared, then what its own fields derive, with any journalled value the
 * registry now refuses set apart. A projected Slack-tag row has no journal of its own yet and passes no events.
 *
 * @param fields what the row's own fields say
 * @param events the row's journal, every cycle
 * @returns the tags to act on, and the unrecognised ones to show
 */
export function rowTagsOf({ fields, events }: { fields: TaggedFields; events: readonly RunEvent[] }): RowTags {
  const declared = declaredTagsOf({ events });
  return {
    tags: [...declared.filter((tag) => tag.source === "declared"), ...derivedTagsOf({ fields })],
    unrecognised: declared.filter((tag) => tag.source === "unrecognised"),
  };
}
