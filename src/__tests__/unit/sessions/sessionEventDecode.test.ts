/**
 * One ledger line decoded field by field (`src/sessions/sessionEventDecode.ts`): an absent optional field decodes to
 * nothing, a malformed one makes the line unreadable, and a `resumed` line must name the session it continued.
 */
import { describe, expect, it } from "vitest";

import { sessionEventOf } from "../../../sessions/sessionEventDecode.js";

const SPAWNED = {
  branch: "a-doc",
  cwd: "/tmp/wt-1",
  kind: "spawned",
  sessionKey: "a-doc",
  surfaceRef: "surface:1",
  tsIso: "t1",
  workspaceRef: "workspace:1",
};

describe("sessionEventOf", () => {
  it("decodes a resumed line naming its session, and refuses one naming none", () => {
    const named = { kind: "resumed", sessionId: "id-1", sessionKey: "a-doc", tsIso: "t2" };
    expect([
      sessionEventOf({ parsed: named }),
      sessionEventOf({ parsed: { ...named, sessionId: "" } }),
      sessionEventOf({ parsed: { ...named, sessionId: 7 } }),
    ]).toEqual([named, undefined, undefined]);
  });

  it("reads a malformed boot model as unrecorded, but a malformed harness field as an unreadable line", () => {
    expect([
      sessionEventOf({ parsed: { ...SPAWNED, bootModel: { kind: "pinned" } } }),
      sessionEventOf({ parsed: { ...SPAWNED, openedBy: "reopen" } }),
    ]).toEqual([SPAWNED, undefined]);
  });

  it("refuses a line of no known kind, or missing its key", () => {
    expect([
      sessionEventOf({ parsed: { kind: "renamed", sessionKey: "a-doc", tsIso: "t1" } }),
      sessionEventOf({ parsed: { kind: "noted", note: "x", tsIso: "t1" } }),
    ]).toEqual([undefined, undefined]);
  });
});
