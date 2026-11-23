/**
 * What the Slack write transport's privacy guard judges in one call, and the verdict over it. Synthetic rules,
 * terms and organisation throughout: `quillfeather` is the private person term, `zorblatt` the forbidden word.
 */
import { describe, expect, it } from "vitest";

import { type ForbiddenIdentifierRules, identifierDigest } from "../../../../hygiene/identifierScan.js";
import { parsePrivateTerms } from "../../../../hygiene/privateTerms.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { PrivacyPolicy } from "../../../../outbound/privacyCheck.js";
import {
  isSlackRead,
  SLACK_READ_METHODS,
  slackUploadLeaves,
  slackWriteFindings,
  slackWriteLeaves,
} from "../../../../outbound/slack/writePrivacyPayload.js";

/** The word `zorblatt` is forbidden. */
const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [],
    wordCi: [identifierDigest({ text: "zorblatt" })],
    wordCs: [],
  },
  providerLocations: [],
};

const POLICY: PrivacyPolicy = {
  denylist: [],
  identifierRules: RULES,
  privateTerms: unwrap(
    parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\n" }),
  ),
};

const bytes = ({ text }: { text: string }): Uint8Array => new TextEncoder().encode(text);

describe("isSlackRead", () => {
  it("lists exactly the lane's ten reads", () => {
    expect([...SLACK_READ_METHODS].toSorted()).toEqual([
      "auth.test",
      "conversations.history",
      "conversations.info",
      "conversations.members",
      "conversations.replies",
      "reactions.get",
      "usergroups.list",
      "users.getPresence",
      "users.info",
      "users.profile.get",
    ]);
  });

  it("judges every other method as a write, an unknown future one and an upload half included", () => {
    expect(
      ["chat.postMessage", "canvases.edit", "files.getUploadURLExternal", "acme.future.method"].map((method) =>
        isSlackRead({ method }),
      ),
    ).toEqual([false, false, false, false]);
    expect(isSlackRead({ method: "conversations.history" })).toBe(true);
  });
});

describe("slackWriteLeaves", () => {
  it("judges text, block text and metadata, and skips ids, timestamps and the token at any depth", () => {
    const args = {
      blocks: [{ elements: [{ type: "user", user_id: "U0FIXTURE" }], text: { text: "hi acme", type: "mrkdwn" } }],
      channel: "C0FIXTURE",
      metadata: { event_payload: { note: "for zorvane" }, event_type: "acme_card" },
      text: "hi acme",
      thread_ts: "1700000000.000100",
      token: "xoxb-not-a-real-token",
    };
    expect(slackWriteLeaves({ args, method: "chat.postMessage" })).toEqual([
      { locus: "slack chat.postMessage blocks[0].elements[0].type", text: "user" },
      { locus: "slack chat.postMessage blocks[0].text.text", text: "hi acme" },
      { locus: "slack chat.postMessage blocks[0].text.type", text: "mrkdwn" },
      { locus: "slack chat.postMessage metadata.event_payload.note", text: "for zorvane" },
      { locus: "slack chat.postMessage metadata.event_type", text: "acme_card" },
      { locus: "slack chat.postMessage text", text: "hi acme" },
    ]);
  });

  it("judges an upload's filename, title and comment, but never walks its bytes", () => {
    const args = { channel_id: "C0FIXTURE", file: bytes({ text: "x" }), filename: "notes.txt", initial_comment: "see" };
    expect(slackWriteLeaves({ args, method: "files.uploadV2" }).map((leaf) => leaf.text)).toEqual(["notes.txt", "see"]);
  });
});

describe("slackUploadLeaves", () => {
  it("reads a text-like file's bytes and passes an image with its bytes unread", () => {
    const args = {
      file_uploads: [
        { file: bytes({ text: "for quillfeather" }), filename: "notes.MD" },
        { file: bytes({ text: "quillfeather" }), filename: "chart.png" },
      ],
    };
    expect(unwrap(slackUploadLeaves({ args }))).toEqual({
      leaves: [{ locus: "slack files.uploadV2 file_uploads[0].file", text: "for quillfeather" }],
      unreadBinaries: 1,
    });
  });

  it("refuses a text-like file that is not valid UTF-8", () => {
    const args = { file: new Uint8Array([0xff, 0xfe, 0x00]), filename: "notes.txt" };
    expect(unwrapErr(slackUploadLeaves({ args }))).toBe(
      "slack files.uploadV2 file: a text-like file that is not valid UTF-8, so it cannot be judged",
    );
  });

  it("refuses a text-like file whose bytes were never read", () => {
    expect(unwrapErr(slackUploadLeaves({ args: { file: "/tmp/notes.txt", filename: "notes.txt" } }))).toBe(
      "slack files.uploadV2 file: a text-like file whose bytes were not read before the check",
    );
  });

  it("finds nothing in a call with no file", () => {
    expect(unwrap(slackUploadLeaves({ args: { channel_id: "C0FIXTURE" } }))).toEqual({ leaves: [], unreadBinaries: 0 });
  });
});

describe("slackWriteFindings", () => {
  it("forgives a forbidden identifier in the workspace and refuses a private term, the owner's DM included", () => {
    const leaves = [
      { locus: "slack chat.postMessage text", text: "zorblatt shipped it" },
      { locus: "slack chat.postMessage blocks[0].text.text", text: "ok\nthanks Quillfeather" },
    ];
    expect(slackWriteFindings({ leaves, policy: POLICY }).map((finding) => finding.message)).toEqual([
      "slack chat.postMessage blocks[0].text.text line 2: a private person term (redacted here) — remove or " +
        "generalise it, or if it is not private ask the chair to narrow that terms row",
    ]);
  });
});
