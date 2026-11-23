/*
 * The production request seam a Linear verification pass reads through. Construction only: calling the seam
 * sends a live request over the paced transport, which a unit test never does.
 */
import { afterEach, describe, expect, it } from "vitest";

import { resetSharedLinearTransports } from "../../../../corpus/linear/transport.js";
import { linearVerifyRequest } from "../../../../live/linear/verifyRequest.js";

afterEach(() => {
  resetSharedLinearTransports();
});

describe("linearVerifyRequest", () => {
  it("builds a seam that takes one argument object", () => {
    expect(linearVerifyRequest({ token: "verify-token-fixture" }).length).toBe(1);
  });

  it("builds a fresh seam on each call, over the one shared transport per token", () => {
    const first = linearVerifyRequest({ token: "verify-token-fixture" });
    const second = linearVerifyRequest({ token: "verify-token-fixture" });
    expect(first === second).toBe(false);
  });
});
