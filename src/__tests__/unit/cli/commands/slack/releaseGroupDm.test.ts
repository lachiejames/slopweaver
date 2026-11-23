/**
 * `releaseGroupDm.ts`: a group-DM stamp lets a row reach a live `is_mpim` read at release, never past it.
 */
import { describe, expect, it } from "vitest";

import { stampedGroupDmRefusal } from "../../../../../cli/commands/slack/releaseGroupDm.js";

/** A live read answering `answer`, recording every channel it was asked about. */
function liveRead({ answer }: { answer: true | undefined }): {
  readonly asked: string[];
  readonly deps: { conversationGroupDm: () => Promise<true | undefined> };
} {
  const asked: string[] = [];
  return {
    asked,
    deps: {
      conversationGroupDm: async () => {
        asked.push("conversationGroupDm");
        return answer;
      },
    },
  };
}

describe("stampedGroupDmRefusal", () => {
  it("reads nothing for an unstamped row, which already owed the proof", async () => {
    const seam = liveRead({ answer: undefined });
    const draft = { channel: "C0ISO", groupDm: undefined, id: "sd-1" };
    expect(await stampedGroupDmRefusal({ deps: seam.deps, draft, token: "xoxp-test" })).toBe(undefined);
    expect(seam.asked).toEqual([]);
  });

  it("passes a stamped row whose conversation still reads as a group DM", async () => {
    const seam = liveRead({ answer: true });
    const draft = { channel: "C0SYN000021", groupDm: true as const, id: "sd-1" };
    expect(await stampedGroupDmRefusal({ deps: seam.deps, draft, token: "xoxp-test" })).toBe(undefined);
    expect(seam.asked).toEqual(["conversationGroupDm"]);
  });

  it("refuses a stamped row the live read does not call a group DM, naming the proof it owes", async () => {
    const seam = liveRead({ answer: undefined });
    const draft = { channel: "C0ISO", groupDm: true as const, id: "sd-1" };
    const refusal = await stampedGroupDmRefusal({ deps: seam.deps, draft, token: "xoxp-test" });
    expect([refusal!.code, refusal!.message]).toEqual([
      "DRAFT_NOT_FOUND",
      "sd-1 is stamped a group DM, but C0ISO does not read as one now, so it owes the first-message proof: " +
        "re-record it with --media <annotated screenshot> — nothing was sent.",
    ]);
  });
});
