/**
 * Who a `--person` names, and the one outcome that must never be an empty page.
 *
 * A person filter that matches nobody returns zero rows, and zero rows reads exactly like "this person
 * said nothing across every platform". That is the failure this module exists to refuse, so the cases
 * below prove BOTH halves: a name that reaches a person reaches them by each of the three ways, and a
 * name that reaches nobody produces a refusal carrying what the store does hold.
 *
 * Pure throughout — the matcher takes the people as a value, which is the whole reason it can be tested
 * over real handle shapes with no Postgres.
 */
import { describe, expect, it } from "vitest";

import { matchPeople, suggestPeople } from "../../../store/person.js";
import type { PersonCandidate } from "../../../store/personMatch.js";

const person = (over: Partial<PersonCandidate> & { id: string; displayName: string }): PersonCandidate => ({
  email: `${over.id}@example.invalid`,
  githubId: null,
  githubLogin: null,
  linearUserId: null,
  notionUserId: null,
  slackUserId: null,
  ...over,
});

const people: readonly PersonCandidate[] = [
  person({
    displayName: "Calvin Tate",
    email: "calvin.tate@example.invalid",
    id: "p1",
    linearUserId: "9c1f0000-0000-4000-8000-000000000000",
    slackUserId: "U0SYNCALVIN0",
  }),
  person({
    displayName: "Seth Rivers",
    email: "seth@example.invalid",
    githubId: "1042",
    githubLogin: "seth-rivers",
    id: "p2",
  }),
];
describe("matchPeople", () => {
  it("reaches a person by their display name, whatever the spacing and case", () => {
    const matched = matchPeople({ name: "  calvin   TATE ", people });
    expect(matched.length).toBe(1);
    expect(matched[0]!.person.id).toBe("p1");
    expect(matched[0]!.way).toBe("display-name");
  });

  it("reaches a person by their GitHub login, the one platform id a person is addressed by in prose", () => {
    const matched = matchPeople({ name: "seth-rivers", people });
    expect(matched.length).toBe(1);
    expect(matched[0]!.person.id).toBe("p2");
    expect(matched[0]!.way).toBe("handle");
  });

  it("reaches a person by an address, through the same normalisation the reconciler keys on", () => {
    const matched = matchPeople({ name: "Calvin.Tate+alerts@Example.Invalid", people });
    expect(matched.length).toBe(1);
    expect(matched[0]!.way).toBe("email");
  });

  it("reports which platforms a matched person is known on, which is what 'across these platforms' resolves to", () => {
    const matched = matchPeople({ name: "Calvin Tate", people });
    expect(matched[0]!.sources).toStrictEqual(["linear", "slack"]);
  });

  it("returns every person a name reaches rather than the first, so an ambiguous name stays visible", () => {
    const twins: readonly PersonCandidate[] = [
      person({ displayName: "Alex Kim", id: "p1" }),
      person({ displayName: "Alex Kim", id: "p2" }),
    ];
    expect(matchPeople({ name: "Alex Kim", people: twins }).length).toBe(2);
  });

  it("reaches nobody on a name the store does not hold, rather than reaching somebody close", () => {
    expect(matchPeople({ name: "Calvin", people }).length).toBe(0);
  });
});

describe("suggestPeople", () => {
  it("offers the name a partial one is a prefix of, which is what a caller usually typed", () => {
    expect(suggestPeople({ name: "calvin", people })).toStrictEqual(["Calvin Tate"]);
  });

  it("offers nothing for a name that is close to nobody, so the refusal says so instead of guessing", () => {
    expect(suggestPeople({ name: "zzzz", people })).toStrictEqual([]);
  });

  it("caps how many it offers, so a common fragment does not print the directory", () => {
    const many = Array.from({ length: 20 }, (_, at) =>
      person({ displayName: `Seth ${String(at)}`, id: `p${String(at)}` }),
    );
    expect(suggestPeople({ limit: 3, name: "seth", people: many }).length).toBe(3);
  });
});
