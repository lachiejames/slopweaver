/**
 * The pure private-terms editor: an add lands a seven-cell row with its meaning, a narrow or remove names a row by
 * id (or `line-<n>` before migration), a four-cell file migrates whole, and every refusal names no term. Every term
 * here is synthetic.
 */
import { describe, expect, it } from "vitest";

import { PRIVATE_TERMS_HEADER_V1, PRIVATE_TERMS_HEADER_V2 } from "../../../hygiene/privateTerms.js";
import {
  applyPrivateTermsEdit,
  type PrivateTermRowInput,
  privateTermClassOf,
} from "../../../hygiene/privateTermsEdit.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** A minter handing out the given ids in order. */
function minter({ ids }: { ids: readonly string[] }): () => string {
  let next = 0;
  return () => {
    const id = ids[next]!;
    next += 1;
    return id;
  };
}

const ROW: PrivateTermRowInput = {
  allowedWhere: "the acme workspace",
  caseInsensitive: true,
  className: "person",
  meaning: "a colleague at acme",
  pattern: "quillfeather",
  source: "relay:acme-row",
};

const V2_ONE = [
  PRIVATE_TERMS_HEADER_V2,
  "pt-00000000000a\tperson\ti\tquillfeather\ta colleague at acme\tthe acme workspace\trelay:acme-row",
  "",
].join("\n");

describe("applyPrivateTermsEdit", () => {
  it("starts an absent file with the seven-cell header and one row carrying its meaning", () => {
    const edited = unwrap(
      applyPrivateTermsEdit({
        current: { kind: "absent" },
        edit: { kind: "add", row: ROW },
        mintId: minter({ ids: ["pt-00000000000a"] }),
      }),
    );
    expect(edited.text).toBe(V2_ONE);
    expect(edited.termId).toBe("pt-00000000000a");
    expect(edited.edited!.meaning).toBe("a colleague at acme");
    expect(edited.edited!.allowedWhere).toBe("the acme workspace");
    expect([edited.rowsBefore, edited.rowsAfter, edited.migrated]).toStrictEqual([0, 1, false]);
  });

  it("migrates a four-cell file whole, keeping comments, and names its rows line-<n> until then", () => {
    const v1 = ["# kept", PRIVATE_TERMS_HEADER_V1, "person\ti\tquillfeather\tsynthetic", ""].join("\n");
    const edited = unwrap(
      applyPrivateTermsEdit({
        current: { kind: "present", text: v1 },
        edit: {
          kind: "narrow",
          narrowing: {
            allowedWhere: undefined,
            caseInsensitive: undefined,
            meaning: "a colleague",
            pattern: undefined,
          },
          termId: "line-3",
        },
        mintId: minter({ ids: ["pt-00000000000b"] }),
      }),
    );
    expect(edited.text).toBe(
      [
        "# kept",
        PRIVATE_TERMS_HEADER_V2,
        "pt-00000000000b\tperson\ti\tquillfeather\ta colleague\t\tsynthetic",
        "",
      ].join("\n"),
    );
    expect(edited.migrated).toBe(true);
    expect(edited.termId).toBe("pt-00000000000b");
  });

  it("narrows only the cells it names", () => {
    const edited = unwrap(
      applyPrivateTermsEdit({
        current: { kind: "present", text: V2_ONE },
        edit: {
          kind: "narrow",
          narrowing: { allowedWhere: "nowhere", caseInsensitive: false, meaning: undefined, pattern: undefined },
          termId: "pt-00000000000a",
        },
        mintId: minter({ ids: [] }),
      }),
    );
    expect(edited.text.split("\n")[1]).toBe(
      "pt-00000000000a\tperson\t-\tquillfeather\ta colleague at acme\tnowhere\trelay:acme-row",
    );
  });

  it("removes a row by id", () => {
    const edited = unwrap(
      applyPrivateTermsEdit({
        current: { kind: "present", text: V2_ONE },
        edit: { kind: "remove", termId: "pt-00000000000a" },
        mintId: minter({ ids: [] }),
      }),
    );
    expect(edited.text).toBe(`${PRIVATE_TERMS_HEADER_V2}\n`);
    expect([edited.rowsBefore, edited.rowsAfter, edited.edited]).toStrictEqual([1, 0, undefined]);
  });

  it("refuses an add with an empty meaning", () => {
    const error = unwrapErr(
      applyPrivateTermsEdit({
        current: { kind: "absent" },
        edit: { kind: "add", row: { ...ROW, meaning: "  " } },
        mintId: minter({ ids: ["pt-00000000000a"] }),
      }),
    );
    expect(error.code).toBe("CELL_INVALID");
  });

  it("refuses a cell holding a tab", () => {
    const error = unwrapErr(
      applyPrivateTermsEdit({
        current: { kind: "absent" },
        edit: { kind: "add", row: { ...ROW, allowedWhere: "a\tb" } },
        mintId: minter({ ids: ["pt-00000000000a"] }),
      }),
    );
    expect(error.message).toBe("the allowed-where cannot be written: it holds a tab or a line break");
  });

  it("refuses a narrowing that changes nothing", () => {
    const error = unwrapErr(
      applyPrivateTermsEdit({
        current: { kind: "present", text: V2_ONE },
        edit: {
          kind: "narrow",
          narrowing: { allowedWhere: undefined, caseInsensitive: undefined, meaning: undefined, pattern: undefined },
          termId: "pt-00000000000a",
        },
        mintId: minter({ ids: [] }),
      }),
    );
    expect(error.code).toBe("NOTHING_TO_CHANGE");
  });

  it("refuses an unknown row and never prints an argument that is not an id's shape", () => {
    const error = unwrapErr(
      applyPrivateTermsEdit({
        current: { kind: "present", text: V2_ONE },
        edit: { kind: "remove", termId: "quillfeather" },
        mintId: minter({ ids: [] }),
      }),
    );
    expect(error.code).toBe("TERM_NOT_FOUND");
    expect(error.message).not.toContain("quillfeather");
    expect(error.message).toContain("<not a row id, not printed>");
  });

  it("refuses a pattern that would match everywhere, writing nothing", () => {
    const error = unwrapErr(
      applyPrivateTermsEdit({
        current: { kind: "absent" },
        edit: { kind: "add", row: { ...ROW, pattern: "x*" } },
        mintId: minter({ ids: ["pt-00000000000a"] }),
      }),
    );
    expect(error.code).toBe("RESULT_MALFORMED");
  });

  it("refuses to edit a file that does not parse", () => {
    const error = unwrapErr(
      applyPrivateTermsEdit({
        current: { kind: "present", text: "not a header\n" },
        edit: { kind: "add", row: ROW },
        mintId: minter({ ids: ["pt-00000000000a"] }),
      }),
    );
    expect(error.code).toBe("CURRENT_MALFORMED");
  });
});

describe("privateTermClassOf", () => {
  it("accepts a class in the closed set", () => {
    expect(unwrap(privateTermClassOf({ text: "person" }))).toBe("person");
  });

  it("refuses one outside it", () => {
    expect(unwrapErr(privateTermClassOf({ text: "planet" })).code).toBe("CELL_INVALID");
  });
});
