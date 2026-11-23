/**
 * Every Braze atlas failure, raised through its factory: the code a caller branches on and the exact lines
 * it prints, with a list-carrying failure kept as separate lines rather than one joined sentence.
 */
import { describe, expect, it } from "vitest";

import { BrazeAtlasErrors, brazeAtlasErrorLines } from "../../../../atlas/braze/errors.js";

describe("BrazeAtlasErrors — the collection", () => {
  it("reports invalid JSON as a headline and the parser's own words", () => {
    const error = BrazeAtlasErrors.collectionNotJson({ cause: new SyntaxError("Unexpected token 'o'") });

    expect(error.code).toBe("COLLECTION_NOT_JSON");
    expect(brazeAtlasErrorLines({ error })).toEqual([
      "the Braze Postman collection is not valid JSON",
      "Unexpected token 'o'",
    ]);
    expect(error.message).toBe("the Braze Postman collection is not valid JSON; Unexpected token 'o'");
  });

  it("prints a non-Error cause as it is", () => {
    const error = BrazeAtlasErrors.collectionNotJson({ cause: "boom" });

    expect(brazeAtlasErrorLines({ error })).toEqual(["the Braze Postman collection is not valid JSON", "boom"]);
  });

  it("names each collection shape it cannot read", () => {
    const errors = [
      BrazeAtlasErrors.collectionNotObject(),
      BrazeAtlasErrors.collectionWithoutItems(),
      BrazeAtlasErrors.collectionWithoutRequests(),
    ];

    expect(errors.map((error) => error.code)).toEqual([
      "COLLECTION_NOT_OBJECT",
      "COLLECTION_WITHOUT_ITEMS",
      "COLLECTION_WITHOUT_REQUESTS",
    ]);
    expect(errors.flatMap((error) => brazeAtlasErrorLines({ error }))).toEqual([
      "the Braze Postman collection is not a JSON object",
      "the Braze Postman collection declares no `item` array, so it carries no requests to read",
      "the Braze Postman collection declares no readable request at all, so nothing was published",
    ]);
  });
});

describe("BrazeAtlasErrors — the reference", () => {
  it("names a page with no api_type block, on two lines", () => {
    const error = BrazeAtlasErrors.pageUndeclared({ url: "https://example.test/docs/api/endpoints/x/get_y" });

    expect(error.code).toBe("PAGE_UNDECLARED");
    expect(brazeAtlasErrorLines({ error })).toEqual([
      'https://example.test/docs/api/endpoints/x/get_y carries no <div class="api_type"> block, so this build cannot read the method and address Braze declares for it',
      "every operation page Braze served at its own address carried one when this reader was measured (146 of 146, on two separate measurements), and a page redirected off the operation tree is reported as unserved before this check — so a page served as an operation without one is a change in Braze's own template rather than an operation to drop silently",
    ]);
  });

  it("names an empty declaration", () => {
    const error = BrazeAtlasErrors.declarationEmpty({ url: "https://example.test/docs/api/endpoints/x/get_y" });

    expect(error.code).toBe("DECLARATION_EMPTY");
    expect(error.message).toBe(
      "https://example.test/docs/api/endpoints/x/get_y declares an empty method or address in its api_type block",
    );
  });

  it("names an empty sitemap by the size of what it returned", () => {
    const error = BrazeAtlasErrors.sitemapEmpty({ characters: 42 });

    expect(error.code).toBe("SITEMAP_EMPTY");
    expect(brazeAtlasErrorLines({ error })).toEqual([
      "the Braze documentation sitemap declared no operation pages at all",
      "an operation page is one under /docs/api/endpoints/ whose last segment begins with an HTTP method and an underscore; https://www.braze.com/docs/sitemap.xml returned 42 characters",
    ]);
  });

  it("names a refused fetch by status and address, on two lines", () => {
    const error = BrazeAtlasErrors.fetchRefused({
      label: "Braze Postman collection",
      status: 404,
      url: "https://example.test/c.json",
    });

    expect(error.code).toBe("FETCH_REFUSED");
    expect(brazeAtlasErrorLines({ error })).toEqual([
      "fetching Braze Postman collection returned HTTP 404",
      "the address is https://example.test/c.json",
    ]);
  });

  it("names a fetch that threw", () => {
    const error = BrazeAtlasErrors.fetchFailed({
      cause: new Error("ECONNRESET"),
      label: "Braze documentation sitemap",
    });

    expect(error.code).toBe("FETCH_FAILED");
    expect(brazeAtlasErrorLines({ error })).toEqual(["fetching Braze documentation sitemap failed: ECONNRESET"]);
  });
});

describe("BrazeAtlasErrors — publishing and reporting", () => {
  it("refuses families this build has no kind for", () => {
    const error = BrazeAtlasErrors.familiesUnknown({ unknownFamilies: ["catalogs", "sms"] });

    expect(error.code).toBe("FAMILIES_UNKNOWN");
    expect(brazeAtlasErrorLines({ error })).toEqual([
      "Braze's reference declares 2 documentation family/families this build has no kind for: catalogs, sms",
      "nothing was published — a new family is Braze adding a product area, which is exactly the unknown unknown this atlas exists to surface. Add it to BRAZE_KINDS and to atlasHome.ts, then run again",
    ]);
  });

  it("says there is nothing to report before a generation exists", () => {
    const error = BrazeAtlasErrors.nothingPublished();

    expect(error.code).toBe("NOTHING_PUBLISHED");
    expect(brazeAtlasErrorLines({ error })).toEqual([
      "no generation has been published, so there is nothing to compare",
      "run: slopweaver atlas braze sync — it needs no credential",
    ]);
  });
});
