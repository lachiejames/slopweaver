/**
 * The plan-then-vanish reap, re-run end-to-end against the SHIPPED binary and a real cmux socket.
 *
 * ## The incident it reconstructs
 *
 * Ask `C0SYN000010/1790924298.202269`. The dispatched worker obeyed answer-first: it posted its
 * reviewed four-PR plan, which wrote a terminal `answered` row, so its workspace was gone a
 * minute later with no PR opened. The loop re-dispatched by hand about three minutes after the plan
 * (`workspace:89`), and about sixteen minutes after that a plain `session close-done` from the chair reaped that live re-dispatch as
 * `[ask child, answered…]` — the gen-1 `answered` row is ever-terminal in the raw history, so the running
 * generation inherited it as its own ending.
 *
 * Two fixes meet here, and this file proves each through the real verb rather than the pure planner, because
 * the verb resolves the ask log, the session ledger and the screen through readers the planner never sees:
 *
 * - a plan posted with a declared follow-through writes the NON-terminal `first-answered`, so the worker
 *   that owes the build is not a done chat;
 * - a terminal OLDER than the running dispatch is not this generation's ending, so a re-dispatch survives it.
 *
 * ## Reconstructed rather than frozen, and why
 *
 * `session close-done` reads `new Date()` and takes no `--now`, so the incident's own instants would sit
 * outside every lease and prove nothing. What carries the incident is its SHAPE — dispatch, plan posted
 * thirty-five minutes later, re-dispatch three minutes after that — and the offsets below preserve it from the
 * wall clock, exactly as `./sessionCloseDoneMidVerdict.test.ts` does for its own incident. The frozen record
 * set could not serve either: every re-dispatch overwrites the ask's one dispatch record, and a dispatch record
declares no instant `turn freeze --not-after` can window, so a cut before the plan still carried a later
generation's record.
 *
 * ## The falsifiable half
 *
 * Every "not reaped" case has a control that differs in ONE event and asserts the reap line by name, so a verb
 * that simply failed to find the row cannot pass. The screen reads IDLE throughout — the one state in which a
 * reap proceeds — so a hold can only come from the judgement under test.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatchSessionName, dispatchWorkspaceName } from "../../../cmux/planNames.js";
import type { AskLifecycleEvent } from "../../../live/ask/lifecycle.js";
import { type SessionEvent, sessionEventLine } from "../../../sessions/session.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { type FakeCmuxServer, startFakeCmuxServer } from "../cmux/fakeCmuxServer.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** The incident's own ask coordinates. */
const CHANNEL = "C0SYN000010";
const MESSAGE_TS = "1790924298.202269";
const THREAD_TS = "1790799910.591889";

/** The incident's offsets, hung off the wall clock: dispatched, plan posted 35m later, re-dispatched 3m after. */
const MINUTE_MS = 60 * 1000;
const at = ({ minutesAgo }: { minutesAgo: number }): string =>
  new Date(Date.now() - minutesAgo * MINUTE_MS).toISOString();
const CAPTURED_AT = at({ minutesAgo: 56 });
const DISPATCHED_AT = at({ minutesAgo: 54 });
const PLAN_POSTED_AT = at({ minutesAgo: 19 });
const REDISPATCHED_AT = at({ minutesAgo: 16 });
/** Both leases sit well in the future, so no lease arm can be what holds or reaps the row. */
const LEASE_AHEAD = at({ minutesAgo: -66 });

/** The worker's workspace, as cmux numbered the re-dispatch that morning. */
const ASK_REF = "workspace:89";
const ASK_ID = "6E3F0A52-0B71-4C9B-9D0E-2F1A7C3B5D89";

const ASK_KEY = dispatchSessionName({ askChannel: CHANNEL, askMessageTs: MESSAGE_TS, role: "ask" });
const ASK_NAME = dispatchWorkspaceName({ askChannel: CHANNEL, askMessageTs: MESSAGE_TS, role: "ask" });

const IDENTITY = { channel: CHANNEL, messageTs: MESSAGE_TS, threadTs: THREAD_TS };

/** The routing decision every `dispatched` row carries; its content plays no part in the reap. */
const DECISION = {
  confidence: "medium",
  needs: [],
  rationale: "raise the PR stack the thread asks for",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "current",
} as const;

const CAPTURED: AskLifecycleEvent = {
  ...IDENTITY,
  kind: "captured",
  surface: "channel",
  tsIso: CAPTURED_AT,
  userId: "U0ASKER",
};
const DISPATCHED: AskLifecycleEvent = {
  ...IDENTITY,
  decision: DECISION,
  kind: "dispatched",
  leaseExpiresAt: LEASE_AHEAD,
  tier: "fresh-visible-session",
  tsIso: DISPATCHED_AT,
};
const PLAN_AS_FIRST_ANSWER: AskLifecycleEvent = {
  ...IDENTITY,
  answerDigest: "sha256:525c720fc80c7a7023c3fed78f3b4aaa06b62d64c94ecea66d3771352bee91c5",
  answerTs: "1790926490.051279",
  kind: "first-answered",
  leaseExpiresAt: LEASE_AHEAD,
  owes: "pull-requests",
  tsIso: PLAN_POSTED_AT,
  what: "the four-PR Datadog test instrumentation stack, links in this thread as each opens",
};
const PLAN_AS_ANSWER: AskLifecycleEvent = {
  ...IDENTITY,
  answerTs: "1790926490.051279",
  kind: "answered",
  tsIso: PLAN_POSTED_AT,
};
const REDISPATCHED: AskLifecycleEvent = {
  ...IDENTITY,
  decision: DECISION,
  kind: "dispatched",
  leaseExpiresAt: LEASE_AHEAD,
  tier: "fresh-visible-session",
  tsIso: REDISPATCHED_AT,
};

let sandbox: string;
let home: string;
let cwd: string;
let server: FakeCmuxServer;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), "slop-cd-firstanswer-"));
  home = join(sandbox, "home");
  cwd = join(sandbox, "checkout");
  mkdirSync(cwd, { recursive: true });
  server = await startFakeCmuxServer({ onLine: ({ connection, line }) => answer({ connection, line }) });
});

afterEach(async () => {
  await server.close();
  rmSync(sandbox, { force: true, recursive: true });
});

/**
 * Answer one request frame the way cmux answers it, for the four methods this verb calls. The worker's screen
 * carries no running-turn marker, so it reads IDLE.
 */
function answer({
  connection,
  line,
}: {
  connection: { writeFrame: (options: { value: unknown }) => void };
  line: string;
}): void {
  const request: unknown = JSON.parse(line);
  const { id, method } = request as { id: string; method: string };
  const results: Record<string, unknown> = {
    "surface.read_text": { text: "> \n  ? for shortcuts" },
    "window.list": { windows: [{ id: "window:1" }] },
    "workspace.close": {},
    "workspace.list": {
      window_id: "window:1",
      workspaces: [
        {
          current_directory: cwd,
          description: `spawned session · ${ASK_NAME}`,
          id: ASK_ID,
          pinned: false,
          ref: ASK_REF,
          selected: false,
          title: "ask worker",
        },
      ],
    },
  };
  const result = results[method];
  if (result === undefined) {
    connection.writeFrame({ value: { error: { code: "method_not_found", message: method }, id, ok: false } });
    return;
  }
  connection.writeFrame({ value: { id, ok: true, result } });
}

/** The worker's own ledger row — a dispatch child, paired with the fake workspace by `cwd`. */
function spawnedEvent(): SessionEvent {
  return {
    branch: "main",
    cwd,
    kind: "spawned",
    sessionKey: ASK_KEY,
    surfaceRef: "surface:97",
    tsIso: REDISPATCHED_AT,
    workspaceRef: ASK_REF,
  };
}

/** Write the ask-lifecycle log and the session ledger; each case differs only in `events`. */
function seedHome({ events }: { events: readonly AskLifecycleEvent[] }): void {
  const slack = join(home, "live", "slack");
  mkdirSync(slack, { recursive: true });
  writeFileSync(
    join(slack, "asks.jsonl"),
    `${events.map((event) => JSON.stringify({ schemaVersion: 1, ...event })).join("\n")}\n`,
  );
  const sessions = join(home, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "sessions.jsonl"), `${sessionEventLine({ event: spawnedEvent() })}\n`);
}

/**
 * Run the shipped binary against the seeded home and the fake socket, with none of this machine's config.
 * Async because `spawnSync` would block the thread the fake server listens on.
 *
 * @returns the child's exit status and both streams
 */
async function closeDone(): Promise<{ status: number; stdout: string; stderr: string }> {
  const child = spawn(BIN, ["session", "close-done", "--dry-run", "--keep-worktrees", "--home", home], {
    cwd: sandbox,
    env: {
      ...accountSandboxChildEnv(),
      CMUX_SOCKET_PATH: server.socketPath,
      HOME: sandbox,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
      TMPDIR: process.env["TMPDIR"]!,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  // A null exit code means the child was SIGNALLED rather than exiting — report it as 1, never a success.
  const status = await new Promise<number>((resolveExit) => {
    child.on("close", (code) => {
      if (code === null) {
        resolveExit(1);
        return;
      }
      resolveExit(code);
    });
  });
  return { status, stderr, stdout };
}

describe("session close-done over a worker that posted its plan and still owes the build", () => {
  it("does NOT reap a worker whose plan posted as a first answer", async () => {
    seedHome({ events: [CAPTURED, DISPATCHED, PLAN_AS_FIRST_ANSWER] });
    const result = await closeDone();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("answer posted");
    expect(result.stdout).toContain("would close 0 done chat(s)");
  });

  it("reaps that same worker when the plan is the terminal answered row instead", async () => {
    seedHome({ events: [CAPTURED, DISPATCHED, PLAN_AS_ANSWER] });
    const result = await closeDone();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${ASK_REF} ${ASK_KEY} [ask child, answer posted]`);
    expect(result.stdout).toContain("would close 1 done chat(s)");
  });
});

describe("session close-done over a re-dispatch of an ask that already answered", () => {
  // Its control is the second case above: the identical log with this one `dispatched` row removed reaps.
  it("does NOT reap the re-dispatch on the earlier generation's answered row", async () => {
    seedHome({ events: [CAPTURED, DISPATCHED, PLAN_AS_ANSWER, REDISPATCHED] });
    const result = await closeDone();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("answer posted");
    expect(result.stdout).toContain("would close 0 done chat(s)");
  });
});
