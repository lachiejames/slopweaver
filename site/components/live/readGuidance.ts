/**
 * The reader for `profile guidance --json`: every source of the owner's guidance in rank order, each entry with its
 * citation (`src/profile/guidanceWire.ts` shapes it).
 *
 * Strict in `./read.ts`'s sense: a payload that does not read is `undefined`, which the page names as not read, never
 * a substitute. A source or an entry that does not read refuses the whole reading, because a dropped source would draw
 * as one the owner has no guidance in.
 */

import {
  GUIDANCE_SOURCE_IDS,
  type GuidanceEntryView,
  type GuidanceLevel,
  type GuidanceSourceView,
  type GuidanceView,
} from "../../lib/alignmentGuidance";
import { type Bag, bags, isBag, str } from "../../lib/bag";

/** The ranks the wire may carry, highest first. */
const LEVELS: readonly GuidanceLevel[] = ["doctrine", "standing-rules", "rulings"];

/** Whether a string is one of the ranks. */
function levelOf({ value }: { value: string }): GuidanceLevel | undefined {
  return LEVELS.find((level) => level === value);
}

/** Every string in a list, or `undefined` when the list is absent or one item is not a string. */
function strings({ bag, key }: { bag: Bag; key: string }): readonly string[] | undefined {
  const value = bag[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    return undefined;
  }
  return value;
}

/** One source's state, or `undefined` when it does not read. */
function stateOf({ bag }: { bag: Bag }): GuidanceSourceView["state"] | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "unreadable") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { kind, why };
  }
  if (kind !== "read") {
    return undefined;
  }
  const list = bags({ bag, key: "entries" });
  const gaps = strings({ bag, key: "gaps" });
  if (list === undefined || gaps === undefined) {
    return undefined;
  }
  const entries: GuidanceEntryView[] = [];
  for (const entry of list) {
    const read = entryOf({ bag: entry });
    if (read === undefined) {
      return undefined;
    }
    entries.push(read);
  }
  return { entries, gaps, kind };
}

/** One entry, or `undefined` when any field does not read — a `null` scope is the one absence it carries by design. */
function entryOf({ bag }: { bag: Bag }): GuidanceEntryView | undefined {
  const text = str({ bag, key: "text" });
  const citation = str({ bag, key: "citation" });
  const body = str({ bag, key: "body" });
  const kinds = strings({ bag, key: "kinds" });
  const rawPrefix = bag["subjectPrefix"];
  const prefixReads = rawPrefix === null || typeof rawPrefix === "string";
  if (text === undefined || citation === undefined || body === undefined || kinds === undefined || !prefixReads) {
    return undefined;
  }
  const subjectPrefix = typeof rawPrefix === "string" ? rawPrefix : null;
  return { body, citation, kinds, subjectPrefix, text };
}

/**
 * Project `profile guidance --json` into the page's view, sources in the order the wire ranks them.
 *
 * @returns every source, or `undefined` when the payload or any source or entry in it does not read
 */
export function readGuidance(payload: unknown): GuidanceView | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const readAtIso = str({ bag: payload, key: "readAtIso" });
  const list = bags({ bag: payload, key: "sources" });
  if (readAtIso === undefined || list === undefined) {
    return undefined;
  }
  const sources: GuidanceSourceView[] = [];
  for (const bag of list) {
    const id = str({ bag, key: "id" });
    const label = str({ bag, key: "label" });
    const rawLevel = str({ bag, key: "level" });
    const level = rawLevel === undefined ? undefined : levelOf({ value: rawLevel });
    const rawState = bag["state"];
    const state = isBag(rawState) ? stateOf({ bag: rawState }) : undefined;
    if (id === undefined || label === undefined || level === undefined || state === undefined) {
      return undefined;
    }
    sources.push({ id, label, level, state });
  }
  // Every source exactly once: a missing one would draw as nothing where nobody looked, a repeated one twice.
  const ids = sources.map((source) => source.id);
  const whole =
    ids.length === GUIDANCE_SOURCE_IDS.length && GUIDANCE_SOURCE_IDS.every((wanted) => ids.includes(wanted));
  if (!whole) {
    return undefined;
  }
  return { readAtIso, sources };
}
