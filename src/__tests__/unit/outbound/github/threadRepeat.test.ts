import { describe, expect, it } from "vitest";

import { priorSelfReply } from "../../../../outbound/github/threadRepeat.js";
import type { ReviewThreadComment } from "../../../../outbound/github/threads.js";

const SELF = "octocat";

function comment({ author, at }: { author: string | undefined; at: string }): ReviewThreadComment {
  return { author, createdAt: `2026-09-28T${at}:00Z`, url: `https://github.com/o/r/pull/7#${at}` };
}

describe("priorSelfReply", () => {
  it("names this identity's reply when the reviewer has not spoken since — the repeated-reply shape", () => {
    const comments = [
      comment({ at: "03:00", author: "quinn" }),
      comment({ at: "05:31", author: SELF }),
      comment({ at: "08:06", author: SELF }),
    ];

    expect(priorSelfReply({ comments, viewer: SELF })).toEqual(comments[2]);
  });

  it("lets the reply go once the reviewer has answered this identity's last reply", () => {
    const comments = [
      comment({ at: "03:00", author: "quinn" }),
      comment({ at: "05:31", author: SELF }),
      comment({ at: "07:00", author: "quinn" }),
    ];

    expect(priorSelfReply({ comments, viewer: SELF })).toBeUndefined();
  });

  it("lets the first reply to a reviewer's thread go", () => {
    expect(priorSelfReply({ comments: [comment({ at: "03:00", author: "quinn" })], viewer: SELF })).toBeUndefined();
  });

  it("never counts this identity's own opening comment as a reply", () => {
    expect(priorSelfReply({ comments: [comment({ at: "03:00", author: SELF })], viewer: SELF })).toBeUndefined();
  });

  it("names the second self-comment on a thread this identity opened and nobody answered", () => {
    const comments = [comment({ at: "03:00", author: SELF }), comment({ at: "04:00", author: SELF })];

    expect(priorSelfReply({ comments, viewer: SELF })).toEqual(comments[1]);
  });

  it("counts a deleted account's comment as somebody else speaking", () => {
    const comments = [
      comment({ at: "03:00", author: "quinn" }),
      comment({ at: "05:31", author: SELF }),
      comment({ at: "06:00", author: undefined }),
    ];

    expect(priorSelfReply({ comments, viewer: SELF })).toBeUndefined();
  });

  it("compares logins case-insensitively, as GitHub does", () => {
    const comments = [comment({ at: "03:00", author: "quinn" }), comment({ at: "05:31", author: "OctoCat" })];

    expect(priorSelfReply({ comments, viewer: SELF })).toEqual(comments[1]);
  });

  it("finds nothing in an empty thread", () => {
    expect(priorSelfReply({ comments: [], viewer: SELF })).toBeUndefined();
  });
});
