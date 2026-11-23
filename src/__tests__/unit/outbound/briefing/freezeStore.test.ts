/**
 * The freeze's naming half: the key a page's frozen bytes are kept under, and the sentence a refusal to open a new
 * history carries. The bytes themselves are the store's (`../../store/publishedPages/freezeHistory.test.ts` holds the
 * neighbour search; the integration lane holds the write).
 *
 * The folder freeze went when the store became a page's only copy: nothing writes or counts a freeze on disk.
 * deleted-with-code: freezePage, frozenVersionCount
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { FreezeStoreErrors } from "../../../../outbound/briefing/errors.js";
import { artifactKey, driftDetail } from "../../../../outbound/briefing/freezeStore.js";

describe("artifactKey", () => {
  it("takes the last path segment of a published artifact URL", () => {
    expect(unwrap(artifactKey({ artifact: "https://claude.ai/public/artifacts/0dc1a3db-11-22" }))).toBe(
      "0dc1a3db-11-22",
    );
  });

  it("drops a query and a fragment before reading the id", () => {
    expect(unwrap(artifactKey({ artifact: "https://claude.ai/public/artifacts/abe08a29?v=2#top" }))).toBe("abe08a29");
  });

  it("takes a bare id unchanged", () => {
    expect(unwrap(artifactKey({ artifact: "fleet-briefing" }))).toBe("fleet-briefing");
  });

  it("keys a local page on its slug, never on the index.html every local page ends in", () => {
    expect(unwrap(artifactKey({ artifact: "file:///home/acme/.slopweaver/pages/acme-review/index.html" }))).toBe(
      "acme-review",
    );
  });

  it("cannot yield a key carrying a separator", () => {
    expect(unwrap(artifactKey({ artifact: "../../etc/passwd" }))).toBe("passwd");
  });

  it("refuses a segment that is not a plain name rather than sanitising it into one", () => {
    const result = artifactKey({ artifact: "../.." });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual(FreezeStoreErrors.artifactUnnameable({ artifact: "../.." }));
    expect(result._unsafeUnwrapErr().message).toBe(
      '"../.." does not name an artifact this store can file: expected an artifact URL or an id of letters, ' +
        "digits, dot, dash or underscore.",
    );
  });
});

describe("driftDetail", () => {
  // The drift measured: a `sed` over each tick's publish script rewrote the fleet briefing's own
  // artifact id, `259` inside `…642592` becoming `260`.
  const canonical = "af415a0a-f9cd-43b1-aac2-187e71642592";
  const drifted = "af415a0a-f9cd-43b1-aac2-187e71642602";

  it("names a near neighbour and how many versions it holds, which is what ends the drift", () => {
    const detail = driftDetail({ key: drifted, neighbours: [{ distance: 2, key: canonical, versions: 568 }] });

    expect(detail).toBe(
      `resolved to the key "${drifted}", which the store holds no version of, while these held pages are a hair ` +
        `away from it: ${canonical} (568 versions, 2 character(s) different)`,
    );
  });

  it("says no held key is near rather than naming the nearest of a bad lot", () => {
    expect(driftDetail({ key: "brand-new-page", neighbours: [] })).toBe(
      'resolved to the key "brand-new-page", which the store holds no version of, and no held page\'s key is ' +
        "within two characters of it",
    );
  });

  it("rides the new-history refusal, which names the flag that opens one", () => {
    const refusal = FreezeStoreErrors.newHistoryRefused({
      detail: driftDetail({ key: "brand-new-page", neighbours: [] }),
      key: "brand-new-page",
    });

    expect(refusal.code).toBe("NEW_HISTORY_REFUSED");
    expect(refusal.message).toContain('resolved to the key "brand-new-page"');
    expect(refusal.message).toContain("slopweaver briefing freeze --artifact <url|id> --page <html> --new");
  });
});
