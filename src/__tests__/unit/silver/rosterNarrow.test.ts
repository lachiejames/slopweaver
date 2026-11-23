/**
 * The narrowing pass: the brief a haiku sub-agent reads, and the check applied to what it answers.
 *
 * Exact string matching is not enough and a per-name spelling list is the wrong way to solve this problem
 * — the roster goes to a sub-agent, which says who was meant. So the properties
 * worth holding down here are NOT about matching at all. They are: every candidate reaches the brief, the
 * contract is stated before the long part, the edit-distance floor is carried as a hint rather than as an
 * answer, and a key the roster does not carry is REFUSED rather than resolved.
 *
 * The names are SYNTHETIC and the domains are `example.*`, preserving only the shapes the code reads.
 */
import { describe, expect, it } from "vitest";
import type { EmailTrust, MemberBronzeRow } from "../../../corpus/members/types.js";
import type { IdentitySource } from "../../../silver/identity.js";
import type { MentionPerson } from "../../../silver/mentionResolver.js";
import { mentionPeople } from "../../../silver/mentionResolver.js";
import { nearMentions } from "../../../silver/nearMention.js";
import type { RosterAnswer } from "../../../silver/rosterNarrow.js";
import {
  parseRosterAnswer,
  ROSTER_PICK_NONE,
  rosterBriefLines,
  rosterRows,
  verificationToken,
} from "../../../silver/rosterNarrow.js";

const ORG_DOMAINS = ["example.com"];

/** One member row, spelled the way hydration writes one. */
function row({
  source = "slack",
  nativeId,
  handle,
  name,
  email,
  emailTrust = "trusted",
  active = true,
  bot = false,
}: {
  source?: IdentitySource;
  nativeId: string;
  handle?: string;
  name?: string;
  email?: string;
  emailTrust?: EmailTrust;
  active?: boolean;
  bot?: boolean;
}): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-09-15T00:00:00.000Z",
    identity: {
      emailTrust,
      nativeId,
      source,
      ...(handle !== undefined ? { handle } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email, emailNormalised: email.toLowerCase() } : {}),
    },
    profile: { active, bot },
    provenance: ["test"],
    raw: {},
    source,
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

/** The folded people for a set of rows, org-classified against `example.com`. */
function peopleOf({ rows }: { rows: readonly MemberBronzeRow[] }): ReturnType<typeof mentionPeople> {
  return mentionPeople({ orgDomains: ORG_DOMAINS, rows });
}

const ROWS: readonly MemberBronzeRow[] = [
  row({ email: "hollis@example.com", handle: "hollis", name: "Hollis Grantham", nativeId: "U1" }),
  row({ email: "hollis@example.com", name: "H. Grantham", nativeId: "lin-1", source: "linear" }),
  row({ email: "petra@example.com", handle: "petra", name: "Petra Vance", nativeId: "U2" }),
  row({ email: "quill@partner.example.net", name: "Quill Adeyemi", nativeId: "U3" }),
  row({ bot: true, name: "Deploybot", nativeId: "B1" }),
];

describe("rosterRows carries every candidate a judge could need", () => {
  it("returns one row per non-bot person, with the other spellings each source holds", () => {
    const rows = rosterRows({ people: peopleOf({ rows: ROWS }) });
    expect(rows.map((entry) => entry.key)).toEqual([
      "hollis@example.com",
      "petra@example.com",
      "quill@partner.example.net",
    ]);
    const hollis = rows.find((entry) => entry.key === "hollis@example.com")!;
    expect(hollis.displayName).toBe("Hollis Grantham");
    expect(hollis.otherNames).toEqual(["H. Grantham"]);
    expect(hollis.handles).toEqual(["hollis"]);
    expect(hollis.sources).toEqual(["slack", "linear"]);
    expect(hollis.orgStatus).toBe("org");
    expect(hollis.active).toBe(true);
  });

  it("keeps the OUTSIDER on the roster and says so, rather than hiding them from the judge", () => {
    const rows = rosterRows({ people: peopleOf({ rows: ROWS }) });
    const quill = rows.find((entry) => entry.key === "quill@partner.example.net")!;
    expect(quill.orgStatus).toBe("external");
  });

  it("drops a bot, because nobody asking who a person is means an integration", () => {
    const rows = rosterRows({ people: peopleOf({ rows: ROWS }) });
    expect(rows.filter((entry) => entry.displayName === "Deploybot")).toEqual([]);
  });

  it("hoists the edit-distance floor's own candidates to the top, carrying the distance as a hint", () => {
    const people = peopleOf({ rows: ROWS });
    const rows = rosterRows({ near: nearMentions({ people, token: "Hollis Grantam" }), people });
    expect(rows[0]!.key).toBe("hollis@example.com");
    expect(rows[0]!.nearDistance).toBe(1);
    expect(rows[1]!.nearDistance).toBeUndefined();
  });

  it("still carries a person the floor cannot reach at all — the case the ruling is about", () => {
    const people = peopleOf({ rows: ROWS });
    const near = nearMentions({ people, token: "Dr Petey" });
    // Falsifiable: the floor really does find nobody for this token, and the roster really does hold her.
    expect(near).toEqual([]);
    const rows = rosterRows({ near, people });
    expect(rows.map((entry) => entry.key)).toContain("petra@example.com");
  });
});

describe("rosterBriefLines states the contract before the long part", () => {
  const people = peopleOf({ rows: ROWS });
  const rows = rosterRows({ near: nearMentions({ people, token: "Hollis Grantam" }), people });

  it("names the ask, the answer format and the roster size", () => {
    const lines = rosterBriefLines({
      ask: { askedBy: "Petra Vance", question: "who owns the pool?", token: "Hollis Grantam" },
      rows,
    });
    const text = lines.join("\n");
    expect(text).toContain('token: "Hollis Grantam"');
    expect(text).toContain("the question it appeared in: who owns the pool?");
    expect(text).toContain("asked by: Petra Vance");
    expect(text).toContain("THE ROSTER — 3 people");
    expect(text).toContain(`PICK <the key VERBATIM from one row below, or ${ROSTER_PICK_NONE}>`);
  });

  it("puts every instruction ABOVE the first roster row, so none of it is read last", () => {
    const lines = rosterBriefLines({ ask: { token: "Hollis Grantam" }, rows });
    const firstRow = lines.findIndex((line) => line.startsWith("  hollis@example.com |"));
    const contract = lines.findIndex((line) => line.startsWith("HOW TO ANSWER"));
    const weigh = lines.findIndex((line) => line.startsWith("WHAT TO WEIGH"));
    expect(contract).toBeGreaterThan(0);
    expect(weigh).toBeGreaterThan(contract);
    expect(firstRow).toBeGreaterThan(weigh);
  });

  it("says the distance is a hint rather than an answer, and that the roster has no activity counts", () => {
    const text = rosterBriefLines({ ask: { token: "Hollis Grantam" }, rows }).join("\n");
    expect(text).toContain("It is a HINT");
    expect(text).toContain("NO activity counts");
  });

  it("says out loud when no framing was supplied, rather than inventing one", () => {
    const text = rosterBriefLines({ ask: { token: "Hollis Grantam" }, rows }).join("\n");
    expect(text).toContain("no framing was supplied");
  });

  it("prints a row with the key first, since the key is the only part a reply may quote", () => {
    const text = rosterBriefLines({ ask: { token: "Hollis Grantam" }, rows }).join("\n");
    expect(text).toContain(
      "  hollis@example.com | Hollis Grantham · also H. Grantham · @hollis · org · slack+linear · ~1 edit from the token",
    );
  });
});

/**
 * The arms of an answer, each throwing when it was anything else — the same shape as `unwrap` for a
 * `Result`, so the assertions below stay free of the conditional that would let one pass vacuously.
 */
function picked({ answer }: { answer: RosterAnswer }): MentionPerson {
  if (answer.kind !== "pick") {
    throw new Error(`expected a pick, got `);
  }
  return answer.person;
}

/** The REASON a pick carried, throwing on any other arm. */
function pickedWhy({ answer }: { answer: RosterAnswer }): string {
  if (answer.kind !== "pick") {
    throw new Error(`expected a pick, got `);
  }
  return answer.why;
}

/** The refused key of an OFF-ROSTER answer, throwing on any other arm. */
function offRoster({ answer }: { answer: RosterAnswer }): string {
  if (answer.kind !== "off-roster") {
    throw new Error(`expected an off-roster answer, got ${answer.kind}`);
  }
  return answer.key;
}

/** The reason of a NONE answer, throwing on any other arm. */
function nobody({ answer }: { answer: RosterAnswer }): string {
  if (answer.kind !== "none") {
    throw new Error(`expected a none answer, got ${answer.kind}`);
  }
  return answer.why;
}

describe("parseRosterAnswer refuses what it cannot check", () => {
  const people = peopleOf({ rows: ROWS });

  it("reads a pick and its reason", () => {
    const answer = parseRosterAnswer({
      people,
      text: "PICK hollis@example.com\nWHY the surname is one letter off and only one person carries it",
    });
    expect(picked({ answer }).displayName).toBe("Hollis Grantham");
    expect(pickedWhy({ answer })).toBe("the surname is one letter off and only one person carries it");
  });

  it("tolerates the prose and punctuation a model wraps around its two lines", () => {
    const answer = parseRosterAnswer({
      people,
      text: "Looking at the roster now.\n\n  **PICK**: `hollis@example.com`\n  WHY - the given name matches.\n",
    });
    expect(picked({ answer }).key).toBe("hollis@example.com");
    expect(pickedWhy({ answer })).toBe("the given name matches");
  });

  it("REFUSES a key the roster does not carry — the one failure a judged pass can have", () => {
    const answer = parseRosterAnswer({ people, text: "PICK hollis.grantham@example.com\nWHY it looks right" });
    expect(offRoster({ answer })).toBe("hollis.grantham@example.com");
  });

  it("reads an explicit nobody as a decision, not as a failure to answer", () => {
    const answer = parseRosterAnswer({ people, text: "PICK none\nWHY nobody here is plausibly a Winthrop" });
    expect(nobody({ answer })).toBe("nobody here is plausibly a Winthrop");
  });

  it("calls a reply with no pick line unreadable rather than guessing at it", () => {
    expect(parseRosterAnswer({ people, text: "I think it is probably Hollis Grantham." }).kind).toBe("unreadable");
  });

  it("matches a key case-insensitively, because a model re-types what it read", () => {
    const answer = parseRosterAnswer({ people, text: "PICK Hollis@Example.com" });
    expect(picked({ answer }).key).toBe("hollis@example.com");
  });

  it("reports an empty reason as empty rather than inventing one", () => {
    const answer = parseRosterAnswer({ people, text: "PICK hollis@example.com" });
    expect(pickedWhy({ answer })).toBe("");
  });
});

describe("verificationToken re-resolves a pick through something the person really carries", () => {
  it("prefers the email, the tier that identifies somebody across sources", () => {
    const people = peopleOf({ rows: ROWS });
    expect(verificationToken({ person: people.find((person) => person.key === "hollis@example.com")! })).toBe(
      "hollis@example.com",
    );
  });

  it("falls back to a handle, then to the native id, for a person with no email", () => {
    const handled = peopleOf({ rows: [row({ handle: "wynn", name: "Wynn Okafor", nativeId: "U7" })] });
    expect(verificationToken({ person: handled[0]! })).toBe("wynn");
    const bare = peopleOf({ rows: [row({ name: "Wynn Okafor", nativeId: "U8" })] });
    expect(verificationToken({ person: bare[0]! })).toBe("U8");
  });
});

describe("a case-folded key is only honoured when it is unambiguous", () => {
  it("refuses a key two people's native ids both fold to, rather than taking the first", () => {
    // Slack does not case-fold a native id, so `slack:U1a` and `slack:U1A` are two different colleagues.
    const people = peopleOf({
      rows: [row({ name: "Wynn Okafor", nativeId: "U1a" }), row({ name: "Bram Okonkwo", nativeId: "U1A" })],
    });
    // Falsifiable: both really are on the roster under keys that differ only in case.
    expect(people.map((person) => person.key).toSorted()).toEqual(["slack:U1A", "slack:U1a"]);
    expect(offRoster({ answer: parseRosterAnswer({ people, text: "PICK slack:u1a" }) })).toBe("slack:u1a");
    // …while the EXACT spelling of either still resolves to that one person.
    expect(picked({ answer: parseRosterAnswer({ people, text: "PICK slack:U1A" }) }).displayName).toBe("Bram Okonkwo");
  });
});
