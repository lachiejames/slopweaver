// deleted-with-code: digestUnprefixed
import { describe, expect, it } from "vitest";

import { PagePublishErrors } from "../../../pages/publishErrors.js";

describe("PagePublishErrors", () => {
  it("names the instant the store could never read back, and that nothing was written", () => {
    const error = PagePublishErrors.instantInvalid({ nowIso: "yesterday" });
    expect([error.code, error.message]).toEqual([
      "PAGE_INSTANT_INVALID",
      '"yesterday" is not an ISO-8601 datetime with an offset, and a freeze stamped with it is one the store can ' +
        "never read back; nothing was written",
    ]);
  });

  it("names the page a failed or unconfirmed store write left without an address, and the re-run that completes it", () => {
    const error = PagePublishErrors.storeUnconfirmed({ slug: "acme-review" });
    expect([error.code, error.message, error.slug]).toEqual([
      "PAGE_STORE_UNCONFIRMED",
      "writing acme-review into the store failed or could not be confirmed, so the publish did not complete and the " +
        "page has no address yet. Re-run the same publish to complete it.",
      "acme-review",
    ]);
  });
});
