import { describe, expect, it } from "vitest";
import { confirmNewRef, type GithubEventRead } from "../../../devLint/floorBaseConfirmation.js";

const HEAD_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const ZERO_SHA = "0".repeat(40);

const ROOT_COMMIT = `tree ${"c".repeat(40)}\nauthor A <a@example.invalid> 1 +0000\ncommitter A <a@example.invalid> 1 +0000\n\nfirst\n`;
const CHILD_COMMIT = `tree ${"c".repeat(40)}\nparent ${OTHER_SHA}\nauthor A <a@example.invalid> 1 +0000\n\nsecond\n`;
const NO_EVENT: GithubEventRead = { kind: "missing", why: "no GitHub event is in the environment" };

/** A push event that created a ref at `after`, with any field overridden. */
function createdPush({
  name = "push",
  payload = {},
}: {
  name?: string;
  payload?: Record<string, unknown>;
}): GithubEventRead {
  return { kind: "read", name, payload: { after: HEAD_SHA, before: ZERO_SHA, created: true, ...payload } };
}

describe("confirmNewRef — arm 1, a root commit", () => {
  it("confirms a HEAD whose raw commit names no parent, with no GitHub event at all", () => {
    expect(confirmNewRef({ event: NO_EVENT, headCommit: ROOT_COMMIT, headSha: HEAD_SHA })).toEqual({
      evidence: "HEAD is a root commit",
      kind: "confirmed",
    });
  });

  it("reads only the header, so a message line starting `parent ` does not make a root commit a child", () => {
    const messageNamesParent = `${ROOT_COMMIT}\nparent ${OTHER_SHA}\n`;
    expect(confirmNewRef({ event: NO_EVENT, headCommit: messageNamesParent, headSha: HEAD_SHA })).toEqual({
      evidence: "HEAD is a root commit",
      kind: "confirmed",
    });
  });

  it("confirms a root commit even when the event file could not be read", () => {
    const unreadable: GithubEventRead = { kind: "missing", why: "the GitHub event file could not be read (ENOENT)" };
    expect(confirmNewRef({ event: unreadable, headCommit: ROOT_COMMIT, headSha: HEAD_SHA }).kind).toBe("confirmed");
  });
});

describe("confirmNewRef — the hole: zeroes exported by hand on a branch with history", () => {
  it("is unconfirmed, naming both gaps, when HEAD has a parent and there is no GitHub event", () => {
    expect(confirmNewRef({ event: NO_EVENT, headCommit: CHILD_COMMIT, headSha: HEAD_SHA })).toEqual({
      kind: "unconfirmed",
      why: "HEAD has a parent, and no GitHub event is in the environment",
    });
  });

  it("is unconfirmed, never confirmed by absence, when neither HEAD nor an event could be read", () => {
    expect(confirmNewRef({ event: NO_EVENT, headCommit: undefined, headSha: undefined })).toEqual({
      kind: "unconfirmed",
      why: "HEAD's commit object could not be read, and no GitHub event is in the environment",
    });
  });

  it("carries an unreadable event file's own reason forward", () => {
    const unreadable: GithubEventRead = { kind: "missing", why: "the GitHub event file could not be read (ENOENT)" };
    expect(confirmNewRef({ event: unreadable, headCommit: CHILD_COMMIT, headSha: HEAD_SHA })).toEqual({
      kind: "unconfirmed",
      why: "HEAD has a parent, and the GitHub event file could not be read (ENOENT)",
    });
  });
});

describe("confirmNewRef — arm 2, the push that created this ref", () => {
  it("confirms a HEAD with history when the push event created the ref at HEAD", () => {
    expect(confirmNewRef({ event: createdPush({}), headCommit: CHILD_COMMIT, headSha: HEAD_SHA })).toEqual({
      evidence: "the push event created this ref at HEAD",
      kind: "confirmed",
    });
  });

  it("confirms by the event when HEAD's commit object could not be read", () => {
    expect(confirmNewRef({ event: createdPush({}), headCommit: undefined, headSha: HEAD_SHA }).kind).toBe("confirmed");
  });

  it("matches `after` against HEAD whatever the letter case", () => {
    const upper = createdPush({ payload: { after: HEAD_SHA.toUpperCase() } });
    expect(confirmNewRef({ event: upper, headCommit: CHILD_COMMIT, headSha: HEAD_SHA }).kind).toBe("confirmed");
  });

  it("refuses an event that is not a push, even with every created-ref field present", () => {
    expect(
      confirmNewRef({ event: createdPush({ name: "pull_request" }), headCommit: CHILD_COMMIT, headSha: HEAD_SHA }),
    ).toEqual({
      kind: "unconfirmed",
      why: "HEAD has a parent, and the GitHub event is `pull_request`, not a push that created this ref",
    });
  });

  it.each([
    { field: "created false", payload: { created: false } },
    { field: "a real before", payload: { before: OTHER_SHA } },
    { field: "a short after", payload: { after: "abc1234" } },
    { field: "a non-hex after", payload: { after: "z".repeat(40) } },
  ])("refuses a push payload with $field", ({ payload }) => {
    expect(confirmNewRef({ event: createdPush({ payload }), headCommit: CHILD_COMMIT, headSha: HEAD_SHA })).toEqual({
      kind: "unconfirmed",
      why:
        "HEAD has a parent, and the push event does not record a created ref (`created: true`, `before` all " +
        "zeroes, `after` a full SHA)",
    });
  });

  it("refuses a push that created a different commit, naming both sides", () => {
    const elsewhere = createdPush({ payload: { after: OTHER_SHA } });
    expect(confirmNewRef({ event: elsewhere, headCommit: CHILD_COMMIT, headSha: HEAD_SHA })).toEqual({
      kind: "unconfirmed",
      why: `HEAD has a parent, and the push event created ${OTHER_SHA}, not HEAD ${HEAD_SHA}`,
    });
  });

  it("refuses a matching push when HEAD's SHA could not be read to match it", () => {
    expect(confirmNewRef({ event: createdPush({}), headCommit: CHILD_COMMIT, headSha: undefined })).toEqual({
      kind: "unconfirmed",
      why: "HEAD has a parent, and HEAD's SHA could not be read to match the push event's `after`",
    });
  });
});
