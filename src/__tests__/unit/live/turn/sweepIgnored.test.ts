/**
 * sweepIgnored — the sweep must not invite a session to re-answer an ask the owner killed.
 *
 * The defect, measured: `turn dispatch --sweep` printed
 * `ready: D0SYN000001/1789422881.103369 — <path> (unposted 9045m, check its reviewer)` for an ask that
 * `live/slack/ignored-asks.jsonl` had carried for days on the owner's own word. The
 * answer file the line named had already been reaped. `turn ignore` appends no terminal lifecycle event, so
 * the ask's `activeDispatch` never clears and every arm of the sweep keys on it — six days of the same line,
 * every ten minutes.
 *
 * The fixture carries TWO dispatched asks, one ignored and one live, driven through the REAL
 * `sweepDispatchedAsks` with plain injected fakes — no mocks, no cmux, no clock. Both halves are asserted:
 * an `ignored` sweep that reported nothing at all would pass a `not.toContain` on its own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type DispatchSweepDeps, sweepDispatchedAsks } from "../../../../cli/commands/turn/dispatchSweep.js";
import { admittedSweepAsks } from "../../../../cli/commands/turn/sweepEntrance.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import type { IgnoredAsk } from "../../../../live/ask/ignore.js";
import type { IgnoredConversation } from "../../../../live/ask/ignoredConversation.js";
import { appendIgnoredConversation } from "../../../../live/ask/ignoredConversationStore.js";
import { appendIgnoredAsk } from "../../../../live/ask/ignoreStore.js";
import type { AppendableDispatchedEvent, AskLifecycle } from "../../../../live/ask/lifecycle.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, readAskLifecycleText } from "../../../../live/ask/store.js";
import type { FreshDispatchRecord } from "../../../../live/turn/dispatch.js";
import { dispatchIdOf } from "../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../live/turn/dispatchStore.js";
import { ignoredSweepLine, partitionIgnoredSweepAsks } from "../../../../live/turn/sweepIgnored.js";
import { emptySweepCounts } from "../../../../live/turn/sweepSummary.js";
import { quietReviewerSweepDeps } from "../../../reviewerSweepFakes.js";

/** The ask the owner killed — the channel and ts of the measurement. */
const KILLED: AskIdentity = {
  channel: "D0SYN000001",
  messageTs: "1789422881.103369",
  threadTs: "1789422881.103369",
};

/** A second ask, in a different channel, that nothing has ever ignored. */
const LIVE: AskIdentity = { channel: "C1", messageTs: "1789500000.111111", threadTs: "1789500000.111111" };

const IGNORED_AT = "2026-09-15T03:38:02.000Z";
const NOW_ISO = "2026-09-21T07:25:00.000Z";
const LEASE = "2099-01-01T00:00:00.000Z";
const WORKSPACE_ID = "a0000011-0000-4000-8000-000000000012";
const SURFACE_ID = "44444444-4444-4444-8444-444444444444";

const DECISION = {
  confidence: "high",
  needs: [],
  rationale: "an open-ended live investigation",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "current",
} as const;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** The `dispatched` event both asks in the fixture carry. */
function dispatchedEvent({ askIdentity }: { askIdentity: AskIdentity }): AppendableDispatchedEvent {
  return {
    ...askIdentity,
    decision: DECISION,
    kind: "dispatched",
    leaseExpiresAt: LEASE,
    tier: "fresh-visible-session",
    tsIso: "2026-09-15T03:00:00.000Z",
  };
}

/** The dispatch record that makes one ask's `fresh-visible-session` read resolve. */
function dispatchRecord({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): FreshDispatchRecord {
  return {
    ...askIdentity,
    askPermalink: `https://example.slack.com/archives/${askIdentity.channel}/p1`,
    briefPath: join(home, "brief.json"),
    decision: DECISION,
    dispatchId: dispatchIdOf({ askIdentity }),
    execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
    leaseExpiresAt: LEASE,
    schemaVersion: 3,
    session: {
      host: "claude-code",
      surfaceId: SURFACE_ID,
      surfaceRef: "surface:145",
      workspaceId: WORKSPACE_ID,
      workspaceRef: "workspace:136",
    },
  };
}

/** A temp home carrying both asks captured and dispatched, with the killed one in the ignore registry. */
function twoAskHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sweep-ignored-"));
  fixtureDirs.push(home);
  for (const askIdentity of [KILLED, LIVE]) {
    appendAskLifecycleEvent({
      event: { ...askIdentity, kind: "captured", surface: "channel", tsIso: "2026-09-15T02:59:00.000Z", userId: "U1" },
      home,
    });
    appendAskLifecycleEvent({ event: dispatchedEvent({ askIdentity }), home });
    writeDispatchRecord({ home, record: dispatchRecord({ askIdentity, home }) });
  }
  appendIgnoredAsk({
    entry: { ...KILLED, ignoredAtIso: IGNORED_AT, reason: "the owner killed this one", schemaVersion: 1 },
    home,
  });
  return home;
}

/** Sweep deps whose every ask reads READY — the exact arm that was inviting the re-answer. */
function readySweepDeps({ home, lines }: { home: string; lines: string[] }): DispatchSweepDeps {
  return {
    freshScreenRead: ({ entry }) =>
      Promise.resolve({
        record: dispatchRecord({ askIdentity: entry, home }),
        screen: "",
        truth: {
          answerPath: join(home, "answer.json"),
          dispatchId: dispatchIdOf({ askIdentity: entry }),
          kind: "ready",
        },
      }),
    latestSubmittedMessage: () => Promise.resolve(undefined),
    nowIso: () => NOW_ISO,
    processSnapshot: () => ({ kind: "rows", rows: [] }) as const,
    // `undefined` is exactly what a home with no Slack bot token supplies, and it is the honest value here:
    // a reaction assertion is a WRITE, and the point of this suite is that the ignored ask reaches none.
    reaction: undefined,
    reviewer: quietReviewerSweepDeps(),
    workerLiveness: ({ workspaceId }) =>
      Promise.resolve({ kind: "unknown", reason: "no cmux in a unit test", workspaceId }),
    writeLine: ({ line }) => lines.push(line),
  };
}

/** The folded lifecycles of a home, in log order — what the sweep's own selection is built from. */
function lifecyclesOf({ home }: { home: string }): readonly AskLifecycle[] {
  return [
    ...foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events }).values(),
  ];
}

describe("turn dispatch --sweep over a permanently ignored ask", () => {
  it("prints no ready line for the ignored ask, and still prints one for the live ask beside it", async () => {
    const home = twoAskHome();
    const lines: string[] = [];
    const code = await sweepDispatchedAsks({ deps: readySweepDeps({ home, lines }), home });
    expect(code).toBe(0);
    expect(lines).toStrictEqual([
      `ignored (not swept): D0SYN000001/1789422881.103369 — this exact ask is permanently ignored since ` +
        `${IGNORED_AT} (the owner killed this one); lift it with slopweaver turn ignore --remove ` +
        `--channel D0SYN000001 --message-ts 1789422881.103369 --reason "<why>"`,
      // The falsifiable witness that the exclusion covers more than the `ready` reading: the reaction
      // assertion is an outbound WRITE arm, and it fires for the live ask and for that ask ALONE. An
      // implementation that only suppressed `ready` would print this line for the ignored ask too.
      "reaction: C1/1789500000.111111 — expected :eyes: (working); could not check what it is wearing — " +
        "no Slack bot token is configured",
      `ready: C1/1789500000.111111 — ${join(home, "answer.json")}`,
      "sweep: 1 ready, 0 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, " +
        "0 never-dispatched, 0 checklist-update-failed, 1 ignored",
    ]);
  });

  it("leaves the ignored ask's lifecycle untouched — a suppression settles nothing", async () => {
    const home = twoAskHome();
    const before = readAskLifecycleText({ home });
    await sweepDispatchedAsks({ deps: readySweepDeps({ home, lines: [] }), home });
    expect(readAskLifecycleText({ home })).toBe(before);
  });

  it("still names an ignored ask the operator asked about by hand, rather than refusing as unknown", async () => {
    const home = twoAskHome();
    const lines: string[] = [];
    const code = await sweepDispatchedAsks({ deps: readySweepDeps({ home, lines }), home, only: KILLED });
    expect(code).toBe(0);
    expect(lines).toStrictEqual([
      `ignored (not swept): D0SYN000001/1789422881.103369 — this exact ask is permanently ignored since ` +
        `${IGNORED_AT} (the owner killed this one); lift it with slopweaver turn ignore --remove ` +
        `--channel D0SYN000001 --message-ts 1789422881.103369 --reason "<why>"`,
      "sweep: 0 ready, 0 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, " +
        "0 never-dispatched, 0 checklist-update-failed, 1 ignored",
    ]);
  });

  it("suppresses an ask whose whole CONVERSATION is ignored, the same as every other entrance", async () => {
    const home = twoAskHome();
    appendIgnoredConversation({
      entry: {
        channel: LIVE.channel,
        ignoredAtIso: IGNORED_AT,
        kind: "ignore",
        reason: "the owner's DM",
        schemaVersion: 1,
      },
      home,
    });
    const lines: string[] = [];
    await sweepDispatchedAsks({ deps: readySweepDeps({ home, lines }), home });
    expect(lines.filter((line) => line.startsWith("ready:"))).toStrictEqual([]);
    expect(lines.filter((line) => line.startsWith("ignored (not swept): C1/"))).toStrictEqual([
      `ignored (not swept): C1/1789500000.111111 — this whole conversation is permanently ignored since ` +
        `${IGNORED_AT} (the owner's DM); lift it with slopweaver turn ignore-conversation --remove --channel C1 ` +
        `--reason "<why>"`,
    ]);
  });

  it("lifts cleanly — an unignored ask is swept again with no other change", async () => {
    const home = twoAskHome();
    appendIgnoredAsk({
      entry: { ...KILLED, ignoredAtIso: NOW_ISO, kind: "unignore", reason: "reopened", schemaVersion: 1 },
      home,
    });
    const lines: string[] = [];
    await sweepDispatchedAsks({ deps: readySweepDeps({ home, lines }), home });
    expect(lines.filter((line) => line.startsWith("ignored (not swept):"))).toStrictEqual([]);
    expect(lines.filter((line) => line.startsWith("ready:")).length).toBe(2);
  });
});

describe("partitionIgnoredSweepAsks", () => {
  it("keeps both halves in log order, so the sweep's two-pass ordering is untouched", () => {
    const home = twoAskHome();
    const entries = lifecyclesOf({ home });
    expect(entries.map((entry) => entry.messageTs)).toStrictEqual([KILLED.messageTs, LIVE.messageTs]);
    const ignoredAsks = new Map<string, IgnoredAsk>([
      [
        JSON.stringify([KILLED.channel, KILLED.messageTs]),
        { ...KILLED, ignoredAtIso: IGNORED_AT, reason: "killed", schemaVersion: 1 },
      ],
    ]);
    const partition = partitionIgnoredSweepAsks({
      entries,
      ignoredAsks,
      ignoredConversations: new Map<string, IgnoredConversation>(),
    });
    expect(partition.sweep.map((entry) => entry.messageTs)).toStrictEqual([LIVE.messageTs]);
    expect(partition.ignored.map((ask) => ask.entry.messageTs)).toStrictEqual([KILLED.messageTs]);
    expect(partition.ignored[0]!.registry).toBe("ask");
    expect(partition.ignored[0]!.since).toBe(IGNORED_AT);
    expect(partition.ignored[0]!.reason).toBe("killed");
  });

  it("suppresses nothing when both registries are empty", () => {
    const partition = partitionIgnoredSweepAsks({
      entries: lifecyclesOf({ home: twoAskHome() }),
      ignoredAsks: new Map<string, IgnoredAsk>(),
      ignoredConversations: new Map<string, IgnoredConversation>(),
    });
    expect(partition.sweep.map((entry) => entry.messageTs)).toStrictEqual([KILLED.messageTs, LIVE.messageTs]);
    expect(partition.ignored).toStrictEqual([]);
  });
});

describe("ignoredSweepLine", () => {
  it("names the ask-registry lift command, so a wrong suppression is not a dead end", () => {
    const home = twoAskHome();
    const entry = lifecyclesOf({ home }).find((ask) => ask.messageTs === KILLED.messageTs)!;
    expect(ignoredSweepLine({ ask: { entry, reason: "265-12", registry: "ask", since: IGNORED_AT } })).toBe(
      `ignored (not swept): D0SYN000001/1789422881.103369 — this exact ask is permanently ignored since ` +
        `${IGNORED_AT} (265-12); lift it with slopweaver turn ignore --remove --channel D0SYN000001 ` +
        `--message-ts 1789422881.103369 --reason "<why>"`,
    );
  });

  it("names the conversation-registry lift command instead when that is what caught it", () => {
    const home = twoAskHome();
    const entry = lifecyclesOf({ home }).find((ask) => ask.messageTs === LIVE.messageTs)!;
    expect(
      ignoredSweepLine({ ask: { entry, reason: "the owner's DM", registry: "conversation", since: IGNORED_AT } }),
    ).toBe(
      `ignored (not swept): C1/1789500000.111111 — this whole conversation is permanently ignored since ` +
        `${IGNORED_AT} (the owner's DM); lift it with slopweaver turn ignore-conversation --remove --channel C1 ` +
        `--reason "<why>"`,
    );
  });
});

describe("admittedSweepAsks", () => {
  it("returns only the live ask, writes one line for the suppressed one, and counts it", () => {
    const home = twoAskHome();
    const lines: string[] = [];
    const counts = emptySweepCounts();
    const admitted = admittedSweepAsks({
      counts,
      entries: lifecyclesOf({ home }),
      home,
      writeLine: ({ line }) => lines.push(line),
    });
    expect(admitted.map((ask) => `${ask.channel}/${ask.messageTs}`)).toStrictEqual(["C1/1789500000.111111"]);
    expect(counts.ignored).toBe(1);
    expect(lines).toStrictEqual([
      `ignored (not swept): D0SYN000001/1789422881.103369 — this exact ask is permanently ignored since ` +
        `${IGNORED_AT} (the owner killed this one); lift it with slopweaver turn ignore --remove ` +
        `--channel D0SYN000001 --message-ts 1789422881.103369 --reason "<why>"`,
    ]);
  });

  it("admits everything, silently, in a home whose registries have never been written", () => {
    const home = mkdtempSync(join(tmpdir(), "sweep-ignored-empty-"));
    fixtureDirs.push(home);
    appendAskLifecycleEvent({
      event: { ...LIVE, kind: "captured", surface: "channel", tsIso: "2026-09-15T02:59:00.000Z", userId: "U1" },
      home,
    });
    const lines: string[] = [];
    const counts = emptySweepCounts();
    const admitted = admittedSweepAsks({
      counts,
      entries: lifecyclesOf({ home }),
      home,
      writeLine: ({ line }) => lines.push(line),
    });
    expect(admitted.map((ask) => `${ask.channel}/${ask.messageTs}`)).toStrictEqual(["C1/1789500000.111111"]);
    expect(counts.ignored).toBe(0);
    expect(lines).toStrictEqual([]);
  });
});
