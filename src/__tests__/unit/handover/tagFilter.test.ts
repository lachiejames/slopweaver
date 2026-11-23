/**
 * `handover list --tag`'s filter: the three term shapes, the registry judging each before any row is read, and
 * matching that reads a row's actionable tags only — AND across every term.
 */
import { describe, expect, it } from "vitest";

import type { RowTags } from "../../../handover/rowTagFold.js";
import { EMPTY_TAG_FILTER, matchesTagFilter, parseTagFilter } from "../../../handover/tagFilter.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** A row carrying `platform=slack`, two workstreams, derived `kind=ask`, and an unrecognised `audience=robots`. */
const TAGS: RowTags = {
  tags: [
    { key: "platform", source: "declared", value: "slack" },
    { key: "workstream", source: "declared", value: "iso-certification" },
    { key: "workstream", source: "declared", value: "hiring" },
    { key: "kind", source: "derived", value: "ask" },
  ],
  unrecognised: [{ key: "audience", source: "unrecognised", value: "robots" }],
};

/** Whether `TAGS` matches the filter the flag values parse to. */
function matches({ flagValues }: { flagValues: readonly string[] }): boolean {
  return matchesTagFilter({ filter: unwrap(parseTagFilter({ flagValues })), tags: TAGS });
}

describe("parseTagFilter", () => {
  it("reads the three term shapes, splitting on the separator and keeping a repeated term once", () => {
    const filter = unwrap(parseTagFilter({ flagValues: ["platform=slack,workstream", "!impact", "platform=slack"] }));
    expect(filter.terms).toEqual([
      { key: "platform", kind: "has-value", text: "platform=slack", value: "slack" },
      { key: "workstream", kind: "has-key", text: "workstream" },
      { key: "impact", kind: "lacks-key", text: "!impact" },
    ]);
  });

  it("accepts a derived key, which no session may write but any reader may ask about", () => {
    expect(unwrap(parseTagFilter({ flagValues: ["kind=ask", "!origin"] })).terms.map((term) => term.text)).toEqual([
      "kind=ask",
      "!origin",
    ]);
  });

  it("marks a filter that reads the journal — a declared key, reply or run — and one that reads doc fields only", () => {
    expect(unwrap(parseTagFilter({ flagValues: ["workstream"] })).readsJournal).toBe(true);
    expect(unwrap(parseTagFilter({ flagValues: ["reply=drafted"] })).readsJournal).toBe(true);
    expect(unwrap(parseTagFilter({ flagValues: ["run=open"] })).readsJournal).toBe(true);
    expect(unwrap(parseTagFilter({ flagValues: ["kind=ask,priority=p0,!origin,repo=slopweaver"] })).readsJournal).toBe(
      false,
    );
    expect(EMPTY_TAG_FILTER.readsJournal).toBe(false);
  });

  it("refuses every term the registry could never match, naming each rather than the first", () => {
    expect(unwrapErr(parseTagFilter({ flagValues: ["platfrom=slack,kind=robot", "workstream=Not Kebab"] }))).toEqual([
      '"platfrom" is not a tag key — did you mean platform?',
      '"robot" is not a value kind takes — it takes doc | ask | tag',
      '"Not Kebab" is not a value workstream takes — it takes a kebab-case workstream name, e.g. iso-certification',
    ]);
  });

  it("refuses an empty term, a negated value, a half-empty pair and surrounding whitespace", () => {
    expect(
      unwrapErr(parseTagFilter({ flagValues: ["", "platform=slack,", "!platform=slack", "=x", "impact= high"] })),
    ).toEqual([
      "a --tag filter term is empty — write key=value, key, or !key",
      "a --tag filter term is empty — write key=value, key, or !key",
      '"!platform=slack" negates a value, which a filter cannot — write !key for rows missing the key',
      '"=x" is not a tag — write it as key=value, e.g. platform=slack',
      '" high" carries surrounding whitespace, which the journal would keep and no filter would match',
    ]);
    expect(unwrapErr(parseTagFilter({ flagValues: ["!"] }))).toEqual([
      "a --tag filter term is empty — write key=value, key, or !key",
    ]);
  });
});

describe("matchesTagFilter", () => {
  it("matches a held value, a held key and a missing key", () => {
    expect(matches({ flagValues: ["platform=slack"] })).toBe(true);
    expect(matches({ flagValues: ["workstream=hiring"] })).toBe(true);
    expect(matches({ flagValues: ["workstream"] })).toBe(true);
    expect(matches({ flagValues: ["!impact"] })).toBe(true);
    expect(matches({ flagValues: ["kind=ask"] })).toBe(true);
  });

  it("refuses a value the row does not hold, a key it lacks, and a key it has under !", () => {
    expect(matches({ flagValues: ["platform=linear"] })).toBe(false);
    expect(matches({ flagValues: ["impact"] })).toBe(false);
    expect(matches({ flagValues: ["!platform"] })).toBe(false);
  });

  it("needs every term to hold, whether terms arrive as flags or comma members", () => {
    expect(matches({ flagValues: ["platform=slack", "workstream=hiring"] })).toBe(true);
    expect(matches({ flagValues: ["platform=slack,impact"] })).toBe(false);
    expect(matches({ flagValues: ["platform=slack", "impact"] })).toBe(false);
  });

  it("never matches an unrecognised tag, so !key selects a row carrying only an unrecognised value of it", () => {
    // The value itself is one the registry refuses, so it cannot even be asked for.
    expect(unwrapErr(parseTagFilter({ flagValues: ["audience=robots"] }))).toEqual([
      '"robots" is not a value audience takes — it takes owner | team | person | channel',
    ]);
    expect(matches({ flagValues: ["audience"] })).toBe(false);
    expect(matches({ flagValues: ["!audience"] })).toBe(true);
  });

  it("matches every row through the empty filter", () => {
    expect(matchesTagFilter({ filter: EMPTY_TAG_FILTER, tags: { tags: [], unrecognised: [] } })).toBe(true);
  });
});
