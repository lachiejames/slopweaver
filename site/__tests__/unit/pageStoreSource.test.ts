/*
 * The page route's two production seams over fakes: a page's answer kept while its addresses read and re-asked once
 * they would not, an absence never kept, a fresh ask taking only a seconds-old answer, and a fetch bound that never
 * runs more than its limit at once.
 */

import { describe, expect, it } from "vitest";

import type { PresentationRead } from "../../lib/pagePresentation";
import { boundedFetch, FRESH_REUSE_MS, keptPresentation, PRESENTATION_MARGIN_MS } from "../../lib/pageStoreSource";

const PAGE: PresentationRead = { expiresInSeconds: 300, files: new Map(), kind: "page" };

/** A source over a store answering `answer`, on a clock the test moves. */
function source({ answer }: { answer: PresentationRead }) {
  const clock = { nowMs: 0 };
  const asked: string[] = [];
  const presentation = keptPresentation({
    nowMs: () => clock.nowMs,
    read: async ({ slug }) => {
      asked.push(slug);
      return answer;
    },
  });
  return { asked, clock, presentation };
}

describe("keptPresentation", () => {
  it("reuses a page's answer until a margin before its addresses expire", async () => {
    const { asked, clock, presentation } = source({ answer: PAGE });
    await presentation({ fresh: false, slug: "alpha" });
    clock.nowMs = 300_000 - PRESENTATION_MARGIN_MS - 1;
    await presentation({ fresh: false, slug: "alpha" });
    expect(asked).toEqual(["alpha"]);
    clock.nowMs = 300_000 - PRESENTATION_MARGIN_MS;
    await presentation({ fresh: false, slug: "alpha" });
    expect(asked).toEqual(["alpha", "alpha"]);
  });

  it("lets a fresh ask take only an answer a few seconds old", async () => {
    const { asked, clock, presentation } = source({ answer: PAGE });
    await presentation({ fresh: true, slug: "alpha" });
    clock.nowMs = FRESH_REUSE_MS;
    await presentation({ fresh: true, slug: "alpha" });
    expect(asked).toEqual(["alpha"]);
    clock.nowMs = FRESH_REUSE_MS + 1;
    await presentation({ fresh: true, slug: "alpha" });
    expect(asked).toEqual(["alpha", "alpha"]);
  });

  it("never reuses an answer its clock says was asked later than now", async () => {
    const { asked, clock, presentation } = source({ answer: PAGE });
    clock.nowMs = 10_000;
    await presentation({ fresh: true, slug: "alpha" });
    clock.nowMs = 4_000;
    await presentation({ fresh: true, slug: "alpha" });
    await presentation({ fresh: false, slug: "alpha" });
    expect(asked).toEqual(["alpha", "alpha"]);
  });

  it("never keeps an answer a slow read left already past its window", async () => {
    const clock = { nowMs: 0 };
    const asked: string[] = [];
    const presentation = keptPresentation({
      nowMs: () => clock.nowMs,
      read: async ({ slug }) => {
        asked.push(slug);
        clock.nowMs += 300_000 - PRESENTATION_MARGIN_MS;
        return PAGE;
      },
    });
    expect(await presentation({ fresh: false, slug: "alpha" })).toEqual(PAGE);
    await presentation({ fresh: false, slug: "alpha" });
    expect(asked).toEqual(["alpha", "alpha"]);
  });

  it("never keeps an absence or a store that could not say", async () => {
    const missing = source({ answer: { kind: "not-found" } });
    await missing.presentation({ fresh: false, slug: "alpha" });
    await missing.presentation({ fresh: false, slug: "alpha" });
    expect(missing.asked).toEqual(["alpha", "alpha"]);
    const stopped = source({ answer: { kind: "store-unreadable", why: "down" } });
    await stopped.presentation({ fresh: false, slug: "alpha" });
    await stopped.presentation({ fresh: false, slug: "alpha" });
    expect(stopped.asked).toEqual(["alpha", "alpha"]);
  });
});

describe("boundedFetch", () => {
  it("never runs more than its limit at once, and runs every fetch", async () => {
    let running = 0;
    let most = 0;
    const fetchBody = boundedFetch({
      fetchBody: async ({ url }) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resume) => setImmediate(resume));
        running -= 1;
        return new TextEncoder().encode(url);
      },
      max: 3,
    });
    const urls = Array.from({ length: 10 }, (_, index) => `http://store.test/${String(index)}`);
    const bodies = await Promise.all(urls.map((url) => fetchBody({ url })));
    expect(most).toBe(3);
    expect(bodies.map((body) => new TextDecoder().decode(body))).toEqual(urls);
  });
});
