/*
 * Which act a spawn calls when its slug holds an open app session, and how the recorded launch of that session is read
 * from the app before the Codex seat is routed.
 *
 * The headline case is the one main got wrong: a run journal holding only a `dispatched` line reads phase `closed`,
 * so the journal alone picks `open` — and the app then opened a NEW card beside the session the ledger still held
 * open. The row now selects `resume`, while the pickup line stays the journal's `handover start`.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";
import { launchOperationForRun, resolveSpawnPickupCommand } from "../../../cmux/pickupCommand.js";
import type { RunEvent } from "../../../handover/ledger.js";
import {
  continuingSessionOf,
  inspectRecordedLaunch,
  launchActForSpawn,
} from "../../../sessionHarness/appContinuation.js";
import type { AppHarnessRequest, AppHarnessResponse, AppLaunchSpec } from "../../../sessionHarness/appProtocol.js";
import type { AppTransport, AppTransportFailure } from "../../../sessionHarness/appSocketTransport.js";
import { WAIT_RULE_INSTRUCTION } from "../../../transcripts/spawnPickupLine.js";

/** A journal a spawn dispatched into and whose `handover start` never ran. */
const DISPATCH_ONLY: readonly RunEvent[] = [
  { atIso: "2026-11-20T03:14:00.000Z", by: "cmux spawn", kind: "dispatched", target: "workspace:9" },
];

const RECORDED: AppLaunchSpec = {
  codexHome: "/home/acme/.codex-two",
  directory: "/work/tree-7",
  judgedInstanceId: "instance-a",
  ledgerKey: "a-doc",
  title: "a-doc",
  vendor: "codex",
};

/** A transport answering every request with one scripted result, recording what it was asked. */
function answering({ answer }: { answer: Result<AppHarnessResponse, AppTransportFailure> }): {
  transport: AppTransport;
  asked: AppHarnessRequest[];
} {
  const asked: AppHarnessRequest[] = [];
  const transport: AppTransport = async ({ request }) => {
    asked.push(request);
    return answer;
  };
  return { asked, transport };
}

describe("launchActForSpawn", () => {
  it("resumes the open app session over a dispatch-only journal, while the pickup line still says handover start", () => {
    const journalOperation = launchOperationForRun({ runEvents: DISPATCH_ONLY });
    expect(journalOperation).toBe("open");
    expect(launchActForSpawn({ continuingSessionId: "0b5e", harness: "app", journalOperation })).toBe("resume");
    expect(resolveSpawnPickupCommand({ docPath: "/docs/a-doc.md", runEvents: DISPATCH_ONLY, slug: "a-doc" })).toBe(
      "Read /docs/a-doc.md end to end, then run: slopweaver handover start a-doc, then execute the doc. It is complete; " +
        `do not re-plan or ask what it covers. ${WAIT_RULE_INSTRUCTION}`,
    );
  });

  it("opens a new session when the slug holds no open app row", () => {
    const journalOperation = launchOperationForRun({ runEvents: DISPATCH_ONLY });
    expect(launchActForSpawn({ continuingSessionId: undefined, harness: "app", journalOperation })).toBe("open");
  });

  it("keeps the journal's act on a cmux spawn even when an app session id is handed to it", () => {
    expect(launchActForSpawn({ continuingSessionId: "0b5e", harness: "cmux", journalOperation: "open" })).toBe("open");
  });

  it("keeps a journal resume on an app spawn with no row", () => {
    expect(launchActForSpawn({ continuingSessionId: undefined, harness: "app", journalOperation: "resume" })).toBe(
      "resume",
    );
  });
});

describe("continuingSessionOf", () => {
  it("names the session a resume plan continues", () => {
    expect(continuingSessionOf({ continuation: { kind: "resume", sessionId: "0b5e" } })).toBe("0b5e");
  });

  it("names none for a fresh plan, whose previous session is not continued", () => {
    const continuation = {
      kind: "fresh",
      previousCodexHome: "/home/acme/.codex-two",
      previousSessionId: "0b5e",
      reason: "codex-two is paused: owner hold",
    } as const;
    expect(continuingSessionOf({ continuation })).toBe(undefined);
  });

  it("names none when nothing continues", () => {
    expect(continuingSessionOf({ continuation: { kind: "none" } })).toBe(undefined);
  });
});

describe("inspectRecordedLaunch", () => {
  it("asks launch.inspect for the exact session and returns the recorded spec with its CODEX_HOME", async () => {
    const answer: AppHarnessResponse = { kind: "launch-spec", sessionId: "0b5e", spec: RECORDED };
    const { asked, transport } = answering({ answer: ok(answer) });
    const read = await inspectRecordedLaunch({ sessionId: "0b5e", transport });
    expect(asked).toEqual([{ kind: "launch.inspect", sessionId: "0b5e" }]);
    expect(unwrap(read)).toEqual(RECORDED);
  });

  it("fails, never opening fresh, when the app refuses the inspection", async () => {
    const { transport } = answering({
      answer: err({ code: "SESSION_NOT_FOUND", kind: "refused", message: "no session 0b5e that came up" }),
    });
    const failure = unwrapErr(await inspectRecordedLaunch({ sessionId: "0b5e", transport }));
    expect(failure.code).toBe("SESSION_LAUNCH_FAILED");
    expect(failure.message).toBe(
      "app harness: could not read the launch app session 0b5e was opened with, so it is not resumed — no session 0b5e that came up",
    );
  });

  it("fails when the app answers with another kind", async () => {
    const answer: AppHarnessResponse = { kind: "aborted" };
    const { transport } = answering({ answer: ok(answer) });
    const failure = unwrapErr(await inspectRecordedLaunch({ sessionId: "0b5e", transport }));
    expect(failure.message).toBe(
      "app harness: could not read the launch app session 0b5e was opened with, so it is not resumed — the app answered launch.inspect with aborted",
    );
  });

  it("fails when the app answers for another session", async () => {
    const answer: AppHarnessResponse = { kind: "launch-spec", sessionId: "9f00", spec: RECORDED };
    const { transport } = answering({ answer: ok(answer) });
    const failure = unwrapErr(await inspectRecordedLaunch({ sessionId: "0b5e", transport }));
    expect(failure.message).toBe(
      "app harness: could not read the launch app session 0b5e was opened with, so it is not resumed — the app answered launch.inspect with session 9f00",
    );
  });
});
