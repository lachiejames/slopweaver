/**
 * {@link isUnrenderedScreenshot} — the read-after-screenshot grade.
 *
 * The fixtures are the MEASURED densities rather than invented ones. 0.00422 bytes/pixel is the smallest
 * CrowdStrike console capture this install holds and 0.00442 the largest of the 97 that are the same
 * loading-spinner frame; 0.00376 is the one uniformly blank Xero page; 0.00783 is the next density above
 * any of them anywhere in the corpus, and 0.024 is the corpus median. So the two cases that matter — the
 * top of the spinner cluster and the bottom of the real pages — are both pinned here, and a threshold moved
 * into that gap in either direction fails.
 */
import { describe, expect, it } from "vitest";

import {
  isUnrenderedScreenshot,
  RENDER_RETRY_SETTLE_MS,
  screenshotArtifact,
  UNRENDERED_BYTES_PER_PIXEL,
  visitPhotographed,
} from "../../../../atlas/kit/browserWalk.js";
import {
  type BrowserTransportError,
  BrowserTransportErrors,
  type PageCapture,
} from "../../../../browser/pageTransport.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { pngOfSize, renderedPng, unrenderedPng } from "../../../pngFixture.js";
import {
  inOrderThenRepeat,
  capture as sharedCapture,
  fakeTransport as sharedFakeTransport,
} from "../../../walkTransportFake.js";

/** Every capture in the measured corpus came back at this size. */
const WIDTH = 3024;
const HEIGHT = 1308;

/** A PNG at one measured bytes-per-pixel density. */
function atDensity({ bytesPerPixel }: { bytesPerPixel: number }): Uint8Array {
  return pngOfSize({ byteLength: Math.round(bytesPerPixel * WIDTH * HEIGHT), height: HEIGHT, width: WIDTH });
}

describe("isUnrenderedScreenshot", () => {
  it("calls the spinner frame unrendered, at both ends of the measured cluster", () => {
    expect(isUnrenderedScreenshot({ bytes: atDensity({ bytesPerPixel: 0.00422 }) })).toBe(true);
    expect(isUnrenderedScreenshot({ bytes: atDensity({ bytesPerPixel: 0.00442 }) })).toBe(true);
    expect(isUnrenderedScreenshot({ bytes: unrenderedPng() })).toBe(true);
  });

  it("calls the uniformly blank page unrendered", () => {
    expect(isUnrenderedScreenshot({ bytes: atDensity({ bytesPerPixel: 0.00376 }) })).toBe(true);
  });

  it("leaves the sparsest page that ACTUALLY rendered alone", () => {
    expect(isUnrenderedScreenshot({ bytes: atDensity({ bytesPerPixel: 0.00783 }) })).toBe(false);
  });

  it("leaves an ordinary console page alone", () => {
    expect(isUnrenderedScreenshot({ bytes: atDensity({ bytesPerPixel: 0.024 }) })).toBe(false);
    expect(isUnrenderedScreenshot({ bytes: renderedPng() })).toBe(false);
  });

  it("puts the threshold inside the measured gap", () => {
    expect(UNRENDERED_BYTES_PER_PIXEL).toBeGreaterThan(0.00442);
    expect(UNRENDERED_BYTES_PER_PIXEL).toBeLessThan(0.00783);
  });

  it("judges by DENSITY, not by file size — the same blank page at half the window is still blank", () => {
    const small = pngOfSize({ byteLength: 4_200, height: HEIGHT / 2, width: WIDTH / 2 });
    expect(small.byteLength).toBeLessThan(unrenderedPng().byteLength);
    expect(isUnrenderedScreenshot({ bytes: small })).toBe(true);
  });

  it("treats a buffer too short to carry a header, and a zero-area image, as unrendered", () => {
    expect(isUnrenderedScreenshot({ bytes: new Uint8Array([1, 2, 3]) })).toBe(true);
    expect(isUnrenderedScreenshot({ bytes: pngOfSize({ byteLength: 900, height: 0, width: 0 }) })).toBe(true);
  });
});

describe("screenshotArtifact", () => {
  it("addresses a capture by the digest of its own bytes, under the directory it was given", () => {
    const ref = screenshotArtifact({ bytes: new Uint8Array([1, 2, 3]), directory: "artifacts/console" });
    expect(ref.sha256).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    expect(ref.relativePath).toBe(
      "artifacts/console/039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81.png",
    );
    expect(ref.byteLength).toBe(3);
    expect(ref.kind).toBe("page-png");
  });
});

/** A capture the fake answers with, differing only in what matters to the grade. */
function capture({ url, shot }: { url: string; shot: Uint8Array | null }): PageCapture {
  return sharedCapture({ over: { observedAt: "2026-09-06T00:00:00.000Z", screenshotPng: shot }, url });
}

/**
 * A transport that answers each visit from a queue in order and records the settle it was asked for.
 *
 * A plain function passed in rather than a mock: the whole question here is what the SECOND visit was asked
 * for and which capture came back, so a fake that answers positionally is the seam.
 */
function queuedTransport({
  answers,
}: {
  answers: readonly Result<PageCapture, BrowserTransportError>[];
}): ReturnType<typeof sharedFakeTransport> {
  return sharedFakeTransport({
    answer: inOrderThenRepeat({
      visits: answers.map((answer) => (answer.isErr() ? { failWith: answer.error } : { capture: answer.value })),
    }),
  });
}

const URL_UNDER_TEST = "https://console.example.invalid/dashboard";

describe("visitPhotographed", () => {
  it("keeps the first capture and looks only once when the page rendered", async () => {
    const { asked, transport } = queuedTransport({
      answers: [ok(capture({ shot: renderedPng({ seed: 1 }), url: URL_UNDER_TEST }))],
    });
    const visited = await visitPhotographed({ settleMs: 2_500, transport, url: URL_UNDER_TEST });
    expect(visited.isOk()).toBe(true);
    expect(unwrap(visited).screenshotPng).toEqual(renderedPng({ seed: 1 }));
    expect(asked.map((visit) => visit.settleMs)).toEqual([2_500]);
  });

  it("looks again after a longer settle when the first shot was a loading frame, and keeps what rendered", async () => {
    const { asked, transport } = queuedTransport({
      answers: [
        ok(capture({ shot: unrenderedPng(), url: URL_UNDER_TEST })),
        ok(capture({ shot: renderedPng({ seed: 2 }), url: URL_UNDER_TEST })),
      ],
    });
    const visited = await visitPhotographed({ settleMs: 2_500, transport, url: URL_UNDER_TEST });
    expect(unwrap(visited).screenshotPng).toEqual(renderedPng({ seed: 2 }));
    expect(asked.map((visit) => visit.settleMs)).toEqual([2_500, RENDER_RETRY_SETTLE_MS]);
  });

  it("honours a caller's own retry settle", async () => {
    const { asked, transport } = queuedTransport({
      answers: [ok(capture({ shot: unrenderedPng(), url: URL_UNDER_TEST }))],
    });
    await visitPhotographed({ retrySettleMs: 30_000, settleMs: 1_000, transport, url: URL_UNDER_TEST });
    expect(asked.map((visit) => visit.settleMs)).toEqual([1_000, 30_000]);
  });

  it("returns the second loading frame when even the longer settle did not finish it", async () => {
    const { asked, transport } = queuedTransport({
      answers: [ok(capture({ shot: unrenderedPng(), url: URL_UNDER_TEST }))],
    });
    const visited = await visitPhotographed({ settleMs: 2_500, transport, url: URL_UNDER_TEST });
    expect(isUnrenderedScreenshot({ bytes: unwrap(visited).screenshotPng! })).toBe(true);
    expect(asked.length).toBe(2);
  });

  it("does not look again when the browser returned no screenshot at all", async () => {
    const { asked, transport } = queuedTransport({ answers: [ok(capture({ shot: null, url: URL_UNDER_TEST }))] });
    const visited = await visitPhotographed({ settleMs: 2_500, transport, url: URL_UNDER_TEST });
    expect(unwrap(visited).screenshotPng).toBe(null);
    expect(asked.map((visit) => visit.settleMs)).toEqual([2_500]);
  });

  it("does not look again when the first visit failed — there is no capture to grade", async () => {
    const { asked, transport } = queuedTransport({
      answers: [
        err(
          BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "timed out",
            url: URL_UNDER_TEST,
          }),
        ),
      ],
    });
    const visited = await visitPhotographed({ settleMs: 2_500, transport, url: URL_UNDER_TEST });
    expect(visited.isErr()).toBe(true);
    expect(asked.map((visit) => visit.settleMs)).toEqual([2_500]);
  });

  it("keeps the first capture when the retry trips over one bad address", async () => {
    const spinner = unrenderedPng();
    const { transport } = queuedTransport({
      answers: [
        ok(capture({ shot: spinner, url: URL_UNDER_TEST })),
        err(
          BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "timed out",
            url: URL_UNDER_TEST,
          }),
        ),
      ],
    });
    const visited = await visitPhotographed({ settleMs: 2_500, transport, url: URL_UNDER_TEST });
    expect(visited.isOk()).toBe(true);
    expect(unwrap(visited).screenshotPng).toEqual(spinner);
  });

  it("propagates a retry that lost the session, because every page after it is doomed too", async () => {
    const { transport } = queuedTransport({
      answers: [
        ok(capture({ shot: unrenderedPng(), url: URL_UNDER_TEST })),
        err(BrowserTransportErrors.sessionLost({ reason: "the tab was closed" })),
      ],
    });
    const visited = await visitPhotographed({ settleMs: 2_500, transport, url: URL_UNDER_TEST });
    expect(visited.isErr()).toBe(true);
    expect(unwrapErr(visited).code).toBe("SESSION_LOST");
  });

  it("keeps the first capture when the retry came back with no screenshot", async () => {
    const spinner = unrenderedPng();
    const { transport } = queuedTransport({
      answers: [ok(capture({ shot: spinner, url: URL_UNDER_TEST })), ok(capture({ shot: null, url: URL_UNDER_TEST }))],
    });
    const visited = await visitPhotographed({ settleMs: 2_500, transport, url: URL_UNDER_TEST });
    expect(unwrap(visited).screenshotPng).toEqual(spinner);
  });
});
