/**
 * The people a card's sentences name (`site/lib/personMentions.ts`) — a card names people,
 * never raw Slack member ids, and each name is a chip whose hover card says which of the owner's workstreams they relate to.
 * Board rows start from the `handover list --json` shape through `readBoard`, never a hand-built `BoardRow`.
 */
import { describe, expect, it } from "vitest";

import { type BoardRow, readBoard } from "../../components/live/read";
import { type CardPeople, cardPeople, personPieces, personWorkstreams } from "../../lib/personMentions";
import type { SlackPeople } from "../../lib/slackPeople";

/** Rosa and Quinn as the drafts reading names them; Quinn shares a first name with nobody. */
const ROSTER: SlackPeople = new Map([
  [
    "U0ROSA",
    { firstNameUnique: false, handle: "rosa", name: "Rosa Moinet", nameUnique: true, title: "Staff Engineer" },
  ],
  ["U0QUINN", { firstNameUnique: true, handle: "quinn", name: "Quinn Riley", nameUnique: true }],
  ["U0SYNADAOWN", { firstNameUnique: true, handle: "ada", name: "Ada Owner", nameUnique: true }],
  ["U0SYN000010", { firstNameUnique: true, handle: "thiago", name: "Thiago" }],
]);

/** The roster as a card holds it, with no board to draw workstreams from. */
const PEOPLE: CardPeople = cardPeople({ board: [], owner: undefined, roster: ROSTER });

/** One board row as the verb publishes it, tagged into `streams`, saying `reason`. */
function row({
  slug,
  reason,
  streams,
  section = "RUN NOW",
}: {
  slug: string;
  reason: string;
  streams: readonly string[];
  section?: string;
}): Record<string, unknown> {
  return {
    kind: "planned",
    ownerWait: "not-waiting",
    reason,
    section,
    slug,
    status: "planned",
    tags: streams.map((value) => ({ key: "workstream", source: "declared", value })),
  };
}

/** Those rows read the way the console reads a board. */
function board({ rows }: { rows: readonly Record<string, unknown>[] }): readonly BoardRow[] {
  return readBoard({ rows, unresolved: 0 })!.rows;
}

describe("personPieces", () => {
  it("draws a mention the roster knows as the person, by name, wherever the id sits in the sentence", () => {
    expect(personPieces({ people: PEOPLE, text: "reply to <@U0ROSA> about it" }).pieces).toEqual([
      { kind: "text", text: "reply to " },
      { id: "U0ROSA", kind: "person", label: "Rosa Moinet" },
      { kind: "text", text: " about it" },
    ]);
  });

  it("draws a labelled mention and a bare id the roster knows by the roster's name, not the label", () => {
    expect(personPieces({ people: PEOPLE, text: "<@U0QUINN|q> asked U0SYN000010" }).pieces).toEqual([
      { id: "U0QUINN", kind: "person", label: "Quinn Riley" },
      { kind: "text", text: " asked " },
      { id: "U0SYN000010", kind: "person", label: "Thiago" },
    ]);
  });

  it("reads a labelled mention the roster does not know as its @label, and reports nothing", () => {
    expect(personPieces({ people: PEOPLE, text: "cc <@U0NOBODY|sadie>" })).toEqual({
      pieces: [
        { kind: "text", text: "cc " },
        { kind: "text", text: "@sadie" },
      ],
      unlinked: [],
    });
  });

  it("keeps an unknown <@U…> as written and reports it once, the drawer's citation finding", () => {
    expect(personPieces({ people: PEOPLE, text: "<@U0NOBODY> and <@U0NOBODY>" })).toEqual({
      pieces: [{ kind: "text", text: "<@U0NOBODY> and <@U0NOBODY>" }],
      unlinked: [{ kind: "slack", label: "U0NOBODY" }],
    });
  });

  it("leaves a capitalised word or an unknown bare id as words, never a chip or a finding", () => {
    expect(personPieces({ people: PEOPLE, text: "UNKNOWN WORKFLOW from U0SYNSTRANGER" })).toEqual({
      pieces: [{ kind: "text", text: "UNKNOWN WORKFLOW from U0SYNSTRANGER" }],
      unlinked: [],
    });
  });
});

describe("personWorkstreams", () => {
  it("names each stream whose OPEN rows name the person by id, handle or whole name, with those rows", () => {
    const rows = board({
      rows: [
        row({ reason: "waiting on <@U0ROSA>", slug: "a", streams: ["iso"] }),
        row({ reason: "ask @rosa for the diff", slug: "b", streams: ["iso", "platform"] }),
        row({ reason: "Rosa Moinet reviewed it", slug: "c", streams: ["platform"] }),
        row({ reason: "Rosa Moinet again", section: "DONE", slug: "d", streams: ["closed-stream"] }),
        row({ reason: "nobody", slug: "e", streams: ["iso"] }),
      ],
    });
    expect(personWorkstreams({ board: rows, id: "U0ROSA", person: ROSTER.get("U0ROSA")! })).toEqual([
      { name: "iso", rows: ["a", "b"] },
      { name: "platform", rows: ["b", "c"] },
    ]);
  });

  it("matches a first name alone only when it is theirs alone in the org", () => {
    const rows = board({
      rows: [
        row({ reason: "Quinn to review", slug: "q", streams: ["dx"] }),
        row({ reason: "Rosa to review", slug: "y", streams: ["dx"] }),
      ],
    });
    expect([
      personWorkstreams({ board: rows, id: "U0QUINN", person: ROSTER.get("U0QUINN")! }),
      personWorkstreams({ board: rows, id: "U0ROSA", person: ROSTER.get("U0ROSA")! }),
    ]).toEqual([[{ name: "dx", rows: ["q"] }], []]);
  });

  it("never matches a name inside a longer word", () => {
    const rows = board({ rows: [row({ reason: "Quinnesque layout", slug: "q", streams: ["dx"] })] });
    expect(personWorkstreams({ board: rows, id: "U0QUINN", person: ROSTER.get("U0QUINN")! })).toEqual([]);
  });

  it("reads a one-word name as a first name, so a shared one matches nobody", () => {
    const rows = board({ rows: [row({ reason: "Kyle Yardley to review", slug: "k", streams: ["dx"] })] });
    const kyle = { firstNameUnique: false, handle: "kyle.o", name: "Kyle" };
    expect(personWorkstreams({ board: rows, id: "U0KYLE", person: kyle })).toEqual([]);
  });

  it("reads a name as a proper noun, so the ordinary word in lower case is not them", () => {
    const rows = board({
      rows: [
        row({ reason: "heap max is 100 MiB", slug: "word", streams: ["perf"] }),
        row({ reason: "ask Max about the heap", slug: "name", streams: ["dx"] }),
      ],
    });
    const max = { firstNameUnique: true, handle: "max.jambor", name: "Max Jambor", nameUnique: true };
    expect(personWorkstreams({ board: rows, id: "U0MAX", person: max })).toEqual([{ name: "dx", rows: ["name"] }]);
  });

  it("never matches a whole name another member's name is or starts with", () => {
    const rows = board({ rows: [row({ reason: "Joseph O'Hara flagged it", slug: "j", streams: ["dx"] })] });
    const joseph = { firstNameUnique: false, handle: "joseph.o", name: "Joseph O", nameUnique: false };
    expect(personWorkstreams({ board: rows, id: "U0JOSEPH", person: joseph })).toEqual([]);
  });

  it("never reads a handle as the start of a longer dotted handle", () => {
    const rows = board({ rows: [row({ reason: "ask @rosa.lindqvist", slug: "y", streams: ["dx"] })] });
    expect(personWorkstreams({ board: rows, id: "U0ROSA", person: ROSTER.get("U0ROSA")! })).toEqual([]);
  });
});

describe("cardPeople", () => {
  it("gives every roster member their workstreams, and the owner none, since the owner is on every row", () => {
    const rows = board({
      rows: [row({ reason: "Ada Owner and Quinn Riley pairing", slug: "p", streams: ["dx"] })],
    });
    const people = cardPeople({ board: rows, owner: "U0SYNADAOWN", roster: ROSTER });
    expect([
      people.get("U0SYNADAOWN")!.workstreams,
      people.get("U0QUINN")!.workstreams,
      people.get("U0QUINN")!.id,
      people.get("U0ROSA")!.title,
    ]).toEqual([[], [{ name: "dx", rows: ["p"] }], "U0QUINN", "Staff Engineer"]);
  });
});
