/**
 * `launchFreshVisibleSession`/`deliverFreshSessionPickup` — the two glue points between `tier.ts`'s abstract
 * launch seam and the real spawn primitive, kept as separate calls so a caller can durably record the opened
 * session BETWEEN boot and pickup delivery. Same fake-client discipline as `cmux/spawn/fakeClient.ts`: no real
 * cmux, no mocking framework, just a recording fake over the exact `CmuxClient` shape.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CmuxClient } from "../../../../cmux/client.js";
import { CmuxErrors } from "../../../../cmux/errors.js";
import type { VisibleSessionPlan } from "../../../../cmux/plan.js";
import { type CmuxRenderGrid, parseRenderGrid } from "../../../../cmux/renderGrid.js";
import type { SpawnDeps } from "../../../../cmux/spawn.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import { deliverFreshSessionPickup, launchFreshVisibleSession } from "../../../../live/turn/freshSession.js";

const PLAN: VisibleSessionPlan = {
  baseBranch: undefined,
  branch: "ask-c1-2-2",
  cwd: "/tmp/ask-worktree",
  driver: "claude",
  host: "claude-code",
  model: undefined,
  pickupCommand: "Read the brief at /tmp/brief.json and answer it.",
  repoRoot: "/tmp/repo",
  respondingToHandle: "@asker",
  sessionName: "ask-c1-2",
  spawnedAt: "2026-08-17T00:00:00.000Z",
  template: "bot",
  workspaceName: "ask-c1-2-2",
  workspaceTitle: "what is the staging pool doing",
  worktreeExists: true,
};

/** The REAL frozen capture of a typed composer (`fixtures/composer/typed.json`), parsed by the real parser. */
const TYPED_GRID: CmuxRenderGrid = unwrap(
  parseRenderGrid({
    value: JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../fixtures/composer/typed.json"), "utf8"),
    ) as unknown,
  }),
);

const CREATED = {
  surfaceId: "id-surface-1",
  surfaceRef: "surface:1",
  workspaceId: "id-workspace-1",
  workspaceRef: "workspace:1",
} as const;

/** A fake client answering `readScreen` from a scripted sequence and recording every sent line. */
function fakeClient({ screens }: { screens: readonly string[] }): { sent: string[]; client: CmuxClient } {
  const sent: string[] = [];
  let screenCall = 0;
  return {
    client: {
      close: () => undefined,
      closeWorkspace: () => Promise.resolve(ok(undefined)),
      createWorkspace: () => Promise.resolve(ok({ ...CREATED })),
      identify: () =>
        Promise.resolve(
          ok({ surfaceId: undefined, surfaceRef: undefined, workspaceId: undefined, workspaceRef: undefined }),
        ),
      interruptTurn: () => Promise.resolve(ok(undefined)),
      listWorkspaces: () => Promise.resolve(ok([])),
      pinWorkspace: () => Promise.resolve(ok(undefined)),
      processTree: () => Promise.resolve(ok([])),
      workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [] })),
      readResumeBinding: () => Promise.resolve(ok(undefined)),
      readScreen: () => {
        const screen = screens[Math.min(screenCall, screens.length - 1)]!;
        screenCall += 1;
        return Promise.resolve(ok(screen));
      },
      readScreenGrid: () => Promise.resolve(ok({ columns: 0, cursor: undefined, rows: 0, spans: [], styles: [] })),
      renameWorkspace: () => Promise.resolve(ok(undefined)),
      resolveWorkspace: () =>
        Promise.resolve(
          err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "not used here", method: "workspace.list" })),
        ),
      sendLine: ({ text }) => {
        sent.push(text);
        return Promise.resolve(ok(undefined));
      },
      submitComposer: () => Promise.resolve(ok(undefined)),
      unpinWorkspace: () => Promise.resolve(ok(undefined)),
      listWorkspacesStrict: () => Promise.resolve(ok([])),
      topologyStrict: () => Promise.resolve(ok({ surfacePids: [], workspaceRefs: [] })),
      workspaceSurface: () =>
        Promise.resolve(
          err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "not used here", method: "pane.list" })),
        ),
    },
    sent,
  };
}

/** Deps around one fake client, with no event stream — so the screen is the only witness. */
function depsOver({ client }: { client: CmuxClient }): SpawnDeps {
  return {
    client,
    close: () => undefined,
    ensureWorktree: () => undefined,
    // The credential gate is not this suite's subject: every plan passes through unchanged.
    gateCredentialStore: ({ plan }) => Promise.resolve(ok(plan)),
    // Nor is the Codex browser door: every seat passes it.
    gateCodexBrowserSurface: () => ok(undefined),
    // Nor is the create lock: every create holds it unopposed.
    holdWorkspaceCreate: () => ok({ claimed: new Set<string>(), release: () => undefined }),
    observedEvents: () => [],
    resolvePluginDir: () => "/repo/slopweaver",
    // The opening sidebar publish is not this suite's subject; it answers success and records nothing.
    sidebarCli: { run: () => ok("") },
    wait: () => Promise.resolve(),
    // The boot witness alone decides, as before a `claude` boot was judged on its composer (`cmux/spawn/harness.ts`).
    witnessClaudeBoot: ({ bootWitnessed }) =>
      Promise.resolve(bootWitnessed ? { kind: "unwitnessed" } : { kind: "failed", reason: "never-read" }),
  };
}

/** A fake that boots cleanly and shows the pickup command landing. */
function bootedClient(): { sent: string[]; client: CmuxClient } {
  return fakeClient({
    screens: ["$ ", "Claude Code v2.1.231 booting…", `Claude Code v2.1.231 booting…\n> ${PLAN.pickupCommand}`],
  });
}

describe("launchFreshVisibleSession", () => {
  it("reports the opened workspace as a claude-code FreshVisibleSessionRef once boot alone is confirmed", async () => {
    const outcome = await launchFreshVisibleSession({ deps: depsOver({ client: bootedClient().client }), plan: PLAN });

    // `cwd` rides along on the ref: a reader hunting a dispatched session on the machine looks for a
    // directory, and an ask session boots into the DISPATCHER'S checkout rather than one named after the ask.
    // `sessionName` rides along for the same reason one step further: sharing that checkout is exactly why
    // the ref cannot be resolved by directory, so the name the harness registered is what remains.
    expect(outcome).toEqual({
      session: { cwd: PLAN.cwd, host: "claude-code", sessionName: PLAN.sessionName, ...CREATED },
    });
  });

  it("never sends the pickup command itself — that is deliverFreshSessionPickup's job", async () => {
    const { client, sent } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });

    await launchFreshVisibleSession({ deps: depsOver({ client }), plan: PLAN });

    expect(sent.includes(PLAN.pickupCommand)).toBe(false);
  });

  it("carries the spawn primitive's own failure reason through, unaltered", async () => {
    const { client } = fakeClient({ screens: ["$ ", "$ "] });

    const outcome = await launchFreshVisibleSession({ deps: depsOver({ client }), plan: PLAN });

    // A claude boot nothing witnessed is closed and tried once more, so the refusal names both attempts.
    expect(outcome).toEqual({
      reason:
        "claude failed to boot twice — workspace:1: the surface never read, and nothing else vouched for the boot, and it was closed; then workspace:1: the surface never read, and nothing else vouched for the boot, and it was closed — so no seat stands for this spawn; run the same command again once the machine has headroom",
    });
  });
});

describe("deliverFreshSessionPickup", () => {
  const SESSION = { host: "claude-code" as const, ...CREATED };

  it("confirms the pickup command landed on an already-booted surface", async () => {
    const { client } = fakeClient({ screens: [`Claude Code v2.1.231 booting…\n> ${PLAN.pickupCommand}`] });

    const outcome = await deliverFreshSessionPickup({ deps: depsOver({ client }), plan: PLAN, session: SESSION });

    expect(outcome).toEqual(ok({ kind: "witnessed", witness: { by: "screen", confirmed: true } }));
  });

  // The distinction the whole `dispatch-unwitnessed` state rests on: an unseen pickup is an OK result whose
  // delivery is `unwitnessed`, never an error. A caller that read this as `err` recorded a live worker dead.
  it("reports an unseen pickup as an unwitnessed DELIVERY, not as a failure", async () => {
    const { client } = fakeClient({ screens: ["Claude Code booting…"] });

    const outcome = await deliverFreshSessionPickup({ deps: depsOver({ client }), plan: PLAN, session: SESSION });

    expect(outcome).toEqual(ok({ kind: "unwitnessed" }));
  });

  it("sends the pickup command exactly ONCE even when nothing witnesses it", async () => {
    const { client, sent } = fakeClient({ screens: ["Claude Code booting…"] });

    await deliverFreshSessionPickup({ deps: depsOver({ client }), plan: PLAN, session: SESSION });

    expect(sent.filter((line) => line === PLAN.pickupCommand).length).toBe(1);
  });

  // Measured: three spawned seats sat seventy minutes with the pickup typed in the box. A worker whose line
  // never left the composer is running nothing, so the dispatch is a failure naming the workspace — never the
  // ambiguous `unwitnessed` a queued line earns.
  it("passes through the refusal for a pickup still TYPED in the composer after its Enter budget", async () => {
    const { client } = fakeClient({ screens: ["Claude Code booting…"] });
    const stranded: CmuxClient = {
      ...client,
      readScreenGrid: () => Promise.resolve(ok(TYPED_GRID)),
    };

    const outcome = await deliverFreshSessionPickup({
      deps: depsOver({ client: stranded }),
      plan: PLAN,
      session: SESSION,
    });

    expect(outcome).toEqual(
      err({
        reason:
          "the pickup is still TYPED, unsubmitted in workspace:1's composer — 4 Enters were pressed with nothing " +
          "re-typed, and the line was not seen to leave it — so the seat is running nothing; press it through " +
          "with `slopweaver cmux submit --workspace workspace:1` and read the screen, never re-send the line " +
          "(composer: approved, land it)",
        strandedInComposer: true,
      }),
    );
  });

  it("reports the reason the client REFUSED to send, which is a real failure", async () => {
    const { client } = fakeClient({ screens: ["Claude Code booting…"] });
    const refusing: CmuxClient = {
      ...client,
      sendLine: () =>
        Promise.resolve(
          err(
            CmuxErrors.callFailed({
              cmuxCode: "internal_error",
              message: "socket closed",
              method: "surface.send_text",
            }),
          ),
        ),
    };

    const outcome = await deliverFreshSessionPickup({
      deps: depsOver({ client: refusing }),
      plan: PLAN,
      session: SESSION,
    });

    expect(outcome).toEqual(
      err({
        reason: "the pickup command could not be sent: cmux surface.send_text failed (internal_error): socket closed",
      }),
    );
  });
});
