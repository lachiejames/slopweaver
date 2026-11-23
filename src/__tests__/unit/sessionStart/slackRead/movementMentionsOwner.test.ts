/*
 * `readSlackThreads` on a thread-movement row's `mentionsOwner`: a mention run read off `raw.text` scores the row
 * addressed and stopped on the owner, and an untagged channel reply stays ambient.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackThreads } from "../../../../cli/commands/sessionStart/slackRead.js";
import { HUMAN, home, homes, member, message, NOW, OWNER, tagging } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readSlackThreads — mentionsOwner on a thread-movement row", () => {
  it("reads a mention run in raw.text, which is the defect that made this field dead code", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        tagging({ author: HUMAN, says: "any idea on this?", ts: "1787708973.446169" }),
      ],
    });
    const readings = readSlackThreads({ home: dir, nowIso: NOW }).inputs[0]!.readings;
    expect(readings.directness).toBe(3);
    expect(readings.stoppedOnOwner).toBe(5);
  });

  it("still scores an untagged channel reply as ambient", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: HUMAN, text: "any idea on this?", ts: "1787708973.446169" }),
      ],
    });
    const readings = readSlackThreads({ home: dir, nowIso: NOW }).inputs[0]!.readings;
    expect(readings.directness).toBe(0);
    expect(readings.stoppedOnOwner).toBe(0);
  });
});
