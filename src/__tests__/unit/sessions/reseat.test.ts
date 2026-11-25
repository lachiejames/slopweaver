/**
 * `cmux reseat`'s pure judgement: which session a workspace runs, what it is relaunched with, and what it refuses.
 */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import {
  bootReseatWall,
  parseLaunchFlags,
  pinnedModelsByWorkspace,
  planReseat,
  reseatAllTargets,
  screenShowsResumeMenu,
  sessionInTree,
} from "../../../sessions/reseat.js";
import { planColdReseat } from "../../../sessions/reseatCold.js";
import { renderReseatOutcome, reseatPassVerdict } from "../../../sessions/reseatOutcome.js";
import type { SessionItem } from "../../../sessions/session.js";

const SESSION_ID = "a0000096-0000-4000-8000-000000000103";

/** One workspace, overridable per case. */
function workspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/wt/seat",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "a seat",
    windowId: "window:1",
    workspaceId: "ws-seat",
    workspaceRef: "workspace:4",
    ...over,
  };
}

/** One registry record, overridable per case. */
function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    cwd: "/wt/seat",
    entrypoint: "cli",
    kind: "interactive",
    name: "seat",
    pid: 393,
    sessionId: SESSION_ID,
    startedAtMs: 0,
    status: "idle",
    ...over,
  };
}

/** The planner's inputs for an idle worker in a fleet worktree whose argv names nothing. */
function inputs(over: Partial<Parameters<typeof planReseat>[0]> = {}): Parameters<typeof planReseat>[0] {
  return {
    argv: `/bin/claude --settings {"hooks":{}} --resume ${SESSION_ID}`,
    callerAncestry: new Set([9001, 9000, 1]),
    chair: false,
    defaults: { envPrefix: "NX_DAEMON=false ", pluginDir: "/wt/seat" },
    env: {},
    flagModel: undefined,
    force: false,
    ledgerModel: undefined,
    ownWorkspaceId: "ws-own",
    session: record(),
    transcriptExists: true,
    wall: undefined,
    workspace: workspace(),
    ...over,
  };
}

describe("bootReseatWall", () => {
  it("walls a seat booted on no configured plan, carrying the hook's own reason", () => {
    const why = "signed out: it declares no setup token descriptor, and its store /x is no configured plan's";
    expect(bootReseatWall({ plan: { kind: "off-plan", why } })).toStrictEqual({ kind: "off-plan", why });
  });

  it("never walls a seat on a plan, nor one whose boot could not be read", () => {
    expect([
      bootReseatWall({ plan: { alias: "plan-one", kind: "token" } }),
      bootReseatWall({ plan: { alias: "plan-one", kind: "store" } }),
      bootReseatWall({ plan: { kind: "unresolved", why: "ps refused" } }),
    ]).toStrictEqual([undefined, undefined, undefined]);
  });
});

describe("parseLaunchFlags", () => {
  it("reads a worker's restored argv, past cmux's settings blob", () => {
    const argv =
      '/bin/claude --settings {"hooks":{"Stop":[]}} --plugin-dir /wt/seat --model opus --effort high ' +
      `--permission-mode bypassPermissions --resume ${SESSION_ID}`;

    expect(parseLaunchFlags({ argv })).toEqual({ effort: "high", model: "opus", pluginDir: "/wt/seat" });
  });

  it("reads nothing from the chair's restored argv, which kept only --settings and --resume", () => {
    expect(parseLaunchFlags({ argv: `/bin/claude --settings {} --resume ${SESSION_ID}` })).toEqual({});
  });

  it("takes the LAST value when a flag repeats, and the = spelling", () => {
    expect(parseLaunchFlags({ argv: "claude --model sonnet --model=opus" })).toEqual({ model: "opus" });
  });
});

describe("sessionInTree", () => {
  it("picks the one registry record whose pid sits in the workspace's tree", () => {
    const found = sessionInTree({
      records: [record({ pid: 7, sessionId: "other" }), record({ pid: 393 })],
      treePids: [1, 393],
      workspaceRef: "workspace:4",
    });

    expect(unwrap(found).sessionId).toBe(SESSION_ID);
  });

  it("refuses a workspace with no live session, naming session re-seat", () => {
    const found = sessionInTree({ records: [record({ pid: 7 })], treePids: [1, 2], workspaceRef: "workspace:4" });

    expect(unwrapErr(found).code).toBe("NO_LIVE_SESSION");
    expect(unwrapErr(found).message).toContain("session re-seat");
  });

  it("refuses two live sessions in one workspace", () => {
    const found = sessionInTree({
      records: [record({ pid: 1, sessionId: "a" }), record({ pid: 2, sessionId: "b" })],
      treePids: [1, 2],
      workspaceRef: "workspace:4",
    });

    expect(unwrapErr(found)).toEqual(expect.objectContaining({ code: "AMBIGUOUS_SESSION", sessionIds: ["a", "b"] }));
  });
});

describe("planReseat", () => {
  it("relaunches a worker on its ledger row's model, with spawn's defaults and Opus effort", () => {
    const plan = unwrap(planReseat(inputs({ ledgerModel: "opus" })));

    expect(plan).toEqual(
      expect.objectContaining({
        chair: false,
        effort: "high",
        envPrefix: "NX_DAEMON=false ",
        model: "opus",
        modelSource: "ledger",
        pluginDir: "/wt/seat",
        launch: { kind: "resume", sessionId: SESSION_ID },
        prior: { kind: "live", pid: 393 },
        sessionId: SESSION_ID,
        templateSuffix: "",
      }),
    );
  });

  it("puts the chair on Fable with the supervisor template when its argv names nothing", () => {
    const plan = unwrap(planReseat(inputs({ chair: true })));

    expect(plan.model).toBe("fable");
    expect(plan.modelSource).toBe("chair");
    expect(plan.effort).toBe(undefined);
    expect(plan.templateSuffix).toContain("claudeMdExcludes");
  });

  it("keeps what the argv names over the ledger, and a typed --model over both", () => {
    const argv = `claude --plugin-dir /wt/own --model sonnet --effort low --resume ${SESSION_ID}`;

    expect(unwrap(planReseat(inputs({ argv, ledgerModel: "opus" })))).toEqual(
      expect.objectContaining({ effort: "low", model: "sonnet", modelSource: "argv", pluginDir: "/wt/own" }),
    );
    expect(unwrap(planReseat(inputs({ argv, flagModel: "opus", ledgerModel: "haiku" }))).modelSource).toBe("flag");
  });

  // MEASURED: a session that never took a prompt has no transcript, and `--resume` on it printed `No
  // conversation found` and dropped the tab to zsh.
  it("plans a FRESH launch for a live session with no transcript, never a resume of it", () => {
    const plan = unwrap(planReseat(inputs({ ledgerModel: "opus", transcriptExists: false })));

    expect([plan.launch, plan.sessionId]).toEqual([{ kind: "fresh" }, SESSION_ID]);
  });

  it("refuses a worker nothing names a model for, rather than booting the saved default", () => {
    expect(unwrapErr(planReseat(inputs())).code).toBe("NO_MODEL");
  });

  it("refuses a typed Fable on a worker without the override, and takes it with one", () => {
    expect(unwrapErr(planReseat(inputs({ flagModel: "fable" }))).code).toBe("MODEL_REFUSED");
    expect(unwrap(planReseat(inputs({ env: { ALLOW_FABLE_OVERRIDE: "1" }, flagModel: "fable" }))).model).toBe("fable");
  });

  it("refuses the caller's own workspace", () => {
    const own = planReseat(inputs({ ledgerModel: "opus", ownWorkspaceId: "ws-seat" }));

    expect(unwrapErr(own).code).toBe("OWN_WORKSPACE");
  });

  it("refuses a session on the caller's own parent chain even when CMUX_WORKSPACE_ID names nothing", () => {
    const own = planReseat(
      inputs({ callerAncestry: new Set([9001, 393, 1]), ledgerModel: "opus", ownWorkspaceId: undefined }),
    );

    expect(unwrapErr(own).code).toBe("OWN_WORKSPACE");
  });

  it("refuses a busy seat behind no wall unless forced, and takes a busy WALLED seat", () => {
    const busy = record({ status: "busy" });

    expect(unwrapErr(planReseat(inputs({ ledgerModel: "opus", session: busy }))).code).toBe("BUSY");
    expect(unwrap(planReseat(inputs({ force: true, ledgerModel: "opus", session: busy }))).prior).toEqual({
      kind: "live",
      pid: 393,
    });
    const walled = planReseat(
      inputs({ ledgerModel: "opus", session: busy, wall: { banner: "retrying", kind: "limit-retrying" } }),
    );
    expect(unwrap(walled).prior).toEqual({ kind: "live", pid: 393 });
  });

  it("refuses a session id that is not a UUID, since the line carries it unquoted", () => {
    const unsafe = planReseat(inputs({ ledgerModel: "opus", session: record({ sessionId: "x; rm -rf ~" }) }));

    expect(unwrapErr(unsafe).code).toBe("UNSAFE_SESSION_ID");
  });
});

/** The cold planner's inputs for the chair's bare-shell tab, saved with only cmux's own flags. */
function coldInputs(over: Partial<Parameters<typeof planColdReseat>[0]> = {}): Parameters<typeof planColdReseat>[0] {
  return {
    argv: `--settings {} --resume ${SESSION_ID}`,
    chair: true,
    cwd: "/wt/chair",
    defaults: { envPrefix: "", pluginDir: "/wt/chair" },
    env: {},
    flagModel: undefined,
    ledgerModel: undefined,
    ownWorkspaceId: "ws-own",
    sessionId: SESSION_ID,
    workspace: workspace({ workspaceId: "ws-chair", workspaceRef: "workspace:1" }),
    ...over,
  };
}

describe("planColdReseat", () => {
  it("plans the chair's bare shell on Fable with nothing to stop, at the SAVED cwd", () => {
    const plan = unwrap(planColdReseat(coldInputs()));

    expect(plan).toEqual(
      expect.objectContaining({
        chair: true,
        cwd: "/wt/chair",
        model: "fable",
        modelSource: "chair",
        prior: { kind: "cold" },
        sessionId: SESSION_ID,
      }),
    );
    expect(plan.templateSuffix).toContain("claudeMdExcludes");
  });

  it("keeps a worker's saved flags over its ledger row", () => {
    const plan = planColdReseat(coldInputs({ argv: "--model sonnet --effort low", chair: false, ledgerModel: "opus" }));

    expect(unwrap(plan)).toEqual(expect.objectContaining({ effort: "low", model: "sonnet", modelSource: "argv" }));
  });

  it("refuses a worker nothing names a model for", () => {
    expect(unwrapErr(planColdReseat(coldInputs({ argv: "", chair: false }))).code).toBe("NO_MODEL");
  });

  it("refuses the caller's own tab and an id that is not a UUID", () => {
    const own = planColdReseat(coldInputs({ ownWorkspaceId: "ws-chair" }));
    const unsafe = planColdReseat(coldInputs({ sessionId: "x; rm -rf ~" }));

    expect(unwrapErr(own).code).toBe("OWN_WORKSPACE");
    expect(unwrapErr(unsafe).code).toBe("UNSAFE_SESSION_ID");
  });
});

describe("reseatAllTargets", () => {
  it("takes only walled seats, never the caller's own, the chair first", () => {
    const seat = workspace({ workspaceId: "ws-seat", workspaceRef: "workspace:4" });
    const chair = workspace({ workspaceId: "ws-chair", workspaceRef: "workspace:1" });
    const own = workspace({ workspaceId: "ws-own", workspaceRef: "workspace:2" });
    const healthy = workspace({ workspaceId: "ws-ok", workspaceRef: "workspace:3" });
    const walls = new Map([
      ["ws-seat", { kind: "logged-out" as const }],
      ["ws-chair", { kind: "logged-out" as const }],
      ["ws-own", { kind: "logged-out" as const }],
    ]);

    const targets = reseatAllTargets({
      chairWorkspaceId: "ws-chair",
      ownWorkspaceId: "ws-own",
      walls,
      workspaces: [seat, own, healthy, chair],
    });

    expect(targets.map((target) => target.workspaceRef)).toEqual(["workspace:1", "workspace:4"]);
  });
});

describe("pinnedModelsByWorkspace", () => {
  it("reads an open row's pinned model, and nothing for an inherited one", () => {
    const rows: SessionItem[] = [
      {
        bootModel: { kind: "pinned", model: "opus" },
        cwd: "/wt/seat",
        lastEventIso: "2026-10-01T00:00:00.000Z",
        sessionKey: "k1",
        slug: "a-seat",
        status: "open",
        workspaceRef: "workspace:4",
      },
      {
        bootModel: { kind: "inherited" },
        cwd: "/wt/other",
        lastEventIso: "2026-10-01T00:00:00.000Z",
        sessionKey: "k2",
        slug: "other",
        status: "open",
        workspaceRef: "workspace:5",
      },
    ];
    const workspaces = [
      workspace(),
      workspace({ currentDirectory: "/wt/other", workspaceId: "ws-other", workspaceRef: "workspace:5" }),
    ];

    expect([...pinnedModelsByWorkspace({ rows, workspaces })]).toEqual([["ws-seat", "opus"]]);
  });

  it("reads nothing for a Codex seat's row, whose pin is no model claude can boot", () => {
    const rows: SessionItem[] = [
      {
        bootModel: { kind: "pinned", model: CODEX_MODEL },
        cwd: "/wt/seat",
        lastEventIso: "2026-10-01T00:00:00.000Z",
        sessionKey: "k1",
        slug: "a-seat",
        status: "open",
        workspaceRef: "workspace:4",
      },
    ];
    expect([...pinnedModelsByWorkspace({ rows, workspaces: [workspace()] })]).toEqual([]);
  });
});

describe("screenShowsResumeMenu", () => {
  it("sees Claude Code's resume-in-full prompt drawn as menu lines at the bottom", () => {
    const menu = "This session is large.\n❯ 1. Resume from summary\n  2. Resume full session as-is\n";

    expect(screenShowsResumeMenu({ screen: menu })).toBe(true);
    expect(screenShowsResumeMenu({ screen: "> " })).toBe(false);
  });

  it("never reads a transcript that QUOTES the menu as the menu", () => {
    const quoted =
      "⏺ reboot.md says a seat parks on — 1. Resume from summary / 2. Resume full session as-is — answer 2.\n" +
      "> \n  ? for shortcuts\n";

    expect(screenShowsResumeMenu({ screen: quoted })).toBe(false);
  });

  it("never reads a menu that has scrolled above the live bottom", () => {
    const scrolled = `1. Resume from summary\n2. Resume full session as-is\n${"⏺ later output\n".repeat(20)}> \n`;

    expect(screenShowsResumeMenu({ screen: scrolled })).toBe(false);
  });
});

describe("renderReseatOutcome and reseatPassVerdict", () => {
  it("prints a refusal with its code, and fails the pass on it", () => {
    const outcome = {
      error: { code: "BUSY" as const, message: "mid-turn" },
      kind: "refused" as const,
      workspaceRef: "workspace:4",
    };

    expect(renderReseatOutcome({ outcome })).toBe("refused\tworkspace:4\tBUSY: mid-turn");
    expect(reseatPassVerdict({ outcomes: [outcome] })).toBe("error");
  });

  it("clears an empty pass", () => {
    expect(reseatPassVerdict({ outcomes: [] })).toBe("ok");
  });
});
