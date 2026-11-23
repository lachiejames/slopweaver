/**
 * `dispatch-unwitnessed` — the third answer between "dispatched" and "nothing ran".
 *
 * The defect these cover, measured live on the ask at message ts `1787878821.099679` → workspace:399
 * (the fourth measured pickup false negative): the pickup command was sent, no witness saw it arrive, and the
 * dispatch was recorded `dispatch-failed` while the worker was alive and already composing its answer. Three
 * things followed from that one wrong word, and there is a case here for each:
 *
 *  - the fold cleared `activeDispatch`, so `turn dispatch --sweep` reported `0 working` over a live worker;
 *  - `burst.ts` released the slot, so the asker's follow-up in the same thread started a SECOND worker, which
 *    went on to compose "the first attempt never got going, nothing ran";
 *  - the thread got a public `:warning:` reaction while the answer was being written.
 *
 * Every case is pure or a real temp-home round trip — the sweep's effects are injected plain fakes, so
 * nothing is mocked and nothing touches a live cmux.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type DispatchSweepDeps, sweepDispatchedAsks } from "../../../../cli/commands/turn/dispatchSweep.js";
import { CMUX_SUBMITTED_MESSAGE_MAX_CHARS } from "../../../../cmux/sendEvidence.js";
import { activeAsks } from "../../../../live/ask/burst.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import type { AppendableAskLifecycleEvent, AppendableDispatchedEvent } from "../../../../live/ask/lifecycle.js";
import { askLifecycleKey, foldAskLifecycle, parseAskLifecycleLog } from "../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, readAskLifecycleText } from "../../../../live/ask/store.js";
import { classifyCandidate } from "../../../../live/listen/recover.js";
import type { FreshDispatchRecord } from "../../../../live/turn/dispatch.js";
import {
  dispatchIdOf,
  freshSessionPickupPrompt,
  unwitnessedPickupCorroboration,
} from "../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../live/turn/dispatchStore.js";
import { quietReviewerSweepDeps } from "../../../reviewerSweepFakes.js";

/** The instant every active-ask read in this file is judged at — inside the fixtures' own window. */
const NOW_ISO = "2026-08-28T01:03:00.000Z";

const ASK: AskIdentity = { channel: "C1", messageTs: "1787878821.099679", threadTs: "1787878821.099679" };
const DISPATCH_ID = dispatchIdOf({ askIdentity: ASK });
const WORKSPACE_ID = "a0000011-0000-4000-8000-000000000012";
const SURFACE_ID = "44444444-4444-4444-8444-444444444444";
const LEASE = "2099-01-01T00:00:00.000Z";
const ASKER = "U1";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const DECISION = {
  confidence: "high",
  needs: [],
  rationale: "an open-ended live investigation",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "current",
} as const;

const DISPATCHED: AppendableDispatchedEvent = {
  ...ASK,
  decision: DECISION,
  kind: "dispatched",
  leaseExpiresAt: LEASE,
  tier: "fresh-visible-session",
  tsIso: "2026-08-28T01:02:00.000Z",
};

const UNWITNESSED: AppendableAskLifecycleEvent = {
  ...ASK,
  kind: "dispatch-unwitnessed",
  reason: "the pickup command was sent into workspace workspace:399 and nothing witnessed it arriving",
  tsIso: "2026-08-28T01:02:40.000Z",
};

const RECORD: FreshDispatchRecord = {
  ...ASK,
  askPermalink: "https://example.slack.com/archives/C1/p1787878821099679",
  briefPath: "/tmp/brief.json",
  decision: DECISION,
  dispatchId: DISPATCH_ID,
  execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
  leaseExpiresAt: LEASE,
  schemaVersion: 3,
  session: {
    cwd: "/tmp/checkout",
    host: "claude-code",
    surfaceId: SURFACE_ID,
    surfaceRef: "surface:400",
    workspaceId: WORKSPACE_ID,
    workspaceRef: "workspace:399",
  },
};

/** A temp state home with one ask captured, dispatched, its pickup unwitnessed, and its record written. */
function unwitnessedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "unwitnessed-dispatch-"));
  fixtureDirs.push(home);
  appendAskLifecycleEvent({
    event: { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-08-28T01:01:00.000Z", userId: ASKER },
    home,
  });
  appendAskLifecycleEvent({ event: DISPATCHED, home });
  appendAskLifecycleEvent({ event: UNWITNESSED, home });
  writeDispatchRecord({ home, record: { ...RECORD, briefPath: join(home, "brief.json") } });
  return home;
}

/** The sweep's effects, with only the two a given case actually exercises supplied. */
function sweepDeps({ lines, submitted }: { lines: string[]; submitted: string | undefined }): DispatchSweepDeps {
  return {
    freshScreenRead: ({ entry }) =>
      Promise.resolve({
        record: { ...RECORD, dispatchId: dispatchIdOf({ askIdentity: entry }) },
        screen: "",
        truth: { kind: "working" },
      }),
    latestSubmittedMessage: () => Promise.resolve(submitted),
    reviewer: quietReviewerSweepDeps(),
    workerLiveness: ({ workspaceId }) =>
      Promise.resolve({ kind: "unknown", reason: "no cmux in a unit test", workspaceId }),
    // No reaction assertion in this case: the sweep is being driven for a different finding, and an
    // `undefined` here is exactly what a home with no Slack bot token supplies.
    reaction: undefined,
    processSnapshot: () => ({ kind: "rows", rows: [] }) as const,
    nowIso: () => "2026-08-28T01:20:00.000Z",
    writeLine: ({ line }) => lines.push(line),
  };
}

describe("the fold — an unwitnessed dispatch is still a dispatch", () => {
  it("keeps activeDispatch, so every reader that keys on it still sees a worker", () => {
    const events = [
      { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-08-28T01:01:00.000Z", userId: ASKER },
      DISPATCHED,
      UNWITNESSED,
    ] as const;

    const entry = foldAskLifecycle({ events }).get(askLifecycleKey({ askIdentity: ASK }))!;

    expect(entry.state).toBe("dispatch-unwitnessed");
    expect(entry.activeDispatch).toStrictEqual(DISPATCHED);
  });

  it("clears activeDispatch for dispatch-failed, which is the state it must not be confused with", () => {
    const events = [
      { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-08-28T01:01:00.000Z", userId: ASKER },
      DISPATCHED,
      { ...ASK, kind: "dispatch-failed", reason: "the workspace is gone", tsIso: "2026-08-28T01:02:40.000Z" },
    ] as const;

    expect(foldAskLifecycle({ events }).get(askLifecycleKey({ askIdentity: ASK }))!.activeDispatch).toBeUndefined();
  });

  it("round-trips through the log's own encoder, reason and all", () => {
    const text = `${JSON.stringify({ ...UNWITNESSED, schemaVersion: 1 })}\n`;

    const parsed = parseAskLifecycleLog({ text });

    expect(parsed.unreadable).toStrictEqual([]);
    expect(parsed.events).toStrictEqual([UNWITNESSED]);
  });

  it("refuses a dispatch-unwitnessed line carrying no reason — an unexplained one names nothing to act on", () => {
    const text = `${JSON.stringify({ ...ASK, kind: "dispatch-unwitnessed", schemaVersion: 1, tsIso: UNWITNESSED.tsIso })}\n`;

    expect(parseAskLifecycleLog({ text }).events).toStrictEqual([]);
  });
});

describe("in flight — an unwitnessed dispatch still counts as live work", () => {
  it("keeps the ask active, unlike dispatch-failed", () => {
    const events = [
      { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-08-28T01:01:00.000Z", userId: ASKER },
      DISPATCHED,
      UNWITNESSED,
    ] as const;

    expect(activeAsks({ nowIso: NOW_ISO, events }).map((ask) => ask.state)).toStrictEqual(["dispatch-unwitnessed"]);
  });
});

describe("listen recover — an unwitnessed dispatch is IN FLIGHT, never already worked", () => {
  it("excludes the ask as in-flight, so no recovery pass re-captures a live worker's ask", () => {
    const events = [
      { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-08-28T01:01:00.000Z", userId: ASKER },
      DISPATCHED,
      UNWITNESSED,
    ] as const;

    const verdict = classifyCandidate({
      allowedChannels: [ASK.channel],
      botUserId: "UBOT",
      cardEventType: "slopweaver_card_v1",
      candidate: {
        ...ASK,
        rawText: "<@UBOT> what is the staging pool doing",
        selfAuthored: false,
        surface: "channel",
        threadAnswers: [],
        threadMarks: [],
        tsIso: "2026-08-28T01:01:00.000Z",
        userId: ASKER,
      },
      ignored: new Map(),
      ignoredConversations: new Map(),
      lifecycles: foldAskLifecycle({ events }),
      since: "2026-08-27T00:00:00.000Z",
      terminalByAsk: new Map(),
    });

    expect(verdict.exclusions).toStrictEqual(["in-flight"]);
  });
});

describe("unwitnessedPickupCorroboration — the reconciliation decision", () => {
  it("confirms from cmux's own delivery record, rebuilding the expected pickup from the ask alone", () => {
    const sent = freshSessionPickupPrompt({ dispatchId: DISPATCH_ID });

    expect(unwitnessedPickupCorroboration({ askIdentity: ASK, latestSubmittedMessage: sent })).toBe(
      "cmux's own latest_submitted_message for the recorded workspace corroborates the pickup command",
    );
  });

  // cmux keeps only the first 240 characters and appends an ellipsis; this prompt is far longer, so an
  // equality or `includes` check would never match. See `cmux/sendEvidence.ts` for the live measurement.
  it("confirms from the TRUNCATED record cmux actually reports, not just an untruncated one", () => {
    const sent = freshSessionPickupPrompt({ dispatchId: DISPATCH_ID });
    const truncated = `${sent.slice(0, CMUX_SUBMITTED_MESSAGE_MAX_CHARS)}…`;

    expect(sent.length).toBeGreaterThan(CMUX_SUBMITTED_MESSAGE_MAX_CHARS);
    expect(unwitnessedPickupCorroboration({ askIdentity: ASK, latestSubmittedMessage: truncated })).toBe(
      "cmux's own latest_submitted_message for the recorded workspace corroborates the pickup command",
    );
  });

  it("declines a record naming a DIFFERENT ask's pickup", () => {
    const other = freshSessionPickupPrompt({
      dispatchId: dispatchIdOf({ askIdentity: { ...ASK, messageTs: "1787879635.954139" } }),
    });

    expect(unwitnessedPickupCorroboration({ askIdentity: ASK, latestSubmittedMessage: other })).toBeUndefined();
  });

  it("declines when cmux has no delivery record at all — the workspace has accepted no prompt", () => {
    expect(unwitnessedPickupCorroboration({ askIdentity: ASK, latestSubmittedMessage: undefined })).toBeUndefined();
  });
});

describe("turn dispatch --sweep — an unwitnessed dispatch is swept like a running one", () => {
  it("counts it as still working, which is exactly what dispatch-failed made it invisible to", async () => {
    const home = unwitnessedHome();
    const lines: string[] = [];

    await sweepDispatchedAsks({ deps: sweepDeps({ lines, submitted: undefined }), home });

    expect(lines[lines.length - 1]).toBe(
      "sweep: 0 ready, 1 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, " +
        "0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    );
  });

  it("reconciles it to dispatch-witnessed once cmux's delivery record corroborates the pickup", async () => {
    const home = unwitnessedHome();
    const lines: string[] = [];
    const sent = freshSessionPickupPrompt({ dispatchId: DISPATCH_ID });

    await sweepDispatchedAsks({ deps: sweepDeps({ lines, submitted: sent }), home });

    const entry = foldAskLifecycle({
      events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events,
    }).get(askLifecycleKey({ askIdentity: ASK }))!;
    expect(entry.state).toBe("dispatch-witnessed");
    expect(entry.activeDispatch).toStrictEqual(DISPATCHED);
    expect(lines[0]).toBe(
      "dispatch-witnessed (reconciled): C1/1787878821.099679 — cmux's own latest_submitted_message for the recorded workspace corroborates the pickup command",
    );
  });

  it("leaves it unwitnessed when nothing corroborates — a missing confirmation is never a negative one", async () => {
    const home = unwitnessedHome();
    const lines: string[] = [];

    await sweepDispatchedAsks({ deps: sweepDeps({ lines, submitted: undefined }), home });

    const entry = foldAskLifecycle({
      events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events,
    }).get(askLifecycleKey({ askIdentity: ASK }))!;
    expect(entry.state).toBe("dispatch-unwitnessed");
  });

  it("still catches a phantom workspace behind it, so an unwitnessed dispatch cannot hide a dead one", async () => {
    const home = unwitnessedHome();
    const lines: string[] = [];
    const deps: DispatchSweepDeps = {
      ...sweepDeps({ lines, submitted: undefined }),
      freshScreenRead: ({ entry }) =>
        Promise.resolve({
          record: { ...RECORD, dispatchId: dispatchIdOf({ askIdentity: entry }) },
          screen: "",
          truth: { kind: "phantom", reason: "the workspace this dispatch recorded is gone", workspaceId: WORKSPACE_ID },
        }),
    };

    await sweepDispatchedAsks({ deps, home });

    const entry = foldAskLifecycle({
      events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events,
    }).get(askLifecycleKey({ askIdentity: ASK }))!;
    expect(entry.state).toBe("dispatch-failed");
  });
});
