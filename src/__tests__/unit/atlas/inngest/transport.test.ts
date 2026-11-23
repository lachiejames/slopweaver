/**
 * The two real transports' failure lines, reached offline: an address that does not parse fails inside
 * `fetch` before any socket is opened, so no network is touched.
 */
import { describe, expect, it } from "vitest";

import { httpDocumentTransport, httpProbeTransport } from "../../../../atlas/inngest/transport.js";
import { unwrapErr } from "../../../../lib/result.js";

describe("the Inngest HTTP transports' failures", () => {
  it("names a document that could not be fetched, with the platform's own reason", async () => {
    expect(unwrapErr(await httpDocumentTransport({ url: "not-a-url" }))).toEqual([
      "not-a-url could not be fetched: Failed to parse URL from not-a-url",
    ]);
  });

  it("names an address that could not be probed, with the platform's own reason", async () => {
    expect(unwrapErr(await httpProbeTransport({ url: "not-a-url" }))).toEqual([
      "not-a-url could not be probed: Failed to parse URL from not-a-url",
    ]);
  });
});
