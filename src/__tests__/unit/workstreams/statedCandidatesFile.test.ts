/**
 * The stated-candidates document's parser, over values rather than files: the loader's own file reads are in
 * `readStatedCandidates.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { NONE_STATED, parseStatedCandidatesFile } from "../../../workstreams/statedCandidatesFile.js";
import { SYNTHETIC_FORMER, SYNTHETIC_STATED, statedCandidatesDocument } from "../../statedCandidatesFixture.js";

const PATH = "/home/stated-candidates.json";

describe("parseStatedCandidatesFile", () => {
  it("reads a valid document as its candidates in order and its former titles by id", () => {
    const stated = unwrap(parseStatedCandidatesFile({ path: PATH, value: statedCandidatesDocument() }));
    expect(stated.candidates).toEqual(SYNTHETIC_STATED);
    expect([...stated.formerNames]).toEqual([[SYNTHETIC_FORMER.id, SYNTHETIC_FORMER.title]]);
  });

  it("refuses a document of another schema version, naming the field", () => {
    const refused = unwrapErr(
      parseStatedCandidatesFile({ path: PATH, value: { ...statedCandidatesDocument(), schemaVersion: 2 } }),
    );
    expect(refused.code).toBe("CANDIDATES_INVALID");
    expect(refused.message).toContain("schemaVersion");
  });

  it("refuses a former title keyed by an id no stated candidate carries", () => {
    const refused = unwrapErr(
      parseStatedCandidatesFile({
        path: PATH,
        value: statedCandidatesDocument({ formerNames: { "acme-gone": "Gone" } }),
      }),
    );
    expect(refused.message).toBe(
      `the stated candidates in ${PATH} do not validate — formerNames.acme-gone: no stated candidate has the id acme-gone`,
    );
  });

  it("refuses a former title that is a stated candidate's current title", () => {
    const holder = SYNTHETIC_STATED[0]!;
    const refused = unwrapErr(
      parseStatedCandidatesFile({
        path: PATH,
        value: statedCandidatesDocument({ formerNames: { [SYNTHETIC_FORMER.id]: holder.name } }),
      }),
    );
    expect(refused.message).toBe(
      `the stated candidates in ${PATH} do not validate — formerNames.${SYNTHETIC_FORMER.id}: "${holder.name}" is the current title of ${holder.id}`,
    );
  });

  it("reads no stated outcome as no candidates and no former titles", () => {
    expect([NONE_STATED.candidates, [...NONE_STATED.formerNames]]).toEqual([[], []]);
  });
});
