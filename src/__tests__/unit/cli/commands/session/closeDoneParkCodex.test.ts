/**
 * `session close-done` parking a seat that runs Codex, not Claude Code: bound by Codex's own idle composer and a
 * process in the seat's tree holding the thread its run launched — and kept, never closed, when either is missing.
 */
import { afterEach, describe, expect, it } from "vitest";

import { closeDoneWithClient } from "../../../../../cli/commands/session/closeDone.js";
import type { CmuxProcess } from "../../../../../cmux/client.js";
import { appendRunEvent, readRunJournal } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import type { CodexThreadObserver } from "../../../../../measurement/codexSessions.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { CODEX_IDLE_AFTER_TURNS, CODEX_RUNNING } from "../../../../fixtures/codexTui.js";
import { fakeClient } from "./closeDoneFakeCmux.js";
import {
  deps,
  home,
  outcomesOf,
  registry,
  removeFixtureDirs,
  run,
  SPAWNED_AT,
  spawnedRow,
  workspace,
} from "./closeDoneHarness.js";

afterEach(removeFixtureDirs);

const CODEX_DIR = "/w/.claude/worktrees/codex-doc";
const SEAT = workspace({ currentDirectory: CODEX_DIR });
/** A shell holding `codex`, whose pid holds the run's thread. */
const CODEX_TREE: readonly CmuxProcess[] = [
  { children: [{ children: [], name: "codex", pid: 5151 }], name: "zsh", pid: 5100 },
];
const CODEX_START: readonly [number, string] = [5151, "Thu Sep  3 08:00:00 2026"];

/** A run a Codex seat launched into, thread `thread-parked` from pid 5151. */
function codexFixture(): { readonly fixture: ReturnType<typeof home>; readonly runsDir: string } {
  const fixture = home();
  const runsDir = stateHomePaths({ home: fixture.home }).runs;
  spawnedRow({ cwd: CODEX_DIR, home: fixture.home, slug: "codex-doc", workspaceRef: "workspace:1" });
  run({ finished: false, home: fixture.home, slug: "codex-doc" });
  appendRunEvent({
    event: {
      atIso: SPAWNED_AT,
      host: "codex",
      kind: "launched",
      pid: 5151,
      sessionId: "thread-parked",
      worktree: CODEX_DIR,
    },
    runsDir,
    slug: "codex-doc",
  });
  return { fixture, runsDir };
}

/** An observer that sees `thread-parked` held by `pid`, recording what it was asked. */
function holding({ pid }: { pid: number }): { readonly observe: CodexThreadObserver; readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    observe: ({ threadId }) => {
      asked.push(threadId);
      if (threadId !== "thread-parked") {
        return { kind: "not-observed", why: "no Codex process holds it" };
      }
      return { kind: "live", path: "/c/sessions/rollout-thread-parked.jsonl", pid };
    },
  };
}

describe("closeDoneWithClient — parking a Codex seat", () => {
  it("journals the checkpoint under the Codex thread and closes the seat when its holder is in the tree", async () => {
    const { fixture, runsDir } = codexFixture();
    const fake = fakeClient({
      screens: { "id-1": CODEX_IDLE_AFTER_TURNS },
      trees: { "id-1": [CODEX_TREE] },
      workspaces: [SEAT],
    });
    const { observe } = holding({ pid: 5151 });
    const parkSeat = registry({ codexThread: observe, records: [], starts: [CODEX_START] });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });

    expect(outcomesOf(swept)).toEqual([
      {
        drafts: 0,
        how: "recorded",
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "parked",
      },
    ]);
    expect(fake.closed).toEqual(["id-1"]);
    const parked = unwrap(readRunJournal({ runsDir, slug: "codex-doc" })).events.at(-1)!;
    expect(parked.kind).toBe("parked");
    expect((parked as { readonly sessionId: string }).sessionId).toBe("thread-parked");
  });

  it("keeps the seat, UNMEASURED, when the thread's holder is outside its tree", async () => {
    const { fixture, runsDir } = codexFixture();
    const fake = fakeClient({
      screens: { "id-1": CODEX_IDLE_AFTER_TURNS },
      trees: { "id-1": [CODEX_TREE] },
      workspaces: [SEAT],
    });
    const { observe } = holding({ pid: 9999 });
    const parkSeat = registry({ codexThread: observe, records: [], starts: [CODEX_START] });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });

    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "seat-unidentified",
        why: "no Claude Code session runs in its process tree, and its Codex thread is UNMEASURED — no Codex thread of its run is held in its process tree (thread-parked: held by pid 9999, outside its process tree)",
      },
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "codex-doc" })).events.map((event) => event.kind)).toEqual([
      "started",
      "launched",
    ]);
  });

  it("re-reads Codex's open files on the last look, so a thread moved outside the tree since leaves the seat open", async () => {
    const { fixture, runsDir } = codexFixture();
    const fake = fakeClient({
      screens: { "id-1": CODEX_IDLE_AFTER_TURNS },
      trees: { "id-1": [CODEX_TREE] },
      workspaces: [SEAT],
    });
    // Looks one and two (observe, reobserve) see pid 5151 hold the thread; the last look before the close sees pid 9999.
    let looks = 0;
    const codexThreads = (): CodexThreadObserver => {
      looks += 1;
      return holding({ pid: looks > 2 ? 9999 : 5151 }).observe;
    };
    const parkSeat = registry({ codexThreads, records: [], starts: [CODEX_START] });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });

    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        journalled: true,
        kind: "park-failed",
        reason:
          "its session changed right before the close (no Claude Code session runs in its process tree, and its Codex thread is UNMEASURED — no Codex thread of its run is held in its process tree (thread-parked: held by pid 9999, outside its process tree)), so the seat is left open",
      },
    ]);
    expect(looks).toBe(3);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "codex-doc" })).events.at(-1)!.kind).toBe("parked");
  });

  it("keeps a seat whose screen shows a Codex turn running, and asks Codex nothing", async () => {
    const { fixture } = codexFixture();
    const fake = fakeClient({
      screens: { "id-1": CODEX_RUNNING },
      trees: { "id-1": [CODEX_TREE] },
      workspaces: [SEAT],
    });
    const { asked, observe } = holding({ pid: 5151 });
    const parkSeat = registry({ codexThread: observe, records: [], starts: [CODEX_START] });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, parkSeat }) });

    expect(outcomesOf(swept).map((outcome) => [outcome.kind, "reason" in outcome ? outcome.reason : ""])).toEqual([
      ["park-kept", "screen-working"],
    ]);
    expect(asked).toStrictEqual([]);
    expect(fake.closed).toEqual([]);
  });
});
