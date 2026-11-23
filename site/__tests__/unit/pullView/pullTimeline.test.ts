/*
 * The pull-request view's conversation, in GitHub's order.
 */

import { describe, expect, it } from "vitest";

import { pullTimeline } from "../../../lib/pullView";
import { VIEW } from "./harness";

describe("pullTimeline", () => {
  it("orders the conversation by time and leaves out the bare envelope of an inline batch", () => {
    expect(pullTimeline({ view: VIEW }).map((item) => `${item.kind}@${item.at}`)).toEqual([
      "comment@2026-09-29T01:00:00Z",
      "thread@2026-09-29T02:00:00Z",
      "review@2026-09-29T03:00:00Z",
      "review@2026-09-29T04:00:00Z",
    ]);
  });
});
