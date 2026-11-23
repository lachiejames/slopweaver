/**
 * `cmux spawn` / `cmux close` — every case here is a parse, a usage line, or a refusal reached BEFORE the verb
 * touches git or cmux. The real spawn path needs a live `cmux` binary and a real worktree, which is not what a
 * unit test does — see the doc's own proof section for that.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCmuxClose } from "../../../../../cli/commands/cmux/close.js";
import { runCmuxReadScreen } from "../../../../../cli/commands/cmux/readScreen.js";
import {
  openSessionItemFor,
  openSessionKeyFor,
  runCmuxSpawn,
  runCmuxTitle,
  spawnExitWhy,
  targetWorkspaceId,
} from "../../../../../cli/commands/cmux/run.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { CmuxClient } from "../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { cmuxSessionHarnessOver } from "../../../../../sessionHarness/cmuxHarness.js";
import type { SessionHarness } from "../../../../../sessionHarness/sessionHarness.js";
import { appendSessionEvent } from "../../../../../sessions/sessionStore.js";
import { INSTANT_WAITS } from "../../../sessionHarness/fakeCmux.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Build an argv the router would hand a verb: `[node, cli, noun, verb, …rest]`. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "cmux", verb, ...rest];
}

/** A handover directory holding one doc, plus an unused home dir. */
function board({ text }: { text: string }): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "cmux-cli-docs-"));
  fixtureDirs.push(dir);
  writeFileSync(join(dir, "a-doc.md"), text, "utf8");
  return { dir };
}

const DOC_WITH_REPO = [
  "---",
  "slug: a-doc",
  "summary: a thing",
  "status: ready",
  "repo: /tmp/nowhere",
  "---",
  "",
  "body",
].join("\n");

const DOC_WITHOUT_REPO = ["---", "slug: no-repo-doc", "summary: a thing", "status: ready", "---", "", "body"].join(
  "\n",
);

const DOC_CANCELLED = [
  "---",
  "slug: cancelled-doc",
  "summary: a thing",
  "status: cancelled",
  "statusSummary: not worth pursuing",
  "repo: /tmp/nowhere",
  "---",
  "",
  "body",
].join("\n");

describe("cmux spawn", () => {
  it("prints usage on --help without touching the board", async () => {
    expect(await runCmuxSpawn(argv({ rest: ["--help"], verb: "spawn" }))).toBe(EXIT_OK);
  });

  it("rejects an unknown flag before its act phase", async () => {
    expect(await runCmuxSpawn(argv({ rest: ["a-doc", "--nope"], verb: "spawn" }))).toBe(EXIT_USAGE);
  });

  it("requires a slug", async () => {
    expect(await runCmuxSpawn(argv({ rest: [], verb: "spawn" }))).toBe(EXIT_USAGE);
  });

  it("refuses to be silent about a slug no doc claims", async () => {
    const { dir } = board({ text: DOC_WITH_REPO });

    expect(await runCmuxSpawn(argv({ rest: ["missing-doc", "--dir", dir, "--model", "sonnet"], verb: "spawn" }))).toBe(
      EXIT_USAGE,
    );
  });

  it("refuses a doc that names no repo:, since there is nowhere to open a worktree", async () => {
    const { dir } = board({ text: DOC_WITHOUT_REPO });

    expect(await runCmuxSpawn(argv({ rest: ["no-repo-doc", "--dir", dir, "--model", "sonnet"], verb: "spawn" }))).toBe(
      EXIT_USAGE,
    );
  });

  /**
   * Real gap this closes: before this fix, `cmux spawn` found any matching doc and chose start-versus-resume
   * purely from the run journal, with no doc-status preflight at all — so it would happily spawn a session on
   * a doc the board itself already refuses to start. Refused BEFORE any worktree/workspace effect, same as
   * `--driver`/`repo:` validation above.
   */
  it("refuses a spawn that names no --model, before any doc is read", async () => {
    const { dir } = board({ text: DOC_CANCELLED });

    expect(await runCmuxSpawn(argv({ rest: ["cancelled-doc", "--dir", dir], verb: "spawn" }))).toBe(EXIT_USAGE);
  });

  it("refuses to spawn a session on a cancelled doc, before any worktree effect", async () => {
    const { dir } = board({ text: DOC_CANCELLED });

    expect(
      await runCmuxSpawn(argv({ rest: ["cancelled-doc", "--dir", dir, "--model", "sonnet"], verb: "spawn" })),
    ).toBe(EXIT_ERROR);
  });

  it("refuses a --driver value that names neither claude nor codex", async () => {
    const { dir } = board({ text: DOC_WITH_REPO });

    expect(
      await runCmuxSpawn(
        argv({ rest: ["a-doc", "--dir", dir, "--driver", "gemini", "--model", "sonnet"], verb: "spawn" }),
      ),
    ).toBe(EXIT_USAGE);
  });
});

describe("spawnExitWhy", () => {
  it("names a spawn-backoff deferral as nothing booted, to re-run once the window opens", () => {
    expect(spawnExitWhy({ exitCode: EXIT_DEFERRED })).toBe(
      "the spawn backoff deferred the successor (exit 4) — nothing booted; re-run once it opens",
    );
  });

  it("names any other exit as a boot that did not finish cleanly", () => {
    expect(spawnExitWhy({ exitCode: EXIT_ERROR })).toBe("the successor did not boot cleanly (exit 1)");
  });
});

describe("cmux close", () => {
  it("prints usage on --help", async () => {
    expect(await runCmuxClose(argv({ rest: ["--help"], verb: "close" }))).toBe(EXIT_OK);
  });

  it("requires a workspace ref", async () => {
    expect(await runCmuxClose(argv({ rest: [], verb: "close" }))).toBe(EXIT_USAGE);
  });

  it("rejects a flag close does not accept", async () => {
    expect(await runCmuxClose(argv({ rest: ["workspace:1", "--dir", "/tmp"], verb: "close" }))).toBe(EXIT_USAGE);
  });
});

/**
 * A client that answers `resolveWorkspace` with one workspace, and `identify` with a DIFFERENT one — the exact
 * disagreement that made `system.identify` the wrong source for "my own workspace".
 */
function fakeClient({ resolves = true }: { resolves?: boolean } = {}): CmuxClient {
  return {
    close: () => undefined,
    closeWorkspace: () => Promise.resolve(ok(undefined)),
    createWorkspace: () =>
      Promise.resolve(
        ok({ surfaceId: "s", surfaceRef: "surface:1", workspaceId: "id-named", workspaceRef: "workspace:9" }),
      ),
    identify: () =>
      Promise.resolve(
        ok({
          surfaceId: "s-focused",
          surfaceRef: "surface:1",
          workspaceId: "id-focused",
          workspaceRef: "workspace:1",
        }),
      ),
    interruptTurn: () => Promise.resolve(ok(undefined)),
    listWorkspaces: () => Promise.resolve(ok([])),
    pinWorkspace: () => Promise.resolve(ok(undefined)),
    processTree: () => Promise.resolve(ok([])),
    workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [] })),
    readResumeBinding: () => Promise.resolve(ok(undefined)),
    readScreen: () => Promise.resolve(ok("")),
    readScreenGrid: () => Promise.resolve(ok({ columns: 0, cursor: undefined, rows: 0, spans: [], styles: [] })),
    renameWorkspace: () => Promise.resolve(ok(undefined)),
    resolveWorkspace: () =>
      Promise.resolve(
        resolves
          ? ok({
              currentDirectory: "/repo",
              description: undefined,
              latestConversationMessage: undefined,
              latestSubmittedAtIso: undefined,
              latestSubmittedMessage: undefined,
              pinned: false,
              selected: false,
              title: "a workspace",
              windowId: "window:1",
              workspaceId: "id-named",
              workspaceRef: "workspace:9",
            })
          : err(CmuxErrors.malformedReply({ detail: "workspace:9 names nothing live", method: "workspace.list" })),
      ),
    sendLine: () => Promise.resolve(ok(undefined)),
    submitComposer: () => Promise.resolve(ok(undefined)),
    unpinWorkspace: () => Promise.resolve(ok(undefined)),
    listWorkspacesStrict: () => Promise.resolve(ok([])),
    topologyStrict: () => Promise.resolve(ok({ surfacePids: [], workspaceRefs: [] })),
    workspaceSurface: () =>
      Promise.resolve(
        err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "not used here", method: "pane.list" })),
      ),
  };
}

/** The cmux session harness over the fake client, with instant waits. */
function fakeHarness({ resolves = true }: { resolves?: boolean } = {}): SessionHarness {
  return cmuxSessionHarnessOver({ client: fakeClient({ resolves }), waits: INSTANT_WAITS });
}

describe("targetWorkspaceId", () => {
  it("resolves a named ref to its id", async () => {
    const resolved = await targetWorkspaceId({ env: {}, harness: fakeHarness(), workspaceRef: "workspace:9" });

    expect(unwrap(resolved)).toBe("id-named");
  });

  it("reads the caller's OWN workspace from the environment, never from the focused one", async () => {
    const resolved = await targetWorkspaceId({
      env: { CMUX_WORKSPACE_ID: "id-mine" },
      harness: fakeHarness(),
      workspaceRef: undefined,
    });

    expect(unwrap(resolved)).toBe("id-mine");
  });

  it("refuses outside a cmux workspace rather than falling back to whatever is focused", async () => {
    const resolved = await targetWorkspaceId({ env: {}, harness: fakeHarness(), workspaceRef: undefined });

    expect(unwrapErr(resolved).message).toContain("name one with --workspace");
  });

  it("carries a ref that names nothing live through as the failure it is", async () => {
    const resolved = await targetWorkspaceId({
      harness: fakeHarness({ resolves: false }),
      env: { CMUX_WORKSPACE_ID: "id-mine" },
      workspaceRef: "workspace:9",
    });

    expect(unwrapErr(resolved).message).toContain("names nothing live");
  });
});

describe("cmux title", () => {
  it("prints usage on --help", async () => {
    expect(await runCmuxTitle(argv({ rest: ["--help"], verb: "title" }))).toBe(EXIT_OK);
  });

  it("requires a title", async () => {
    expect(await runCmuxTitle(argv({ rest: [], verb: "title" }))).toBe(EXIT_USAGE);
  });

  it("refuses a blank title", async () => {
    expect(await runCmuxTitle(argv({ rest: ["   "], verb: "title" }))).toBe(EXIT_USAGE);
  });

  it("rejects a flag title does not accept", async () => {
    expect(await runCmuxTitle(argv({ rest: ["a title", "--dir", "/tmp"], verb: "title" }))).toBe(EXIT_USAGE);
  });
});

describe("openSessionKeyFor", () => {
  it("finds the open session holding this workspace ref", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmux-session-home-"));
    fixtureDirs.push(dir);
    appendSessionEvent({
      event: {
        branch: "a-doc",
        cwd: "/tmp/wt",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:7",
      },
      home: dir,
    });

    expect(openSessionKeyFor({ home: dir, workspaceRef: "workspace:7" })).toBe("a-doc");
  });

  it("never matches an already-closed session", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmux-session-home-"));
    fixtureDirs.push(dir);
    appendSessionEvent({
      event: {
        branch: "a-doc",
        cwd: "/tmp/wt",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:7",
      },
      home: dir,
    });
    appendSessionEvent({ event: { kind: "closed", sessionKey: "a-doc", tsIso: "t2" }, home: dir });

    expect(openSessionKeyFor({ home: dir, workspaceRef: "workspace:7" })).toBeUndefined();
  });

  it("returns undefined for a workspace ref never spawned through the ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmux-session-home-"));
    fixtureDirs.push(dir);

    expect(openSessionKeyFor({ home: dir, workspaceRef: "workspace:99" })).toBeUndefined();
  });
});

describe("openSessionItemFor", () => {
  it("exposes the handover slug alongside the session key, for a predecessor's run-finished check", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmux-session-home-"));
    fixtureDirs.push(dir);
    appendSessionEvent({
      event: {
        branch: "fresh-supervisor-handoff-9004",
        cwd: "/tmp/wt",
        kind: "spawned",
        sessionKey: "fresh-supervisor-handoff-9004",
        slug: "fresh-supervisor-handoff-9004",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:432",
      },
      home: dir,
    });

    expect(openSessionItemFor({ home: dir, workspaceRef: "workspace:432" })!.slug).toBe(
      "fresh-supervisor-handoff-9004",
    );
  });

  it("returns undefined for a workspace ref never spawned through the ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmux-session-home-"));
    fixtureDirs.push(dir);

    expect(openSessionItemFor({ home: dir, workspaceRef: "workspace:99" })).toBeUndefined();
  });
});

/**
 * `cmux read-screen` — the same real-`cmux`-binary boundary as `spawn`/`close` above: only the parse/usage/
 * refusal path reached BEFORE it touches a live cmux binary is what a unit test can cover.
 */
describe("cmux read-screen", () => {
  it("prints usage on --help without needing a workspace", async () => {
    expect(await runCmuxReadScreen(argv({ rest: ["--help"], verb: "read-screen" }))).toBe(EXIT_OK);
  });

  it("requires --workspace", async () => {
    expect(await runCmuxReadScreen(argv({ rest: [], verb: "read-screen" }))).toBe(EXIT_USAGE);
  });

  it("no longer requires --surface, because cmux resolves a workspace's primary surface itself", async () => {
    // Refused for the flag it genuinely needs, not for the one it does not: this reaches the parse's own
    // refusal path rather than the missing-workspace one.
    expect(await runCmuxReadScreen(argv({ rest: ["--surface", "surface:1"], verb: "read-screen" }))).toBe(EXIT_USAGE);
  });

  it("refuses a --scrollback that is not a whole number, before touching cmux", async () => {
    expect(
      await runCmuxReadScreen(
        argv({ rest: ["--workspace", "workspace:1", "--scrollback", "lots"], verb: "read-screen" }),
      ),
    ).toBe(EXIT_USAGE);
  });

  it("rejects an unknown flag before its act phase", async () => {
    expect(await runCmuxReadScreen(argv({ rest: ["--workspace", "workspace:1", "--nope"], verb: "read-screen" }))).toBe(
      EXIT_USAGE,
    );
  });
});
