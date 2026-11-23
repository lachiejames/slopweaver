import { describe, expect, it } from "vitest";
import { z } from "zod";

import { jumpcloudBoundarySource } from "../../../../atlas/jumpcloud/boundaryCodegen.js";
import type { JumpcloudDeclaredCarrier } from "../../../../atlas/jumpcloud/carrierCodegen.js";
import { JumpcloudCodegenErrors } from "../../../../atlas/jumpcloud/codegenErrors.js";
import { defineJumpcloudArrayBoundary } from "../../../../atlas/jumpcloud/responseBoundary.js";
import {
  type JumpcloudResponseCensus,
  type JumpcloudSurfaceCensus,
  observeJumpcloudAnswer,
} from "../../../../atlas/jumpcloud/responseCensus.js";
import {
  JUMPCLOUD_RESPONSE_DOCUMENT_PATHS,
  type JumpcloudResponseDocumentPath,
  jumpcloudResponseDocumentPathRefusals,
  jumpcloudResponseDocumentPathsFor,
} from "../../../../atlas/jumpcloud/responseDocumentPaths.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

/** The census one surface's answers produce. */
function censusOf({ texts }: { texts: readonly string[] }): JumpcloudResponseCensus {
  const census: JumpcloudResponseCensus = {};
  for (const text of texts) {
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text });
  }
  return census;
}

const BARE: JumpcloudDeclaredCarrier = { kind: "bare-array" };

/** The boundary source of surface `s` with `doc` declared a document. */
function sourceWithDoc({ stat }: { stat: JumpcloudSurfaceCensus }): string {
  const documentPaths = new Set(["[].doc"]);
  return unwrap(jumpcloudBoundarySource({ documentPaths, specCarrier: () => ok(BARE), stat, surface: "s" }));
}

/** One entry on surface `s`. */
function entry({ path, reason = "a document" }: { path: string; reason?: string }): JumpcloudResponseDocumentPath {
  return { path, reason, surface: "s" };
}

describe("jumpcloudBoundarySource over a named document path", () => {
  it("declares the document unread and every key beside it strict, whatever the documents held", () => {
    const stat = censusOf({ texts: ['[{"doc":{"a":{"b":1}},"id":"x"},{"doc":{"c":[true]},"id":"y"}]'] })["s"]!;
    expect(sourceWithDoc({ stat })).toBe(
      'defineJumpcloudArrayBoundary({ item: z.strictObject({ doc: z.unknown(), id: z.string() }), surface: "s" })',
    );
  });

  it("keeps a document present on only some records optional", () => {
    const stat = censusOf({ texts: ['[{"doc":{"a":1},"id":"x"},{"id":"y"}]'] })["s"]!;
    expect(sourceWithDoc({ stat })).toBe(
      'defineJumpcloudArrayBoundary({ item: z.strictObject({ doc: z.unknown().optional(), id: z.string() }), surface: "s" })',
    );
  });
});

describe("a boundary holding a document field", () => {
  const boundary = defineJumpcloudArrayBoundary({
    item: z.strictObject({ doc: z.unknown(), id: z.string() }),
    surface: "s",
  });

  it("admits documents of unrelated keys at any depth", () => {
    const text = '[{"doc":{"a":{"b":[1]}},"id":"x"},{"doc":{"z":"q"},"id":"y"}]';
    expect(unwrap(boundary.admit({ headers: {}, text })).records).toEqual([
      { doc: { a: { b: [1] } }, id: "x" },
      { doc: { z: "q" }, id: "y" },
    ]);
  });

  it("still refuses a key added beside the document, and a missing document", () => {
    const added = unwrapErr(boundary.admit({ headers: {}, text: '[{"doc":{},"id":"x","owner":"o"}]' }));
    expect(added.message).toContain('new field "[0].owner"');
    const missing = unwrapErr(boundary.admit({ headers: {}, text: '[{"id":"x"}]' }));
    expect(missing.message).toContain('field "[0].doc" is missing');
  });
});

describe("jumpcloudResponseDocumentPathsFor", () => {
  it("reads the paths named for one surface only", () => {
    const paths = [entry({ path: "[].a" }), { path: "[].b", reason: "x", surface: "t" }];
    expect([...jumpcloudResponseDocumentPathsFor({ paths, surface: "s" })]).toEqual(["[].a"]);
    expect([...jumpcloudResponseDocumentPathsFor({ paths, surface: "u" })]).toEqual([]);
  });
});

describe("jumpcloudResponseDocumentPathRefusals", () => {
  const census = censusOf({ texts: ['[{"doc":{"a":1},"n":1}]'] });
  const generated = new Set(["s"]);
  const refusal = ({ path, why }: { path: string; why: string }) =>
    JumpcloudCodegenErrors.responseDocumentPath({ path, surface: "s", why });

  it("passes an entry naming an object field its surface measured", () => {
    expect(jumpcloudResponseDocumentPathRefusals({ census, generated, paths: [entry({ path: "[].doc" })] })).toEqual(
      [],
    );
  });

  it("refuses each entry that cannot stand, naming the check", () => {
    const paths = [
      entry({ path: "[].doc", reason: " " }),
      entry({ path: "[].doc[]" }),
      entry({ path: "[].n" }),
      entry({ path: "[].gone" }),
      { path: "[].doc", reason: "x", surface: "t" },
    ];
    expect(jumpcloudResponseDocumentPathRefusals({ census, generated, paths })).toEqual([
      refusal({ path: "[].doc", why: "no reason given" }),
      refusal({ path: "[].doc[]", why: "not an object field, the only place an unread value may stand" }),
      refusal({ path: "[].n", why: "measured as number, not an object" }),
      refusal({ path: "[].gone", why: "never measured on a surface whose answers were" }),
      JumpcloudCodegenErrors.responseDocumentPath({
        path: "[].doc",
        surface: "t",
        why: "no generated boundary admits this surface",
      }),
    ]);
  });

  it("refuses a path below a field measured as a scalar or only null, and checks none below an empty list", () => {
    const below = censusOf({ texts: ['[{"x":1,"y":null,"list":[]}]'] });
    const paths = [entry({ path: "[].x.doc" }), entry({ path: "[].y.doc" }), entry({ path: "[].list[].doc" })];
    expect(jumpcloudResponseDocumentPathRefusals({ census: below, generated, paths })).toEqual([
      refusal({ path: "[].x.doc", why: "below a field measured as number, not an object" }),
      refusal({ path: "[].y.doc", why: "below a field measured as null, not an object" }),
    ]);
  });

  it("refuses a path missing a list's item marker, empty list or not", () => {
    const lists = censusOf({ texts: ['[{"items":[{"doc":{"a":1}}],"none":[]}]'] });
    const paths = [entry({ path: "[].items.doc" }), entry({ path: "[].none.doc" })];
    expect(jumpcloudResponseDocumentPathRefusals({ census: lists, generated, paths })).toEqual([
      refusal({ path: "[].items.doc", why: "below a field measured as array, not an object" }),
      refusal({ path: "[].none.doc", why: "below a field measured as array, not an object" }),
    ]);
  });

  it("refuses a data-keyed map's value, which no boundary may leave unread", () => {
    const keyed = censusOf({ texts: ['[{"docs":{"0b9a8c7d-1234-4abc-9def-0123456789ab":{"a":1}}}]'] });
    const path = Object.keys(keyed["s"]!.paths).find((measured) => measured.startsWith("[].docs.<"))!;
    expect(jumpcloudResponseDocumentPathRefusals({ census: keyed, generated, paths: [entry({ path })] })).toEqual([
      refusal({ path, why: "not an object field, the only place an unread value may stand" }),
    ]);
  });

  it("refuses a duplicate and an entry below another", () => {
    const paths = [entry({ path: "[].doc" }), entry({ path: "[].doc" }), entry({ path: "[].doc.a" })];
    expect(jumpcloudResponseDocumentPathRefusals({ census, generated, paths })).toEqual([
      refusal({ path: "[].doc", why: "named twice" }),
      refusal({ path: "[].doc", why: "named twice" }),
      refusal({ path: "[].doc.a", why: "below another document path on the same surface" }),
    ]);
  });

  it("checks no path on a surface no answer measured, nor in a record no answer carried", () => {
    const paths = [entry({ path: "[].anything" })];
    expect(jumpcloudResponseDocumentPathRefusals({ census: {}, generated, paths })).toEqual([]);
    const emptyList = censusOf({ texts: ["[]"] });
    expect(jumpcloudResponseDocumentPathRefusals({ census: emptyList, generated, paths })).toEqual([]);
  });

  it("refuses a path inside a record measured with no keys at all", () => {
    const paths = [entry({ path: "ghost" }), entry({ path: "[].ghost" })];
    const emptyObject = censusOf({ texts: ["{}"] });
    const emptyItem = censusOf({ texts: ["[{}]"] });
    const never = "never measured on a surface whose answers were";
    expect(jumpcloudResponseDocumentPathRefusals({ census: emptyObject, generated, paths: [paths[0]!] })).toEqual([
      refusal({ path: "ghost", why: never }),
    ]);
    expect(jumpcloudResponseDocumentPathRefusals({ census: emptyItem, generated, paths: [paths[1]!] })).toEqual([
      refusal({ path: "[].ghost", why: never }),
    ]);
  });

  it("names exactly the three documents measured on the live tenancy", () => {
    expect(JUMPCLOUD_RESPONSE_DOCUMENT_PATHS.map(({ surface, path }) => `${surface} ${path}`)).toEqual([
      "v2-list-templates templates[].dsl",
      "v2-rules-service-list-rules rules[].conditions[].filters",
      "v2-rule-templates-service-list-rule-templates templates[].outputSchema",
    ]);
  });
});
