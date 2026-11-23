/**
 * How one JumpCloud answer is admitted — `src/atlas/jumpcloud/responseBoundary.ts`.
 *
 * Each surface declares its carrier, so an answer in any other carrier, or carrying a field its item does not
 * declare, is refused by name instead of being re-guessed into a page.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineJumpcloudArrayBoundary,
  defineJumpcloudEmptyBoundary,
  defineJumpcloudObjectBoundary,
  defineJumpcloudWrappedBoundary,
} from "../../../../atlas/jumpcloud/responseBoundary.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const SURFACE = "v2-gcep-device-state";
const ITEM = z.strictObject({ id: z.string(), name: z.string() });
const NO_HEADERS = {};
const TOTAL_HEADERS = { "x-total-count": "7" };

describe("defineJumpcloudArrayBoundary", () => {
  const boundary = defineJumpcloudArrayBoundary({ item: ITEM, surface: SURFACE });

  it("admits a bare array, its total read from X-Total-Count", () => {
    const page = unwrap(boundary.admit({ headers: TOTAL_HEADERS, text: '[{"id":"a","name":"A"}]' }));

    expect(page).toEqual({ records: [{ id: "a", name: "A" }], shape: "bare-array", totalCount: 7 });
    expect(boundary.carrier).toBe("bare-array");
    expect(boundary.surface).toBe(SURFACE);
  });

  it("carries no total when the provider sent no header", () => {
    expect(unwrap(boundary.admit({ headers: NO_HEADERS, text: "[]" })).totalCount).toBe(null);
  });

  it("refuses a new field on an item by name, holding nothing", () => {
    const refused = unwrapErr(boundary.admit({ headers: NO_HEADERS, text: '[{"id":"a","name":"A","owner":"x"}]' }));

    expect(refused.code).toBe("BODY_SHAPE_CHANGED");
    expect(refused.message).toBe(
      `${SURFACE} answered a shape this version does not read, so nothing it answered is held: new field "[0].owner"`,
    );
  });

  it("refuses a missing field by name", () => {
    const refused = unwrapErr(boundary.admit({ headers: NO_HEADERS, text: '[{"id":"a"}]' }));

    expect(refused.message).toBe(
      `${SURFACE} answered a shape this version does not read, so nothing it answered is held: field "[0].name" is missing`,
    );
  });

  it("refuses a v1 wrapper on a surface declared bare, rather than re-guessing the carrier", () => {
    const refused = unwrapErr(boundary.admit({ headers: NO_HEADERS, text: '{"results":[],"totalCount":0}' }));

    expect(refused.code).toBe("BODY_SHAPE_CHANGED");
  });

  it("refuses an empty body on a surface that never declared one", () => {
    expect(unwrapErr(boundary.admit({ headers: NO_HEADERS, text: "  " })).code).toBe("BODY_SHAPE_CHANGED");
  });

  it("names the first three drifted fields and counts the rest", () => {
    const text = '[{"id":"a","name":"A","p":1,"q":2,"r":3,"s":4,"t":5}]';
    const refused = unwrapErr(boundary.admit({ headers: NO_HEADERS, text }));

    expect(refused.message).toBe(
      `${SURFACE} answered a shape this version does not read, so nothing it answered is held: new field "[0].p"; new field "[0].q"; new field "[0].r" (+2 more)`,
    );
  });

  it("words a body that is not JSON by its length alone, never carrying its text", () => {
    const refused = unwrapErr(boundary.admit({ headers: NO_HEADERS, text: "<html>secret</html>" }));

    expect(refused.code).toBe("OPERATION_UNUSABLE");
    expect(refused.message).toBe(
      `${SURFACE} will not serve the request as this atlas constructs it: the response body is not JSON — 19 byte(s) that this atlas cannot store as a document. That is a fact about the operation rather than a failed read, so it does not stop a generation being published`,
    );
  });

  it("admits a value a file decoder already produced", () => {
    const page = unwrap(boundary.admitValue({ headers: NO_HEADERS, value: [{ id: "b", name: "B" }] }));

    expect(page.records).toEqual([{ id: "b", name: "B" }]);
  });
});

describe("defineJumpcloudWrappedBoundary", () => {
  it("admits v1's wrapper, its total read off the body", () => {
    const boundary = defineJumpcloudWrappedBoundary({ envelope: "results-total", item: ITEM, surface: SURFACE });
    const page = unwrap(
      boundary.admit({ headers: TOTAL_HEADERS, text: '{"results":[{"id":"a","name":"A"}],"totalCount":53}' }),
    );

    expect(page).toEqual({ records: [{ id: "a", name: "A" }], shape: "wrapped-results", totalCount: 53 });
  });

  it("refuses v1's wrapper with its total missing", () => {
    const boundary = defineJumpcloudWrappedBoundary({ envelope: "results-total", item: ITEM, surface: SURFACE });
    const refused = unwrapErr(boundary.admit({ headers: NO_HEADERS, text: '{"results":[]}' }));

    expect(refused.message).toBe(
      `${SURFACE} answered a shape this version does not read, so nothing it answered is held: field "totalCount" is missing`,
    );
  });

  it("admits v2's results-only wrapper, its total read from X-Total-Count", () => {
    const boundary = defineJumpcloudWrappedBoundary({ envelope: "results-only", item: ITEM, surface: SURFACE });
    const page = unwrap(boundary.admit({ headers: TOTAL_HEADERS, text: '{"results":[]}' }));

    expect(page).toEqual({ records: [], shape: "wrapped-results", totalCount: 7 });
  });

  it("refuses a total in the body of a results-only wrapper, a carrier change", () => {
    const boundary = defineJumpcloudWrappedBoundary({ envelope: "results-only", item: ITEM, surface: SURFACE });
    const refused = unwrapErr(boundary.admit({ headers: NO_HEADERS, text: '{"results":[],"totalCount":0}' }));

    expect(refused.message).toBe(
      `${SURFACE} answered a shape this version does not read, so nothing it answered is held: new field "totalCount"`,
    );
  });
});

describe("defineJumpcloudObjectBoundary", () => {
  const boundary = defineJumpcloudObjectBoundary({ object: ITEM, surface: SURFACE });

  it("admits one object as exactly one record", () => {
    const page = unwrap(boundary.admit({ headers: NO_HEADERS, text: '{"id":"a","name":"A"}' }));

    expect(page).toEqual({ records: [{ id: "a", name: "A" }], shape: "single-object", totalCount: null });
  });

  it("refuses an array where the surface declares one object", () => {
    expect(unwrapErr(boundary.admit({ headers: NO_HEADERS, text: '[{"id":"a","name":"A"}]' })).code).toBe(
      "BODY_SHAPE_CHANGED",
    );
  });

  it("takes only an object schema, so no scalar or list carrier can be declared through it", () => {
    // @ts-expect-error -- a scalar is not an object carrier; this line fails to compile if the constraint is lost
    const scalar = (): unknown => defineJumpcloudObjectBoundary({ object: z.string(), surface: SURFACE });

    expect(scalar).toBeInstanceOf(Function);
  });

  it("refuses a changed field type by name", () => {
    const refused = unwrapErr(boundary.admit({ headers: NO_HEADERS, text: '{"id":"a","name":3}' }));

    expect(refused.code).toBe("BODY_SHAPE_CHANGED");
    expect(refused.message).toContain('field "name" changed');
  });
});

describe("defineJumpcloudEmptyBoundary", () => {
  const boundary = defineJumpcloudEmptyBoundary({ surface: SURFACE });

  it("admits an empty body as a page of no records", () => {
    expect(unwrap(boundary.admit({ headers: NO_HEADERS, text: "" }))).toEqual({
      records: [],
      shape: "empty",
      totalCount: null,
    });
  });

  it("refuses a body on a surface measured to answer none", () => {
    expect(unwrapErr(boundary.admit({ headers: NO_HEADERS, text: "[]" })).code).toBe("BODY_SHAPE_CHANGED");
  });

  it("refuses a decoded value, null included, since a decoded file is a body", () => {
    expect(unwrapErr(boundary.admitValue({ headers: NO_HEADERS, value: null })).code).toBe("BODY_SHAPE_CHANGED");
  });

  it("refuses the JSON body null, which is a body and not the absence of one", () => {
    expect(unwrapErr(boundary.admit({ headers: NO_HEADERS, text: "null" })).message).toBe(
      `${SURFACE} answered a shape this version does not read, so nothing it answered is held: new field "(body)" where the surface declares no body`,
    );
  });
});
