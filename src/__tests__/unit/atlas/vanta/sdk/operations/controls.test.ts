import { describe, expect, it } from "vitest";

import type { VantaTokenProvider } from "../../../../../../atlas/vanta/oauth.js";
import { createControlsOperations } from "../../../../../../atlas/vanta/sdk/operations/controls.js";
import type { VantaTransport } from "../../../../../../atlas/vanta/transport.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";

const tokenProvider: VantaTokenProvider = { getToken: async () => ok("tok") };

const controlDto = {
  creationDate: null,
  customFields: [],
  description: "d",
  domains: [],
  externalId: null,
  id: "c1",
  modificationDate: null,
  name: "n",
  owner: null,
  role: null,
  source: "Custom" as const,
};
const controlDetailDto = {
  ...controlDto,
  note: null,
  numDocumentsPassing: 0,
  numDocumentsTotal: 0,
  numTestsPassing: 0,
  numTestsTotal: 0,
  status: "OK",
};

describe("createControlsOperations", () => {
  it("getControl calls GET on the control-detail endpoint", async () => {
    let seenPath = "";
    let seenMethod = "";
    const transport: VantaTransport = {
      request: async (init) => {
        seenPath = init.path;
        seenMethod = init.method;
        return ok({ body: JSON.stringify(controlDetailDto), headers: {}, status: 200 });
      },
    };
    const operations = createControlsOperations({ tokenProvider, transport });
    const result = await operations.getControl({ controlId: "c1" });
    expect(unwrap(result).id).toBe("c1");
    expect(seenPath).toBe("/v1/controls/c1");
    expect(seenMethod).toBe("GET");
  });

  it("createControl POSTs the request body as JSON", async () => {
    let sentBody = "";
    const transport: VantaTransport = {
      request: async (init) => {
        sentBody = typeof init.body === "string" ? init.body : "";
        return ok({ body: JSON.stringify(controlDto), headers: {}, status: 200 });
      },
    };
    const operations = createControlsOperations({ tokenProvider, transport });
    const result = await operations.createControl({
      description: "d",
      domain: "COMPLIANCE",
      effectiveDate: "2026-01-01",
      externalId: "EXT-1",
      name: "n",
    });
    expect(unwrap(result).id).toBe("c1");
    expect(JSON.parse(sentBody).externalId).toBe("EXT-1");
  });

  it("listLibraryControls encodes pagination params into the query string", async () => {
    let seenPath = "";
    const transport: VantaTransport = {
      request: async (init) => {
        seenPath = init.path;
        return ok({
          body: JSON.stringify({
            results: {
              data: [],
              pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
            },
          }),
          headers: {},
          status: 200,
        });
      },
    };
    const operations = createControlsOperations({ tokenProvider, transport });
    // oxlint-disable-next-line no-deprecated -- exercising the deprecated-but-still-live endpoint on purpose
    await operations.listLibraryControls({ pageCursor: "cur1", pageSize: 20 });
    expect(seenPath).toBe("/v1/controls/controls-library?pageSize=20&pageCursor=cur1");
  });

  it("deleteControl issues a DELETE with no body expected back", async () => {
    const transport: VantaTransport = { request: async () => ok({ body: "", headers: {}, status: 200 }) };
    const operations = createControlsOperations({ tokenProvider, transport });
    expect(unwrap(await operations.deleteControl({ controlId: "c1" }))).toBeNull();
  });

  it("propagates a request failure as a typed VantaSdkError", async () => {
    const transport: VantaTransport = { request: async () => err(["boom"]) };
    const operations = createControlsOperations({ tokenProvider, transport });
    const result = await operations.getControl({ controlId: "c1" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("VANTA_SDK_API_ERROR");
  });
});
