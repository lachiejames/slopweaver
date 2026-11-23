/**
 * The NARROWING pass — hand the whole member roster to a haiku sub-agent and let it say who was meant.
 *
 * ## The rule this implements
 *
 * `identity resolve 'Tobyn Barten'` once called a two-letter misspelling "a real absence". A person would only
 * fail to see who was meant when the name was spelled so wrongly it became a totally different name, so exact
 * string matching is not enough, and adding common misspellings to an exact-match list does not fix the class
 * of problem. The fix is to take the identity roster, narrow it down, and ask who is most likely meant from
 * that list. That judgement goes to a haiku sub-agent, and the whole identity roster never enters the single
 * context window of the agent doing the work.
 *
 * So there is no alternative-spellings table here, no nickname list, no soundex, and no threshold that
 * decides anything. {@link ./nearMention} — edit distance — is the FLOOR that works with no model at all,
 * and it is carried onto the rows as a hint. The judgement is the sub-agent's.
 *
 * ## Why the roster is printed rather than reasoned over here
 *
 * Rule 2 (no headless model, anywhere) and the repo's no-model-transport rule both hold: nothing in this
 * file, or in the verb that prints it, calls a model. The brief is TEXT, and the haiku that answers it is an
 * in-process sub-agent of an already-visible session — the same shape {@link ../detective/fanout} describes
 * for a detective wave.
 *
 * That also keeps the roster out of the working context, and it does so by WHO RUNS THE VERB rather than by a file on
 * disk: the sub-agent runs `slopweaver identity narrow <token>` itself, so the roster only ever lands in the
 * sub-agent's context. The working agent sends a token and receives one key back.
 *
 * ## What a pick is worth, and what closes the loop
 *
 * A pick is a NOMINATION, never a resolution. {@link parseRosterAnswer} refuses a key that is not on the
 * roster it was built from — a model naming a plausible person who does not exist is the failure mode a
 * fuzzy pass cannot have and a judged one can — and the verb then re-runs the EXACT ladder
 * ({@link ./mentionResolver.lookupMention}) on a token the picked person genuinely carries. So what a caller
 * finally holds is the same resolution they would have got by typing the right spelling, refusals included:
 * an outsider still comes back as `external`, and two colleagues of one name still come back `ambiguous`.
 *
 * Pure — no I/O, no clock, no model. The caller injects the folded people.
 */
import type { MentionPerson } from "./mentionResolver.js";
import type { NearMatch } from "./nearMention.js";

/** What a sub-agent writes instead of a key when the roster holds nobody the ask could mean. */
export const ROSTER_PICK_NONE = "none";

/** The ask a narrowing brief is built around — the token, and whatever framing the caller has. */
export interface RosterAsk {
  /** The token as it was written, misspelling and all. */
  readonly token: string;
  /** The question the token appeared in, when the caller has it. */
  readonly question?: string;
  /** Who asked, when the caller knows — a colleague's own name narrows who they would mean. */
  readonly askedBy?: string;
}

/** One roster row as the brief prints it: everything a reader could recognise a person by. */
export interface RosterRow {
  readonly key: string;
  readonly displayName: string;
  /** Every other name the sources carry for them, deduped — a Linear profile often spells it differently. */
  readonly otherNames: readonly string[];
  readonly handles: readonly string[];
  readonly orgStatus: MentionPerson["orgStatus"];
  /** Which sources hold them, in source order. */
  readonly sources: readonly string[];
  readonly active: boolean;
  /** The edit distance {@link ./nearMention} measured, when it measured one. A hint, never a verdict. */
  readonly nearDistance?: number;
}

/**
 * What a sub-agent's reply came to. Every non-`pick` arm is a refusal that carries what it saw, for the
 * same reason {@link ./mentionResolver.MentionLookup}'s are: a caller has to be able to tell "it named
 * somebody who is not on the roster" from "it named nobody".
 */
export type RosterAnswer =
  | { readonly kind: "pick"; readonly person: MentionPerson; readonly why: string }
  | { readonly kind: "none"; readonly why: string }
  | { readonly kind: "off-roster"; readonly key: string; readonly why: string }
  | { readonly kind: "unreadable" };

/** The distinct names a person's identities carry, in identity order, the display name first. */
function namesOf({ person }: { person: MentionPerson }): readonly string[] {
  const seen = new Set<string>([person.displayName.toLowerCase()]);
  const out: string[] = [];
  for (const identity of person.identities) {
    const name = identity.name;
    if (name === undefined) {
      continue;
    }
    const folded = name.toLowerCase();
    if (seen.has(folded)) {
      continue;
    }
    seen.add(folded);
    out.push(name);
  }
  return out;
}

/** The distinct handles a person's identities carry, in identity order. */
function handlesOf({ person }: { person: MentionPerson }): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const identity of person.identities) {
    const handle = identity.handle;
    if (handle === undefined) {
      continue;
    }
    const folded = handle.toLowerCase();
    if (seen.has(folded)) {
      continue;
    }
    seen.add(folded);
    out.push(handle);
  }
  return out;
}

/** The distinct sources a person is held by, in identity order. */
function sourcesOf({ person }: { person: MentionPerson }): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const identity of person.identities) {
    if (seen.has(identity.source)) {
      continue;
    }
    seen.add(identity.source);
    out.push(identity.source);
  }
  return out;
}

/**
 * Every person in the member index as a roster row, bots excluded, near matches first.
 *
 * Bots are dropped for the same reason {@link ./nearMention.nearMentions} drops them — nobody asking "who is
 * this person" means an integration — and dropping them here also keeps the brief's size honest: a workspace
 * with a hundred apps installed would otherwise spend a hundred rows on them.
 *
 * The near matches are hoisted to the TOP rather than merely tagged, because a long roster is read with
 * attention that runs out, and the floor's own candidates are the ones worth reading first. Their order is
 * whatever the near pass chose; everyone else keeps the index's own key order.
 *
 * @param people the folded, org-classified people ({@link ./mentionResolver.mentionPeople})
 * @param near what {@link ./nearMention.nearMentions} returned for the same token, when it ran
 * @returns one row per non-bot person
 */
export function rosterRows({
  people,
  near = [],
}: {
  people: readonly MentionPerson[];
  near?: readonly NearMatch[];
}): readonly RosterRow[] {
  const distances = new Map<string, number>();
  for (const match of near) {
    const held = distances.get(match.person.key);
    if (held === undefined || match.distance < held) {
      distances.set(match.person.key, match.distance);
    }
  }
  const rowOf = ({ person }: { person: MentionPerson }): RosterRow => {
    const distance = distances.get(person.key);
    return {
      active: person.active,
      displayName: person.displayName,
      handles: handlesOf({ person }),
      key: person.key,
      orgStatus: person.orgStatus,
      otherNames: namesOf({ person }),
      sources: sourcesOf({ person }),
      ...(distance === undefined ? {} : { nearDistance: distance }),
    };
  };
  const rows = people.filter((person) => !person.bot).map((person) => rowOf({ person }));
  const nearKeys = new Set(distances.keys());
  return [...rows.filter((row) => nearKeys.has(row.key)), ...rows.filter((row) => !nearKeys.has(row.key))];
}

/** One roster row as a line: the key first, because the key is the only part of it a reply may quote. */
function rosterRowLine({ row }: { row: RosterRow }): string {
  const parts = [row.displayName];
  if (row.otherNames.length > 0) {
    parts.push(`also ${row.otherNames.join(", ")}`);
  }
  if (row.handles.length > 0) {
    parts.push(row.handles.map((handle) => `@${handle}`).join(", "));
  }
  parts.push(row.orgStatus);
  parts.push(row.sources.join("+"));
  if (!row.active) {
    parts.push("deactivated");
  }
  if (row.nearDistance !== undefined) {
    const edits = row.nearDistance === 1 ? "1 edit" : `${String(row.nearDistance)} edits`;
    parts.push(`~${edits} from the token`);
  }
  return `  ${row.key} | ${parts.join(" · ")}`;
}

/** The ask, as the brief states it back — only the fields the caller actually supplied. */
function askLines({ ask }: { ask: RosterAsk }): readonly string[] {
  const lines = [`  token: "${ask.token}"`];
  if (ask.question !== undefined && ask.question.length > 0) {
    lines.push(`  the question it appeared in: ${ask.question}`);
  }
  if (ask.askedBy !== undefined && ask.askedBy.length > 0) {
    lines.push(`  asked by: ${ask.askedBy}`);
  }
  if (ask.question === undefined && ask.askedBy === undefined) {
    lines.push("  (no framing was supplied — judge on the token and the roster alone, and say so in WHY)");
  }
  return lines;
}

/**
 * The whole narrowing brief: the ask, the answer contract, what to weigh, and the roster itself.
 *
 * Written to be read by a sub-agent rather than by a person, which is why the contract comes BEFORE the
 * roster: the rows are the long part, and an instruction after them is an instruction read last.
 *
 * @param ask the token and whatever framing came with it
 * @param rows the roster ({@link rosterRows})
 * @returns the lines to print
 */
export function rosterBriefLines({ ask, rows }: { ask: RosterAsk; rows: readonly RosterRow[] }): readonly string[] {
  return [
    "NARROW THIS ROSTER. Someone named a person and the exact lookup did not match anyone.",
    "Your job is the one a colleague does without thinking: of everybody below, who did they mean?",
    "",
    "THE ASK",
    ...askLines({ ask }),
    "",
    "HOW TO ANSWER — exactly these two lines, and nothing else is read:",
    `  PICK <the key VERBATIM from one row below, or ${ROSTER_PICK_NONE}>`,
    "  WHY <one sentence: what in the ask and the row made it that person>",
    "",
    "WHAT TO WEIGH",
    "  - a misspelling of one or two letters, in either name, is ordinary. So is a nickname, a shortened",
    "    given name, a married name, and a voice-to-text mangling that keeps only the sound.",
    '  - a title is not part of anybody\'s name here. "Dr Ada" is a given name plus a title.',
    "  - a given name on its own is enough when one row plainly carries it and the rest do not.",
    "  - `~N edits` on a row is the edit-distance floor that already ran. It is a HINT: it cannot see a",
    "    nickname at all, and being nearest is not being right.",
    "  - this roster carries NO activity counts, so it cannot tell you who is prominent. When two rows",
    "    survive, pick the likelier and say in WHY that both survived.",
    `  - answer ${ROSTER_PICK_NONE} rather than stretch. A wrong person is worse than no person, and the`,
    "    caller re-checks your key against the exact lookup either way.",
    "",
    `THE ROSTER — ${String(rows.length)} people, from the member index (every provider's own member list):`,
    ...rows.map((row) => rosterRowLine({ row })),
  ];
}

/**
 * The value after a leading keyword on a line, stripped of the decoration a model tends to add.
 *
 * Lenient on the WRAPPING and strict on the value, which is the only division that is safe here: a reply
 * bolding its own answer (`**PICK**: \`key\``) is a formatting habit, not a different answer, while the key
 * itself is checked against the roster by {@link parseRosterAnswer} and cannot be loosened at all.
 */
function valueAfter({ line, keyword }: { line: string; keyword: string }): string | undefined {
  const trimmed = line.trim().replace(/^[\s*#>\-`]+/u, "");
  if (!trimmed.toUpperCase().startsWith(keyword)) {
    return undefined;
  }
  return trimmed
    .slice(keyword.length)
    .replace(/^\*+/u, "")
    .replace(/^[\s:*-]+/u, "")
    .replace(/^[`"']+/u, "")
    .replace(/[`"'.,]+$/u, "")
    .trim();
}

/** The `WHY` line's text, or the empty string when the reply carried none. */
function whyIn({ lines }: { lines: readonly string[] }): string {
  for (const line of lines) {
    const why = valueAfter({ keyword: "WHY", line });
    if (why !== undefined) {
      return why;
    }
  }
  return "";
}

/**
 * Read a sub-agent's reply back into a pick, checked against the roster it was given.
 *
 * The check is the point. A key that is not on the roster is reported as such and never resolved — a judged
 * pass can name a person who does not exist, which is a failure mode the edit-distance floor cannot have,
 * so the one place it could enter is closed here rather than downstream.
 *
 * @param text the reply, verbatim; surrounding prose is tolerated and only the `PICK`/`WHY` lines are read
 * @param people the same folded people the brief was built from
 * @returns what the reply came to — a pick, an explicit nobody, an off-roster key, or an unreadable reply
 */
export function parseRosterAnswer({ text, people }: { text: string; people: readonly MentionPerson[] }): RosterAnswer {
  const lines = text.split("\n");
  const why = whyIn({ lines });
  for (const line of lines) {
    const pick = valueAfter({ keyword: "PICK", line });
    if (pick === undefined || pick.length === 0) {
      continue;
    }
    if (pick.toLowerCase() === ROSTER_PICK_NONE) {
      return { kind: "none", why };
    }
    const exact = people.find((candidate) => candidate.key === pick);
    if (exact !== undefined) {
      return { kind: "pick", person: exact, why };
    }
    // A case-insensitive match is allowed because a model re-types what it read, but only when it is
    // UNIQUE. A key is an email (already folded) or `<source>:<nativeId>`, and a native id is NOT
    // case-folded by its provider — so two keys differing only in case are two different people, and
    // picking the first of them would be a confident wrong person reached by a leniency.
    const folded = pick.toLowerCase();
    const insensitive = people.filter((candidate) => candidate.key.toLowerCase() === folded);
    const only = insensitive.length === 1 ? insensitive[0] : undefined;
    if (only === undefined) {
      return { key: pick, kind: "off-roster", why };
    }
    return { kind: "pick", person: only, why };
  }
  return { kind: "unreadable" };
}

/**
 * A token the picked person genuinely carries, for re-running the EXACT ladder on.
 *
 * The pick is a nomination, so nothing may act on the key itself: the ladder has to be the thing that
 * answers, or a judged pick would have quietly become a resolution and the org-status refusals would have
 * been skipped along with it. The email is preferred because it is the tier that identifies a person across
 * sources; a handle next; a native id last, which always exists.
 *
 * @param person the person a reply picked
 * @returns the token to re-resolve them by, or `undefined` for a person carrying no identity at all — which
 *   {@link ./mentionResolver.mentionPeople} cannot produce, and which is stated rather than assumed
 */
export function verificationToken({ person }: { person: MentionPerson }): string | undefined {
  if (person.email !== undefined) {
    return person.email;
  }
  for (const identity of person.identities) {
    if (identity.handle !== undefined) {
      return identity.handle;
    }
  }
  const first = person.identities[0];
  if (first === undefined) {
    return undefined;
  }
  return first.nativeId;
}
