/*
 * The two bronze passes asked to stop between chunks: once `stopWhen` answers true, each reports itself cut and
 * hands back nothing it half-read; while it answers false, each reads the window whole.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { latestPerThread, spokenInThreads } from "../../../../cli/commands/sessionStart/slackScan.js";
import { HUMAN, home, homes, message, OWNER } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

const SINCE = "2026-08-01T00:00:00.000Z";

/** The one bronze file of a home holding a thread the owner spoke in, then a colleague answered. */
const windowFile = (): string =>
  join(
    home({
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: HUMAN, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    }),
    "corpus",
    "bronze",
    "slack",
    "window.jsonl",
  );

describe("spokenInThreads", () => {
  it("reports itself cut when told to stop before the first chunk", () => {
    expect(
      spokenInThreads({ ownerId: OWNER, paths: [windowFile()], sinceIso: SINCE, stopWhen: () => true }),
    ).toStrictEqual({ cut: true });
  });

  it("finds the one thread the owner spoke in when never told to stop", () => {
    const touched = spokenInThreads({ ownerId: OWNER, paths: [windowFile()], sinceIso: SINCE, stopWhen: () => false });

    expect("spoken" in touched).toBe(true);
    expect([...(touched as { spoken: ReadonlyMap<string, unknown> }).spoken.keys()]).toHaveLength(1);
  });
});

describe("latestPerThread", () => {
  it("reports itself cut when told to stop before the first chunk", () => {
    expect(
      latestPerThread({ keys: new Set(), ownerId: OWNER, paths: [windowFile()], stopWhen: () => true }),
    ).toStrictEqual({ cut: true });
  });

  it("reads to the end when no stop is asked for", () => {
    expect(
      latestPerThread({ keys: new Set(), ownerId: OWNER, paths: [windowFile()], stopWhen: undefined }),
    ).toStrictEqual({ facts: new Map(), unparsed: 0 });
  });
});
