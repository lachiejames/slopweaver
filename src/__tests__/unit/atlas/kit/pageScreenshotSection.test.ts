/**
 * The screenshots section: each picture prints what actually became of it, and a picture that could not be
 * verified opens the section rather than hiding behind it. The whole page's composition is `pageHtml.test.ts`'s
 * subject.
 */
import { describe, expect, it } from "vitest";

import type { AtlasPageModel, AtlasPageScreenshot } from "../../../../atlas/kit/pageModel.js";
import { screenshotsSection } from "../../../../atlas/kit/pageScreenshotSection.js";

const SHOT: AtlasPageScreenshot = {
  byteLength: 10,
  deepLink: null,
  mediaType: "image/png",
  providerId: "policies-collection",
  relativePath: "artifacts/pages/aa.png",
  sha256: "a".repeat(64),
  surface: "browser",
};

/** One model holding the one screenshot, everything else defaulted. */
function model(): AtlasPageModel {
  return {
    closedGapCount: 0,
    defects: [],
    detailTables: [],
    entityCount: 0,
    exclusions: [],
    freshnessWindow: null,
    generationDisagreements: [],
    generationUpdatedAt: "2026-09-01T00:00:00.000Z",
    kinds: [],
    liveReadCommand: null,
    openGapCount: 0,
    openGaps: [],
    platform: "example",
    question: "what does example hold",
    reachability: {
      corroboratedCount: 0,
      denominator: "declared",
      kinds: [],
      neverHit: [],
      neverHitCount: 0,
      undeclaredFindCount: 0,
      undeterminedKinds: [],
      unknownBecause: null,
    },
    resyncCommand: "slopweaver atlas example sync",
    schemaVersion: 3,
    screenshots: [SHOT],
    surfaces: [],
    visibilityScope: "whatever this token opens",
    writePolicy: "refuse-every-write",
  };
}

describe("screenshotsSection", () => {
  it("reads a shot the shell never read as held back by the budget, and stays shut", () => {
    const html = screenshotsSection({ embedded: [], model: model() });
    expect(html).toContain("<details><summary>Screenshots held (1)</summary>");
    expect(html).toContain("0 of 1 screenshot(s) embedded in this page.");
    expect(html).toContain('<div class="noshot"><code>artifacts/pages/aa.png</code></div>');
    expect(html).toContain("held on disk — it did not fit this page&#39;s screenshot budget");
  });

  it("shows a verified shot as a picture with its caption", () => {
    const html = screenshotsSection({
      embedded: [{ dataUri: "data:image/png;base64,AAAA", sha256: SHOT.sha256, status: "embedded" }],
      model: model(),
    });
    expect(html).toContain("1 of 1 screenshot(s) embedded in this page.");
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="policies-collection" loading="lazy" />');
    expect(html).toContain("<code>policies-collection</code> · browser · 10 bytes · <code>aaaaaaaaaaaa</code>");
  });

  it.each([
    { status: "integrity-failed", words: "GONE OR CHANGED — the bytes on disk are not the ones this atlas recorded" },
    { status: "path-refused", words: "REFUSED — the stored path points outside this atlas&#39;s own directory" },
    { status: "unreadable", words: "MISSING — the file this atlas recorded could not be read" },
  ] as const)("opens the section and marks the shot broken on $status", ({ status, words }) => {
    const html = screenshotsSection({
      embedded: [{ dataUri: null, sha256: SHOT.sha256, status }],
      model: model(),
    });
    expect(html).toContain("<details open><summary>Screenshots held (1, 1 unverifiable)</summary>");
    expect(html).toContain("<strong>1 of them could not be verified against the digest this atlas recorded.</strong>");
    expect(html).toContain('<div class="noshot broken"><code>artifacts/pages/aa.png</code></div>');
    expect(html).toContain(words);
    expect(html).not.toContain("<img");
  });
});
