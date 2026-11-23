/*
 * `readSlackThreads` under `session-start --deadline`: the scan is synchronous, so it asks between chunks and, once
 * told to stop, reports nothing it half-read — a cut leg, never a quieter one.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackThreads, SLACK_CUT_SHORT_LINE } from "../../../../cli/commands/sessionStart/slackRead.js";
import { HUMAN, home, homes, member, message, NOW, OWNER } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A home holding one thread the owner spoke in whose last word is a colleague's — one row when read whole. */
const movedThread = (): string =>
  home({
    members: [member({ id: HUMAN, name: "A Colleague" })],
    records: [
      message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
      message({ author: HUMAN, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
    ],
  });

describe("readSlackThreads under a deadline", () => {
  it("stops at the first chunk once the deadline has passed, and reports the leg cut with nothing in it", () => {
    const read = readSlackThreads({ home: movedThread(), nowIso: NOW, stopWhen: () => true });

    expect(read.cut).toBe(true);
    expect(read.status).toBe("unavailable");
    expect(read.inputs).toStrictEqual([]);
    expect(read.threadsSpokenIn).toBe(0);
    expect(read.couldNotSee).toStrictEqual([SLACK_CUT_SHORT_LINE]);
  });

  it("reads whole, and is not cut, while the deadline has not passed", () => {
    const read = readSlackThreads({ home: movedThread(), nowIso: NOW, stopWhen: () => false });

    expect(read.cut).toBe(undefined);
    expect(read.threadsSpokenIn).toBe(1);
    expect(read.inputs).toHaveLength(1);
  });
});
