/**
 * `draftRecordProof.ts`: the finding and first-message proof bars bind a revision as they bind a recording,
 * a recording is judged on its argv before any read, and `slack draft list --json` names every row the Queue will not
 * draw.
 */
import { describe, expect, it } from "vitest";

import type { DraftRecordOptions } from "../../../../../cli/commands/slack/draftCore.js";
import {
  firstMessageGroupDm,
  proofMissingWarnings,
  readRecordingDestination,
  recordingDestination,
  recordingProof,
  revisionProofRefusal,
} from "../../../../../cli/commands/slack/draftRecordProof.js";
import { unwrap } from "../../../../../lib/result.js";
import { parkedDraftDigest, type SlackDraftItem } from "../../../../../outbound/slack/draftRegister.js";
import type { DraftMediaEvidence } from "../../../../../outbound/slack/firstMessageProof.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";
import { annotatedRecord } from "../../../../annotatedShotFixture.js";

/** A plain as-me payload saying `text`. */
function plain({ text }: { text: string }): SlackDripMessagePayload {
  return { form: "plain", text, unfurl_links: false, unfurl_media: false };
}

const SHA = "0".repeat(64);

/** The row's one attachment: a picture whose record vouches for its box and for nothing covering it. */
const VOUCHED: readonly DraftMediaEvidence[] = [
  { kind: "picture", records: [annotatedRecord({ digest: `sha256:${SHA}` })], sha256: SHA },
];

describe("revisionProofRefusal", () => {
  const proved = {
    advisory: [],
    authorId: "U0SYNADAOWN",
    channel: "C0POOL",
    form: '{"kind":"one-card","problem":{"kind":"possible","affects":"many"}}',
    id: "sd-22222222",
    impact: "12 users could not check out",
    kind: "finding" as const,
    media: [{ bytes: 1, name: "still.png", sha256: SHA }],
    mentions: [],
    payload: plain({ text: "12 users could not check out <https://grafana.example/view|view>" }),
    shape: "top-level" as const,
    tsIso: "2026-10-19T00:00:00.000Z",
    why: "the pool",
  };
  const item: SlackDraftItem = {
    draft: { ...proved, digest: parkedDraftDigest({ draft: proved }) },
    id: proved.id,
    state: "held",
  };

  it("refuses a rewrite of a proved finding that drops its link and its first-line count", () => {
    const lines = revisionProofRefusal({
      item,
      media: VOUCHED,
      words: { form: proved.form, payload: plain({ text: "The pool is still exhausted." }) },
    });
    expect(lines[0]).toContain("is missing link, impact-count-first");
    expect(
      lines.some((line) => line.startsWith("this draft is a first message in a channel and is missing link.")),
    ).toBe(true);
    expect(lines.at(-1)).toContain("nothing was recorded");
    expect(lines.at(-1)).toContain("--supersedes sd-22222222");
  });

  it("records a rewrite that keeps every piece", () => {
    const words = {
      form: proved.form,
      payload: plain({ text: "12 users still cannot check out <https://g.example|view>" }),
    };
    expect(revisionProofRefusal({ item, media: VOUCHED, words })).toEqual([]);
  });

  it("refuses a rewrite of a first message whose screenshot's record vouches for no box", () => {
    const unboxed: readonly DraftMediaEvidence[] = [
      {
        kind: "picture",
        records: [annotatedRecord({ digest: `sha256:${SHA}`, over: { annotations: undefined } })],
        sha256: SHA,
      },
    ];
    const words = { form: proved.form, payload: proved.payload };
    expect(revisionProofRefusal({ item, media: unboxed, words })[0]).toBe(
      "this draft is a first message in a channel and is missing annotation. The very first " +
        "message in the channel leads with the receipts, an annotated screenshot and the link backing it, even " +
        "posting as the owner tagging the bot; one without is sent back unseen.",
    );
  });

  it("leaves a reply raising no finding as it was", () => {
    const message: SlackDraftItem = {
      ...item,
      draft: { ...item.draft, form: '{"kind":"one-card"}', kind: "message", shape: "thread", threadTs: "1.2" },
    };
    const words = { form: '{"kind":"one-card"}', payload: plain({ text: "thanks, looking now" }) };
    expect(revisionProofRefusal({ item: message, media: [], words })).toEqual([]);
  });
});

describe("recordingProof — what the argv alone decides, before any read", () => {
  /** A parsed record of an as-me message at `channel`'s top level, naming `media` files. */
  function recordOf({ channel, media }: { channel: string; media: readonly string[] }): DraftRecordOptions {
    return { act: undefined, channel, impact: undefined, media, threadTs: undefined } as unknown as DraftRecordOptions;
  }
  const form = '{"kind":"one-card"}';

  it("refuses a first message naming no file and no link, naming all three pieces", () => {
    const refused = recordingProof({
      form,
      groupDm: undefined,
      impactInForm: false,
      kind: "message",
      options: recordOf({ channel: "C0ISO", media: [] }),
      payload: plain({ text: "the control is failing" }),
    });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr()[0]).toContain("is missing screenshot, link, annotation.");
    expect(refused._unsafeUnwrapErr().at(-1)).toBe("NOTHING was parked and nothing was sent.");
  });

  it("waits for the bytes on the screenshot once a file is named, judging only the link", () => {
    const options = recordOf({ channel: "C0ISO", media: ["/tmp/control.png"] });
    const unlinked = recordingProof({
      form,
      groupDm: undefined,
      impactInForm: false,
      kind: "message",
      options,
      payload: plain({ text: "x" }),
    });
    const linked = recordingProof({
      form,
      groupDm: undefined,
      impactInForm: false,
      kind: "message",
      options,
      payload: plain({ text: "the control <https://app.vanta.com/c/1|control>" }),
    });
    expect(unlinked._unsafeUnwrapErr()[0]).toContain("is missing link.");
    expect(unwrap(linked)).toBeUndefined();
  });

  it("asks nothing of a message to a DM", () => {
    const options = recordOf({ channel: "D0DM", media: [] });
    const asked = recordingProof({
      form,
      groupDm: undefined,
      impactInForm: false,
      kind: "message",
      options,
      payload: plain({ text: "hi" }),
    });
    expect(unwrap(asked)).toBeUndefined();
  });

  it("asks nothing of a group DM its conversation read stamped, and all three of the same C… id unstamped", () => {
    const options = recordOf({ channel: "C0SYN000021", media: [] });
    const payload = plain({ text: "keen for a standing call" });
    const stamped = recordingProof({ form, groupDm: true, impactInForm: false, kind: "message", options, payload });
    const unstamped = recordingProof({
      form,
      groupDm: undefined,
      impactInForm: false,
      kind: "message",
      options,
      payload,
    });
    expect(unwrap(stamped)).toBeUndefined();
    expect(unstamped._unsafeUnwrapErr()[0]).toContain("is missing screenshot, link, annotation.");
  });

  it("reads a recording with no thread as a top-level row", () => {
    expect(
      recordingDestination({
        groupDm: undefined,
        options: { act: undefined, channel: "C0ISO", threadTs: undefined },
        payload: "p",
      }),
    ).toEqual({ act: undefined, channel: "C0ISO", payload: "p", shape: "top-level", threadTs: undefined });
  });

  it("carries a group-DM stamp onto the destination only when the read gave one", () => {
    expect(
      recordingDestination({
        groupDm: true,
        options: { act: undefined, channel: "C0SYN000021", threadTs: undefined },
        payload: "p",
      }),
    ).toEqual({
      act: undefined,
      channel: "C0SYN000021",
      groupDm: true,
      payload: "p",
      shape: "top-level",
      threadTs: undefined,
    });
  });
});

describe("firstMessageGroupDm", () => {
  /** A conversation read that answers `is_mpim` and counts how often it was asked. */
  function groupDmRead(): { readonly asked: string[]; readonly read: () => Promise<{ groupDm: true }> } {
    const asked: string[] = [];
    return {
      asked,
      read: async () => {
        asked.push("conversationInfo");
        return { groupDm: true };
      },
    };
  }

  it("reads the conversation for a top-level message in a C… id and answers its stamp", async () => {
    const seam = groupDmRead();
    const options = { act: undefined, channel: "C0SYN000021", threadTs: undefined };
    expect(await firstMessageGroupDm({ options, payload: "p", readInfo: seam.read })).toBe(true);
    expect(seam.asked).toEqual(["conversationInfo"]);
  });

  it("reads nothing for a reply, a bump or a DM, none of which owes the first-message proof", async () => {
    const seam = groupDmRead();
    const answers = [
      { act: undefined, channel: "C0ISO", threadTs: "1789407961.767649" },
      { act: "bump" as const, channel: "C0ISO", threadTs: undefined },
      { act: undefined, channel: "D0DM", threadTs: undefined },
    ].map((options) => firstMessageGroupDm({ options, payload: "p", readInfo: seam.read }));
    expect(await Promise.all(answers)).toEqual([undefined, undefined, undefined]);
    expect(seam.asked).toEqual([]);
  });

  it("stamps the destination a first message into a group DM is admitted under, and nothing on a reply", async () => {
    const seam = groupDmRead();
    const top = { act: undefined, channel: "C0SYN000021", threadTs: undefined };
    const reply = { ...top, threadTs: "1789407961.767649" };
    const stamped = await readRecordingDestination({ options: top, payload: "p", readInfo: seam.read });
    const unstamped = await readRecordingDestination({ options: reply, payload: "p", readInfo: seam.read });
    expect([stamped.groupDm, Object.keys(unstamped).includes("groupDm"), seam.asked]).toEqual([
      true,
      false,
      ["conversationInfo"],
    ]);
  });
});

describe("proofMissingWarnings", () => {
  it("names each row sent back unseen with what it lacks, and nothing for a row with its proof", () => {
    const items = [{ id: "sd-1", proofMissing: ["screenshot", "impact"] }, { id: "sd-2" }];
    expect(proofMissingWarnings({ items })).toEqual(["slack draft list: sd-1 sent back unseen, no screenshot, impact"]);
  });
});
