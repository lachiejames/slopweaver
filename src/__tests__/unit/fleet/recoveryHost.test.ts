/**
 * The desktop app as a Recovery pass reaches it, over a scripted transport and a real session ledger in a temp home:
 * the launch spec a throwaway session carries, the raw list with ended sessions kept, a close that ends the ledger row
 * whether the app closed the session or no longer had it, and the open rows an earlier pass left.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appRecoveryHost, recoveryLaunchDeps, recoveryLaunchSpec } from "../../../fleet/recoveryHost.js";
import type { RecoveryHost } from "../../../fleet/recoveryPassDeps.js";
import { recoveryScratchRoot } from "../../../fleet/recoveryScratch.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import type { AppHarnessResponse, AppSessionSnapshot } from "../../../sessionHarness/appProtocol.js";
import type { AppTransportFailure } from "../../../sessionHarness/appSocketTransport.js";
import { sessionLedgerDeps } from "../../../sessionHarness/sessionLedger.js";
import type { SessionEvent } from "../../../sessions/session.js";
import { memoryClaudePlanProbesPort } from "../../claudePlanProbesFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "recovery-host-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One answer the scripted app gives every request. */
type Answer = Result<AppHarnessResponse, AppTransportFailure>;

/** A Recovery session's `spawned` row, as the recording launcher writes one, running in `cwd`. */
function recoverySpawned({ cwd, sessionId }: { cwd: string; sessionId: string }): SessionEvent {
  const sessionKey = `fleet-recovery:old:claude:claude-1:${sessionId}`;
  return {
    bootModel: { kind: "pinned", model: "sonnet" },
    branch: "fleet-recovery",
    cwd,
    harness: "app",
    kind: "spawned",
    openedBy: "open",
    sessionId,
    sessionKey,
    slug: sessionKey,
    surfaceRef: `app:${sessionId}`,
    tsIso: "2026-11-25T09:00:00.000Z",
    workspaceId: sessionId,
    workspaceRef: `app:${sessionId}`,
  };
}

/** The host over an app that gives every request `answer`, recording each request kind it was sent. */
function hostAnswering({ answer, asked }: { answer: Answer; asked: string[] }): RecoveryHost {
  const root = recoveryScratchRoot({ home });
  return appRecoveryHost({
    deps: {
      holds: ({ directory }) => directory.startsWith(`${root}/`),
      home,
      launch: recoveryLaunchDeps({
        home,
        inherited: {},
        pluginDir: "/plugin",
        port: memoryPlanRegisterPort(),
        probesPort: memoryClaudePlanProbesPort(),
      }),
      ledger: sessionLedgerDeps({ home }),
      repoRoot: "/repo",
      transport: async ({ request }) => {
        asked.push(request.kind);
        return answer;
      },
    },
  });
}

const SNAPSHOT: AppSessionSnapshot = {
  directory: "/scratch/run-1/fleet-recovery",
  handle: "app:s-1",
  ledgerKey: "fleet-recovery:run:codex:codex-1",
  openedAtIso: "2026-11-25T10:00:00.000Z",
  sessionId: "s-1",
  state: "closed",
  title: "Recovery check: codex on codex-1",
  vendor: "codex",
};

describe("recoveryLaunchSpec", () => {
  it("opens a Claude check on the plan's own store and the cheaper model, as a research session", () => {
    const spec = recoveryLaunchSpec({
      candidate: { alias: "claude-1", storeDir: "/stores/one", vendor: "claude" },
      directory: "/scratch/run-1/fleet-recovery",
      ledgerKey: "fleet-recovery:run:claude:claude-1",
      openedAtIso: "2026-11-25T10:00:00.000Z",
      prompt: "the prompt",
      repoRoot: "/repo",
    });
    expect(spec).toEqual({
      baseBranch: undefined,
      branch: "fleet-recovery",
      credentialStoreDir: "/stores/one",
      directory: "/scratch/run-1/fleet-recovery",
      directoryExists: true,
      host: "claude-code",
      initialMessage: "the prompt",
      launchKey: "fleet-recovery:run:claude:claude-1",
      ledgerKey: "fleet-recovery:run:claude:claude-1",
      model: "sonnet",
      openedAtIso: "2026-11-25T10:00:00.000Z",
      registeredName: undefined,
      repoRoot: "/repo",
      respondingToHandle: undefined,
      role: "session",
      template: "research",
      title: "Recovery check: claude on claude-1",
    });
  });

  it("opens a Codex check on the plan's own home and its saved model", () => {
    const spec = recoveryLaunchSpec({
      candidate: { alias: "codex-1", codexHome: "/codex/one", vendor: "codex" },
      directory: "/scratch/run-2/fleet-recovery",
      ledgerKey: "fleet-recovery:run:codex:codex-1",
      openedAtIso: "2026-11-25T10:00:00.000Z",
      prompt: "the prompt",
      repoRoot: "/repo",
    });
    expect([spec.host, spec.codexHome, spec.model, spec.credentialStoreDir, spec.title]).toEqual([
      "codex",
      "/codex/one",
      undefined,
      undefined,
      "Recovery check: codex on codex-1",
    ]);
  });
});

describe("appRecoveryHost list", () => {
  it("answers every session the app holds, an ended one included", async () => {
    const asked: string[] = [];
    const host = hostAnswering({ answer: ok({ kind: "sessions", sessions: [SNAPSHOT] }), asked });
    expect(unwrap(await host.list())).toEqual([SNAPSHOT]);
    expect(asked).toEqual(["list"]);
  });

  it("names a reply of another kind rather than reading it as no sessions", async () => {
    const host = hostAnswering({ answer: ok({ kind: "aborted" }), asked: [] });
    expect(unwrapErr(await host.list())).toBe(
      "the desktop app answered list with aborted, so what it holds was not read",
    );
  });

  it("carries the transport's own reason when the app cannot be reached", async () => {
    const answer: Answer = err({ causeCode: "ENOENT", kind: "unreachable", message: "the desktop app is not running" });
    const host = hostAnswering({ answer, asked: [] });
    expect(unwrapErr(await host.list())).toBe("the desktop app is not running");
  });
});

describe("appRecoveryHost close and leftOpen", () => {
  it("lists an open Recovery row inside this home's scratch, and not one outside it", () => {
    const ledger = sessionLedgerDeps({ home });
    const inside = `${recoveryScratchRoot({ home })}/old-1/fleet-recovery`;
    ledger.append({ event: recoverySpawned({ cwd: inside, sessionId: "s-in" }) });
    ledger.append({ event: recoverySpawned({ cwd: "/another-home/fleet-recovery", sessionId: "s-out" }) });
    const host = hostAnswering({ answer: ok({ kind: "aborted" }), asked: [] });
    expect(unwrap(host.leftOpen())).toEqual([{ handle: "app:s-in", sessionId: "s-in" }]);
  });

  it("ends the row of a session the app closed", async () => {
    const ledger = sessionLedgerDeps({ home });
    const inside = `${recoveryScratchRoot({ home })}/old-1/fleet-recovery`;
    ledger.append({ event: recoverySpawned({ cwd: inside, sessionId: "s-1" }) });
    const asked: string[] = [];
    const host = hostAnswering({ answer: ok({ forced: true, kind: "closed", session: SNAPSHOT }), asked });
    expect((await host.close({ session: { handle: "app:s-1", sessionId: "s-1" } })).isOk()).toBe(true);
    expect(asked).toEqual(["close"]);
    expect(unwrap(host.leftOpen())).toEqual([]);
  });

  it("ends the row of a session the app no longer has, and counts it closed", async () => {
    const ledger = sessionLedgerDeps({ home });
    const inside = `${recoveryScratchRoot({ home })}/old-1/fleet-recovery`;
    ledger.append({ event: recoverySpawned({ cwd: inside, sessionId: "s-1" }) });
    const answer: Answer = err({ code: "SESSION_NOT_FOUND", kind: "refused", message: "no app session s-1" });
    const host = hostAnswering({ answer, asked: [] });
    expect((await host.close({ session: { handle: "app:s-1", sessionId: "s-1" } })).isOk()).toBe(true);
    expect(unwrap(host.leftOpen())).toEqual([]);
  });

  it("does not count a session closed when the app refused the close for another reason", async () => {
    const answer: Answer = err({ code: "OPERATION_FAILED", kind: "refused", message: "the card would not close" });
    const host = hostAnswering({ answer, asked: [] });
    expect(unwrapErr(await host.close({ session: { handle: "app:s-1", sessionId: "s-1" } }))).toContain(
      "the card would not close",
    );
  });
});
