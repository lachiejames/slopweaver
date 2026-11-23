import { describe, expect, it } from "vitest";

import type { VantaTokenProvider } from "../../../../../../atlas/vanta/oauth.js";
import { createTestsOperations } from "../../../../../../atlas/vanta/sdk/operations/tests.js";
import type { VantaTransport } from "../../../../../../atlas/vanta/transport.js";
import { ok, unwrap } from "../../../../../../lib/result.js";

const tokenProvider: VantaTokenProvider = { getToken: async () => ok("tok") };

describe("createTestsOperations", () => {
  it("listTests encodes every supplied filter into the query string", async () => {
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
    const operations = createTestsOperations({ tokenProvider, transport });
    await operations.listTests({ categoryFilter: "IT", statusFilter: "NEEDS_ATTENTION" });
    expect(seenPath).toBe("/v1/tests?statusFilter=NEEDS_ATTENTION&categoryFilter=IT");
  });

  it("listTests omits filters that were not supplied", async () => {
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
    const operations = createTestsOperations({ tokenProvider, transport });
    await operations.listTests({});
    expect(seenPath).toBe("/v1/tests");
  });

  it("deactivateTestEntity posts the reason as JSON", async () => {
    let sentBody = "";
    const transport: VantaTransport = {
      request: async (init) => {
        sentBody = typeof init.body === "string" ? init.body : "";
        return ok({ body: "", headers: {}, status: 200 });
      },
    };
    const operations = createTestsOperations({ tokenProvider, transport });
    const result = await operations.deactivateTestEntity({
      deactivateReason: "known false positive",
      entityId: "en1",
      testId: "t1",
    });
    expect(unwrap(result)).toBeNull();
    expect(JSON.parse(sentBody)).toEqual({ deactivateReason: "known false positive" });
  });
});
