import { describe, expect, it } from "vitest";
import { SlackLifecycleErrors } from "../../../../../../cli/commands/slack/lifecycleErrors.js";
import { releasePlacementRefusal } from "../../../../../../cli/commands/slack/releaseRow.js";
import type { ParkedSlackDraft } from "../../../../../../outbound/slack/draftRegister.js";
import { heldRow } from "./fixtures.js";

describe("releasePlacementRefusal — the release that put two thread replies top-level", () => {
  const thread: ParkedSlackDraft = { ...heldRow(), shape: "thread", threadTs: "1789407961.767649" };

  it("sends a top-level row by post and a thread row by reply, refusing neither", () => {
    expect([
      releasePlacementRefusal({ draft: heldRow(), verb: "post" }),
      releasePlacementRefusal({ draft: thread, verb: "reply" }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses a thread row released by post, naming the reply command that sends it into its thread", () => {
    expect(releasePlacementRefusal({ draft: thread, verb: "post" })).toEqual(
      SlackLifecycleErrors.draftVerbMismatch({
        command: `slopweaver slack reply --as me --draft sd-1a2b3c4d --approve ${thread.digest}`,
        draftId: "sd-1a2b3c4d",
        shape: "thread",
      }),
    );
  });

  it("refuses a top-level row released by reply, naming the post command", () => {
    const row = heldRow();
    expect(releasePlacementRefusal({ draft: row, verb: "reply" })).toEqual(
      SlackLifecycleErrors.draftVerbMismatch({
        command: `slopweaver slack post --as me --draft sd-1a2b3c4d --approve ${row.digest}`,
        draftId: "sd-1a2b3c4d",
        shape: "top-level",
      }),
    );
  });

  it("refuses a top-level row whose why says thread reply, by either verb", () => {
    const row: ParkedSlackDraft = { ...heldRow(), why: "THREAD REPLY, not top-level" };
    const refusal = SlackLifecycleErrors.draftWhySaysThread({ draftId: "sd-1a2b3c4d" });
    expect([
      releasePlacementRefusal({ draft: row, verb: "post" }),
      releasePlacementRefusal({ draft: row, verb: "reply" }),
    ]).toEqual([refusal, refusal]);
  });
});
