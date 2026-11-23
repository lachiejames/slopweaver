/**
 * The fixtures the `session close-done` parking cases share: a run its seat launched into, the screen and
 * process tree of a seat at rest, a predecessor's park, and a registry whose seat changes between looks.
 */
import { appendSlackDraftEvent } from "../../../../../admit/slackDraftStore.js";
import type { ParkSeatDeps } from "../../../../../cli/commands/session/closeDoneParkLook.js";
import type { CmuxProcess } from "../../../../../cmux/client.js";
import type { ParkedDraft } from "../../../../../handover/parkedEvent.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";
import type { SessionRecord } from "../../../../../sessions/liveSessions.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { home, NO_OWN_PULL_REQUEST, run, SPAWNED_AT, spawnedRow, workspace } from "./closeDoneHarness.js";

/** The worktree the parked seat works in. */
export const PARKED_DIR = "/w/.claude/worktrees/parked-doc";
/** The screen of a Claude Code seat at rest after finishing a turn. */
export const AT_REST = ["⏺ Done for now.", "", "❯ ", "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");
/** The process tree of the parked seat: a shell holding `claude`. */
export const SEAT_TREE: readonly CmuxProcess[] = [
  { children: [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 4200 },
];
/** The workspace the parked seat sits in. */
export const SEAT = workspace({ currentDirectory: PARKED_DIR });

/**
 * A run the named session launched into, with a held Slack draft on its row when asked.
 *
 * @param within a home already holding other rows, which the sweep then meets AFTER this newer one; a fresh one else
 * @returns the fixture home and the run journal directory.
 */
export function parkedFixture({
  heldDraft = false,
  within: fixture = home(),
}: {
  heldDraft?: boolean;
  within?: ReturnType<typeof home>;
} = {}): {
  readonly fixture: ReturnType<typeof home>;
  readonly runsDir: string;
} {
  const runsDir = stateHomePaths({ home: fixture.home }).runs;
  spawnedRow({ cwd: PARKED_DIR, home: fixture.home, slug: "parked-doc", workspaceRef: "workspace:1" });
  run({ finished: false, home: fixture.home, slug: "parked-doc" });
  appendRunEvent({
    event: { atIso: SPAWNED_AT, kind: "launched", pid: 4242, sessionId: "session-parked", worktree: PARKED_DIR },
    runsDir,
    slug: "parked-doc",
  });
  if (heldDraft) {
    const base = {
      advisory: [],
      authorId: "U0SYNADAOWN",
      channel: "C0ISO",
      channelName: "iso-27001",
      form: '{"kind":"one-card","lines":[]}',
      id: "sd-11111111",
      mentions: [],
      payload: {
        form: "plain" as const,
        text: "the reply the owner has not sent",
        unfurl_links: true,
        unfurl_media: true,
      },
      row: "parked-doc",
      shape: "top-level" as const,
      tsIso: SPAWNED_AT,
      why: "a reply",
    };
    const draft = { ...base, digest: parkedDraftDigest({ draft: base }) } as ParkedSlackDraft;
    appendSlackDraftEvent({
      event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso },
      home: fixture.home,
    });
  }
  return { fixture, runsDir };
}

/** The park a predecessor's seat was left open by, carrying the drafts named. */
export function predecessorPark({ runsDir, drafts }: { runsDir: string; drafts?: readonly ParkedDraft[] }): void {
  appendRunEvent({
    event: {
      atIso: "2026-09-03T09:00:00.000Z",
      branch: "parked-doc",
      ...(drafts === undefined ? {} : { drafts }),
      kind: "parked",
      screenTail: "❯ ",
      sessionId: "session-parked",
      workspaceRef: "workspace:1",
      worktree: PARKED_DIR,
    },
    runsDir,
    slug: "parked-doc",
  });
}

/**
 * A registry whose seat reads as `first` for its first `looks` reads (one unless named) and as `after` after.
 *
 * @returns the park seat's registry deps.
 */
export function changing({
  first,
  after,
  looks = 1,
}: {
  first: SessionRecord;
  after: SessionRecord;
  looks?: number;
}): ParkSeatDeps {
  let reads = 0;
  const current = (): SessionRecord => (reads > looks ? after : first);
  return {
    codexThreads: () => () => ({ kind: "not-observed", why: "no Codex process holds it" }),
    ownPullRequests: NO_OWN_PULL_REQUEST,
    registry: () => {
      reads += 1;
      return { records: [current()], refused: [], unreadable: undefined };
    },
    starts: () => ({ starts: new Map([[current().pid, current().procStart!]]) }),
  };
}
