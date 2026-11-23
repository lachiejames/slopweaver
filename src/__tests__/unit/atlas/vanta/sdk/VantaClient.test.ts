import { describe, expect, it } from "vitest";

import type { VantaTokenProvider } from "../../../../../atlas/vanta/oauth.js";
import { createVantaClient } from "../../../../../atlas/vanta/sdk/VantaClient.js";
import type { VantaTransport } from "../../../../../atlas/vanta/transport.js";
import { ok, unwrap } from "../../../../../lib/result.js";

const tokenProvider: VantaTokenProvider = { getToken: async () => ok("tok") };

describe("createVantaClient", () => {
  it("composes every tag's operations onto one flat client", async () => {
    const detail = {
      creationDate: null,
      customFields: [],
      description: "d",
      domains: [],
      externalId: null,
      id: "c1",
      modificationDate: null,
      name: "n",
      note: null,
      numDocumentsPassing: 0,
      numDocumentsTotal: 0,
      numTestsPassing: 0,
      numTestsTotal: 0,
      owner: null,
      role: null,
      source: "Custom",
      status: "OK",
    };
    const transport: VantaTransport = {
      request: async () => ok({ body: JSON.stringify(detail), headers: {}, status: 200 }),
    };
    const client = createVantaClient({ tokenProvider, transport });

    expect(client.getControl).toBeDefined();
    expect(client.getDocument).toBeDefined();
    expect(client.listTests).toBeDefined();
    expect(client.createVendor).toBeDefined();

    const result = await client.getControl({ controlId: "c1" });
    expect(unwrap(result).id).toBe("c1");
  });
});
