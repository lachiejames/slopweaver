/**
 * The two PURE shapers behind the workspace-shape transport calls: how a partial `conversations.invite`
 * result is read, and where a canvas id is found on a create response. No I/O, no clock, no mocks.
 *
 * Both exist because the SDK types the response loosely and the interesting cases are the malformed ones —
 * which a live cassette cannot produce on demand, and which decide whether a partial invite reads as a
 * success or a failure.
 */
import { describe, expect, it } from "vitest";

import { canvasIdOf } from "../../../../corpus/slack/writeApiCanvas.js";
import { shapeInviteOutcome, shapeJoinedChannel } from "../../../../corpus/slack/writeApiConversations.js";

describe("shapeInviteOutcome", () => {
  it("counts everyone as landed when Slack returned no errors array at all", () => {
    expect(shapeInviteOutcome({ errors: undefined, userIds: ["U01", "U02"] })).toEqual({
      landed: 2,
      refused: [],
      requested: ["U01", "U02"],
      unattributed: [],
    });
  });

  it("keeps the count and reports the refused one with its code — one bad id does not sink the batch", () => {
    const outcome = shapeInviteOutcome({
      errors: [{ error: "user_not_found", ok: false, user: "U02" }],
      userIds: ["U01", "U02", "U03"],
    });

    expect(outcome.landed).toBe(2);
    expect(outcome.refused).toEqual([{ code: "user_not_found", userId: "U02" }]);
    expect(outcome.unattributed).toEqual([]);
  });

  it("counts `already_in_channel` as LANDED, because the desired end state already holds", () => {
    const outcome = shapeInviteOutcome({
      errors: [{ error: "already_in_channel", ok: false, user: "U01" }],
      userIds: ["U01"],
    });

    expect(outcome.landed).toBe(1);
    expect(outcome.refused).toEqual([]);
  });

  it("reports the MEASURED grid shape — an error with no `user` — as unattributed, never as a success", () => {
    // The exact body the live workspace returned for an id belonging to nobody. The first
    // version of this shaper dropped it and reported both ids as in the channel.
    const outcome = shapeInviteOutcome({
      errors: [{ error: "org_user_not_in_team", ok: false }],
      userIds: ["U01", "U0NOBODY"],
    });

    expect(outcome.unattributed).toEqual(["org_user_not_in_team"]);
    expect(outcome.landed).toBe(1);
    expect(outcome.refused).toEqual([]);
  });

  it("counts an unattributed `already_in_channel` as landed too, not as an unknown refusal", () => {
    const outcome = shapeInviteOutcome({ errors: [{ error: "already_in_channel" }], userIds: ["U01"] });

    expect(outcome.landed).toBe(1);
    expect(outcome.unattributed).toEqual([]);
  });

  it("names an entry carrying no error code `unknown` rather than counting it as landed", () => {
    const outcome = shapeInviteOutcome({ errors: [{ user: "U02" }], userIds: ["U01", "U02"] });

    expect(outcome.refused).toEqual([{ code: "unknown", userId: "U02" }]);
    expect(outcome.landed).toBe(1);
  });

  it("never reports a negative landed count, however many errors Slack returns", () => {
    const outcome = shapeInviteOutcome({
      errors: [{ error: "a" }, { error: "b" }, { error: "c" }],
      userIds: ["U01"],
    });

    expect(outcome.landed).toBe(0);
  });
});

describe("shapeJoinedChannel", () => {
  it("reads a fresh join as not already a member", () => {
    expect(
      shapeJoinedChannel({ channel: { id: "C0SYN000013", name: "ask-product-help" }, warning: undefined }),
    ).toEqual({ alreadyMember: false, id: "C0SYN000013", name: "ask-product-help" });
  });

  it("reads Slack's already_in_channel warning as already a member, among other warnings too", () => {
    expect(shapeJoinedChannel({ channel: { id: "C1" }, warning: "superfluous_charset,already_in_channel" })).toEqual({
      alreadyMember: true,
      id: "C1",
      name: undefined,
    });
  });

  it("answers undefined when the response names no channel id", () => {
    expect(shapeJoinedChannel({ channel: { name: "x" }, warning: undefined })).toBeUndefined();
  });
});

describe("canvasIdOf", () => {
  it("reads the top-level canvas_id `conversations.canvases.create` returns", () => {
    expect(canvasIdOf({ result: { canvas_id: "F01", ok: true } })).toBe("F01");
  });

  it("falls back to a nested canvas.id, the other shape Slack has used", () => {
    expect(canvasIdOf({ result: { canvas: { id: "F02" }, ok: true } })).toBe("F02");
  });

  it("prefers the top-level id when both are present, so one response cannot answer two ways", () => {
    expect(canvasIdOf({ result: { canvas: { id: "F02" }, canvas_id: "F01" } })).toBe("F01");
  });

  it("answers undefined for a response carrying neither, so the caller throws rather than inventing an id", () => {
    expect(canvasIdOf({ result: { ok: true } })).toBeUndefined();
    expect(canvasIdOf({ result: "not a record" })).toBeUndefined();
  });
});
