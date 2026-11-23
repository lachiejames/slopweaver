import { describe, expect, it } from "vitest";

import { InngestAtlasErrors, inngestAtlasErrorLines } from "../../../../atlas/inngest/errors.js";

describe("InngestAtlasErrors", () => {
  it("quotes the probe's own reason when the dashboard is unreachable", () => {
    const error = InngestAtlasErrors.dashboardUnreachable({ detail: "the relay stopped answering" });
    expect(error.code).toBe("DASHBOARD_UNREACHABLE");
    expect(inngestAtlasErrorLines({ error })).toEqual([
      "could not reach the Inngest dashboard to learn its default environment: the relay stopped answering",
    ]);
  });

  it("carries a signed-out landing as two lines, the message their join", () => {
    const error = InngestAtlasErrors.signedOut();
    expect(error.code).toBe("SIGNED_OUT");
    expect(inngestAtlasErrorLines({ error })).toEqual([
      "the Inngest dashboard sent this browser to its sign-in page, so no page could be walked",
      "sign in to Inngest in your own Chrome and run the walk again",
    ]);
    expect(error.message).toBe(
      "the Inngest dashboard sent this browser to its sign-in page, so no page could be walked; sign in to Inngest in your own Chrome and run the walk again",
    );
  });

  it("names the page that preloads no entry bundle", () => {
    const error = InngestAtlasErrors.entryUndeclared({ url: "https://example.test/" });
    expect(error.code).toBe("ENTRY_UNDECLARED");
    expect(inngestAtlasErrorLines({ error })).toEqual([
      "https://example.test/ preloads no /assets/index-*.js entry, so the route table cannot be read",
      "the dashboard's build layout has changed — re-read the page's modulepreload links before editing this",
    ]);
  });

  it("carries an unreadable route table as two lines", () => {
    const error = InngestAtlasErrors.routesUnreadable();
    expect(error.code).toBe("ROUTES_UNREADABLE");
    expect(inngestAtlasErrorLines({ error })).toEqual([
      "the dashboard's entry bundle declares no route this compiler could read",
      "a route is `X.update({id:…,path:…,getParentRoute:()=>PARENT})` — the application's build has changed shape",
    ]);
  });

  it("names the catalogue that declared no operation", () => {
    const error = InngestAtlasErrors.catalogueEmpty({ url: "https://example.test/llms.txt" });
    expect(error.code).toBe("CATALOGUE_EMPTY");
    expect(inngestAtlasErrorLines({ error })).toEqual([
      "https://example.test/llms.txt was read and declared no operation this compiler could recognise",
      "an operation is a link whose reference path is /v1/<group>/<OperationId> or /v2/<group>/<OperationId>",
    ]);
  });

  it("names a refused document by address and status", () => {
    const error = InngestAtlasErrors.documentRefused({ status: 503, url: "https://example.test/a" });
    expect(error.code).toBe("DOCUMENT_REFUSED");
    expect(inngestAtlasErrorLines({ error })).toEqual(["https://example.test/a answered HTTP 503"]);
  });

  it("names a document that could not be fetched, a non-Error cause as its string", () => {
    const error = InngestAtlasErrors.documentUnfetched({ cause: "boom", url: "https://example.test/a" });
    expect(error.code).toBe("DOCUMENT_UNFETCHED");
    expect(error.message).toBe("https://example.test/a could not be fetched: boom");
  });

  it("names an address that could not be probed", () => {
    const error = InngestAtlasErrors.probeFailed({ cause: new Error("ECONNRESET"), url: "https://example.test/a" });
    expect(error.code).toBe("PROBE_FAILED");
    expect(inngestAtlasErrorLines({ error })).toEqual(["https://example.test/a could not be probed: ECONNRESET"]);
  });
});
