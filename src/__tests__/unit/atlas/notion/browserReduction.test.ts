import { describe, expect, it } from "vitest";

import { NOTION_WEB_ORIGIN } from "../../../../atlas/notion/browserPages.js";
import {
  isFirstPartyNotionCall,
  notionOperationName,
  notionPathShape,
  reduceNotionCalls,
} from "../../../../atlas/notion/browserReduction.js";
import type { CapturedResponse } from "../../../../browser/pageTransport.js";

/** One captured response, overridable field by field. */
const response = (over: Partial<CapturedResponse> = {}): CapturedResponse => ({
  body: {},
  method: "POST",
  statusCode: 200,
  url: `${NOTION_WEB_ORIGIN}/api/v3/getSpaces`,
  ...over,
});

describe("isFirstPartyNotionCall", () => {
  it("accepts a call to Notion's own origin", () => {
    expect(isFirstPartyNotionCall({ origin: NOTION_WEB_ORIGIN, url: `${NOTION_WEB_ORIGIN}/api/v3/getSpaces` })).toBe(
      true,
    );
  });

  it("rejects a third-party telemetry beacon, which is an atlas of somebody else's product", () => {
    expect(isFirstPartyNotionCall({ origin: NOTION_WEB_ORIGIN, url: "https://telemetry.example.com/beacon" })).toBe(
      false,
    );
  });

  it("rejects a URL it cannot parse", () => {
    expect(isFirstPartyNotionCall({ origin: NOTION_WEB_ORIGIN, url: "not a url" })).toBe(false);
  });
});

describe("notionOperationName", () => {
  it("takes the final segment beneath the client's own API prefix", () => {
    expect(notionOperationName({ url: `${NOTION_WEB_ORIGIN}/api/v3/loadCachedPageChunk` })).toBe("loadCachedPageChunk");
  });

  it("reports null for a page URL, which is not one of the client's API posts", () => {
    expect(notionOperationName({ url: `${NOTION_WEB_ORIGIN}/acme/settings` })).toBeNull();
  });

  it("reports null for the prefix with nothing after it", () => {
    expect(notionOperationName({ url: `${NOTION_WEB_ORIGIN}/api/v3/` })).toBeNull();
  });

  it("reports null for a URL it cannot parse", () => {
    expect(notionOperationName({ url: "not a url" })).toBeNull();
  });
});

describe("notionPathShape", () => {
  it("leaves a named path verbatim", () => {
    expect(notionPathShape({ url: `${NOTION_WEB_ORIGIN}/api/v3/getSpaces` })).toBe("/api/v3/getSpaces");
  });

  it("redacts a 32-hex id segment, which is a page address and a private identifier", () => {
    expect(notionPathShape({ url: `${NOTION_WEB_ORIGIN}/image/0123456789abcdef0123456789abcdef` })).toBe("/image/{id}");
  });

  it("redacts a dashed uuid segment, which Notion uses interchangeably with the bare form", () => {
    expect(notionPathShape({ url: `${NOTION_WEB_ORIGIN}/f/01234567-89ab-cdef-0123-456789abcdef` })).toBe("/f/{id}");
  });

  it("redacts a bare run of digits", () => {
    expect(notionPathShape({ url: `${NOTION_WEB_ORIGIN}/x/12345` })).toBe("/x/{n}");
  });

  it("redacts a segment that only CONTAINS an id, which is how an attachment name leaked", () => {
    expect(
      notionPathShape({
        url: `${NOTION_WEB_ORIGIN}/image/attachment%3A01234567-89ab-cdef-0123-456789abcdef%3Asomebody-holiday-photo.jpg`,
      }),
    ).toBe("/image/{ref}");
  });

  it("stores no part of an attachment's own file name", () => {
    const shape = notionPathShape({
      url: `${NOTION_WEB_ORIGIN}/image/attachment%3A01234567-89ab-cdef-0123-456789abcdef%3Asomebody-holiday-photo.jpg`,
    });
    expect(shape!.includes("holiday")).toBe(false);
  });

  it("redacts a segment carrying a bare id with a suffix around it", () => {
    expect(notionPathShape({ url: `${NOTION_WEB_ORIGIN}/f/0123456789abcdef0123456789abcdef.png` })).toBe("/f/{id}");
  });

  it("reports null for a URL it cannot parse", () => {
    expect(notionPathShape({ url: "not a url" })).toBeNull();
  });
});

describe("reduceNotionCalls", () => {
  it("drops every third-party response before anything is stored", () => {
    const rows = reduceNotionCalls({
      origin: NOTION_WEB_ORIGIN,
      responses: [response({ url: "https://telemetry.example.com/beacon" })],
    });
    expect(rows).toEqual([]);
  });

  it("keeps the response's field NAMES and no value it saw", () => {
    const rows = reduceNotionCalls({
      origin: NOTION_WEB_ORIGIN,
      responses: [response({ body: { spaces: { name: "a real workspace name" } } })],
    });
    expect(rows[0]!.responseFields).toContain("spaces");
  });

  it("stores no value from the body, so a real workspace name cannot reach a kind file", () => {
    const rows = reduceNotionCalls({
      origin: NOTION_WEB_ORIGIN,
      responses: [response({ body: { name: "a real workspace name" } })],
    });
    expect(JSON.stringify(rows).includes("a real workspace name")).toBe(false);
  });

  it("names the operation from the URL", () => {
    const rows = reduceNotionCalls({ origin: NOTION_WEB_ORIGIN, responses: [response()] });
    expect(rows[0]!.operation).toBe("getSpaces");
  });

  it("carries the HTTP method through", () => {
    const rows = reduceNotionCalls({ origin: NOTION_WEB_ORIGIN, responses: [response({ method: "GET" })] });
    expect(rows[0]!.method).toBe("GET");
  });

  it("carries the status through", () => {
    const rows = reduceNotionCalls({ origin: NOTION_WEB_ORIGIN, responses: [response({ statusCode: 403 })] });
    expect(rows[0]!.statusCode).toBe(403);
  });

  it("orders named operations alphabetically, so two runs write identical bytes", () => {
    const rows = reduceNotionCalls({
      origin: NOTION_WEB_ORIGIN,
      responses: [
        response({ url: `${NOTION_WEB_ORIGIN}/api/v3/syncRecordValues` }),
        response({ url: `${NOTION_WEB_ORIGIN}/api/v3/getSpaces` }),
      ],
    });
    expect(rows.map((row) => row.operation)).toEqual(["getSpaces", "syncRecordValues"]);
  });

  it("sorts a call with no operation after every named one, because absent and empty are different facts", () => {
    const rows = reduceNotionCalls({
      origin: NOTION_WEB_ORIGIN,
      responses: [
        response({ url: `${NOTION_WEB_ORIGIN}/acme/settings` }),
        response({ url: `${NOTION_WEB_ORIGIN}/api/v3/getSpaces` }),
      ],
    });
    expect(rows.map((row) => row.operation)).toEqual(["getSpaces", null]);
  });
});
