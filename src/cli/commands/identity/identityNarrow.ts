/**
 * `slopweaver identity narrow` — hand the whole member index to a haiku sub-agent when the exact lookup
 * missed, then check the key it picked.
 *
 * Depth 3, the last rung of the ladder: it reaches {@link ./identityResolve} for the lookup vocabulary and
 * nothing reaches back. `effect: "none"` holds here too — this verb prints a brief, and the model that
 * reads one belongs to the session, never to this process (rule 2).
 */

import { safeJsonStringify } from "../../../lib/safeJson.js";
import { lookupMention, type MentionPerson, mentionPeople } from "../../../silver/mentionResolver.js";
import { nearMentions } from "../../../silver/nearMention.js";
import {
  parseRosterAnswer,
  type RosterAsk,
  rosterBriefLines,
  rosterRows,
  verificationToken,
} from "../../../silver/rosterNarrow.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { renderRosterRefusal } from "./core.js";
import { emitLookup } from "./identityResolve.js";
import { homeFor, type IdentityDeps, strFlag, verbTail } from "./identityShared.js";

export const IDENTITY_NARROW_USAGE =
  "usage: slopweaver identity narrow <name|handle|email|id> [--question <text>] [--asked-by <who>] [--answer <reply>] [--home <dir>] [--json]";

/** The flag spec `identity narrow` parses. */
const NARROW_FLAGS = { boolean: ["json"], string: ["answer", "asked-by", "home", "question"] } as const;

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const IDENTITY_NARROW_FLAG_NAMES: readonly string[] = [...NARROW_FLAGS.string, ...NARROW_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `identity narrow` flags. Exported so the help-truth ratchet probes the REAL parser rather than a
 * copy of it that could drift.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags
 */
export function parseIdentityNarrowArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: NARROW_FLAGS });
}

/** Print the narrowing brief — the roster a sub-agent judges, and the contract it answers under. */
function emitRosterBrief({
  deps,
  people,
  ask,
  json,
}: {
  deps: IdentityDeps;
  people: readonly MentionPerson[];
  ask: RosterAsk;
  json: boolean;
}): number {
  const rows = rosterRows({ near: nearMentions({ people, token: ask.token }), people });
  if (json) {
    // Through `safeJsonStringify`, unlike this file's other `--json` documents: every one of those serialises
    // ONE person, while this one's size comes from the DATA — about a thousand rows and over a hundred KiB on a
    // real store, and a store an order of magnitude larger is a number only the data knows.
    deps.logger.out({ line: safeJsonStringify({ label: "identity narrow roster", space: 2, value: { ask, rows } }) });
    return rows.length > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
  }
  rosterBriefLines({ ask, rows }).forEach((line) => {
    deps.logger.out({ line });
  });
  // An EMPTY roster is not a brief anybody can answer, and a sub-agent handed one would invent a key rather
  // than say so. `EXIT_EXPECTED_EMPTY` is the signal the caller's own `||` already watches for.
  return rows.length > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Re-resolve a PICKED person through the exact ladder, and refuse when the ladder lands somewhere else.
 *
 * The pick names WHO; the ladder decides whether they may be handed back, so a pick that comes out `external`
 * or `ambiguous` is the system working — the sub-agent read a roster, and the roster is not the permission.
 *
 * But the ladder answers the TOKEN, not the pick, and the two can come apart: a colleague with no email whose
 * handle is another colleague's email local part re-resolves to that other person. Handing them back would be
 * the very thing this path exists to prevent — a confident wrong person, arrived at by a verification step.
 */
function emitVerifiedPick({
  deps,
  people,
  person,
  json,
}: {
  deps: IdentityDeps;
  people: readonly MentionPerson[];
  person: MentionPerson;
  json: boolean;
}): number {
  const token = verificationToken({ person });
  if (token === undefined) {
    deps.logger.error({ msg: `"${person.key}" carries no identity to re-resolve it by` });
    return EXIT_ERROR;
  }
  const lookup = lookupMention({ people, source: "slack", token });
  const landed = lookup.kind === "resolved" || lookup.kind === "no-account" ? lookup.match.person.key : person.key;
  if (landed !== person.key) {
    deps.logger.error({
      msg: `"${person.key}" was picked, but re-resolving it by "${token}" lands on "${landed}" — the token they carry is not theirs alone, so nothing is answered here`,
    });
    return EXIT_ERROR;
  }
  return emitLookup({ deps, json, lookup, raw: token });
}

/** Read a sub-agent's reply back, refuse an invented key, and re-resolve a real pick through the ladder. */
function emitRosterAnswer({
  deps,
  people,
  raw,
  answer,
  json,
}: {
  deps: IdentityDeps;
  people: readonly MentionPerson[];
  raw: string;
  answer: string;
  json: boolean;
}): number {
  const read = parseRosterAnswer({ people, text: answer });
  if (read.kind === "pick") {
    return emitVerifiedPick({ deps, json, people, person: read.person });
  }
  if (json) {
    deps.logger.out({
      line: JSON.stringify({ raw, reason: read.kind, ...("key" in read ? { key: read.key } : {}) }, null, 2),
    });
  } else {
    renderRosterRefusal({ answer: read, token: raw }).forEach((line) => {
      deps.logger.out({ line });
    });
  }
  return read.kind === "none" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
}

/**
 * Run `identity narrow <raw>` over injected dependencies — the testable shell.
 *
 * Two modes, and the split is the loop. With no `--answer` it PRINTS the brief a haiku sub-agent reads: the
 * ask, the answer contract, and every non-bot person in the member index
 * ({@link ../../../silver/rosterNarrow}). With `--answer` it reads that sub-agent's reply back, refuses a
 * key the roster does not carry, and re-runs the EXACT ladder on a token the picked person genuinely
 * carries — so a judged pick can never skip the org-status refusals a typed spelling would have hit.
 *
 * No model is called here, or anywhere under this verb: the brief is text, and the sub-agent that answers it
 * belongs to an already-visible session (rule 2). The sub-agent runs this verb ITSELF, which is what keeps
 * the roster out of the working agent's context — the standing objection to it, answered by who runs the
 * command rather than by a file on disk.
 *
 * @param argv the full process argv
 * @param deps the effectful seams
 * @returns the process exit code — `EXIT_EXPECTED_EMPTY` when the pass picked nobody, `EXIT_ERROR` when the
 *   reply named somebody who is not on the roster or carried no pick at all
 */
export function runIdentityNarrowWithDeps({ argv, deps }: { argv: readonly string[]; deps: IdentityDeps }): number {
  const rest = verbTail({ argv, verb: "narrow" });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: IDENTITY_NARROW_USAGE });
    return EXIT_OK;
  }
  const parsed = parseIdentityNarrowArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      deps.logger.error({ msg: e });
    });
    deps.logger.error({ msg: IDENTITY_NARROW_USAGE });
    return EXIT_USAGE;
  }
  const raw = parsed.value.positionals[0];
  if (raw === undefined) {
    deps.logger.error({ msg: "narrow needs the token somebody wrote — the misspelling, not a guess at it" });
    deps.logger.error({ msg: IDENTITY_NARROW_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = homeFor({ deps, values });
  const json = values["json"] === true;
  const directory = deps.loadDirectory({ home });
  directory.warnings.forEach((w) => {
    deps.logger.warn({ msg: w });
  });
  const people = mentionPeople({ orgDomains: directory.orgDomains, rows: directory.rows });
  const answer = strFlag({ key: "answer", values });
  if (answer !== undefined) {
    return emitRosterAnswer({ answer, deps, json, people, raw });
  }
  const question = strFlag({ key: "question", values });
  const askedBy = strFlag({ key: "asked-by", values });
  return emitRosterBrief({
    ask: {
      token: raw,
      ...(question === undefined ? {} : { question }),
      ...(askedBy === undefined ? {} : { askedBy }),
    },
    deps,
    json,
    people,
  });
}
