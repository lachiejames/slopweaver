/**
 * The sweep's recording half — the durable lifecycle event each swept ask earns. The Slack half (finalising
 * the card, the status and the reaction) needs a bot token, which these cases deliberately do not have: the
 * ledger must still be written when the thread cannot be reached.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  recordFollowThroughStopped,
  recordLeaseExpiry,
  recordPhantomDispatch,
  recordUndispatchedAsk,
  recordWorkerFailure,
} from "../../../../../cli/commands/turn/sweptRecords.js";
import {
  type AppendableDispatchedEvent,
  type AskLifecycle,
  parseAskLifecycleLog,
} from "../../../../../live/ask/lifecycle.js";
import {
  appendAskLifecycleEvent,
  capturedAskFor,
  ensureCapturedAskLifecycle,
  readAskLifecycleText,
} from "../../../../../live/ask/store.js";
import type { RespondDecision } from "../../../../../live/turn/tier.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };
const NOW = "2026-10-02T03:00:00.000Z";
const FIRST_ANSWER_ISO = "2026-10-02T00:30:00.000Z";

const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "none",
};

const DISPATCHED: AppendableDispatchedEvent = {
  ...ASK,
  decision: DECISION,
  kind: "dispatched",
  leaseExpiresAt: "2026-10-02T02:00:00.000Z",
  tier: "fresh-visible-session",
  tsIso: "2026-10-02T00:00:00.000Z",
};

const fixtureDirs: string[] = [];
let exportedToken: string | undefined;

beforeEach(() => {
  // The resolver reads SLACK_BOT_TOKEN before the home's secret file, so a machine with the token exported would
  // send these cases to Slack. Absent has to hold for the environment too, not just the temp home.
  exportedToken = process.env["SLACK_BOT_TOKEN"];
  delete process.env["SLACK_BOT_TOKEN"];
});

afterEach(() => {
  if (exportedToken !== undefined) {
    process.env["SLACK_BOT_TOKEN"] = exportedToken;
  }
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home holding one captured ask — dispatched when asked, and with a first answer standing when asked. */
function askIn({ dispatched, firstAnswered }: { dispatched: boolean; firstAnswered: boolean }): {
  readonly entry: AskLifecycle;
  readonly home: string;
} {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-swept-records-"));
  fixtureDirs.push(home);
  ensureCapturedAskLifecycle({ askIdentity: ASK, home, surface: "channel", userId: "U0OWNER" });
  if (dispatched) {
    appendAskLifecycleEvent({ event: DISPATCHED, home });
  }
  if (firstAnswered) {
    appendAskLifecycleEvent({
      event: {
        ...ASK,
        answerDigest: `sha256:${"a".repeat(64)}`,
        answerTs: "1785000100.000200",
        kind: "first-answered",
        leaseExpiresAt: "2026-10-02T04:30:00.000Z",
        owes: "pull-requests",
        tsIso: FIRST_ANSWER_ISO,
        what: "open the PR",
      },
      home,
    });
  }
  return { entry: capturedAskFor({ channel: ASK.channel, home, messageTs: ASK.messageTs })!, home };
}

/** The last event the log holds. */
function lastEvent({ home }: { home: string }): ReturnType<typeof parseAskLifecycleLog>["events"][number] {
  return parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events.at(-1)!;
}

describe("recordLeaseExpiry", () => {
  it("appends a lease-expired event stamped with the sweep's instant, even with no bot token to finalise the card", async () => {
    const { entry, home } = askIn({ dispatched: true, firstAnswered: false });

    await recordLeaseExpiry({ dispatched: DISPATCHED, entry, home, nowIso: NOW });

    expect(lastEvent({ home })).toEqual({ ...ASK, kind: "lease-expired", tsIso: NOW });
  });

  it("appends the same lease-expired event when a first answer stands — the plan does not change what the ledger holds", async () => {
    const { entry, home } = askIn({ dispatched: true, firstAnswered: true });

    await recordLeaseExpiry({ dispatched: DISPATCHED, entry, home, nowIso: NOW });

    expect(lastEvent({ home })).toEqual({ ...ASK, kind: "lease-expired", tsIso: NOW });
  });

  it("keeps the first answer on the folded ask — a lease expiry is not an ending", async () => {
    const { entry, home } = askIn({ dispatched: true, firstAnswered: true });

    await recordLeaseExpiry({ dispatched: DISPATCHED, entry, home, nowIso: NOW });

    const after = capturedAskFor({ channel: ASK.channel, home, messageTs: ASK.messageTs })!;
    expect(after.firstAnswer!.tsIso).toBe(FIRST_ANSWER_ISO);
  });
});

describe("recordFollowThroughStopped", () => {
  it("appends a `failed` event, never `dispatch-failed`, naming the first answer's instant", async () => {
    const { entry, home } = askIn({ dispatched: true, firstAnswered: true });

    await recordFollowThroughStopped({
      dispatched: DISPATCHED,
      entry,
      firstAnswerIso: FIRST_ANSWER_ISO,
      home,
      nowIso: NOW,
    });

    expect(lastEvent({ home })).toEqual({
      ...ASK,
      kind: "failed",
      reason: `the worker's workspace is gone after it posted its first answer at ${FIRST_ANSWER_ISO}`,
      tsIso: NOW,
    });
  });
});

describe("recordPhantomDispatch", () => {
  it("appends a dispatch-failed event carrying the liveness check's own finding verbatim", async () => {
    const { entry, home } = askIn({ dispatched: true, firstAnswered: false });

    await recordPhantomDispatch({
      dispatched: DISPATCHED,
      entry,
      home,
      nowIso: NOW,
      reason: "workspace:1 no longer exists",
    });

    expect(lastEvent({ home })).toEqual({
      ...ASK,
      kind: "dispatch-failed",
      reason: "workspace:1 no longer exists",
      tsIso: NOW,
    });
  });
});

describe("recordUndispatchedAsk", () => {
  it("appends a dispatch-failed event for an ask nothing ever routed", async () => {
    const { entry, home } = askIn({ dispatched: false, firstAnswered: false });

    await recordUndispatchedAsk({ entry, home, nowIso: NOW, reason: "no session ever picked this up" });

    expect(lastEvent({ home })).toEqual({
      ...ASK,
      kind: "dispatch-failed",
      reason: "no session ever picked this up",
      tsIso: NOW,
    });
  });
});

describe("recordWorkerFailure", () => {
  it("appends a terminal failed event carrying the worker's own words, not the card's colleague-safe sentence", async () => {
    const { entry, home } = askIn({ dispatched: true, firstAnswered: false });

    await recordWorkerFailure({
      dispatched: DISPATCHED,
      entry,
      home,
      nowIso: NOW,
      reason: "the Datadog token is expired",
    });

    expect(lastEvent({ home })).toEqual({
      ...ASK,
      kind: "failed",
      reason: "the Datadog token is expired",
      tsIso: NOW,
    });
  });
});
