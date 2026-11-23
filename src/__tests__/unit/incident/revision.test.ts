/*
 * The revision fold the incident note and the postmortem card share: which number comes next, which open revision it
 * supersedes, and when more than one open revision makes it ambiguous.
 */
import { describe, expect, it } from "vitest";

import type { HandRow } from "../../../hand/row.js";
import { buildHandStep } from "../../../hand/step.js";
import { channelRevisionPattern, nextChannelRevision } from "../../../incident/revision.js";
import { unwrap } from "../../../lib/result.js";

const CHANNEL_ID = "C0SYN000004";

/** A posted hand row under `id`, optionally carrying the settling of the step it re-cuts. */
function posted({ id, settles }: { id: string; settles?: string }): HandRow {
  const step = unwrap(
    buildHandStep({
      draft: {
        id,
        postedBy: "supervisor",
        postedIso: "2026-09-24T01:10:00.000Z",
        unblocks: "the incident card",
        what: "Read the briefing",
        witness: "slopweaver hand show",
      },
    }),
  );
  if (settles === undefined) {
    return { kind: "posted", step };
  }
  return {
    kind: "posted",
    settles: {
      bySession: "supervisor",
      did: "re-cut",
      id: settles,
      kind: "settled",
      settledIso: "2026-09-24T02:00:00.000Z",
    },
    step,
  };
}

/** A settled hand row for `id`. */
function settled({ id }: { id: string }): HandRow {
  return { bySession: "supervisor", did: "sent it", id, kind: "settled", settledIso: "2026-09-24T03:00:00.000Z" };
}

describe("channelRevisionPattern", () => {
  it("captures the revision number under the kind and the lowered channel id, and nothing under another kind", () => {
    const pattern = channelRevisionPattern({ channelId: CHANNEL_ID, kind: "pm" });

    expect(pattern.exec("pm-c0syn000004-r12")![1]).toBe("12");
    expect(pattern.exec("inc-c0syn000004-r12")).toBe(null);
  });
});

describe("nextChannelRevision", () => {
  it("opens at r1, superseding nothing, when the channel has no card", () => {
    expect(nextChannelRevision({ channelId: CHANNEL_ID, kind: "inc", rows: [] })).toEqual({
      kind: "next",
      revision: { id: "inc-c0syn000004-r1" },
    });
  });

  it("numbers past a settled revision without superseding it", () => {
    const rows = [posted({ id: "inc-c0syn000004-r1" }), settled({ id: "inc-c0syn000004-r1" })];

    expect(nextChannelRevision({ channelId: CHANNEL_ID, kind: "inc", rows })).toEqual({
      kind: "next",
      revision: { id: "inc-c0syn000004-r2" },
    });
  });

  it("counts a re-cut's settlement written on its posting's own line, superseding only the re-cut", () => {
    const rows = [
      posted({ id: "inc-c0syn000004-r1" }),
      posted({ id: "inc-c0syn000004-r2", settles: "inc-c0syn000004-r1" }),
    ];

    expect(nextChannelRevision({ channelId: CHANNEL_ID, kind: "inc", rows })).toEqual({
      kind: "next",
      revision: { id: "inc-c0syn000004-r3", supersedes: "inc-c0syn000004-r2" },
    });
  });

  it("names every open revision when more than one is open", () => {
    const rows = [posted({ id: "pm-c0syn000004-r1" }), posted({ id: "pm-c0syn000004-r2" })];

    expect(nextChannelRevision({ channelId: CHANNEL_ID, kind: "pm", rows })).toEqual({
      kind: "ambiguous",
      open: ["pm-c0syn000004-r1", "pm-c0syn000004-r2"],
    });
  });
});
