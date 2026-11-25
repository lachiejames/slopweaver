/*
 * The chair gate's two hosts, judged side by side, so the app arm is provably an ADDED arm: each case reads the
 * same chair once as a cmux workspace and once as an app session and asserts both verdicts exactly. A change to how
 * a cmux chair is judged fails the cmux half here as well as the cases in `./chairGate.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { type ChairRead, chairSessionName, judgeChair } from "../../../supervisor/chairGate.js";
import { FABLE_CHAIR_REQUIREMENT } from "../../../supervisor/chairPolicy.js";
import { CMUX_SILENT, FABLE_CALLER, FABLE_ONLY, OPUS_ONLY } from "./chairGateFixtures.js";

const APP_ID = "a0000107-0000-4000-8000-0000000000a1";

/**
 * The same chair read, moved to an app session: the location is the app's and no session carries a pid.
 *
 * @param read the cmux-hosted read to move
 * @returns that read as the desktop app would host it
 */
function asAppHosted({ read }: { read: Extract<ChairRead, { kind: "resolved" }> }): ChairRead {
  return {
    ...read,
    location: { appSessionId: APP_ID, kind: "app" },
    sessions: read.sessions.map((reading) => ({ ...reading, pid: undefined })),
  };
}

describe("judgeChair — a cmux chair and an app chair", () => {
  it("opens the caller-only pass when cmux did not answer, and never when the app did not", () => {
    const appSilent: ChairRead = { cause: "app-chair-unread", kind: "unresolved", why: "the app is not serving" };

    const verdicts = [CMUX_SILENT, appSilent].map((read) =>
      judgeChair({ caller: FABLE_CALLER, read, requirement: FABLE_CHAIR_REQUIREMENT }),
    );

    expect(verdicts).toStrictEqual([
      {
        kind: "caller-only",
        note:
          "chair gate: cmux did not answer (cmux workspaces could not be listed (window.list did not answer within " +
          "15000ms)), so only this session was judged — session a0000014-0000-4000-8000-000000000015: on " +
          "claude-fable-5-1 as of 2026-09-15T21:04:22.000Z. Any other tab in the pinned workspace went unseen this tick.",
      },
      { detail: "the chair could not be read: the app is not serving", kind: "refused", lines: [] },
    ]);
  });

  it("refuses an off-Fable chair on either host alike, naming a cmux session by pid and an app one as app-hosted", () => {
    const verdicts = [OPUS_ONLY, asAppHosted({ read: OPUS_ONLY })].map((read) =>
      judgeChair({ read, requirement: FABLE_CHAIR_REQUIREMENT }),
    );
    const clause =
      "OFF FABLE — on claude-opus-4-8 as of 2026-09-15T20:58:32.701Z; a safeguard fallback switched it from " +
      "claude-fable-5-1 to claude-opus-4-8 at 2026-09-15T19:23:30.360Z (category cyber)";

    expect(verdicts).toStrictEqual([
      {
        detail: "1 of 1 session(s) in the pinned workspace are off Fable, 0 unread",
        kind: "refused",
        lines: [`  session a0000023-0000-4000-8000-000000000026 (pid 111): ${clause}`],
      },
      {
        detail: "1 of 1 session(s) in the pinned workspace are off Fable, 0 unread",
        kind: "refused",
        lines: [`  session a0000023-0000-4000-8000-000000000026 (app-hosted): ${clause}`],
      },
    ]);
  });

  it("passes an on-Fable chair on either host", () => {
    const verdicts = [FABLE_ONLY, asAppHosted({ read: FABLE_ONLY })].map((read) =>
      judgeChair({ read, requirement: FABLE_CHAIR_REQUIREMENT }),
    );

    expect(verdicts).toStrictEqual([{ kind: "clean" }, { kind: "clean" }]);
  });
});

describe("chairSessionName", () => {
  it("names a cmux session by its pid and an app session as app-hosted, never with a made-up pid", () => {
    expect([
      chairSessionName({ pid: 111, sessionId: "s1" }),
      chairSessionName({ pid: undefined, sessionId: "s1" }),
    ]).toEqual(["session s1 (pid 111)", "session s1 (app-hosted)"]);
  });
});
