/**
 * The private-terms store's refusals: each names the file, lock or proposal it is about, and the reason it was given,
 * and nothing else.
 */
import { describe, expect, it } from "vitest";

import { PrivateTermsStoreErrors } from "../../../hygiene/privateTermsStoreErrors.js";

describe("PrivateTermsStoreErrors", () => {
  it("names the failed step, its path and the cause's message", () => {
    const error = PrivateTermsStoreErrors.ioFailed({
      cause: new Error("EACCES"),
      path: "/home/acme/hygiene/private-terms.tsv",
      what: "reading the private terms file",
    });
    expect(error.code).toBe("STORE_IO_FAILED");
    expect(error.message).toBe("reading the private terms file /home/acme/hygiene/private-terms.tsv failed: EACCES");
  });

  it("says a held lock is someone else's and to run again once that edit has finished", () => {
    const error = PrivateTermsStoreErrors.lockHeld({ path: "/home/acme/x.lock", why: "pid 7 holds it and is running" });
    expect(error.code).toBe("LOCK_HELD");
    expect(error.message).toBe(
      "the lock /home/acme/x.lock is not ours to take: pid 7 holds it and is running; run it again once that edit has finished",
    );
  });

  it("says a stale proposal wrote nothing and should be proposed again", () => {
    const error = PrivateTermsStoreErrors.proposalStale({ proposalId: "pp-000000000001", why: "the file changed" });
    expect(error.code).toBe("PROPOSAL_STALE");
    expect(error.message).toBe(
      "proposal pp-000000000001 cannot land: the file changed; nothing was written, propose the edit again",
    );
  });

  it("says there is no proposal to confirm, and why", () => {
    const error = PrivateTermsStoreErrors.proposalUnusable({ why: "none is kept under that id" });
    expect(error.code).toBe("PROPOSAL_UNUSABLE");
    expect(error.message).toBe("no proposal to confirm: none is kept under that id");
  });
});
