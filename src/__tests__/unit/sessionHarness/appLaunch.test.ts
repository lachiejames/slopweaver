/*
 * The app harness's launch in three acts over a scripted transport: prepare, resolve the initial message, deliver —
 * or abort when the resolve fails — and what each failure leaves the caller knowing.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";
import { type AppLaunchDeps, appSessionLauncherOver } from "../../../sessionHarness/appLaunch.js";
import type { AppHarnessRequest, AppHarnessResponse, AppSessionSnapshot } from "../../../sessionHarness/appProtocol.js";
import type { AppTransport } from "../../../sessionHarness/appSocketTransport.js";
import type { HarnessLaunchSpec } from "../../../sessionHarness/launch.js";
import { SPEC } from "./recordingLedgerFixtures.js";

const CODEX_SPEC: HarnessLaunchSpec = { ...SPEC, codexHome: "/home/codex-plan-1", host: "codex", model: "gpt-5" };

const SNAPSHOT: AppSessionSnapshot = {
  directory: "/work/tree-7",
  handle: "app:0b5e",
  ledgerKey: "a-doc",
  openedAtIso: "2026-11-09T01:00:00.000Z",
  sessionId: "0b5e",
  state: "idle",
  title: "a-doc",
  vendor: "codex",
};

/** The app's answer to a ping, naming the Codex binary its sessions run. */
const PONG: AppHarnessResponse = {
  appPid: 4242,
  codexPath: "/Applications/Slopweaver.app/codex",
  instanceId: "instance-a",
  kind: "pong",
  startedAtIso: "2026-11-09T00:00:00.000Z",
};

/**
 * A transport answering each request kind from a table, recording the order it was asked in. A ping is answered with
 * {@link PONG} unless the table answers it.
 */
function scripted({ answers }: { answers: Partial<Record<AppHarnessRequest["kind"], AppHarnessResponse>> }): {
  transport: AppTransport;
  asked: AppHarnessRequest[];
} {
  const asked: AppHarnessRequest[] = [];
  const table: Partial<Record<AppHarnessRequest["kind"], AppHarnessResponse>> = { ping: PONG, ...answers };
  const transport: AppTransport = async ({ request }) => {
    asked.push(request);
    const answer = table[request.kind];
    if (answer === undefined) {
      return err({ code: "OPERATION_FAILED", kind: "refused", message: `no answer scripted for ${request.kind}` });
    }
    return ok(answer);
  };
  return { asked, transport };
}

const PREPARED: AppHarnessResponse = { kind: "prepared", launchToken: "token-1", session: SNAPSHOT };
const DELIVERED: AppHarnessResponse = { kind: "delivered", session: { ...SNAPSHOT, state: "running" } };
const NO_WORKTREE: AppLaunchDeps = {
  codexBrowserDoorAt: () => () => ok(undefined),
  ensureWorktree: (): never => {
    throw new Error("the worktree exists");
  },
  gateClaudeCredential: async ({ plan }) => ok({ ...plan, credentialStoreDir: "/home/claude-plan-2" }),
  resolvePluginDir: () => undefined,
};

/** Spawn effects that record the order they ran in, and the binary the door judged, beside the transport's requests. */
function loggedDeps({
  log,
  refusal,
  credentialRefusal,
}: {
  log: string[];
  refusal?: string;
  credentialRefusal?: string;
}): AppLaunchDeps {
  return {
    codexBrowserDoorAt:
      ({ codexPath }) =>
      ({ plan }) => {
        log.push(`browser ${plan.host} ${plan.cwd} through ${codexPath}`);
        return refusal === undefined ? ok(undefined) : err(refusal);
      },
    ensureWorktree: ({ plan }) => {
      log.push(`worktree ${plan.cwd}`);
    },
    gateClaudeCredential: async ({ plan }) => {
      log.push(`credential ${plan.cwd}`);
      if (credentialRefusal !== undefined) {
        return err(credentialRefusal);
      }
      return ok({ ...plan, credentialStoreDir: "/home/claude-plan-2" });
    },
    resolvePluginDir: ({ plan }) => {
      log.push(`plugin ${plan.credentialStoreDir === undefined ? "ungated" : "gated"}`);
      return "/work/repo";
    },
  };
}

describe("appSessionLauncherOver", () => {
  it("prepares, resolves the pickup line, then delivers it", async () => {
    const { asked, transport } = scripted({ answers: { "launch.deliver": DELIVERED, "launch.prepare": PREPARED } });
    const opened = unwrap(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({
        resolveInitialMessage: () => ok({ operation: "open", text: "slopweaver handover start a-doc" }),
        spec: CODEX_SPEC,
      }),
    );
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.prepare", "launch.deliver"]);
    expect(asked[1]).toEqual({
      kind: "launch.prepare",
      spec: {
        codexHome: "/home/codex-plan-1",
        directory: "/work/tree-7",
        judgedInstanceId: "instance-a",
        ledgerKey: "a-doc",
        model: CODEX_MODEL,
        title: "a-doc",
        vendor: "codex",
      },
    });
    expect(asked[2]).toEqual({
      kind: "launch.deliver",
      launchToken: "token-1",
      text: "slopweaver handover start a-doc",
    });
    expect(opened.handle).toBe("app:0b5e");
    expect(opened.initialMessage).toBe("slopweaver handover start a-doc");
  });

  it("aborts the prepared session when the pickup line cannot be resolved", async () => {
    const { asked, transport } = scripted({
      answers: { "launch.abort": { kind: "aborted" }, "launch.prepare": PREPARED },
    });
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({
        resolveInitialMessage: () => err("the run journal is unreadable"),
        spec: CODEX_SPEC,
      }),
    );
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.prepare", "launch.abort"]);
    expect(failed.message).toBe(
      "app harness: the initial message could not be resolved, so the session was closed: the run journal is unreadable",
    );
  });

  it("never claims the session closed when its abort did not reach the app", async () => {
    const { asked, transport } = scripted({ answers: { "launch.prepare": PREPARED } });
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({
        resolveInitialMessage: () => err("the run journal is unreadable"),
        spec: CODEX_SPEC,
      }),
    );
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.prepare", "launch.abort"]);
    expect(failed.message).toBe(
      "app harness: the initial message could not be resolved, and the abort did not reach the app (no answer scripted for launch.abort), so the app ends the session at its unsettled-launch deadline: the run journal is unreadable",
    );
  });

  it("names the open session when its delivery went unconfirmed, so no caller launches beside it", async () => {
    const { transport } = scripted({ answers: { "launch.prepare": PREPARED } });
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({ spec: CODEX_SPEC }),
    );
    expect(failed.initialMessageUnproven).toBe(true);
    expect(failed.opened).toEqual({ endpointHandle: "app:0b5e", handle: "app:0b5e", sessionId: "0b5e" });
  });

  it("names no open session when the app says it ended before its message, so no row is left open", async () => {
    const transport: AppTransport = async ({ request }) => {
      if (request.kind === "ping") {
        return ok(PONG);
      }
      if (request.kind === "launch.prepare") {
        return ok(PREPARED);
      }
      return err({ code: "SESSION_NOT_FOUND", kind: "refused", message: "no launch is waiting on that token" });
    };
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({ spec: CODEX_SPEC }),
    );
    expect(failed).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: the session ended before its initial message: no launch is waiting on that token",
      operation: "open",
    });
  });

  it("names the app's own refusal when prepare is refused", async () => {
    const { asked, transport } = scripted({ answers: {} });
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({ spec: CODEX_SPEC }),
    );
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.prepare"]);
    expect(failed).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: no answer scripted for launch.prepare",
      operation: "open",
    });
  });

  it("sends an explicit state home on the prepare, and names an old app's BAD_REQUEST as predating it", async () => {
    const asked: AppHarnessRequest[] = [];
    const transport: AppTransport = async ({ request }) => {
      asked.push(request);
      if (request.kind === "ping") {
        return ok(PONG);
      }
      return err({ code: "BAD_REQUEST", kind: "refused", message: "the request is not one this app reads" });
    };
    const launcher = appSessionLauncherOver({
      deps: NO_WORKTREE,
      ledgerHome: "/scratch/home",
      stateHome: "/scratch/home",
      transport,
    });
    const failed = unwrapErr(await launcher.open({ spec: CODEX_SPEC }));
    expect(asked[1]).toMatchObject({ kind: "launch.prepare", spec: { stateHome: "/scratch/home" } });
    expect(failed.message).toBe(
      "app harness: the request is not one this app reads — this launch carries stateHome (cmux spawn --home), so the " +
        "installed app most likely predates stateHome: install the current desktop app before a confined seat can open on it",
    );
  });

  it("leaves a BAD_REQUEST on an unconfined launch as the app said it", async () => {
    const transport: AppTransport = async ({ request }) => {
      if (request.kind === "ping") {
        return ok(PONG);
      }
      return err({ code: "BAD_REQUEST", kind: "refused", message: "the request is not one this app reads" });
    };
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({ spec: CODEX_SPEC }),
    );
    expect(failed.message).toBe("app harness: the request is not one this app reads");
  });

  it("says the prepare went unanswered when the app never answered it, so a card may still open", async () => {
    const transport: AppTransport = async ({ request }) => {
      if (request.kind === "ping") {
        return ok(PONG);
      }
      return err({
        causeCode: "TIMEOUT",
        kind: "unreachable",
        message: "the desktop app did not answer launch.prepare within 180s",
      });
    };
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({ spec: CODEX_SPEC }),
    );
    expect(failed).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: the desktop app did not answer launch.prepare within 180s",
      operation: "open",
      prepareUnanswered: true,
    });
  });

  it("refuses a prepare the app answered with another kind", async () => {
    const { transport } = scripted({ answers: { "launch.prepare": { kind: "aborted" } } });
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).resume({
        spec: CODEX_SPEC,
      }),
    );
    expect(failed).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: the app answered launch.prepare with aborted",
      operation: "resume",
    });
  });

  it("resumes through the same three acts, delivering the spec's own message with no resolver", async () => {
    const { asked, transport } = scripted({ answers: { "launch.deliver": DELIVERED, "launch.prepare": PREPARED } });
    const resumed = unwrap(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).resume({
        spec: { ...CODEX_SPEC, initialMessage: "carry on" },
      }),
    );
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.prepare", "launch.deliver"]);
    expect(resumed.initialMessage).toBe("carry on");
    expect(resumed.resumed).toBeUndefined();
  });

  it("continues the recorded app session on a resume, and says it did", async () => {
    const { asked, transport } = scripted({ answers: { "launch.deliver": DELIVERED, "launch.resume": PREPARED } });
    const resumed = unwrap(
      await appSessionLauncherOver({
        continuing: "0b5e",
        deps: NO_WORKTREE,
        ledgerHome: undefined,
        transport,
      }).resume({ spec: { ...CODEX_SPEC, initialMessage: "carry on" } }),
    );
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.resume", "launch.deliver"]);
    expect(asked[1]).toMatchObject({ kind: "launch.resume", sessionId: "0b5e" });
    expect([resumed.sessionId, resumed.resumed]).toEqual(["0b5e", true]);
  });

  it("marks a resumed session left standing with its delivery unproven as resumed", async () => {
    const { transport } = scripted({ answers: { "launch.resume": PREPARED } });
    const failed = unwrapErr(
      await appSessionLauncherOver({
        continuing: "0b5e",
        deps: NO_WORKTREE,
        ledgerHome: undefined,
        transport,
      }).resume({ spec: CODEX_SPEC }),
    );
    expect([failed.initialMessageUnproven, failed.resumed, failed.opened?.sessionId]).toEqual([true, true, "0b5e"]);
  });

  it("aborts, and claims no resume, when the app answers a resume with another session", async () => {
    const { asked, transport } = scripted({
      answers: { "launch.abort": { kind: "aborted" }, "launch.resume": PREPARED },
    });
    const failed = unwrapErr(
      await appSessionLauncherOver({
        continuing: "app-session-7",
        deps: NO_WORKTREE,
        ledgerHome: undefined,
        transport,
      }).resume({ spec: CODEX_SPEC }),
    );
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.resume", "launch.abort"]);
    expect(failed).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: the app answered launch.resume for app-session-7 with session 0b5e, which was aborted",
      operation: "resume",
    });
  });

  it("opens a new session on an open, even with a recorded app session to continue", async () => {
    const { asked, transport } = scripted({ answers: { "launch.deliver": DELIVERED, "launch.prepare": PREPARED } });
    const opened = unwrap(
      await appSessionLauncherOver({
        continuing: "app-session-7",
        deps: NO_WORKTREE,
        ledgerHome: undefined,
        transport,
      }).open({ spec: CODEX_SPEC }),
    );
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.prepare", "launch.deliver"]);
    expect(opened.resumed).toBeUndefined();
  });

  it("names the session it tried to continue when the app refuses the resume", async () => {
    const { transport } = scripted({ answers: {} });
    const failed = unwrapErr(
      await appSessionLauncherOver({
        continuing: "app-session-7",
        deps: NO_WORKTREE,
        ledgerHome: undefined,
        transport,
      }).resume({ spec: CODEX_SPEC }),
    );
    expect(failed).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: no answer scripted for launch.resume (resuming app session app-session-7)",
      operation: "resume",
    });
  });

  it("names the directory it could not create, before asking the app for a card", async () => {
    const { asked, transport } = scripted({ answers: {} });
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps: NO_WORKTREE, ledgerHome: undefined, transport }).open({
        spec: { ...CODEX_SPEC, directoryExists: false },
      }),
    );
    expect(asked).toEqual([{ kind: "ping" }]);
    expect(failed.message).toBe("app harness: could not create /work/tree-7: the worktree exists");
  });

  it("reads the browser door on a new worktree once it exists, before the app is asked for a card", async () => {
    const log: string[] = [];
    const { asked, transport } = scripted({ answers: { "launch.deliver": DELIVERED, "launch.prepare": PREPARED } });
    unwrap(
      await appSessionLauncherOver({ deps: loggedDeps({ log }), ledgerHome: undefined, transport }).open({
        spec: { ...CODEX_SPEC, directoryExists: false },
      }),
    );
    expect(log).toEqual([
      "worktree /work/tree-7",
      "browser codex /work/tree-7 through /Applications/Slopweaver.app/codex",
    ]);
    expect(asked.map((request) => request.kind)).toEqual(["ping", "launch.prepare", "launch.deliver"]);
  });

  it("reads the browser door on a worktree that already exists, too", async () => {
    const log: string[] = [];
    const { transport } = scripted({ answers: { "launch.deliver": DELIVERED, "launch.prepare": PREPARED } });
    unwrap(
      await appSessionLauncherOver({ deps: loggedDeps({ log }), ledgerHome: undefined, transport }).open({
        spec: CODEX_SPEC,
      }),
    );
    expect(log).toEqual(["browser codex /work/tree-7 through /Applications/Slopweaver.app/codex"]);
  });

  it("asks the app for no card when the browser door refuses, naming the door's reason", async () => {
    const log: string[] = [];
    const { asked, transport } = scripted({ answers: { "launch.prepare": PREPARED } });
    const deps = loggedDeps({ log, refusal: "the seat's config turns the ChatGPT browser on" });
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps, ledgerHome: undefined, transport }).open({ spec: CODEX_SPEC }),
    );
    expect(asked).toEqual([{ kind: "ping" }]);
    expect(failed).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: the seat's config turns the ChatGPT browser on",
      operation: "open",
    });
  });

  it("refuses, judging nothing, when the app names no Codex binary, or no instance to bind the judgment to", async () => {
    const bare = { appPid: 1, kind: "pong", startedAtIso: "2026-11-09T00:00:00.000Z" } as const;
    const pongs: AppHarnessResponse[] = [bare, { ...bare, codexPath: "/app/codex" }, { ...bare, instanceId: "i" }];
    const outcomes = await Promise.all(
      pongs.map(async (ping) => {
        const log: string[] = [];
        const { asked, transport } = scripted({ answers: { ping } });
        const failed = unwrapErr(
          await appSessionLauncherOver({ deps: loggedDeps({ log }), ledgerHome: undefined, transport }).open({
            spec: CODEX_SPEC,
          }),
        );
        return { asked, log, message: failed.message };
      }),
    );
    const refused = {
      asked: [{ kind: "ping" }],
      log: [],
      message:
        "app harness: the app did not name the Codex binary its sessions run, so the browser door cannot judge it — " +
        "reinstall the app with `slopweaver desktop install`",
    };
    expect(outcomes).toEqual([refused, refused, refused]);
  });

  it("gates a Claude seat's credential first, then its worktree, and asks for its card with no ping and no door", async () => {
    const log: string[] = [];
    const { asked, transport } = scripted({ answers: { "launch.deliver": DELIVERED, "launch.prepare": PREPARED } });
    unwrap(
      await appSessionLauncherOver({ deps: loggedDeps({ log }), ledgerHome: undefined, transport }).open({
        spec: { ...SPEC, directoryExists: false },
      }),
    );
    expect(log).toEqual(["credential /work/tree-7", "plugin gated", "worktree /work/tree-7"]);
    expect(asked.map((request) => request.kind)).toEqual(["launch.prepare", "launch.deliver"]);
    expect(asked[0]).toEqual({
      kind: "launch.prepare",
      spec: {
        claudeMdExcludes: [],
        credential: { kind: "store", secureStorageDir: "/home/claude-plan-2" },
        directory: "/work/tree-7",
        ledgerKey: "a-doc",
        model: "opus",
        pluginDir: "/work/repo",
        title: "a-doc",
        vendor: "claude",
      },
    });
  });

  it("leaves no worktree and asks the app nothing when a Claude seat's credential gate refuses", async () => {
    const log: string[] = [];
    const { asked, transport } = scripted({ answers: {} });
    const deps = loggedDeps({ credentialRefusal: "every plan is spent this week", log });
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps, ledgerHome: undefined, transport }).open({
        spec: { ...SPEC, directoryExists: false },
      }),
    );
    expect(log).toEqual(["credential /work/tree-7"]);
    expect(asked).toEqual([]);
    expect(failed).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: every plan is spent this week",
      operation: "open",
    });
  });

  it("makes no worktree and asks the app nothing when the gate passes a Claude seat with no store routed", async () => {
    const log: string[] = [];
    const { asked, transport } = scripted({ answers: {} });
    const deps: AppLaunchDeps = {
      ...loggedDeps({ log }),
      gateClaudeCredential: async ({ plan }) => {
        log.push(`credential ${plan.cwd}`);
        return ok(plan);
      },
    };
    const failed = unwrapErr(
      await appSessionLauncherOver({ deps, ledgerHome: undefined, transport }).open({
        spec: { ...SPEC, directoryExists: false },
      }),
    );
    expect(log).toEqual(["credential /work/tree-7", "plugin ungated"]);
    expect(asked).toEqual([]);
    expect(failed.code).toBe("SESSION_LAUNCH_FAILED");
    expect(failed.message).toContain("no plan routed this Claude seat a credential store");
  });
});
