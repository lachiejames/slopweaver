/**
 * Which released rows a `slack delete` of one message journals as deleted: every row released at that exact coordinate,
 * once, minus those already journalled there.
 */
import { describe, expect, it } from "vitest";

import { draftDeletionIds } from "../../../../outbound/slack/draftDeletion.js";
import type { SlackDraftEvent } from "../../../../outbound/slack/draftRegister.js";

const CHANNEL = "C0SYN000001";
const TS = "1791764888.080129";
const AT = "2026-10-12T00:46:00.000Z";

/** A release of `id` at `channel`/`ts`. */
function released({ id, channel = CHANNEL, ts = TS }: { id: string; channel?: string; ts?: string }): SlackDraftEvent {
  return { channel, id, kind: "released", ts, tsIso: AT };
}

/** A journalled deletion of `id` at `channel`/`ts`. */
function deleted({ id, channel = CHANNEL, ts = TS }: { id: string; channel?: string; ts?: string }): SlackDraftEvent {
  return { channel, id, kind: "deleted", ts, tsIso: AT };
}

describe("draftDeletionIds", () => {
  it("names every row released at the coordinate once, in first-release order", () => {
    const events = [
      released({ id: "sd-dd932464" }),
      released({ id: "sd-elsewhere", ts: "1791764999.000100" }),
      released({ id: "sd-second" }),
      released({ id: "sd-dd932464" }),
    ];
    expect(draftDeletionIds({ channel: CHANNEL, events, ts: TS })).toStrictEqual(["sd-dd932464", "sd-second"]);
  });

  it("skips a row already journalled at that coordinate, so a retry adds only what is missing", () => {
    const events = [released({ id: "sd-dd932464" }), released({ id: "sd-second" }), deleted({ id: "sd-dd932464" })];
    expect(draftDeletionIds({ channel: CHANNEL, events, ts: TS })).toStrictEqual(["sd-second"]);
  });

  it("still names a row whose only deletion is at another ts or channel", () => {
    const events = [
      released({ id: "sd-dd932464" }),
      deleted({ id: "sd-dd932464", ts: "1791764999.000100" }),
      deleted({ channel: "C0OTHER", id: "sd-dd932464" }),
    ];
    expect(draftDeletionIds({ channel: CHANNEL, events, ts: TS })).toStrictEqual(["sd-dd932464"]);
  });

  it("names nothing when no row released at the coordinate", () => {
    expect(draftDeletionIds({ channel: CHANNEL, events: [], ts: TS })).toStrictEqual([]);
    expect(
      draftDeletionIds({ channel: CHANNEL, events: [released({ id: "sd-other", channel: "C0OTHER" })], ts: TS }),
    ).toStrictEqual([]);
  });
});
