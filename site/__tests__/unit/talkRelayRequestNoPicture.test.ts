/*
 * What `/api/talk/relay` accepts as the reason a relay carries no picture: each reason kept apart from the
 * others, so a native look macOS Screen Recording refused never arrives as a look that gave no frame. Split from
 * `talkRelayRequest.test.ts` by scenario.
 */
import { describe, expect, it } from "vitest";

import { parseTalkRelayRequest } from "../../lib/talkRelayRequest";

/** A full relay with every field valid, so the screen reason is the one field under test. */
const FULL = {
  about: "ask:queue-shows-raw-user-id",
  heard: "the queue shows a raw user id, show the name instead",
  readsAfter: [],
  say: "Show the name and channel on the queue row instead of the raw Slack id.",
  turnId: "a0000017-0000-4000-8000-000000000019",
};

const parse = (body: unknown): ReturnType<typeof parseTalkRelayRequest> =>
  parseTalkRelayRequest({ raw: JSON.stringify(body) });

describe("parseTalkRelayRequest — why there is no picture", () => {
  it("keeps a look that gave no frame apart from no share", () => {
    expect(parse({ ...FULL, screen: { kind: "none", reason: "capture-failed" } })).toMatchObject({
      relay: { screen: { kind: "none", reason: "capture-failed" } },
    });
  });

  it("keeps a share with no frame taken this turn apart from both", () => {
    expect(parse({ ...FULL, screen: { kind: "none", reason: "not-taken-this-turn" } })).toMatchObject({
      relay: { screen: { kind: "none", reason: "not-taken-this-turn" } },
    });
  });

  it("keeps a native look Screen Recording refused apart from a look that gave no frame", () => {
    expect(parse({ ...FULL, screen: { kind: "none", reason: "screen-recording-off" } })).toMatchObject({
      relay: { screen: { kind: "none", reason: "screen-recording-off" } },
    });
  });

  it("refuses a no-picture reason it does not know", () => {
    expect(parse({ ...FULL, screen: { kind: "none", reason: "stale" } })).toMatchObject({
      kind: "refused",
      why: "screen.reason must be one of screen-not-shared, capture-failed, screen-recording-off, not-taken-this-turn",
    });
  });
});
