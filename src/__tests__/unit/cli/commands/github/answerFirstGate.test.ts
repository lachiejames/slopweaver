/**
 * The creation door's answer-first gate — `cli/commands/github/answerFirstGate.ts`.
 *
 * Round-tripped through a real temp home, for the same reason `live/turn/workerSessionStore.test.ts` is:
 * the gate's whole job is to read two files two other processes wrote, and generation-binding is a
 * comparison against a dispatch record on the same disk. The rule itself is pure and tested against plain
 * values in `live/turn/answerFirst.test.ts`; what these cases pin is the PROJECTION off disk and the
 * refusal the door actually prints.
 *
 * The refusal case asserts the hatch's own token, not just that some lines came out. A gate that refused
 * without printing the override would be the exact defect `error-handling.md` measured across 29 sites.
 */
// register-class: tooling-shipped-before-the-public-ask-was-answered (docs/recurring-failure-register/bindings.md)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { answerFirstAsksFrom, answerFirstGateRefused } from "../../../../../cli/commands/github/answerFirstGate.js";
import { appendAskLifecycleEvent } from "../../../../../live/ask/store.js";
import type { FreshDispatchRecord } from "../../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../../live/turn/dispatchStore.js";
import { writeWorkerSession } from "../../../../../live/turn/workerSessionStore.js";

/** The owner's own `#dev-alerts` ask, which is the turn this gate exists for. */
const ASK = { channel: "C0SYN000006", messageTs: "1789952379.135579", threadTs: "1789952379.135579" };

const LEASE = "2026-09-21T04:39:36.000Z";
const WORKER_SESSION = "a0000036-0000-4000-8000-000000000039";
const AT_THE_PUSH = "2026-09-21T02:56:00.000Z";

/** The env of the worker session itself — Claude Code's own session variable is what names it. */
const WORKER_ENV = { CLAUDE_CODE_SESSION_ID: WORKER_SESSION };

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "answer-first-"));
  fixtureDirs.push(home);
  return home;
};

const dispatchRecord = (): FreshDispatchRecord => ({
  askPermalink: "https://example.slack.com/archives/C0SYN000006/p1789952379135579",
  briefPath: "/tmp/brief.json",
  channel: ASK.channel,
  decision: {
    confidence: "high",
    needs: [],
    rationale: "a live investigation is needed",
    response: "respond",
    schemaVersion: 1,
    tier: "fresh-visible-session",
    truthMode: "none",
  },
  dispatchId: "d-291-9x",
  execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
  leaseExpiresAt: LEASE,
  messageTs: ASK.messageTs,
  schemaVersion: 3,
  session: {
    cwd: "/tmp/checkout",
    host: "claude-code",
    sessionName: "ask-worker",
    surfaceId: "s-1",
    surfaceRef: "surface:1",
    workspaceId: "w-206",
    workspaceRef: "workspace:206",
  },
  threadTs: ASK.threadTs,
});

/** Capture and dispatch this ask on the given surface, exactly as the live path writes it. */
const dispatchFor = ({ home, surface }: { home: string; surface: "channel" | "dm" }): void => {
  const record = dispatchRecord();
  // The captured event is written by hand rather than through `ensureCapturedAskLifecycle`, which stamps
  // the WALL clock: the elapsed clause in the refusal is measured from this instant, so pinning it is what
  // makes "open 17m" an assertion about the gate rather than about the day the suite runs.
  appendAskLifecycleEvent({
    event: { ...ASK, kind: "captured", surface, tsIso: "2026-09-21T02:38:28.000Z", userId: "U0OWNER" },
    home,
  });
  appendAskLifecycleEvent({
    event: {
      ...ASK,
      decision: record.decision,
      kind: "dispatched",
      leaseExpiresAt: LEASE,
      tier: "fresh-visible-session",
      tsIso: "2026-09-21T02:39:36.000Z",
    },
    home,
  });
  writeDispatchRecord({ home, record });
};

/** The record `turn resume` writes when the worker announces which visible session it is. */
const announceWorker = ({ home }: { home: string }): void => {
  writeWorkerSession({
    askIdentity: ASK,
    home,
    record: {
      cwd: "/tmp/checkout",
      host: "claude-code",
      leaseExpiresAt: LEASE,
      recordedAtIso: "2026-09-21T02:40:00.000Z",
      sessionId: WORKER_SESSION,
    },
  });
};

/** Run the gate, collecting whatever it printed. */
const runGate = ({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): { readonly refused: boolean; readonly lines: string[] } => {
  const lines: string[] = [];
  const refused = answerFirstGateRefused({
    env,
    home,
    nowIso: AT_THE_PUSH,
    out: ({ line }) => {
      lines.push(line);
    },
  });
  return { lines, refused };
};

describe("answerFirstAsksFrom — the projection off disk", () => {
  it("reads an empty home as no asks at all, rather than throwing", () => {
    expect(answerFirstAsksFrom({ home: freshHome() })).toEqual([]);
  });

  it("carries the surface, the capture instant and the announced worker session for a live dispatch", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });

    const asks = answerFirstAsksFrom({ home });

    expect(asks.length).toBe(1);
    expect(asks[0]!.channel).toBe("C0SYN000006");
    expect(asks[0]!.messageTs).toBe("1789952379.135579");
    expect(asks[0]!.surface).toBe("channel");
    expect(asks[0]!.dispatched).toBe(true);
    expect(asks[0]!.workerSessionId).toBe(WORKER_SESSION);
  });

  it("carries no worker session for an ask whose dispatch a terminal already superseded", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });
    appendAskLifecycleEvent({
      event: { ...ASK, answerTs: "1789962000.000100", kind: "answered", tsIso: "2026-09-21T05:16:50.000Z" },
      home,
    });

    const asks = answerFirstAsksFrom({ home });

    expect(asks[0]!.dispatched).toBe(false);
    expect(asks[0]!.workerSessionId).toBeUndefined();
  });
});

describe("answerFirstGateRefused — the refusal", () => {
  it("REFUSES the worker holding an unanswered public ask, naming it and how long it has been open", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });

    const { lines, refused } = runGate({ env: WORKER_ENV, home });

    expect(refused).toBe(true);
    const printed = lines.join("\n");
    expect(printed).toContain("this session is the dispatched worker for C0SYN000006/1789952379.135579, open 17m");
    expect(printed).toContain("with no answer posted yet");
  });

  it("prints the override token, which is the thing a bare block leaves out", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });

    expect(runGate({ env: WORKER_ENV, home }).lines.join("\n")).toContain("SLOPWEAVER_ALLOW_ANSWER_FIRST=1");
  });

  it("tells the worker what to do instead, rather than only what it may not do", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });

    expect(runGate({ env: WORKER_ENV, home }).lines.join("\n")).toContain("Post the answer first");
  });
});

describe("answerFirstGateRefused — what it must let through", () => {
  it("passes a home that has never captured an ask, printing nothing", () => {
    const { lines, refused } = runGate({ env: WORKER_ENV, home: freshHome() });

    expect(refused).toBe(false);
    expect(lines).toEqual([]);
  });

  it("passes a DM, because the public audience is the criterion", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "dm" });
    announceWorker({ home });

    expect(runGate({ env: WORKER_ENV, home }).refused).toBe(false);
  });

  it("passes a session that is not the worker", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });

    expect(runGate({ env: { CLAUDE_CODE_SESSION_ID: "some-other-session" }, home }).refused).toBe(false);
  });

  it("passes when the ask has been answered, which is the ordinary way past this gate", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });
    appendAskLifecycleEvent({
      event: { ...ASK, answerTs: "1789962000.000100", kind: "answered", tsIso: "2026-09-21T05:16:50.000Z" },
      home,
    });

    expect(runGate({ env: WORKER_ENV, home }).refused).toBe(false);
  });

  it("passes when the hatch is open, and says nothing while doing it", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });

    const { lines, refused } = runGate({
      env: { ...WORKER_ENV, SLOPWEAVER_ALLOW_ANSWER_FIRST: "1" },
      home,
    });

    expect(refused).toBe(false);
    expect(lines).toEqual([]);
  });

  it("passes a process that cannot name its own session at all", () => {
    const home = freshHome();
    dispatchFor({ home, surface: "channel" });
    announceWorker({ home });

    expect(runGate({ env: {}, home }).refused).toBe(false);
  });
});
