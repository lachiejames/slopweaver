/**
 * What a `talk unread` report says about the gone calls it went past on a quarantine: the whole count always, the first
 * few named, and nothing at all when it went past none.
 */
import { describe, expect, it } from "vitest";

import {
  QUARANTINE_NAMED_MAX,
  quarantineJson,
  quarantineLines,
} from "../../../../../cli/commands/talk/unreadQuarantine.js";
import type { CallQuarantineRow } from "../../../../../talk/callQuarantineLedger.js";
import type { UnreadRead } from "../../../../../talk/unreadWords.js";

const AT = "2026-10-26T08:56:10.505Z";
const rowFor = ({ index }: { index: number }): CallQuarantineRow => ({
  atIso: AT,
  callId: `00000000-0000-4000-8000-00000000000${String(index)}`,
  reason: "gone",
  session: null,
});
const readOf = ({ count }: { count: number }): UnreadRead => ({
  bootstrapFloorIso: undefined,
  cursor: undefined,
  quarantined: Array.from({ length: count }, (_unused, index) => rowFor({ index })),
  tails: [],
});

describe("quarantineLines", () => {
  it("says nothing when the read went past no quarantined call", () => {
    expect(quarantineLines({ read: readOf({ count: 0 }) })).toEqual([]);
  });

  it("names one call with its acceptance instant", () => {
    expect(quarantineLines({ read: readOf({ count: 1 }) })).toEqual([
      `talk unread: went past 1 gone call(s) whose loss is quarantined on the record, not read: ` +
        `${rowFor({ index: 0 }).callId} (accepted ${AT}) — talk/call-quarantine.jsonl says why`,
    ]);
  });

  it("names the first five and counts the rest", () => {
    const [line] = quarantineLines({ read: readOf({ count: QUARANTINE_NAMED_MAX + 2 }) });

    expect(line).toContain("went past 7 gone call(s)");
    expect(line).toContain(`${rowFor({ index: 4 }).callId} (accepted ${AT}), and 2 more`);
  });
});

describe("quarantineJson", () => {
  it("carries the whole count and at most five named rows", () => {
    const json = quarantineJson({ read: readOf({ count: QUARANTINE_NAMED_MAX + 1 }) });

    expect(json.count).toBe(6);
    expect(json.named.map((row) => row.callId)).toEqual([0, 1, 2, 3, 4].map((index) => rowFor({ index }).callId));
  });
});
