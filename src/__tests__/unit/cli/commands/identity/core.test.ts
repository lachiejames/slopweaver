import { describe, expect, it } from "vitest";
import {
  nearMatchToJson,
  peopleToJson,
  personToJson,
  renderNoExactMatch,
  renderPeople,
  renderPersonBlock,
  renderRosterRefusal,
} from "../../../../../cli/commands/identity/core.js";
import type { IdentityResolution, Person } from "../../../../../silver/identity.js";
import type { MentionOrgStatus } from "../../../../../silver/mentionResolver.js";
import type { NearField, NearMatch } from "../../../../../silver/nearMention.js";

const ada: Person = {
  confidence: "override",
  displayName: "Ada Lovelace",
  id: "person:ada",
  identities: [
    { nativeId: "ada", source: "github" },
    { email: "ada@x.co", handle: "ada", nativeId: "U1", source: "slack" },
  ],
  provenance: ["override:person:ada"],
};

describe("renderPersonBlock", () => {
  it("renders a header, one line per identity, and provenance", () => {
    expect(renderPersonBlock({ person: ada })).toEqual([
      "person:ada  [override]  Ada Lovelace",
      "  github:ada",
      "  slack:U1 @ada <ada@x.co>",
      "  linked-by: override:person:ada",
    ]);
  });
});

describe("renderPeople", () => {
  it("renders one guidance line for an empty resolution", () => {
    const resolution: IdentityResolution = { candidates: [], conflicts: [], index: new Map(), people: [] };
    expect(renderPeople({ resolution })).toEqual([
      "(no identities — seed the identity roster with `slopweaver identity roster replace` or run `slopweaver refresh` first)",
    ]);
  });

  it("renders each person block then the held name candidates", () => {
    const resolution: IdentityResolution = {
      candidates: [{ confidence: "name", personIds: ["person:github:x", "person:slack:x"], reason: "name:x" }],
      conflicts: [],
      index: new Map(),
      people: [ada],
    };
    const lines = renderPeople({ resolution });
    expect(lines[0]).toBe("person:ada  [override]  Ada Lovelace");
    expect(lines.at(-1)).toBe("held name-link: person:github:x ~ person:slack:x (name:x)");
  });
});

describe("peopleToJson / personToJson", () => {
  it("shapes a person as a stable JSON value", () => {
    expect(personToJson({ person: ada })).toEqual({
      confidence: "override",
      displayName: "Ada Lovelace",
      id: "person:ada",
      identities: ada.identities,
      provenance: ["override:person:ada"],
    });
  });

  it("shapes the resolution with people + candidates + conflicts", () => {
    const resolution: IdentityResolution = {
      candidates: [],
      conflicts: ["boom"],
      index: new Map(),
      people: [ada],
    };
    expect(peopleToJson({ resolution })).toEqual({
      candidates: [],
      conflicts: ["boom"],
      people: [personToJson({ person: ada })],
    });
  });
});

/** A near match, as {@link nearMentions} hands one back. */
function near({
  displayName,
  key,
  email,
  orgStatus = "org",
  active = true,
  field = "full-name",
  distance = 1,
}: {
  displayName: string;
  key: string;
  email?: string;
  orgStatus?: MentionOrgStatus;
  active?: boolean;
  field?: NearField;
  distance?: number;
}): NearMatch {
  return {
    distance,
    field,
    person: {
      active,
      bot: false,
      displayName,
      identities: [],
      key,
      orgStatus,
      ...(email !== undefined ? { email } : {}),
    },
    value: displayName.toLowerCase(),
  };
}

describe("renderNoExactMatch", () => {
  it("names who is spelled near the token, and declines to pick one", () => {
    const lines = renderNoExactMatch({
      corpusScanned: false,
      near: [near({ displayName: "Tobin Barton", email: "tobin@example.com", key: "tobin@example.com" })],
      token: "Tobyn Barten",
    });
    expect(lines[0]).toBe('no colleague in the member index answers EXACTLY to "Tobyn Barten".');
    expect(lines[1]).toBe("  the member index was spelling-matched too, and 1 person in it is near it:");
    expect(lines[2]).toBe("    Tobin Barton <tobin@example.com>  [org-status: org · full-name · 1 edit]");
    expect(lines[3]).toBe(
      "  this verb will not pick one for you — re-run it with the spelling, handle, email or id you meant.",
    );
    // The spelling pass is the floor, so every miss also names the judged one.
    expect(lines[4]).toBe(
      '  a spelling pass is not judgement: run `slopweaver identity narrow "Tobyn Barten"` in a haiku sub-agent, which reads the whole roster and says who was meant.',
    );
    expect(lines[5]).toBe(
      "  to search the whole corpus for someone who only appears as a record author, add `--corpus-scan`.",
    );
    expect(lines.length).toBe(6);
  });

  it("pluralises the count and shows a deactivated, email-less outsider honestly", () => {
    const lines = renderNoExactMatch({
      corpusScanned: false,
      near: [
        near({ displayName: "Tobin Barton", email: "tobin@example.com", key: "tobin@example.com", distance: 2 }),
        near({
          active: false,
          displayName: "Tobin Barton",
          field: "name-part",
          key: "github:mbarton",
          orgStatus: "unverified",
          distance: 2,
        }),
      ],
      token: "Tobyn Barten",
    });
    // "people", never "colleagues": the second row is an unverified outsider, and a header that called it a
    // colleague would be this change's own defect, one notch smaller.
    expect(lines[1]).toBe("  the member index was spelling-matched too, and 2 people in it are near it:");
    // The near HEADER must not call them colleagues; line 0's "no colleague ... answers" is a different claim.
    expect(lines[1]).not.toContain("colleague");
    expect(lines[3]).toBe(
      "    Tobin Barton — github:mbarton [deactivated]  [org-status: unverified · name-part · 2 edits]",
    );
  });

  it("scopes the near count to the MEMBER INDEX even after a corpus scan, which was never spelling-matched", () => {
    const lines = renderNoExactMatch({
      corpusScanned: true,
      near: [near({ displayName: "Tobin Barton", email: "tobin@example.com", key: "tobin@example.com", distance: 2 })],
      token: "Tobyn Barten",
    });
    expect(lines[0]).toBe('no colleague in the member index or the corpus answers EXACTLY to "Tobyn Barten".');
    expect(lines[1]).toBe("  the member index was spelling-matched too, and 1 person in it is near it:");
    // Falsifiable: the wider subject IS printed on line 0, so a near count sharing it would be visible here.
    expect(lines[1]).not.toContain("corpus");
  });

  it("replaces the false 'real absence' claim when the near pass is what failed", () => {
    const lines = renderNoExactMatch({ corpusScanned: false, near: [], token: "ghost" });
    expect(lines[0]).toBe(
      'no colleague in the member index answers to "ghost", and nothing in the member index is spelled near it.',
    );
    const body = lines.join("\n");
    expect(body).not.toContain("real absence");
    // Nor the smaller version of the same overclaim: member bronze is written by `refresh`, so nothing here
    // can say the roster is current. This assertion is the first review pass's finding, held down.
    expect(body).not.toContain("not stale");
    // The CHECKABLE half survives — this is a replacement, not a deletion.
    expect(body).toContain("member bronze is every provider's own member list and needs no `derive`");
    expect(body).toContain("only as current as the last `slopweaver refresh`");
    expect(body).toContain("Nothing here establishes that the person is not in the corpus.");
    // The case the floor cannot reach is exactly this one, so the judged pass is offered here TOO — a miss
    // with no near match is where a session would otherwise be left with nothing to do next.
    expect(body).toContain('slopweaver identity narrow "ghost"');
  });

  it("widens the claim to the corpus after a scan, and stops offering the flag already used", () => {
    const lines = renderNoExactMatch({ corpusScanned: true, near: [], token: "ghost" });
    expect(lines[0]).toBe(
      'no colleague in the member index or the corpus answers to "ghost", and nothing in the member index is spelled near it.',
    );
    expect(lines.join("\n")).not.toContain("--corpus-scan");
  });
});

describe("nearMatchToJson", () => {
  it("carries the field and the distance, which are the whole basis of the suggestion", () => {
    expect(
      nearMatchToJson({
        near: near({ displayName: "Tobin Barton", email: "tobin@example.com", key: "tobin@example.com", distance: 2 }),
      }),
    ).toEqual({
      active: true,
      displayName: "Tobin Barton",
      distance: 2,
      email: "tobin@example.com",
      field: "full-name",
      key: "tobin@example.com",
      orgStatus: "org",
      value: "tobin barton",
    });
  });
});

describe("renderRosterRefusal", () => {
  it("calls an explicit nobody a judgement, and names both limits behind it", () => {
    const lines = renderRosterRefusal({
      answer: { kind: "none", why: "nobody here is plausibly a Winthrop" },
      token: "Winthrop",
    });
    expect(lines[0]).toBe(
      'the narrowing pass answered "none" for "Winthrop" — nobody on the roster was judged to be them.',
    );
    expect(lines[1]).toBe("  it gave as its reason: nobody here is plausibly a Winthrop");
    const body = lines.join("\n");
    expect(body).toContain("that is a judgement, not a proof");
    expect(body).toContain("no activity counts");
    // The sentence this whole path exists to delete must not come back in the judged pass's own refusal.
    expect(body).not.toContain("real absence");
  });

  it("refuses an off-roster key and says what such a key IS", () => {
    const lines = renderRosterRefusal({
      answer: { key: "tobyn.barten@example.com", kind: "off-roster", why: "it looks right" },
      token: "Tobyn Barten",
    });
    expect(lines[0]).toBe(
      'the narrowing pass answered with "tobyn.barten@example.com", which is not a key on the roster it was given.',
    );
    expect(lines.join("\n")).toContain("a person that does not exist");
  });

  it("says an unreadable reply established nothing, and names the format it wanted", () => {
    const lines = renderRosterRefusal({ answer: { kind: "unreadable" }, token: "Tobyn Barten" });
    expect(lines[0]).toBe(
      'the narrowing pass\'s reply carried no PICK line, so there is nothing to check for "Tobyn Barten".',
    );
    expect(lines[1]).toBe("  it must answer `PICK <key>` or `PICK none` on a line of its own.");
  });
});
