import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  runHandoverAmend,
  runHandoverAsk,
  runHandoverClaim,
  runHandoverRelease,
} from "../../../cli/commands/handover/lifecycleRun.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { writerOf } from "../../../handover/runOwner.js";
import { appendRunEvent, readRunJournal } from "../../../handover/runStore.js";
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV, type SupervisorHost } from "../../../supervisor/session.js";

interface Endpoint {
  readonly host: Exclude<SupervisorHost, "explicit">;
  readonly sessionId: string;
}

interface Route {
  readonly name: string;
  readonly from: Endpoint;
  readonly to: Endpoint;
}

const ROUTES: readonly Route[] = [
  {
    from: { host: "claude-code", sessionId: "claude-one" },
    name: "Claude to Claude",
    to: { host: "claude-code", sessionId: "claude-two" },
  },
  {
    from: { host: "codex", sessionId: "codex-one" },
    name: "Codex to Codex",
    to: { host: "codex", sessionId: "codex-two" },
  },
  {
    from: { host: "claude-code", sessionId: "claude-one" },
    name: "Claude to Codex",
    to: { host: "codex", sessionId: "codex-two" },
  },
  {
    from: { host: "codex", sessionId: "codex-one" },
    name: "Codex to Claude",
    to: { host: "claude-code", sessionId: "claude-two" },
  },
];

const homes: string[] = [];
const savedClaude = process.env[CLAUDE_CODE_SESSION_ID_ENV];
const savedCodex = process.env[CODEX_THREAD_ID_ENV];

afterEach(() => {
  setEnv({ endpoint: undefined });
  restoreEnv({ name: CLAUDE_CODE_SESSION_ID_ENV, value: savedClaude });
  restoreEnv({ name: CODEX_THREAD_ID_ENV, value: savedCodex });
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** Restore one optional process variable exactly. */
function restoreEnv({ name, value }: { name: string; value: string | undefined }): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

/** Expose exactly one visible host to the command under test. */
function setEnv({ endpoint }: { endpoint: Endpoint | undefined }): void {
  delete process.env[CLAUDE_CODE_SESSION_ID_ENV];
  delete process.env[CODEX_THREAD_ID_ENV];
  if (endpoint?.host === "claude-code") {
    process.env[CLAUDE_CODE_SESSION_ID_ENV] = endpoint.sessionId;
  }
  if (endpoint?.host === "codex") {
    process.env[CODEX_THREAD_ID_ENV] = endpoint.sessionId;
  }
}

/** A real board plus append-only journal owned by `endpoint`. */
function ownedRun({ endpoint }: { endpoint: Endpoint }): { home: string; runsDir: string } {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-transfer-"));
  homes.push(home);
  const handovers = join(home, "handovers");
  const runsDir = join(home, "runs");
  mkdirSync(handovers, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    join(handovers, "move-me.md"),
    ["---", "slug: move-me", "summary: move this run", "status: in-progress", "---", "", "# Move me", ""].join("\n"),
  );
  appendRunEvent({
    event: { atIso: "2026-08-09T00:00:00.000Z", branch: "feat/move", docHash: "hash", kind: "started" },
    runsDir,
    slug: "move-me",
  });
  appendRunEvent({
    event: {
      atIso: "2026-08-09T00:00:01.000Z",
      host: endpoint.host,
      kind: "claimed",
      pid: 100,
      sessionId: endpoint.sessionId,
      why: "test owner",
      worktree: "/tmp/source",
    },
    runsDir,
    slug: "move-me",
  });
  return { home, runsDir };
}

/** Real argv for an ownership verb. */
function argv({ home, verb, force = false }: { home: string; verb: "claim" | "release"; force?: boolean }): string[] {
  return [
    "node",
    "cli",
    "handover",
    verb,
    "move-me",
    "--home",
    home,
    "--why",
    `test ${verb}`,
    ...(force ? ["--force"] : []),
  ];
}

describe("handover ownership transfer matrix", () => {
  it.each(ROUTES)("persists $name through release then claim", async ({ from, to }) => {
    const { home, runsDir } = ownedRun({ endpoint: from });
    setEnv({ endpoint: from });
    const released = await runHandoverRelease(argv({ home, verb: "release" }));
    setEnv({ endpoint: to });
    const claimed = await runHandoverClaim(argv({ home, verb: "claim" }));
    const journal = readRunJournal({ runsDir, slug: "move-me" })._unsafeUnwrap();

    expect(released).toBe(EXIT_OK);
    expect(claimed).toBe(EXIT_OK);
    expect(journal.events.map((event) => event.kind)).toEqual(["started", "claimed", "released", "claimed"]);
    expect(writerOf({ events: journal.events })).toEqual({
      atIso: journal.events[3]!.atIso,
      host: to.host,
      pid: process.pid,
      sessionId: to.sessionId,
      worktree: process.cwd(),
    });
  });

  it("refuses an ordinary lifecycle write from a foreign session", async () => {
    const { home, runsDir } = ownedRun({ endpoint: { host: "codex", sessionId: "codex-one" } });
    setEnv({ endpoint: { host: "claude-code", sessionId: "claude-two" } });

    const code = await runHandoverAmend([
      "node",
      "cli",
      "handover",
      "amend",
      "move-me",
      "--home",
      home,
      "--why",
      "foreign edit",
    ]);

    expect(code).not.toBe(EXIT_OK);
    expect(
      readRunJournal({ runsDir, slug: "move-me" })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed"]);
  });

  it("requires a loud reasoned takeover when Codex liveness cannot be measured, and journals the force", async () => {
    const { home, runsDir } = ownedRun({ endpoint: { host: "codex", sessionId: "codex-one" } });
    setEnv({ endpoint: { host: "claude-code", sessionId: "claude-two" } });

    const refused = await runHandoverClaim(argv({ home, verb: "claim" }));
    const forced = await runHandoverClaim(argv({ force: true, home, verb: "claim" }));

    expect(refused).not.toBe(EXIT_OK);
    expect(forced).toBe(EXIT_OK);
    const events = readRunJournal({ runsDir, slug: "move-me" })._unsafeUnwrap().events;
    expect(writerOf({ events })!.sessionId).toBe("claude-two");
    // The takeover genuinely bypassed the guard (unknown liveness + --force), so the journal records it.
    expect(lastClaim({ events }).forced).toBe(true);
  });

  it("never journals forced for a redundant --force against a provably dead hostless holder", async () => {
    // A pid guaranteed not to belong to any running process, same fixture as the orphan-abandon suite.
    const { home, runsDir } = ownedRun({ endpoint: { host: "claude-code", sessionId: "irrelevant" } });
    appendRunEvent({
      event: {
        atIso: "2026-08-09T00:00:02.000Z",
        kind: "launched",
        pid: 999_999,
        sessionId: "hostless-dead",
        worktree: undefined,
      },
      runsDir,
      slug: "move-me",
    });
    setEnv({ endpoint: { host: "claude-code", sessionId: "claude-two" } });

    const code = await runHandoverClaim(argv({ force: true, home, verb: "claim" }));

    expect(code).toBe(EXIT_OK);
    const events = readRunJournal({ runsDir, slug: "move-me" })._unsafeUnwrap().events;
    // claimRefusal admits a dead holder WITHOUT force, so the flag did not bypass anything — journalling
    // `forced` here would be a false audit fact.
    expect("forced" in lastClaim({ events })).toBe(false);
  });
});

/** The most recent claim on a journal, narrowed by predicate so the assertion itself carries no conditional. */
function lastClaim({ events }: { events: readonly RunEvent[] }): Extract<RunEvent, { kind: "claimed" }> {
  return events.findLast((event): event is Extract<RunEvent, { kind: "claimed" }> => event.kind === "claimed")!;
}

/**
 * The confirmed incident, reproduced end-to-end rather than only at the pure-function layer: a run
 * was `released` and never reclaimed, and a wholly unrelated session's `handover ask` sailed through the old
 * `unowned`-collapse and delivered a fabricated question to the owner's real Slack DM under a stranger's name.
 * `runHandoverAsk` never checks ownership itself — it delegates to `recordText`'s shared `mutationRefusal`, so
 * this is also the regression test for that indirection staying wired up.
 */
describe("a released, unclaimed run refuses every mutating exit", () => {
  it("refuses handover ask from an unrelated session — the exact incident this exists to prevent", async () => {
    const { home, runsDir } = ownedRun({ endpoint: { host: "claude-code", sessionId: "claude-one" } });
    setEnv({ endpoint: { host: "claude-code", sessionId: "claude-one" } });
    await runHandoverRelease(argv({ home, verb: "release" }));
    setEnv({ endpoint: { host: "codex", sessionId: "unrelated-codex-session" } });

    const code = await runHandoverAsk([
      "node",
      "cli",
      "handover",
      "ask",
      "move-me",
      "--home",
      home,
      "--question",
      "fabricated question a stranger's Stop hook produced",
    ]);

    expect(code).not.toBe(EXIT_OK);
    expect(
      readRunJournal({ runsDir, slug: "move-me" })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "released"]);
  });

  it("still refuses handover ask even from the session that released it — a return still needs an explicit claim", async () => {
    const { home, runsDir } = ownedRun({ endpoint: { host: "claude-code", sessionId: "claude-one" } });
    setEnv({ endpoint: { host: "claude-code", sessionId: "claude-one" } });
    await runHandoverRelease(argv({ home, verb: "release" }));

    const code = await runHandoverAsk([
      "node",
      "cli",
      "handover",
      "ask",
      "move-me",
      "--home",
      home,
      "--question",
      "did the original writer get a free pass back in?",
    ]);

    expect(code).not.toBe(EXIT_OK);
    expect(
      readRunJournal({ runsDir, slug: "move-me" })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "released"]);
  });

  it("lets a session claim the released run, and ask succeeds only after that", async () => {
    const { home, runsDir } = ownedRun({ endpoint: { host: "claude-code", sessionId: "claude-one" } });
    setEnv({ endpoint: { host: "claude-code", sessionId: "claude-one" } });
    await runHandoverRelease(argv({ home, verb: "release" }));
    setEnv({ endpoint: { host: "codex", sessionId: "codex-two" } });
    const claimed = await runHandoverClaim(argv({ home, verb: "claim" }));

    const code = await runHandoverAsk([
      "node",
      "cli",
      "handover",
      "ask",
      "move-me",
      "--home",
      home,
      "--question",
      // A question that ASKS, so the card-alignment gate is not what this case trips over either.
      "properly claimed, so does this ask go through?",
      // The SHAPE is what `handover ask` refuses without; this case is about
      // OWNERSHIP, so it carries a valid one rather than asserting the shape gate by accident.
      "--problem",
      "the run was released and then claimed, so ownership has to be the only thing under test",
      "--options",
      "let the ask through :: the run stays parked until the owner answers\nclaim it back first :: the question waits on a second act",
      "--lean",
      "let it through — the claim already happened",
      "--risk",
      "an ask recorded on the wrong owner",
      "--blast-radius",
      "this one test run",
      "--still-real",
      "the claim event is in the journal",
      "--example",
      "You see a run released and claimed again, then it asks you this. Should it go through?",
    ]);

    expect(claimed).toBe(EXIT_OK);
    expect(code).toBe(EXIT_OK);
    expect(
      readRunJournal({ runsDir, slug: "move-me" })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "released", "claimed", "question"]);
  });

  it("refuses a second release of an already-released run rather than appending a stray writer", async () => {
    const { home, runsDir } = ownedRun({ endpoint: { host: "claude-code", sessionId: "claude-one" } });
    setEnv({ endpoint: { host: "claude-code", sessionId: "claude-one" } });
    await runHandoverRelease(argv({ home, verb: "release" }));
    setEnv({ endpoint: { host: "codex", sessionId: "unrelated-codex-session" } });

    const code = await runHandoverRelease(argv({ home, verb: "release" }));

    expect(code).not.toBe(EXIT_OK);
    expect(
      readRunJournal({ runsDir, slug: "move-me" })
        ._unsafeUnwrap()
        .events.map((event) => event.kind),
    ).toEqual(["started", "claimed", "released"]);
  });
});
