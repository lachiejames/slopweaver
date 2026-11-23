/**
 * The first-message proof bar (`outbound/slack/firstMessageProof.ts`): the very first message in a
 * channel brings an annotated, unobstructed screenshot and a visible link, or it never reaches the owner's Queue.
 */
import { describe, expect, it } from "vitest";

import {
  type DraftMediaEvidence,
  firstMessageProofRefusal,
  firstMessageProofVerdict,
  isFirstChannelMessage,
  vouchedAnnotations,
} from "../../../../outbound/slack/firstMessageProof.js";
import { annotatedRecord, failedRecord, SHOT_NOTE } from "../../../annotatedShotFixture.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

/** A top-level post in a team channel: the shape the rule applies to. */
const TOP_LEVEL = { act: undefined, channel: "C0SYN123ABCD", shape: "top-level", threadTs: undefined } as const;

/** A payload whose one link renders: a labelled mrkdwn link in the message text. */
const LINKED_PAYLOAD = { text: "the control is failing <https://app.example.com/view|the view>" };

/** A payload with prose and no link at all. */
const BARE_PAYLOAD = { text: "the control is failing" };

/** A picture entry filed under `sha256` with the records its digest holds. */
const picture = ({
  records,
  sha256,
}: {
  records: Extract<DraftMediaEvidence, { kind: "picture" }>["records"];
  sha256: string;
}): DraftMediaEvidence => ({ kind: "picture", records, sha256 });

describe("isFirstChannelMessage", () => {
  it("is true for a top-level post in a C… channel", () => {
    expect(isFirstChannelMessage({ draft: TOP_LEVEL })).toBe(true);
  });

  it("is true for a top-level post in a G… group, which reads as a channel", () => {
    expect(isFirstChannelMessage({ draft: { ...TOP_LEVEL, channel: "G0SYN123ABCD" } })).toBe(true);
  });

  it("is false for a thread reply, whether it says so by shape or by a thread root", () => {
    expect([
      isFirstChannelMessage({ draft: { ...TOP_LEVEL, shape: "thread", threadTs: "1700000000.000100" } }),
      isFirstChannelMessage({ draft: { ...TOP_LEVEL, shape: "thread" } }),
      isFirstChannelMessage({ draft: { ...TOP_LEVEL, threadTs: "1700000000.000100" } }),
    ]).toEqual([false, false, false]);
  });

  it("is false for a DM, however it is shaped", () => {
    expect(isFirstChannelMessage({ draft: { ...TOP_LEVEL, channel: "D0SYN123ABCD" } })).toBe(false);
  });

  it("is false for a group DM its row is stamped as, whose C… id alone reads as a channel", () => {
    expect([
      isFirstChannelMessage({ draft: { ...TOP_LEVEL, groupDm: true } }),
      isFirstChannelMessage({ draft: TOP_LEVEL }),
    ]).toEqual([false, true]);
  });

  it("is false for a bump, which re-surfaces an earlier message, and true for any other act", () => {
    expect([
      isFirstChannelMessage({ draft: { ...TOP_LEVEL, act: "bump" } }),
      isFirstChannelMessage({ draft: { ...TOP_LEVEL, act: "reply" } }),
    ]).toEqual([false, true]);
  });
});

describe("vouchedAnnotations", () => {
  it("returns the boxes of a newest passed record declaring nothing covering it", () => {
    const records = [annotatedRecord({ digest: DIGEST_A })];
    expect(vouchedAnnotations({ records })).toEqual([{ note: SHOT_NOTE, rect: { height: 1, width: 1, x: 0, y: 0 } }]);
  });

  it("is undefined for a passed record that declares no obstruction", () => {
    const unvouched = annotatedRecord({ digest: DIGEST_A, over: { obstruction: undefined } });
    expect(vouchedAnnotations({ records: [unvouched] })).toBe(undefined);
  });

  it("is undefined for a passed record with no annotations, and for one with an empty list", () => {
    const bare = annotatedRecord({ digest: DIGEST_A, over: { annotations: undefined } });
    expect([
      vouchedAnnotations({ records: [bare] }),
      vouchedAnnotations({ records: [annotatedRecord({ digest: DIGEST_A, over: { annotations: [] } })] }),
    ]).toEqual([undefined, undefined]);
  });

  it("is undefined when any record for the bytes failed, an older obscured one included", () => {
    const older = failedRecord({ correction: "retake it", digest: DIGEST_A, reason: "obscured" });
    expect(vouchedAnnotations({ records: [older, annotatedRecord({ digest: DIGEST_A })] })).toBe(undefined);
  });

  it("is undefined when the newest record failed", () => {
    const newest = failedRecord({ correction: "retake it", digest: DIGEST_A, reason: "illegible" });
    expect(vouchedAnnotations({ records: [annotatedRecord({ digest: DIGEST_A }), newest] })).toBe(undefined);
  });

  it("is undefined for no records at all", () => {
    expect(vouchedAnnotations({ records: [] })).toBe(undefined);
  });
});

describe("firstMessageProofVerdict", () => {
  const vouched = picture({ records: [annotatedRecord({ digest: DIGEST_A })], sha256: DIGEST_A });

  it("owes nothing when the row is not a first message", () => {
    const verdict = firstMessageProofVerdict({
      draft: { ...TOP_LEVEL, channel: "D0SYN123ABCD", payload: BARE_PAYLOAD },
      media: [],
    });
    expect(verdict).toEqual({ missing: [] });
  });

  it("names every piece for a first message with no media and no link", () => {
    const verdict = firstMessageProofVerdict({ draft: { ...TOP_LEVEL, payload: BARE_PAYLOAD }, media: [] });
    expect(verdict).toEqual({ missing: ["screenshot", "link", "annotation"] });
  });

  it("owes nothing of a stamped group DM, and every piece of the same C… id unstamped", () => {
    const groupDm = { ...TOP_LEVEL, channel: "C0SYN000021", payload: BARE_PAYLOAD };
    expect([
      firstMessageProofVerdict({ draft: { ...groupDm, groupDm: true }, media: [] }),
      firstMessageProofVerdict({ draft: groupDm, media: [] }),
    ]).toEqual([{ missing: [] }, { missing: ["screenshot", "link", "annotation"] }]);
  });

  it("clears a vouched picture with a visible link, leading with the first picture's notes and bytes", () => {
    const verdict = firstMessageProofVerdict({ draft: { ...TOP_LEVEL, payload: LINKED_PAYLOAD }, media: [vouched] });
    expect(verdict).toEqual({ leadingReceipt: { notes: [SHOT_NOTE], sha256: DIGEST_A }, missing: [] });
  });

  it("names only the annotation for a picture with no records", () => {
    const verdict = firstMessageProofVerdict({
      draft: { ...TOP_LEVEL, payload: LINKED_PAYLOAD },
      media: [picture({ records: [], sha256: DIGEST_A })],
    });
    expect(verdict).toEqual({ missing: ["annotation"] });
  });

  it("names only the link when the picture is vouched and the message shows no link", () => {
    const verdict = firstMessageProofVerdict({ draft: { ...TOP_LEVEL, payload: BARE_PAYLOAD }, media: [vouched] });
    expect(verdict).toEqual({ missing: ["link"] });
  });

  it("names the annotation but not the screenshot for bytes the store could not read", () => {
    const verdict = firstMessageProofVerdict({
      draft: { ...TOP_LEVEL, payload: LINKED_PAYLOAD },
      media: [{ kind: "unread", sha256: DIGEST_A, why: "the file is gone" }],
    });
    expect(verdict).toEqual({ missing: ["annotation"] });
  });

  it("names the screenshot and the annotation for a PDF alone, which is no picture", () => {
    const verdict = firstMessageProofVerdict({
      draft: { ...TOP_LEVEL, payload: LINKED_PAYLOAD },
      media: [{ kind: "other", sha256: DIGEST_A }],
    });
    expect(verdict).toEqual({ missing: ["screenshot", "annotation"] });
  });

  it("names the annotation when the second of two pictures is unvouched, and carries no leading receipt", () => {
    const verdict = firstMessageProofVerdict({
      draft: { ...TOP_LEVEL, payload: LINKED_PAYLOAD },
      media: [vouched, picture({ records: [], sha256: DIGEST_B })],
    });
    expect(verdict).toEqual({ missing: ["annotation"] });
  });

  it("leads with the FIRST picture when both are vouched", () => {
    const second = picture({
      records: [
        annotatedRecord({
          digest: DIGEST_B,
          over: { annotations: [{ note: "second", rect: { height: 1, width: 1, x: 0, y: 0 } }] },
        }),
      ],
      sha256: DIGEST_B,
    });
    const verdict = firstMessageProofVerdict({
      draft: { ...TOP_LEVEL, payload: LINKED_PAYLOAD },
      media: [vouched, second],
    });
    expect(verdict).toEqual({ leadingReceipt: { notes: [SHOT_NOTE], sha256: DIGEST_A }, missing: [] });
  });

  it("sends a cleared picture back once a later failed record lands for its bytes", () => {
    const later = failedRecord({ correction: "retake it", digest: DIGEST_A, reason: "obscured" });
    const verdict = firstMessageProofVerdict({
      draft: { ...TOP_LEVEL, payload: LINKED_PAYLOAD },
      media: [picture({ records: [annotatedRecord({ digest: DIGEST_A }), later], sha256: DIGEST_A })],
    });
    expect(verdict).toEqual({ missing: ["annotation"] });
  });
});

describe("firstMessageProofRefusal", () => {
  it("is empty when nothing is missing", () => {
    expect(firstMessageProofRefusal({ missing: [] })).toEqual([]);
  });

  it("names the annotation and what to bring, then says there is no hatch", () => {
    expect(firstMessageProofRefusal({ missing: ["annotation"] })).toEqual([
      "this draft is a first message in a channel and is missing annotation. The very first " +
        "message in the channel leads with the receipts, an annotated screenshot and the link backing it, even " +
        "posting as the owner tagging the bot; one without is sent back unseen.",
      "bring every screenshot annotated and clear: a box drawn over what the reader should look at, with its note, " +
        "every pop-up, banner and modal dismissed before the capture, the boxes drawn with `browser annotate`, the " +
        "output read back, and its image record saying so (`browser image-record` on the form annotate wrote, with " +
        '`annotations: [{ rect, note }]` and `obstruction: "none"`). A capture something covers is retaken — ' +
        "`reason: obscured` — never worked around",
      "--self-evident and --tried do not answer this. There is deliberately NO escape hatch here.",
    ]);
  });

  it("names every piece in the order given, one bring line each", () => {
    const lines = firstMessageProofRefusal({ missing: ["screenshot", "link"] });
    expect(lines).toEqual([
      "this draft is a first message in a channel and is missing screenshot, link. The very " +
        "first message in the channel leads with the receipts, an annotated screenshot and the link backing it, " +
        "even posting as the owner tagging the bot; one without is sent back unseen.",
      "bring a screenshot of what it claims, cropped to it: --media <file.png>",
      "bring a link to where the reader sees it for themselves (the Vanta control, the Datadog view, the record itself)",
      "--self-evident and --tried do not answer this. There is deliberately NO escape hatch here.",
    ]);
  });
});
