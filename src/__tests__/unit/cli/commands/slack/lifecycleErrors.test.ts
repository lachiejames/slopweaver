/**
 * The `slack` lifecycle refusals: each factory raises the exact value an edit or release used to author as a
 * string, and the lines helper prints a list-carrying refusal one line per problem.
 */
import { describe, expect, it } from "vitest";

import { SlackLifecycleErrors, slackLifecycleErrorLines } from "../../../../../cli/commands/slack/lifecycleErrors.js";

describe("SlackLifecycleErrors", () => {
  it("names how many messages an as-me edit form described", () => {
    expect(SlackLifecycleErrors.singleMessageRequired({ count: 3 })).toEqual({
      code: "SINGLE_MESSAGE_REQUIRED",
      count: 3,
      message:
        "slack edit --as me replaces ONE message, but --form described 3. Pass a single-message drip (one entry " +
        "in `messages`), or use --body for the plain escape hatch.",
    });
  });

  it("says nothing was sent when the draft cannot be found", () => {
    expect(SlackLifecycleErrors.draftNotFound({ reason: "no draft sd-1 in the register" })).toEqual({
      code: "DRAFT_NOT_FOUND",
      message: "no draft sd-1 in the register — nothing was sent.",
      reason: "no draft sd-1 in the register",
    });
  });

  it("names both digests when the approval binds other bytes", () => {
    expect(SlackLifecycleErrors.draftApprovalMismatch({ approve: "aaaa", digest: "bbbb", draftId: "sd-1" })).toEqual({
      approve: "aaaa",
      code: "DRAFT_APPROVAL_MISMATCH",
      digest: "bbbb",
      draftId: "sd-1",
      message:
        "--approve aaaa is not draft sd-1's digest (bbbb) — the approval names other bytes, so nothing was sent. " +
        "`slopweaver slack draft show sd-1` prints the one it binds.",
    });
  });

  it("names --form as the way to re-prepare a draft recorded from stdin", () => {
    expect(SlackLifecycleErrors.draftFormRequired({ draftId: "sd-2" }).message).toBe(
      "draft sd-2 was recorded from stdin before the register kept the form it read, so it cannot be re-prepared " +
        "from the row. Pass the form that renders it with --form <json|-> — the digest still refuses anything but " +
        "the approved bytes.",
    );
  });
});

describe("slackLifecycleErrorLines", () => {
  it("prints the no-fold refusal as the refusal then the way out", () => {
    expect(slackLifecycleErrorLines({ error: SlackLifecycleErrors.noFoldEditRefused() })).toEqual([
      "this verb re-renders its form as a CARD, and a card sits in the attachment wrapper that was measured to " +
        "make a Slack message fold — so editing a `no-fold` message through it would republish it as the very " +
        "thing it exists not to be. Nothing was changed.",
      "post a new no-fold message with `slopweaver slack post --as bot --form -` and delete the old one with " +
        "`slopweaver slack delete`, or raise the no-fold edit path.",
    ]);
  });

  it("prints forwarded refusals one per line", () => {
    const error = SlackLifecycleErrors.upstreamRefused({ reasons: ["owner unresolved", "bare ref"] });

    expect(slackLifecycleErrorLines({ error })).toEqual(["owner unresolved", "bare ref"]);
  });

  it("prints a single refusal as its message alone", () => {
    expect(slackLifecycleErrorLines({ error: SlackLifecycleErrors.draftNotFound({ reason: "gone" }) })).toEqual([
      "gone — nothing was sent.",
    ]);
  });
});
