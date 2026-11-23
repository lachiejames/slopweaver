/**
 * The bar this repo's identity layer has to clear: two distinct humans who share one Slack display name must
 * stay two people, and no code path may key a person on a name.
 *
 * These are written as end-to-end resolver assertions rather than unit checks of the shape predicate, because
 * the defect they cover was never in one function — a display name reached `nativeId` at the projection edge
 * and every tier downstream then behaved correctly on a value it should never have been handed.
 */
import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { Person } from "../../../silver/identity.js";
import { isNativeIdShaped } from "../../../silver/nativeIdShape.js";
import type { RawPersonResolution } from "../../../silver/personLookup.js";
import { resolvePersonForRaw } from "../../../silver/personLookup.js";
import { identityCandidatesForRecord, resolveFromRecords } from "../../../silver/personResolver.js";

/** A Slack `file` record as `src/corpus/slack/project.ts` really projects one: author is a display NAME. */
const fileRecord = ({ author, user, sourceId }: { author: string; user: string; sourceId: string }): CorpusRecord => ({
  author,
  container: "slack/C1",
  kind: "file",
  raw: { id: "F1", user },
  refs: [],
  source: "slack",
  sourceId,
  text: "File: chart.png",
  tsIso: "2026-05-01T00:00:00Z",
  url: "https://example.invalid/f",
});

/** The candidates an ambiguous lookup named, THROWING on any other outcome — so no assertion needs a branch. */
const ambiguousPeople = ({ resolved }: { resolved: RawPersonResolution }): readonly Person[] => {
  if (resolved.kind !== "ambiguous") {
    throw new Error(`expected an ambiguous lookup, got ${resolved.kind}`);
  }
  return resolved.people;
};

/** The single person a lookup resolved to, THROWING on any other outcome. */
const onlyPerson = ({ resolved }: { resolved: RawPersonResolution }): Person => {
  if (resolved.kind !== "resolved") {
    throw new Error(`expected exactly one person, got ${resolved.kind}`);
  }
  return resolved.person;
};

describe("two humans sharing one Slack display name", () => {
  it("stay TWO canonical people, each keyed on their own Slack user id", () => {
    const resolution = resolveFromRecords({
      records: [
        fileRecord({ author: "Chris", sourceId: "C1:1:file:F1", user: "U111AAA" }),
        fileRecord({ author: "Chris", sourceId: "C1:2:file:F2", user: "U222BBB" }),
      ],
      roster: [],
    });

    expect(resolution.people.length).toBe(2);
    expect(resolution.people.map((person) => person.id).toSorted()).toEqual([
      "person:slack:u111aaa",
      "person:slack:u222bbb",
    ]);
    expect(
      resolution.people.flatMap((person) => person.identities.map((identity) => identity.nativeId)).toSorted(),
    ).toEqual(["U111AAA", "U222BBB"]);
  });

  it("produces no person keyed on the shared display name", () => {
    const resolution = resolveFromRecords({
      records: [
        fileRecord({ author: "Chris", sourceId: "C1:1:file:F1", user: "U111AAA" }),
        fileRecord({ author: "Chris", sourceId: "C1:2:file:F2", user: "U222BBB" }),
      ],
      roster: [],
    });

    expect(resolution.people.some((person) => person.id === "person:slack:chris")).toBe(false);
    expect(
      resolution.people.flatMap((person) => person.identities).some((identity) => identity.nativeId === "Chris"),
    ).toBe(false);
  });

  it("reports the shared name as ambiguous rather than picking one of them", () => {
    const resolution = resolveFromRecords({
      records: [
        fileRecord({ author: "Chris", sourceId: "C1:1:file:F1", user: "U111AAA" }),
        fileRecord({ author: "Chris", sourceId: "C1:2:file:F2", user: "U222BBB" }),
      ],
      roster: [],
    });

    const people = ambiguousPeople({ resolved: resolvePersonForRaw({ raw: "Chris", resolution }) });

    expect(people.length).toBe(2);
    expect(people.map((person) => person.id).toSorted()).toEqual(["person:slack:u111aaa", "person:slack:u222bbb"]);
  });

  it("still resolves each of them exactly by their own Slack id", () => {
    const resolution = resolveFromRecords({
      records: [
        fileRecord({ author: "Chris", sourceId: "C1:1:file:F1", user: "U111AAA" }),
        fileRecord({ author: "Chris", sourceId: "C1:2:file:F2", user: "U222BBB" }),
      ],
      roster: [],
    });

    const one = onlyPerson({ resolved: resolvePersonForRaw({ raw: "U111AAA", resolution }) });

    expect(one.id).toBe("person:slack:u111aaa");
  });
});

describe("no derived identity is ever keyed on a display name", () => {
  it("refuses a Slack author that is a display name with no recoverable id", () => {
    expect(
      identityCandidatesForRecord({
        record: { ...fileRecord({ author: "Chris", sourceId: "C1:1:file:F1", user: "U1" }), raw: { id: "F1" } },
      }),
    ).toEqual([]);
  });

  it("refuses a Linear author, which its connector supplies as a displayName", () => {
    expect(
      identityCandidatesForRecord({
        record: {
          author: "wren.holloway",
          container: "ENGX",
          kind: "issue",
          raw: { creator: { displayName: "wren.holloway" }, id: "aaaaaaaa-1111-4111-8111-111111111111" },
          refs: [],
          source: "linear",
          sourceId: "ENGX-1",
          text: "t",
          tsIso: "2026-05-01T00:00:00Z",
          url: "https://example.invalid/i",
        },
      }),
    ).toEqual([]);
  });

  it("keeps a GitHub login, whose native id is legitimately name-shaped", () => {
    expect(
      identityCandidatesForRecord({
        record: {
          author: "wholloway-demo",
          container: "o/r",
          kind: "pr",
          refs: [],
          source: "github",
          sourceId: "#1",
          text: "t",
          tsIso: "2026-05-01T00:00:00Z",
          url: "https://example.invalid/p",
        },
      }),
    ).toEqual([{ name: "wholloway-demo", nativeId: "wholloway-demo", source: "github" }]);
  });

  it("every source rejects a value carrying whitespace, which no native id has", () => {
    expect(isNativeIdShaped({ source: "slack", value: "Wren De La Holloway" })).toBe(false);
    expect(isNativeIdShaped({ source: "linear", value: "Wren De La Holloway" })).toBe(false);
    expect(isNativeIdShaped({ source: "notion", value: "Wren De La Holloway" })).toBe(false);
    expect(isNativeIdShaped({ source: "github", value: "Wren De La Holloway" })).toBe(false);
  });

  it("accepts each source's real id shape", () => {
    expect(isNativeIdShaped({ source: "slack", value: "UOWNER" })).toBe(true);
    expect(isNativeIdShaped({ source: "linear", value: "aaaaaaaa-1111-4111-8111-111111111111" })).toBe(true);
    expect(isNativeIdShaped({ source: "notion", value: "aaaaaaaa111141118111111111111111" })).toBe(true);
    expect(isNativeIdShaped({ source: "github", value: "github-actions[bot]" })).toBe(true);
  });
});
