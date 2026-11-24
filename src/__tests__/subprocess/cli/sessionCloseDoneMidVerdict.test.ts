/**
 * The mid-verdict reap, re-run end-to-end against the SHIPPED binary and a real cmux socket.
 *
 * ## Why this is a subprocess test and not another unit case
 *
 * `src/__tests__/unit/sessions/dispatchDoneEvidence.test.ts` proves `dispatchDoneEvidence` holds a reviewer whose
 * parent lease has lapsed. It cannot prove that `slopweaver session close-done` does — the verb resolves the
 * review posture off DISK, through a reader the pure planner never sees, over a socket. Every one of those
 * three is where the wiring could be absent while the judgement is perfect. So this spawns `bin/slopweaver`
 * with `CMUX_SOCKET_PATH` pointed at a fake control socket speaking the exact newline-delimited-JSON wire
 * format `src/cmux/socketFrames.ts` documents, and reads what the real verb prints.
 *
 * ## The incident it reconstructs, and the one thing it could NOT take from disk
 *
 * Ask `C0SYN000006/1789347793.808099`: the worker's dispatch lease lapsed, review round 2 opened 32 minutes
 * later on `workspace:228` and wrote no verdict, and a `close-done` run from an unrelated seat reaped it
 * about twenty minutes after that as `parent lease expired`.
 *
 * The state is reconstructed rather than frozen, and the reason is a fact worth writing down: a review
 * record lives at ONE path per ask (`reviewPaths(...).record`) and every round overwrites it, so by the time
 * this was written that ask's record had advanced to round 5 and carried a `releasedAt`. Round 2's bytes no
 * longer exist anywhere. What survives is the SHAPE, and the offsets below preserve it exactly — see
 * `LEASE_EXPIRES_AT` for why they hang off the wall clock rather than being those instants.
 *
 * ## The falsifiable half
 *
 * A "it was not reaped" assertion is worth nothing unless the same input REAPS when the one fact under test
 * is removed. So the second case is the identical home with the review record deleted — nothing else changed
 * — and it asserts the reap line by name. Without that pair, a verb that had simply failed to find the row
 * at all would pass the first case.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatchSessionName, dispatchWorkspaceName } from "../../../cmux/planNames.js";
import type { AskLifecycleEvent } from "../../../live/ask/lifecycle.js";
import type { ReviewRecord } from "../../../live/turn/review.js";
import { type SessionEvent, sessionEventLine } from "../../../sessions/session.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { type FakeCmuxServer, startFakeCmuxServer } from "../cmux/fakeCmuxServer.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** The incident's own ask coordinates. */
const CHANNEL = "C0SYN000006";
const MESSAGE_TS = "1789347793.808099";
const THREAD_TS = "1788956581.789719";

/**
 * The incident's own OFFSETS, hung off the wall clock rather than its own instants.
 *
 * `session close-done` reads `new Date()` and takes no `--now`, so a frozen instant would put the reviewer
 * days outside `MAX_REVIEW_HOLD_HOURS` and the hold under test would never apply — the fixture would prove
 * the opposite of what it claims. What actually carries the incident is the SHAPE, and it is preserved
 * exactly: the worker's lease lapsed 52 minutes ago, and the reviewer opened 32 minutes after that, which is
 * the real gap between the lapse and the round opening. A reviewer 20 minutes old is inside the hold;
 * a lease 52 minutes lapsed is not.
 */
const MINUTE_MS = 60 * 1000;
const LEASE_EXPIRES_AT = new Date(Date.now() - 52 * MINUTE_MS).toISOString();
const ROUND_TWO_SPAWNED_AT = new Date(Date.now() - 20 * MINUTE_MS).toISOString();
const CAPTURED_AT = new Date(Date.now() - 172 * MINUTE_MS).toISOString();

/** The reviewer's workspace, as cmux numbered it that morning. */
const REVIEW_REF = "workspace:228";
const REVIEW_ID = "E0CF407A-6B18-4946-9D31-B5BB53F4B797";

const REVIEW_KEY = dispatchSessionName({ askChannel: CHANNEL, askMessageTs: MESSAGE_TS, role: "review" });
const REVIEW_NAME = dispatchWorkspaceName({ askChannel: CHANNEL, askMessageTs: MESSAGE_TS, role: "review" });

let sandbox: string;
let home: string;
let cwd: string;
let server: FakeCmuxServer;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), "slop-cd-midverdict-"));
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
 * Answer one request frame the way cmux answers it, for the four methods this verb calls.
 *
 * `surface.read_text` returns a screen with no running-turn marker, so the reviewer reads IDLE — the
 * hostile setting for this test, because an idle screen is the one state in which the reap would proceed.
 * A busy screen would hold the row for a reason that has nothing to do with the fix.
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
          description: `spawned session · ${REVIEW_NAME}`,
          id: REVIEW_ID,
          pinned: false,
          ref: REVIEW_REF,
          selected: false,
          title: "answer review",
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

/** The ask's own history: captured, dispatched on a lease that has since lapsed, and the recorded expiry. */
const ASK_EVENTS: readonly AskLifecycleEvent[] = [
  {
    channel: CHANNEL,
    kind: "captured",
    messageTs: MESSAGE_TS,
    surface: "channel",
    threadTs: THREAD_TS,
    tsIso: CAPTURED_AT,
    userId: "U0SYNADAOWN",
  },
  {
    channel: CHANNEL,
    decision: {
      confidence: "high",
      needs: [],
      rationale: "worth answering",
      response: "respond",
      schemaVersion: 1,
      tier: "fresh-visible-session",
      truthMode: "current",
    },
    kind: "dispatched",
    leaseExpiresAt: LEASE_EXPIRES_AT,
    messageTs: MESSAGE_TS,
    threadTs: THREAD_TS,
    tier: "fresh-visible-session",
    tsIso: CAPTURED_AT,
  },
  { channel: CHANNEL, kind: "lease-expired", messageTs: MESSAGE_TS, threadTs: THREAD_TS, tsIso: LEASE_EXPIRES_AT },
];

/**
 * The reviewer's own ledger row — a dispatch child, so it answers to no handover slug.
 *
 * Takes the checkout because the sandbox is minted per test, and the row's `cwd` is what pairs it with the
 * workspace the fake inventory reports.
 *
 * @returns the one `spawned` event the session ledger carries
 */
function spawnedEvent({ checkout }: { checkout: string }): SessionEvent {
  return {
    branch: "main",
    cwd: checkout,
    kind: "spawned",
    sessionKey: REVIEW_KEY,
    surfaceRef: "surface:249",
    tsIso: ROUND_TWO_SPAWNED_AT,
    workspaceRef: REVIEW_REF,
  };
}

/** Round 2's review record: open, unreleased, and with no verdict file beside it. */
function roundTwoRecord({ reviewDir }: { reviewDir: string }): ReviewRecord {
  return {
    answerDigest: "sha256:84f66bbc0172523a815ed8ecd8950785dd50422ced28bfdcd9981636914d6689",
    answerPath: join(reviewDir, "answer.json"),
    authorSession: "author workspace workspace:208",
    carriedUnresolved: [],
    channel: CHANNEL,
    messageTs: MESSAGE_TS,
    packetPath: join(reviewDir, "packet.md"),
    reviewer: {
      cwd,
      host: "claude-code",
      sessionName: REVIEW_KEY,
      surfaceId: "23EA52DF-63B2-4CF3-8720-8A41F25BA4C0",
      surfaceRef: "surface:249",
      workspaceId: REVIEW_ID,
      workspaceRef: REVIEW_REF,
    },
    reviewerSession: `reviewer workspace ${REVIEW_REF}`,
    round: 2,
    schemaVersion: 2,
    spawnedAt: ROUND_TWO_SPAWNED_AT,
    threadTs: THREAD_TS,
    verdictPath: join(reviewDir, "verdict.json"),
  };
}

/**
 * Write the whole home: the ask-lifecycle log, the session ledger, and — unless `withReview` is false — the
 * open round-2 review record. The two cases differ in that one file and nothing else.
 */
function seedHome({ withReview }: { withReview: boolean }): void {
  const slack = join(home, "live", "slack");
  mkdirSync(slack, { recursive: true });
  writeFileSync(
    join(slack, "asks.jsonl"),
    `${ASK_EVENTS.map((event) => JSON.stringify({ schemaVersion: 1, ...event })).join("\n")}\n`,
  );
  const sessions = join(home, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "sessions.jsonl"), `${sessionEventLine({ event: spawnedEvent({ checkout: cwd }) })}\n`);
  if (!withReview) {
    return;
  }
  const reviewDir = join(slack, "reviews", `${CHANNEL}-${MESSAGE_TS}`);
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(join(reviewDir, "record.json"), `${JSON.stringify(roundTwoRecord({ reviewDir }), null, 2)}\n`);
}

/**
 * Run the shipped binary against the seeded home and the fake socket, with none of this machine's config.
 *
 * ASYNC on purpose, and this is the whole reason the fake server works at all: `spawnSync` blocks the
 * calling thread, so the server listening in THIS process never accepts the child's connection and every
 * call dies on `cmux window.list did not answer within 15000ms`. Measured — that is exactly what the first
 * draft of this file printed.
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
  // A null exit code means the child was SIGNALLED rather than exiting, which is a failure of this test
  // setup and not an exit status — report it as 1 rather than coalescing it into one silently.
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

describe("session close-done over a reviewer that is mid-verdict", () => {
  it("does NOT reap a reviewer with an open review, past a parent lease that lapsed before it opened", async () => {
    seedHome({ withReview: true });
    const result = await closeDone();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("parent lease expired");
    expect(result.stdout).toContain("would close 0 done chat(s)");
  });

  it("reaps that same reviewer once the open review is the only thing removed", async () => {
    seedHome({ withReview: false });
    const result = await closeDone();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${REVIEW_REF} ${REVIEW_KEY} [review child, parent lease expired]`);
    expect(result.stdout).toContain("would close 1 done chat(s)");
  });
});
