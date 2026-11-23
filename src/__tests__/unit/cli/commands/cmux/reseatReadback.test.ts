/**
 * `reseatReadback.ts` read directly — the refusals one typed line ends in when it cannot be proven up. The confirmed
 * arms (resumed, fresh, missing-conversation) run end to end through `reseatPass/reseatWorkspaceRelaunch.test.ts`'s cold relaunches.
 */
import { describe, expect, it } from "vitest";

import {
  awaitPromptAfterFailedResume,
  RESEAT_CONFIRM_SECONDS,
  typeAndConfirm,
} from "../../../../../cli/commands/cmux/reseatReadback.js";
import { EXIT_SIGHTINGS_TO_FAIL } from "../../../../../cmux/bootSignal.js";
import type { CmuxClient } from "../../../../../cmux/client.js";
import type { CmuxRenderGrid } from "../../../../../cmux/renderGrid.js";
import { err, ok, unwrapErr } from "../../../../../lib/result.js";
import type { ReseatPlan } from "../../../../../sessions/reseat.js";
import { ReseatErrors } from "../../../../../sessions/reseatErrors.js";
import { fakeClient, fakeDeps, workspace } from "../fleet/fleetKit.js";

/** A grid that READ and holds no composer — what a zsh prompt left behind draws. */
const NO_COMPOSER_GRID: CmuxRenderGrid = { columns: 0, cursor: undefined, rows: 0, spans: [], styles: [] };

const SESSION = "0f0f0f0f-0000-4000-8000-000000000001";

const MISSING = `No conversation found with session ID: ${SESSION}`;

/** A relaunch in workspace `w1`, resuming {@link SESSION} with nothing to stop. */
const PLAN: ReseatPlan = {
  chair: false,
  cwd: "/w/w1",
  effort: undefined,
  envPrefix: "",
  launch: { kind: "resume", sessionId: SESSION },
  model: "opus",
  modelSource: "argv",
  pluginDir: undefined,
  prior: { kind: "cold" },
  sessionId: SESSION,
  templateSuffix: "",
  workspace: workspace({ id: "w1" }),
};

describe("typeAndConfirm", () => {
  it("refuses as RELAUNCH_FAILED at typing the line when cmux will not take it, carrying whether a stop came first", async () => {
    const sent: string[] = [];
    const deps = fakeDeps({
      client: fakeClient({ screens: { w1: "$ " }, sendFails: true, sent }),
      ownWorkspaceId: undefined,
    });

    const typed = await typeAndConfirm({
      afterStop: true,
      deps,
      launch: PLAN.launch,
      line: "claude --resume x",
      plan: PLAN,
      priorPids: new Set(),
    });

    expect(typed).toEqual(
      err(
        ReseatErrors.relaunchFailed({
          afterStop: true,
          cause: "cmux surface.send_text failed (not_found): gone",
          step: "typing the relaunch line",
          workspaceRef: "workspace:w1",
        }),
      ),
    );
    expect(sent).toEqual(["w1: claude --resume x"]);
  });

  it("refuses as UNCONFIRMED, naming the resumed id, when no live session stands in the tab once the polls run out", async () => {
    const deps = fakeDeps({ client: fakeClient({ screens: { w1: "$ " } }), ownWorkspaceId: undefined });

    const typed = await typeAndConfirm({
      afterStop: false,
      deps,
      launch: PLAN.launch,
      line: "claude --resume x",
      plan: PLAN,
      priorPids: new Set(),
    });

    expect(typed).toEqual(
      err(
        ReseatErrors.unconfirmed({ seconds: RESEAT_CONFIRM_SECONDS, sessionId: SESSION, workspaceRef: "workspace:w1" }),
      ),
    );
  });

  it("answers missing-conversation on a NEW line even when the tab's processes will not read", async () => {
    const base = fakeClient({});
    let reads = 0;
    const client: CmuxClient = {
      ...base,
      readScreen: () => {
        reads += 1;
        return Promise.resolve(ok(reads === 1 ? "$ " : `$ claude --resume x\n${MISSING}\n$ `));
      },
      readScreenGrid: () => Promise.resolve(ok(NO_COMPOSER_GRID)),
    };
    // An exit must stand on consecutive reads before it is one, so the read-back gets exactly that many.
    const deps = { ...fakeDeps({ client, ownWorkspaceId: undefined }), confirmPolls: EXIT_SIGHTINGS_TO_FAIL };

    const typed = await typeAndConfirm({
      afterStop: false,
      deps,
      launch: PLAN.launch,
      line: "claude --resume x",
      plan: PLAN,
      priorPids: new Set(),
    });

    expect(typed).toEqual(ok({ kind: "missing-conversation" }));
  });

  it("never answers missing-conversation beside a grid that will not read, and runs out UNCONFIRMED", async () => {
    // The same exit stands on every read, but a grid that fails may hold a live composer.
    const base = fakeClient({});
    let reads = 0;
    const client: CmuxClient = {
      ...base,
      readScreen: () => {
        reads += 1;
        return Promise.resolve(ok(reads === 1 ? "$ " : `$ claude --resume x\n${MISSING}\n$ `));
      },
    };
    const deps = { ...fakeDeps({ client, ownWorkspaceId: undefined }), confirmPolls: EXIT_SIGHTINGS_TO_FAIL + 1 };

    const typed = await typeAndConfirm({
      afterStop: false,
      deps,
      launch: PLAN.launch,
      line: "claude --resume x",
      plan: PLAN,
      priorPids: new Set(),
    });

    expect(typed).toEqual(
      err(
        ReseatErrors.unconfirmed({ seconds: RESEAT_CONFIRM_SECONDS, sessionId: SESSION, workspaceRef: "workspace:w1" }),
      ),
    );
  });

  it("never answers missing-conversation on two different quotes, one a read, and runs out UNCONFIRMED", async () => {
    // Each quote reads as a new exit for one frame, and neither stands on two reads.
    const base = fakeClient({});
    let reads = 0;
    const client: CmuxClient = {
      ...base,
      readScreen: () => {
        reads += 1;
        const id = reads % 2 === 0 ? "quoted-A" : "quoted-B";
        return Promise.resolve(ok(reads === 1 ? "$ " : `No conversation found with session ID: ${id}\n⏺ Restoring…`));
      },
      readScreenGrid: () => Promise.resolve(ok(NO_COMPOSER_GRID)),
    };
    const deps = { ...fakeDeps({ client, ownWorkspaceId: undefined }), confirmPolls: EXIT_SIGHTINGS_TO_FAIL + 1 };

    const typed = await typeAndConfirm({
      afterStop: false,
      deps,
      launch: PLAN.launch,
      line: "claude --resume x",
      plan: PLAN,
      priorPids: new Set(),
    });

    expect(typed).toEqual(
      err(
        ReseatErrors.unconfirmed({ seconds: RESEAT_CONFIRM_SECONDS, sessionId: SESSION, workspaceRef: "workspace:w1" }),
      ),
    );
  });

  it("names a fresh session as what it waited for when the launch boots one", async () => {
    const deps = fakeDeps({ client: fakeClient({ screens: { w1: "$ " } }), ownWorkspaceId: undefined });

    const typed = await typeAndConfirm({
      afterStop: true,
      deps,
      launch: { kind: "fresh" },
      line: "claude",
      plan: PLAN,
      priorPids: new Set(),
    });

    expect(typed).toEqual(
      err(
        ReseatErrors.unconfirmed({
          seconds: RESEAT_CONFIRM_SECONDS,
          sessionId: "a fresh session",
          workspaceRef: "workspace:w1",
        }),
      ),
    );
  });
});

describe("awaitPromptAfterFailedResume", () => {
  it("refuses as RELAUNCH_FAILED after a stop when the tab never reads back at a bare prompt", async () => {
    const deps = fakeDeps({ client: fakeClient({}), ownWorkspaceId: undefined });

    const awaited = await awaitPromptAfterFailedResume({ deps, plan: PLAN });

    const error = unwrapErr(awaited);
    expect(error.code).toBe("RELAUNCH_FAILED");
    expect(error.message).toContain(
      "relaunching fresh once failed: its resume printed No conversation found, and the tab never came back to a bare prompt",
    );
  });
});
