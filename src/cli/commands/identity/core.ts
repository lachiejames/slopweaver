/**
 * Pure presentation for the `identity` verb — render a resolution / a single person as terminal lines or
 * as a JSON-serialisable value. No I/O: the shell ({@link ./run}) injects the corpus + roster reads; this
 * module only shapes what they resolved to. Kept pure so it's unit-tested with exact assertions.
 */
import type { IdentityResolution, Person, PersonIdentity } from "../../../silver/identity.js";
import type { MentionMatch } from "../../../silver/mentionResolver.js";
import type { NearMatch } from "../../../silver/nearMention.js";
import type { RosterAnswer } from "../../../silver/rosterNarrow.js";

/** One identity as a compact line: `github:ada @ada <ada@x>`. */
function identityLine({ identity }: { identity: PersonIdentity }): string {
  const parts = [`${identity.source}:${identity.nativeId}`];
  if (identity.handle !== undefined) {
    parts.push(`@${identity.handle}`);
  }
  if (identity.email !== undefined) {
    parts.push(`<${identity.email}>`);
  }
  return `  ${parts.join(" ")}`;
}

/**
 * Render one person as a block: a header (id · confidence · display name), one line per source identity,
 * and the provenance. Pure.
 *
 * @param person the canonical person
 * @returns the block's lines
 */
export function renderPersonBlock({ person }: { person: Person }): readonly string[] {
  return [
    `${person.id}  [${person.confidence}]  ${person.displayName}`,
    ...person.identities.map((identity) => identityLine({ identity })),
    `  linked-by: ${person.provenance.join(", ")}`,
  ];
}

/**
 * Render the whole resolution: every person block, then any HELD name candidates. A resolution with no
 * people renders one guidance line. Pure.
 *
 * @param resolution the identity resolution
 * @returns the terminal lines
 */
export function renderPeople({ resolution }: { resolution: IdentityResolution }): readonly string[] {
  if (resolution.people.length === 0) {
    return [
      "(no identities — seed the identity roster with `slopweaver identity roster replace` or run `slopweaver refresh` first)",
    ];
  }
  const blocks = resolution.people.flatMap((person) => [...renderPersonBlock({ person }), ""]);
  const held = resolution.candidates.map(
    (candidate) => `held name-link: ${candidate.personIds.join(" ~ ")} (${candidate.reason})`,
  );
  return [...blocks, ...held];
}

/**
 * A person as a JSON-serialisable value (stable key order via the interface). Pure.
 *
 * @param person the resolved person
 * @returns the serialisable value; key order comes from the interface, so `--json` output is stable
 */
export function personToJson({ person }: { person: Person }): unknown {
  return {
    confidence: person.confidence,
    displayName: person.displayName,
    id: person.id,
    identities: person.identities,
    provenance: person.provenance,
  };
}

/**
 * The whole resolution as a JSON-serialisable value (people + held candidates + conflicts). Pure.
 *
 * @param resolution the identity resolution
 * @returns the serialisable value, including held candidates and conflicts — an unresolved identity is
 *   reported rather than dropped, so a missing person is visible instead of silently absent
 */
export function peopleToJson({ resolution }: { resolution: IdentityResolution }): unknown {
  return {
    candidates: resolution.candidates,
    conflicts: resolution.conflicts,
    people: resolution.people.map((person) => personToJson({ person })),
  };
}

/**
 * Render what the MEMBER index resolved: the person, the tier that matched, and every source id they carry.
 * Pure.
 *
 * The TIER is on the header rather than implied, because it is the whole difference between an answer a
 * caller may act on and one they must check. `native-id` is unambiguous by construction; `given-name` means
 * exactly one live colleague answered to a first name, which is safe here only because nothing else did.
 *
 * @param match the person and the tier that matched them
 * @returns the block's lines
 */
export function renderMentionMatch({ match }: { match: MentionMatch }): readonly string[] {
  const person = match.person;
  const state = person.active ? "" : "  [deactivated]";
  return [
    `${person.key}  [${match.tier}]  ${person.displayName}${state}`,
    ...person.identities.map((identity) =>
      identityLine({
        identity: {
          nativeId: identity.nativeId,
          source: identity.source,
          ...(identity.handle !== undefined ? { handle: identity.handle } : {}),
          ...(identity.name !== undefined ? { name: identity.name } : {}),
          ...(identity.email !== undefined ? { email: identity.email } : {}),
        },
      }),
    ),
    `  matched-by: ${match.tier}, org-status: ${person.orgStatus}`,
  ];
}

/**
 * A member-index match as a JSON-serialisable value. Pure.
 *
 * @param match the person and the tier that matched them
 * @returns the serialisable value — the tier and org status are included because a caller acting on this
 *   programmatically needs to know how weak the match was
 */
export function mentionMatchToJson({ match }: { match: MentionMatch }): Record<string, unknown> {
  return {
    active: match.person.active,
    displayName: match.person.displayName,
    email: match.person.email,
    identities: match.person.identities,
    key: match.person.key,
    orgStatus: match.person.orgStatus,
    tier: match.tier,
  };
}

/** One near match as an indented line: who they are, how they are placed, and what the distance was. */
function nearMatchLine({ near }: { near: NearMatch }): string {
  const person = near.person;
  const email = person.email === undefined ? ` — ${person.key}` : ` <${person.email}>`;
  const state = person.active ? "" : " [deactivated]";
  const edits = near.distance === 1 ? "1 edit" : `${String(near.distance)} edits`;
  // `org-status:` is spelled out rather than left as a bare word, matching {@link renderMentionMatch}'s own
  // footer. The near pass admits external and unverified people deliberately, so the row has to say which
  // it is — a suggestion the reader mistakes for a colleague is the same overclaim in a smaller place.
  return `    ${person.displayName}${email}${state}  [org-status: ${person.orgStatus} · ${near.field} · ${edits}]`;
}

/**
 * Render what `identity resolve` found when the EXACT ladder matched nobody — the near pass's result, and
 * wording that says only what was actually established. Pure.
 *
 * The wording is the whole point of this function, so it is stated rather than left to a reader of the
 * template. MEASURED, this verb answered `Tobyn Barten` with "member bronze is every provider's
 * own member list, so this is a real absence, not a stale roster" while the member index held **Tobin
 * Barton** across three sources. The first clause was true and the conclusion drawn from it was false, and
 * a session that reads a real absence stops looking. So:
 *
 * - with near matches, the line says the exact ladder found nobody and names who is spelled close, and the
 *   verb explicitly declines to pick between them ({@link ../../../silver/nearMention} says why it may not).
 *   It counts them as PEOPLE, never as colleagues: the near pass admits external and unverified rows, so
 *   the smaller version of the same overclaim would be a header calling an outsider a colleague;
 * - with none, the false conclusion is replaced by what the pass actually failed at. It compares SPELLINGS,
 *   so a nickname or a married name reads exactly like an absence, and nothing here proves the person is
 *   not in the corpus. What survives of the old sentence is only the part that is checkable — member bronze
 *   needs no `derive`, so no derive failure is hiding them. It does NOT survive as "the roster is not
 *   stale" — and BOTH arms end by naming {@link ./identityNarrow.runIdentityNarrowWithDeps}, the judged pass that
 *   reaches what a spelling comparison cannot;
 * - member bronze is written by `refresh`, so it is only as current as the last one, and a colleague
 *   who joined since reads identically to an absence. That second clause was the first review pass's own
 *   finding on this function.
 *
 * @param token the token as the caller wrote it
 * @param near what the near pass returned, in its own order
 * @param corpusScanned whether `--corpus-scan` already ran, which decides both how wide the absence claim
 *   may be and whether offering that flag is still useful advice
 * @returns the lines to print
 */
export function renderNoExactMatch({
  token,
  near,
  corpusScanned,
}: {
  token: string;
  near: readonly NearMatch[];
  corpusScanned: boolean;
}): readonly string[] {
  const scanHint = "  to search the whole corpus for someone who only appears as a record author, add `--corpus-scan`.";
  // The narrowing step, offered on EVERY miss rather than only on a near one: spelling
  // distance is the floor, and the case it cannot reach at all — a nickname, a title, a voice-to-text
  // mangling — is exactly the case where this verb would otherwise hand a session nothing to do next.
  const narrowHint = `  a spelling pass is not judgement: run \`slopweaver identity narrow "${token}"\` in a haiku sub-agent, which reads the whole roster and says who was meant.`;
  const searched = corpusScanned ? "the member index or the corpus" : "the member index";
  if (near.length === 0) {
    return [
      `no colleague in ${searched} answers to "${token}", and nothing in the member index is spelled near it.`,
      "  member bronze is every provider's own member list and needs no `derive`, so no derive failure is",
      "  hiding them — but it is only as current as the last `slopweaver refresh`, and this pass compares",
      "  SPELLINGS, so a nickname, a married name or a recent joiner reads exactly like an absence.",
      "  Nothing here establishes that the person is not in the corpus.",
      narrowHint,
      ...(corpusScanned ? [] : [scanHint]),
    ];
  }
  // The near header names the MEMBER INDEX outright rather than reusing `searched`. Under `--corpus-scan`
  // `searched` reads "the member index or the corpus", and the near pass never spelling-matched the corpus
  // at all — so a shared subject would claim a reach this has not got. The second review pass's finding.
  const count = near.length === 1 ? "1 person in it is" : `${String(near.length)} people in it are`;
  return [
    `no colleague in ${searched} answers EXACTLY to "${token}".`,
    `  the member index was spelling-matched too, and ${count} near it:`,
    ...near.map((match) => nearMatchLine({ near: match })),
    "  this verb will not pick one for you — re-run it with the spelling, handle, email or id you meant.",
    narrowHint,
    ...(corpusScanned ? [] : [scanHint]),
  ];
}

/**
 * A near match as a JSON-serialisable value. Pure.
 *
 * @param near the near match
 * @returns the serialisable value — the field and distance are included because they are the whole basis of
 *   the suggestion, and a caller acting on it programmatically needs to see how weak it is
 */
export function nearMatchToJson({ near }: { near: NearMatch }): unknown {
  return {
    active: near.person.active,
    displayName: near.person.displayName,
    distance: near.distance,
    email: near.person.email,
    field: near.field,
    key: near.person.key,
    orgStatus: near.person.orgStatus,
    value: near.value,
  };
}

/**
 * Render what `identity narrow --answer` did with a reply that resolved nobody. Pure.
 *
 * Each arm names what was actually established, for the same reason {@link renderNoExactMatch} does: the
 * defect this whole path exists to fix was a sentence that overstated a miss. A `none` is a judgement made
 * on a roster with no activity counts in it; an off-roster key is a person the sub-agent invented; an
 * unreadable reply established nothing at all.
 *
 * @param answer what the reply came to — every arm except `pick`, which resolves through the exact ladder
 *   instead and never reaches here
 * @param token the token the brief was built for
 * @returns the lines to print
 */
export function renderRosterRefusal({
  answer,
  token,
}: {
  answer: Exclude<RosterAnswer, { kind: "pick" }>;
  token: string;
}): readonly string[] {
  const why = answer.kind === "unreadable" ? "" : answer.why;
  const whyLines = why.length === 0 ? [] : [`  it gave as its reason: ${why}`];
  if (answer.kind === "none") {
    return [
      // What it SAYS is what arrived: a reply of `none`. It deliberately does not claim the roster was read,
      // because this verb cannot know that — an `--answer` typed by hand never saw a brief at all, and a
      // sentence asserting a read that did not happen is the same overclaim this whole path removed.
      `the narrowing pass answered "none" for "${token}" — nobody on the roster was judged to be them.`,
      ...whyLines,
      "  that is a judgement, not a proof: the member index is only as current as the last `slopweaver",
      "  refresh`, and the brief carries no activity counts, so a quiet colleague reads like a stranger.",
    ];
  }
  if (answer.kind === "off-roster") {
    return [
      `the narrowing pass answered with "${answer.key}", which is not a key on the roster it was given.`,
      ...whyLines,
      "  nothing was resolved from it. A key the roster does not carry is a person that does not exist —",
      "  the one failure a judged pass can have that the spelling floor cannot — so it is refused here.",
    ];
  }
  return [
    `the narrowing pass's reply carried no PICK line, so there is nothing to check for "${token}".`,
    "  it must answer `PICK <key>` or `PICK none` on a line of its own.",
  ];
}
