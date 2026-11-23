/**
 * A real temp home holding a dispatched, announced bot turn — the two files `admit/botTurnAsk.ts` reads, each
 * written through the same store function the live path calls (`answerFirstGate.test.ts` is the shape).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendAskLifecycleEvent } from "../../../live/ask/store.js";
import type { FreshDispatchRecord } from "../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../live/turn/dispatchStore.js";
import { writeWorkerSession } from "../../../live/turn/workerSessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";

/** The owner's Slack user id in every fixture profile. */
export const OWNER = "U0SYNOWNER0001";

/** A colleague who tags the bot about a failed deploy — the worked case in the ruling. */
export const ENGINEER = "U0SYNENGINEER1";

/** The visible worker session holding the dispatched turn. */
export const WORKER_SESSION = "a0000036-0000-4000-8000-000000000039";

const LEASE = "2026-10-13T04:39:36.000Z";

/**
 * Mint a temp home, registering it for removal.
 *
 * @param dirs the caller's cleanup list, emptied in its own `afterEach`
 * @param ownerUserId the profile's `slackBot.ownerUserId`, or `null` to write a profile naming no owner
 * @returns the home path
 */
export function freshHome({ dirs, ownerUserId }: { dirs: string[]; ownerUserId: string | null }): string {
  const home = mkdtempSync(join(tmpdir(), "bot-live-write-"));
  dirs.push(home);
  const slackBot = ownerUserId === null ? {} : { slackBot: { ownerUserId, selfUserIds: [] } };
  writeFileSync(
    stateHomePaths({ home }).profileJson,
    JSON.stringify({ displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [], ...slackBot }),
  );
  return home;
}

/**
 * Remove every home the cleanup list holds.
 *
 * @param dirs the cleanup list, emptied
 */
export function removeHomes({ dirs }: { dirs: string[] }): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

const dispatchRecord = ({ messageTs }: { messageTs: string }): FreshDispatchRecord => ({
  askPermalink: `https://example.slack.com/archives/C0SYNDEPLOYS01/p${messageTs.replace(".", "")}`,
  briefPath: "/tmp/brief.json",
  channel: "C0SYNDEPLOYS01",
  decision: {
    confidence: "high",
    needs: [],
    rationale: "a live investigation is needed",
    response: "respond",
    schemaVersion: 1,
    tier: "fresh-visible-session",
    truthMode: "none",
  },
  dispatchId: `d-${messageTs}`,
  execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
  leaseExpiresAt: LEASE,
  messageTs,
  schemaVersion: 3,
  session: {
    cwd: "/tmp/checkout",
    host: "claude-code",
    sessionName: "ask-worker",
    surfaceId: "s-1",
    surfaceRef: "surface:1",
    workspaceId: "w-1",
    workspaceRef: "workspace:1",
  },
  threadTs: messageTs,
});

/**
 * Capture and dispatch one ask, and optionally announce its worker, exactly as the live path writes each.
 *
 * @param home the fixture home
 * @param asker the Slack user who tagged the bot
 * @param messageTs the ask's own message ts, which keys it
 * @param announcedAs the worker session `turn resume` recorded, or `undefined` for a worker that never ran it
 */
export function dispatchAsk({
  home,
  asker,
  messageTs,
  announcedAs,
}: {
  home: string;
  asker: string;
  messageTs: string;
  announcedAs: string | undefined;
}): void {
  const ask = { channel: "C0SYNDEPLOYS01", messageTs, threadTs: messageTs };
  const record = dispatchRecord({ messageTs });
  appendAskLifecycleEvent({
    event: { ...ask, kind: "captured", surface: "channel", tsIso: "2026-10-13T02:38:28.000Z", userId: asker },
    home,
  });
  appendAskLifecycleEvent({
    event: {
      ...ask,
      decision: record.decision,
      kind: "dispatched",
      leaseExpiresAt: LEASE,
      tier: "fresh-visible-session",
      tsIso: "2026-10-13T02:39:36.000Z",
    },
    home,
  });
  writeDispatchRecord({ home, record });
  if (announcedAs === undefined) return;
  writeWorkerSession({
    askIdentity: ask,
    home,
    record: {
      cwd: "/tmp/checkout",
      host: "claude-code",
      leaseExpiresAt: LEASE,
      recordedAtIso: "2026-10-13T02:40:00.000Z",
      sessionId: announcedAs,
    },
  });
}
