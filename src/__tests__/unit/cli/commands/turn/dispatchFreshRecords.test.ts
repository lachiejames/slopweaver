/**
 * What the `fresh-visible-session` tier records — `cli/commands/turn/dispatchFreshRecords.ts`.
 *
 * The two properties here are the ones a LATER reader depends on, days after the dispatch call returned:
 * that a pickup which went unwitnessed is written as a state the sweep keeps tracking rather than as a
 * failure that ends the dispatch, and that an unjudgeable cmux socket is never allowed to read as a phantom.
 * Both are recorded defects rather than hypotheticals — the module's own header carries their dates.
 *
 * The liveness seam is a plain function passed in, never a mock; the lifecycle writes go to a `mkdtempSync`
 * home and are read back off disk, which is the round-trip the real verbs do.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { phantomReasonFor, recordDispatchUnwitnessed } from "../../../../../cli/commands/turn/dispatchFreshRecords.js";
import type { WorkspaceLiveness } from "../../../../../cmux/liveness.js";
import type { AskIdentity } from "../../../../../live/ask/identity.js";
import { ensureCapturedAskLifecycle } from "../../../../../live/ask/store.js";
import type { FreshVisibleSessionRef } from "../../../../../live/turn/tier.js";

const ASK: AskIdentity = { channel: "C0SYN000006", messageTs: "1789952379.135579", threadTs: "1789775392.910229" };

const SESSION: FreshVisibleSessionRef = {
  cwd: "/tmp/checkout",
  host: "claude-code",
  surfaceId: "id-surface:161",
  surfaceRef: "surface:161",
  workspaceId: "id-workspace:152",
  workspaceRef: "workspace:152",
};

/** A liveness check that answers the same verdict for whatever workspace it is handed. */
function answering({
  liveness,
}: {
  liveness: WorkspaceLiveness;
}): (options: { workspaceId: string }) => Promise<WorkspaceLiveness> {
  return () => Promise.resolve(liveness);
}

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home carrying this ask's `captured` row, which is what the fold keys every read off. */
function capturedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slop-fresh-records-"));
  homes.push(home);
  ensureCapturedAskLifecycle({ askIdentity: ASK, home, surface: "channel", userId: "U0OWNER" });
  return home;
}

describe("phantomReasonFor", () => {
  it("answers the phantom's own reason when cmux says the workspace is empty", async () => {
    const reason = await phantomReasonFor({
      checkLiveness: answering({
        liveness: {
          kind: "phantom",
          reason: "workspace id-workspace:152 has no process tree",
          why: "host-exited",
          workspaceId: SESSION.workspaceId,
        },
      }),
      session: SESSION,
    });

    expect(reason).toBe("workspace id-workspace:152 has no process tree");
  });

  it("answers undefined for a live workspace", async () => {
    const reason = await phantomReasonFor({
      checkLiveness: answering({
        liveness: { kind: "alive", pid: 90882, process: "claude", workspaceId: SESSION.workspaceId },
      }),
      session: SESSION,
    });

    expect(reason).toBe(undefined);
  });

  it("answers undefined for UNKNOWN too — a broken oracle never condemns a dispatch", async () => {
    const reason = await phantomReasonFor({
      checkLiveness: answering({
        liveness: { kind: "unknown", reason: "cmux socket did not answer", workspaceId: SESSION.workspaceId },
      }),
      session: SESSION,
    });

    expect(reason).toBe(undefined);
  });
});

describe("recordDispatchUnwitnessed", () => {
  it("writes a NON-terminal row naming the workspace, and saying the line was not re-sent", () => {
    const home = capturedHome();

    recordDispatchUnwitnessed({ askIdentity: ASK, home, session: SESSION });

    const rows = readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { kind: string; reason?: string });
    expect(rows.map((row) => row.kind)).toEqual(["captured", "dispatch-unwitnessed"]);
    expect(rows[1]!.reason).toBe(
      "the pickup command was sent into workspace workspace:152 and nothing witnessed it arriving — it was " +
        "NOT re-sent, and the worker is treated as running until a sweep proves otherwise",
    );
  });
});
