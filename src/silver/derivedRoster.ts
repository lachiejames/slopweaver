/**
 * The DERIVED identity roster (`corpus/silver/index/identities.json`) — read for addressing. Whether it can
 * still be TRUSTED is a separate question, answered by the freshness contract in `./derive/freshness.ts`.
 *
 * Two rosters exist and they are not interchangeable:
 *
 * | roster | written by | role |
 * |---|---|---|
 * | the store's identity roster | a human | the OVERRIDE/seed layer — always wins |
 * | `corpus/silver/index/identities.json` | `slopweaver derive` | the derived cross-source resolution |
 *
 * A correct onboarding writes the first as the 3-byte seed `[]` and the second with the whole team, so a
 * consumer that reads only the human roster resolves NOTHING after a full ingest. That was a shipped defect.
 *
 * **`candidates` is deliberately not addressable.** Derive holds low-confidence (name-only) links as
 * candidates rather than applying them, and this module reads `people` only. The held ids are parsed purely
 * so a refusal can SAY "held pending confirmation" — never so a held link can resolve a ping. A wrong guess
 * in the graph is cheap; a wrong guess that pings a colleague is not.
 */
import { parseJson } from "../lib/jsonParse.js";
import { isRecord } from "../lib/parsers.js";
import { type PersonIdentity, parsePersonIdentity } from "./identity.js";

/** One derived person, narrowed to what addressing a mention needs. */
export interface DerivedPerson {
  readonly id: string;
  /** How the cross-source link was made: `override` | `email` | `handle` | `name` | `single-source`. */
  readonly confidence: string;
  /** The PR4.8 account kind (`person` | `bot` | `integration`); absent on a pre-PR4.8 artifact. */
  readonly kind?: string;
  readonly identities: readonly PersonIdentity[];
}

/** The derived roster as an addressing consumer sees it: the applied people, and the ids only PROPOSED. */
export interface DerivedRoster {
  readonly people: readonly DerivedPerson[];
  /** Canonical person ids implicated in a HELD (proposed, unapplied) link candidate. NOT addressable. */
  readonly heldPersonIds: ReadonlySet<string>;
}

/** An empty roster — what an absent or garbled artifact degrades to, like every other silver reader. */
export const EMPTY_DERIVED_ROSTER: DerivedRoster = { heldPersonIds: new Set(), people: [] };

/** One `people[]` element, or `undefined` when it is not shaped like a person. */
function parseDerivedPerson({ entry }: { entry: unknown }): DerivedPerson | undefined {
  if (!isRecord(entry) || typeof entry["id"] !== "string" || entry["id"].length === 0) {
    return undefined;
  }
  const confidence = entry["confidence"];
  const kind = entry["kind"];
  const rawIdentities = Array.isArray(entry["identities"]) ? entry["identities"] : [];
  return {
    confidence: typeof confidence === "string" ? confidence : "single-source",
    id: entry["id"],
    identities: rawIdentities
      .map((raw) => parsePersonIdentity({ entry: raw }))
      .filter((identity): identity is PersonIdentity => identity !== undefined),
    ...(typeof kind === "string" ? { kind } : {}),
  };
}

/** The non-empty string person ids one candidate names. */
function candidatePersonIds({ candidate }: { candidate: unknown }): readonly string[] {
  const personIds = isRecord(candidate) ? candidate["personIds"] : undefined;
  if (!Array.isArray(personIds)) {
    return [];
  }
  return personIds.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** Every canonical person id named by a held link candidate. */
function parseHeldPersonIds({ value }: { value: unknown }): ReadonlySet<string> {
  const candidates = isRecord(value) ? value["candidates"] : undefined;
  if (!Array.isArray(candidates)) {
    return new Set();
  }
  return new Set(candidates.flatMap((candidate) => candidatePersonIds({ candidate })));
}

/**
 * Parse the persisted derived roster. Tolerant by design: a missing/garbled artifact yields an EMPTY
 * roster (every mention then refuses, which is the safe direction) rather than a throw.
 *
 * @param content the raw `{ people, candidates, conflicts }` JSON text
 * @returns the applied people plus the held (non-addressable) person ids
 */
export function parseDerivedRoster({ content }: { content: string }): DerivedRoster {
  return parseDerivedRosterFile({ content }).roster;
}

/** A roster file that parsed to nothing usable: an empty roster, from no known derive. */
const UNUSABLE_ROSTER_FILE = { observedAtIso: null, roster: EMPTY_DERIVED_ROSTER } as const;

/**
 * Parse the persisted derived roster together with the instant the derive that wrote it observed its sources.
 *
 * That instant is also in the freshness stamp, and it is how a reader tells whether the roster and the stamp
 * beside it came from ONE derive: two derives running at once each write both files, and their writes can
 * interleave. A file written before the field existed carries none, which matches a stamp from that time.
 *
 * @param content the raw `{ people, candidates, conflicts, observedAtIso }` JSON text
 * @returns the roster exactly as {@link parseDerivedRoster} reads it, and the writing derive's observation
 *   instant, `null` when the file does not carry one
 */
export function parseDerivedRosterFile({ content }: { content: string }): {
  readonly roster: DerivedRoster;
  readonly observedAtIso: string | null;
} {
  const parsed = parseJson({ text: content });
  if (parsed.isErr()) {
    return UNUSABLE_ROSTER_FILE;
  }
  const value = parsed.value;
  const rawPeople = isRecord(value) ? value["people"] : undefined;
  if (!Array.isArray(rawPeople)) {
    return UNUSABLE_ROSTER_FILE;
  }
  const observedAtIso = isRecord(value) ? value["observedAtIso"] : undefined;
  return {
    observedAtIso: typeof observedAtIso === "string" && observedAtIso.length > 0 ? observedAtIso : null,
    roster: {
      heldPersonIds: parseHeldPersonIds({ value }),
      people: rawPeople
        .map((entry) => parseDerivedPerson({ entry }))
        .filter((person): person is DerivedPerson => person !== undefined),
    },
  };
}
