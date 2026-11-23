import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../outbound/artifact/types.js";
import { dryRunSteps, dryRunWarnings } from "../../../../outbound/slack/dryRun.js";
import { renderUpdateCard } from "../../../../outbound/slack/render.js";
import type { SlackCardChrome } from "../../../../outbound/slack/types.js";

const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

function artifact(): UpdateArtifact {
  return {
    citations: [{ id: "c1", label: "[1]", url: "https://example.invalid/a" }],
    detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
    index: [],
    kind: "update",
    media: [],
    tldr: "A short lead.",
  };
}

function payloadFor({ from }: { from: UpdateArtifact }) {
  return renderUpdateCard({
    artifact: from,
    artifactFingerprint: "fp-1",
    chrome: CHROME,
    mentions: { groups: new Map(), people: new Map() },
  });
}

describe("dryRunWarnings", () => {
  it("says nothing when the artifact is clean", () => {
    expect(dryRunWarnings({ artifact: artifact() })).toEqual([]);
  });

  it("warns about zero citations WITHOUT rejecting — citations are advisory", () => {
    const warnings = dryRunWarnings({ artifact: { ...artifact(), citations: [] } });

    expect(warnings.length).toBe(1);
    expect(warnings[0]!.code).toBe("no-citations");
  });

  it("warns that *bold* in a plain field will render as literal asterisks", () => {
    const warnings = dryRunWarnings({
      artifact: { ...artifact(), tldr: "shipped the *important* fix" },
    });

    expect(warnings.length).toBe(1);
    expect(warnings[0]!.code).toBe("markdown-in-plain-text");
    expect(warnings[0]!.message).toContain('tldr contains "*important*"');
  });

  it("finds markdown inside a bullet item, not just the TL;DR", () => {
    const warnings = dryRunWarnings({
      artifact: {
        ...artifact(),
        detail: [{ items: [[{ text: "an _emphasised_ bullet", type: "text" }]], type: "bullets" }],
      },
    });

    expect(warnings.length).toBe(1);
    expect(warnings[0]!.message).toContain('"_emphasised_"');
  });

  it("reports EVERY lookalike in one text run, not just the first", () => {
    // Without the `g` flag only the first hit per run was reported, so an author fixed one span, re-ran,
    // and got the next warning — one round-trip per mistake, on the very defect class this PR exists for.
    const warnings = dryRunWarnings({
      artifact: { ...artifact(), tldr: "*one* and _two_ and `three` and ~four~" },
    });

    expect(warnings.map((w) => w.code)).toEqual([
      "markdown-in-plain-text",
      "markdown-in-plain-text",
      "markdown-in-plain-text",
      "markdown-in-plain-text",
    ]);
    expect(warnings[0]!.message).toContain('tldr contains "*one*" at offset 0');
    expect(warnings[3]!.message).toContain('"~four~"');
  });

  it("does not leak regex state between runs — the SECOND field is scanned from its own start", () => {
    const warnings = dryRunWarnings({
      artifact: {
        ...artifact(),
        detail: [
          { runs: [{ text: "a *first* hit", type: "text" }], type: "paragraph" },
          { runs: [{ text: "a *second* hit", type: "text" }], type: "paragraph" },
        ],
        tldr: "a *lead* hit",
      },
    });

    expect(warnings.length).toBe(3);
    expect(warnings[1]!.message).toContain('detail[0][0][0] contains "*first*" at offset 2');
    expect(warnings[2]!.message).toContain('detail[1][0][0] contains "*second*" at offset 2');
  });

  it("does NOT warn about a properly styled span — the style flag is the correct form", () => {
    const warnings = dryRunWarnings({
      artifact: {
        ...artifact(),
        detail: [{ runs: [{ bold: true, text: "important", type: "text" }], type: "paragraph" }],
      },
    });

    expect(warnings).toEqual([]);
  });

  it("does not warn about an ordinary em-dash or apostrophe — no prose is ever scanned for style", () => {
    const warnings = dryRunWarnings({
      artifact: { ...artifact(), tldr: "shipped — at last — the reviewer's fix" },
    });

    expect(warnings).toEqual([]);
  });
});

describe("dryRunSteps", () => {
  it("renders a single postMessage when there is no media", () => {
    const steps = dryRunSteps({
      channel: "C1",
      mediaFilenames: [],
      blockCount: payloadFor({ from: artifact() }).attachments[0].blocks.length,
      metadataEventType: payloadFor({ from: artifact() }).metadata.event_type,
      wrappers: 1,
    });

    expect(steps.length).toBe(1);
    expect(steps[0]!.api).toBe("chat.postMessage");
  });

  it("renders upload, poll, post, update and read-back for a two-file send, in order", () => {
    const steps = dryRunSteps({
      channel: "C1",
      mediaFilenames: ["a.png", "b.pdf"],
      blockCount: payloadFor({ from: artifact() }).attachments[0].blocks.length,
      metadataEventType: payloadFor({ from: artifact() }).metadata.event_type,
      wrappers: 1,
    });

    expect(steps.map((step) => step.api)).toEqual([
      "files.uploadV2",
      "files.uploadV2",
      "files.info",
      "chat.postMessage",
      "chat.update",
      "conversations.history",
    ]);
    expect(steps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("marks the file_ids placeholders as the ONE thing a dry run cannot show for real", () => {
    const steps = dryRunSteps({
      channel: "C1",
      mediaFilenames: ["a.png"],
      blockCount: payloadFor({ from: artifact() }).attachments[0].blocks.length,
      metadataEventType: payloadFor({ from: artifact() }).metadata.event_type,
      wrappers: 1,
    });
    const update = steps.find((step) => step.api === "chat.update")!;

    expect(update.detail).toContain("file_ids=[<file-id-0>]");
    expect(update.detail).toContain("everything above is byte-exact");
  });

  it("names the thread when replying", () => {
    const steps = dryRunSteps({
      channel: "C1",
      mediaFilenames: [],
      blockCount: payloadFor({ from: artifact() }).attachments[0].blocks.length,
      metadataEventType: payloadFor({ from: artifact() }).metadata.event_type,
      wrappers: 1,
      threadTs: "1700000000.000100",
    });

    expect(steps[0]!.detail).toContain("thread_ts=1700000000.000100");
  });

  it("reports the real block count and metadata event type", () => {
    const steps = dryRunSteps({
      channel: "C1",
      mediaFilenames: [],
      blockCount: payloadFor({ from: artifact() }).attachments[0].blocks.length,
      metadataEventType: payloadFor({ from: artifact() }).metadata.event_type,
      wrappers: 1,
    });

    expect(steps[0]!.detail).toContain("6 block(s)");
    expect(steps[0]!.detail).toContain("1 wrapper(s)");
    expect(steps[0]!.detail).toContain("metadata.event_type=test_card_v1");
  });
});

describe("dryRunWarnings — an inert @handle in plain text", () => {
  it("warns that a plain-text @handle pings nobody, naming the path and the offset", () => {
    const withTag: UpdateArtifact = {
      ...artifact(),
      detail: [{ runs: [{ text: "hey @acmebot look at this", type: "text" }], type: "paragraph" }],
    };
    const found = dryRunWarnings({ artifact: withTag }).filter((w) => w.code === "inert-mention-in-plain-text");
    expect(found.length).toBe(1);
    expect(found[0]!.message).toContain('detail[0][0][0] contains "@acmebot" at offset 3');
    expect(found[0]!.message).toContain("INERT");
  });

  it("warns on a tag in the tldr, where the path is the field name", () => {
    const withTag: UpdateArtifact = { ...artifact(), tldr: "@someone please look" };
    const found = dryRunWarnings({ artifact: withTag }).filter((w) => w.code === "inert-mention-in-plain-text");
    expect(found.length).toBe(1);
    expect(found[0]!.message).toContain('tldr contains "@someone" at offset 0');
  });

  it("reports EVERY tag in one run, not just the first", () => {
    const withTags: UpdateArtifact = {
      ...artifact(),
      detail: [{ runs: [{ text: "@one and @two and @three", type: "text" }], type: "paragraph" }],
    };
    const found = dryRunWarnings({ artifact: withTags }).filter((w) => w.code === "inert-mention-in-plain-text");
    expect(found.length).toBe(3);
  });

  it("does NOT warn on an email address, whose @ has no leading boundary", () => {
    const withEmail: UpdateArtifact = {
      ...artifact(),
      detail: [{ runs: [{ text: "write to someone@example.invalid", type: "text" }], type: "paragraph" }],
    };
    expect(dryRunWarnings({ artifact: withEmail }).filter((w) => w.code === "inert-mention-in-plain-text")).toEqual([]);
  });

  it("does NOT warn on a real mention run, which is the correct spelling", () => {
    const withMention: UpdateArtifact = {
      ...artifact(),
      detail: [{ runs: [{ person: "@acmebot", type: "mention" }], type: "paragraph" }],
    };
    expect(dryRunWarnings({ artifact: withMention }).filter((w) => w.code === "inert-mention-in-plain-text")).toEqual(
      [],
    );
  });
});
