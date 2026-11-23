/**
 * The one catalog: the owner's stated outcomes first, then the mined candidates, refusing a clash across the two rather
 * than handing the owner's word to the wrong one.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { candidateCatalog } from "../../../workstreams/candidateCatalog.js";
import { parseCandidatesFile } from "../../../workstreams/candidates.js";
import { candidatesDocument } from "../../../workstreams/candidatesDocument.js";
import { SYNTHETIC_STATED } from "../../statedCandidatesFixture.js";

import { validCandidates } from "./candidatesFixture.js";

const mined = unwrap(parseCandidatesFile({ value: validCandidates() }));

/** A document read over an empty store, no reactions and nothing else on the page. */
const NOTHING_ELSE = {
  definitions: [],
  drafts: [],
  proposals: [],
  register: { meta: null, workstreams: [] },
  rows: [],
  titles: [],
  whoFirst: [],
} as const;

describe("candidateCatalog", () => {
  it("lists the stated outcomes first, in their order, then the mined ones in file order, with the file's provenance", () => {
    const catalog = unwrap(candidateCatalog({ mined, stated: SYNTHETIC_STATED }));

    expect(catalog.candidates.map((one) => one.id)).toEqual([
      ...SYNTHETIC_STATED.map((one) => one.id),
      ...mined.candidates.map((one) => one.id),
    ]);
    expect([catalog.mined, catalog.channels]).toEqual([
      { minedFrom: mined.minedFrom, minedIso: mined.minedIso, minedSources: mined.minedSources },
      mined.channels,
    ]);
  });

  it("offers the stated outcomes alone before any mine, with no provenance and no channels", () => {
    const catalog = unwrap(candidateCatalog({ mined: null, stated: SYNTHETIC_STATED }));

    expect([catalog.candidates.length, catalog.mined, catalog.channels]).toEqual([SYNTHETIC_STATED.length, null, {}]);
  });

  it("refuses a mined candidate reusing a stated id, number or name, naming the clash", () => {
    const value = validCandidates();
    const first = (value["candidates"] as Record<string, unknown>[])[0]!;
    first["id"] = SYNTHETIC_STATED[0]!.id;
    const clashing = unwrap(parseCandidatesFile({ value }));

    const refused = unwrapErr(candidateCatalog({ mined: clashing, stated: SYNTHETIC_STATED }));

    expect(refused.code).toBe("CANDIDATES_INVALID");
    expect(refused.message).toContain(SYNTHETIC_STATED[0]!.id);
  });

  it("offers nothing with neither a stated outcome nor a mine, and the document says so as zero candidates", () => {
    const catalog = unwrap(candidateCatalog({ mined: null, stated: [] }));
    const document = candidatesDocument({ ...NOTHING_ELSE, catalog });

    expect([catalog.candidates, catalog.mined, catalog.channels]).toEqual([[], null, {}]);
    expect([document.candidates, document.counts.unanswered, document.mined]).toEqual([[], 0, null]);
  });

  it("refuses a stated set that clashes with itself, mined or not", () => {
    const doubled = [SYNTHETIC_STATED[0]!, SYNTHETIC_STATED[0]!];

    expect(unwrapErr(candidateCatalog({ mined: null, stated: doubled })).code).toBe("CANDIDATES_INVALID");
  });

  it("carries the mine's provenance onto the document, and null with the stated outcomes alone", () => {
    const fromMine = candidatesDocument({ ...NOTHING_ELSE, catalog: unwrap(candidateCatalog({ mined, stated: [] })) });
    const statedOnly = candidatesDocument({
      ...NOTHING_ELSE,
      catalog: unwrap(candidateCatalog({ mined: null, stated: SYNTHETIC_STATED })),
    });

    expect(fromMine.mined).toEqual({
      minedFrom: mined.minedFrom,
      minedIso: mined.minedIso,
      minedSources: mined.minedSources,
    });
    expect([statedOnly.mined, statedOnly.counts.unanswered, statedOnly.candidates.length]).toEqual([
      null,
      SYNTHETIC_STATED.length,
      SYNTHETIC_STATED.length,
    ]);
  });
});
