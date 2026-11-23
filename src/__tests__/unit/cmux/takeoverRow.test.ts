/**
 * `cmux takeover`'s board-row half, over a real journal in a throwaway home.
 *
 * Step 6 is the whole point of the six-step takeover, and the two things it promises are exactly what a
 * reviewer cannot read off the source: that the event it writes REACHES the journal, and that a write it
 * cannot make does not stop the verb. Both are asserted here against the file on disk.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeSiblings,
  predecessorLedgerRow,
  predecessorRunGate,
  recordPredecessorRowClosed,
} from "../../../cli/commands/cmux/takeoverRow.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { parseLedger } from "../../../handover/ledger.js";
import { appendRunEvent } from "../../../handover/runStore.js";
import type { SessionItem } from "../../../sessions/session.js";
import { appendSessionEvent } from "../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "takeover-row-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every event standing in one slug's journal, read back off disk. */
function journalKinds({ slug }: { slug: string }): readonly string[] {
  const path = join(stateHomePaths({ home }).runs, `${slug}.jsonl`);
  return parseLedger({ text: readFileSync(path, "utf8") }).events.map((event) => event.kind);
}

/** The summary of one slug's only `closed` event. */
function closedSummary({ slug }: { slug: string }): string {
  const path = join(stateHomePaths({ home }).runs, `${slug}.jsonl`);
  const events = parseLedger({ text: readFileSync(path, "utf8") }).events;
  return events.find((event) => event.kind === "closed")!.summary;
}

describe("recordPredecessorRowClosed", () => {
  it("writes ONE closed event naming the pin that replaced the chair", () => {
    recordPredecessorRowClosed({
      home,
      predecessorSlug: "fresh-supervisor-handoff-9290",
      successorRef: "workspace:137",
    });
    expect(journalKinds({ slug: "fresh-supervisor-handoff-9290" })).toEqual(["closed"]);
    expect(closedSummary({ slug: "fresh-supervisor-handoff-9290" })).toBe(
      "the supervisor pin moved to workspace:137; this chair retired",
    );
  });

  it("returns normally on a slug the row writer REFUSES, so a completed pin swap is never undone", () => {
    expect(
      recordPredecessorRowClosed({ home, predecessorSlug: "../escape", successorRef: "workspace:137" }),
    ).toBeUndefined();
  });

  it("refuses a SECOND close rather than appending one, and leaves the first standing", () => {
    recordPredecessorRowClosed({ home, predecessorSlug: "chair-a", successorRef: "workspace:1" });
    recordPredecessorRowClosed({ home, predecessorSlug: "chair-a", successorRef: "workspace:2" });
    expect(journalKinds({ slug: "chair-a" })).toEqual(["closed"]);
    expect(closedSummary({ slug: "chair-a" })).toBe("the supervisor pin moved to workspace:1; this chair retired");
  });
});

/** One live workspace as `cmux list` reports it. */
function liveWorkspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/w/.claude/worktrees/fresh-supervisor-handoff-9290",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: true,
    selected: false,
    title: "/slopweaver:supervisor",
    windowId: "window:1",
    workspaceId: "id-chair",
    workspaceRef: "workspace:1",
    ...over,
  };
}

/** The canonicaliser for paths with no symlink in them: every spelling is already the only one. */
const literalDir = ({ dir }: { dir: string }): string => dir;

/** One open ledger row, as the fold produces it. */
function openRow({ slug, workspaceRef, cwd }: { slug: string; workspaceRef: string; cwd: string }): SessionItem {
  return { cwd, lastEventIso: "2026-11-05T09:00:00.000Z", sessionKey: slug, slug, status: "open", workspaceRef };
}

/** Record one spawned row on the real ledger under the throwaway home, in its own worktree. */
function spawned({ slug, workspaceRef }: { slug: string; workspaceRef: string }): void {
  appendSessionEvent({
    event: {
      branch: slug,
      cwd: `/w/.claude/worktrees/${slug}`,
      kind: "spawned",
      sessionKey: slug,
      slug,
      surfaceRef: "surface:1",
      tsIso: "2026-11-05T09:00:00.000Z",
      workspaceRef,
    },
    home,
  });
}

/** Start and finish one slug's run journal. */
function finishedRun({ slug }: { slug: string }): void {
  const runsDir = stateHomePaths({ home }).runs;
  appendRunEvent({
    event: { atIso: "2026-11-05T09:00:00.000Z", branch: slug, docHash: "h", kind: "started" },
    runsDir,
    slug,
  });
  appendRunEvent({ event: { atIso: "2026-11-05T10:00:00.000Z", kind: "finished", residue: [] }, runsDir, slug });
}

describe("predecessorLedgerRow", () => {
  const chairCwd = "/w/.claude/worktrees/fresh-supervisor-handoff-9290";

  it("pairs a row cmux renumbered on restart by its worktree, where the recorded ref names nothing live", () => {
    const row = openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:164" });
    const found = predecessorLedgerRow({
      canonicalDir: literalDir,
      predecessorWorkspaceId: "id-chair",
      rows: [row],
      workspaces: [liveWorkspace({ workspaceRef: "workspace:1" })],
    });
    expect(found!.slug).toBe("fresh-supervisor-handoff-9290");
  });

  it("follows the predecessor's id after a restart, never the workspace cmux re-issued the old ref to", () => {
    const row = openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:164" });
    const reissued = liveWorkspace({
      currentDirectory: "/w/.claude/worktrees/some-seat",
      pinned: false,
      workspaceId: "id-seat",
      workspaceRef: "workspace:164",
    });
    const found = predecessorLedgerRow({
      canonicalDir: literalDir,
      predecessorWorkspaceId: "id-chair",
      rows: [row],
      workspaces: [reissued, liveWorkspace({ workspaceRef: "workspace:1" })],
    });
    expect(found!.slug).toBe("fresh-supervisor-handoff-9290");
  });

  it("never hands the predecessor a row whose ref cmux re-issued to it from another worktree", () => {
    const stranger = openRow({ cwd: "/w/.claude/worktrees/some-seat", slug: "some-seat", workspaceRef: "workspace:1" });
    const found = predecessorLedgerRow({
      canonicalDir: literalDir,
      predecessorWorkspaceId: "id-chair",
      rows: [stranger],
      workspaces: [liveWorkspace({ workspaceRef: "workspace:1" })],
    });
    expect(found).toBeUndefined();
  });

  it("refuses when a stale open row of the same slug shares the worktree, since it can win a re-issued ref", () => {
    const stale = openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:1" });
    const own = openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:164" });
    const found = predecessorLedgerRow({
      canonicalDir: literalDir,
      predecessorWorkspaceId: "id-chair",
      rows: [stale, own],
      workspaces: [liveWorkspace({ workspaceRef: "workspace:1" })],
    });
    expect(found).toBeUndefined();
  });

  it("refuses when another open row in the predecessor's worktree answers to a different slug", () => {
    const stale = openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9289", workspaceRef: "workspace:7" });
    const exact = openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:1" });
    const found = predecessorLedgerRow({
      canonicalDir: literalDir,
      predecessorWorkspaceId: "id-chair",
      rows: [stale, exact],
      workspaces: [liveWorkspace({ workspaceRef: "workspace:1" })],
    });
    expect(found).toBeUndefined();
  });

  it("refuses when a second live workspace shares the predecessor's worktree, since refs cannot tell them apart", () => {
    const seat = liveWorkspace({ pinned: false, workspaceId: "id-seat", workspaceRef: "workspace:10" });
    const found = predecessorLedgerRow({
      canonicalDir: literalDir,
      predecessorWorkspaceId: "id-chair",
      rows: [
        openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:20" }),
        openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:10" }),
      ],
      workspaces: [seat, liveWorkspace({ workspaceRef: "workspace:20" })],
    });
    expect(found).toBeUndefined();
  });

  it("ignores a closed row, so a retired chair's row is never re-read as the predecessor", () => {
    const closed = {
      ...openRow({ cwd: chairCwd, slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:1" }),
      status: "closed" as const,
    };
    const found = predecessorLedgerRow({
      canonicalDir: literalDir,
      predecessorWorkspaceId: "id-chair",
      rows: [closed],
      workspaces: [liveWorkspace()],
    });
    expect(found).toBeUndefined();
  });

  it("refuses a row from a same-named worktree under another root, even on the ref cmux re-issued", () => {
    const seat = liveWorkspace({
      currentDirectory: "/repo-b/.claude/worktrees/shared",
      pinned: false,
      workspaceId: "id-seat",
      workspaceRef: "workspace:2",
    });
    const chair = liveWorkspace({ currentDirectory: "/repo-a/.claude/worktrees/shared", workspaceRef: "workspace:1" });
    const found = predecessorLedgerRow({
      canonicalDir: literalDir,
      predecessorWorkspaceId: "id-chair",
      rows: [
        openRow({ cwd: "/repo-b/.claude/worktrees/shared", slug: "seat", workspaceRef: "workspace:1" }),
        openRow({ cwd: "/repo-a/.claude/worktrees/shared", slug: "chair", workspaceRef: "workspace:164" }),
      ],
      workspaces: [chair, seat],
    });
    expect(found).toBeUndefined();
  });

  it("pairs across a symlinked root once both paths canonicalise to the same directory", () => {
    const viaLink = openRow({ cwd: "/link/.claude/worktrees/chair", slug: "chair", workspaceRef: "workspace:164" });
    const found = predecessorLedgerRow({
      canonicalDir: ({ dir }) => dir.replace(/^\/link\//u, "/real/"),
      predecessorWorkspaceId: "id-chair",
      rows: [viaLink],
      workspaces: [liveWorkspace({ currentDirectory: "/real/.claude/worktrees/chair" })],
    });
    expect(found!.slug).toBe("chair");
  });
});

describe("closeSiblings", () => {
  const at = { spawnedIso: "2026-11-05T09:00:00.000Z" };
  const chair = { ...openRow({ cwd: "/w/chair", slug: "s", workspaceRef: "workspace:164" }), ...at };

  it("counts an open row sharing the key, recorded ref and spawn instant, which the close would also reach", () => {
    const seat = { ...openRow({ cwd: "/w/seat", slug: "s", workspaceRef: "workspace:164" }), ...at };
    expect(closeSiblings({ row: chair, rows: [seat, chair] })).toBe(1);
  });

  it("counts none when the other row differs by spawn instant, or is already closed", () => {
    const later = { ...openRow({ cwd: "/w/seat", slug: "s", workspaceRef: "workspace:164" }), spawnedIso: "t2" };
    const closed = { ...chair, cwd: "/w/seat", status: "closed" as const };
    expect(closeSiblings({ row: chair, rows: [later, closed, chair] })).toBe(0);
  });
});

describe("predecessorRunGate", () => {
  it("refuses a workspace the session ledger has never registered, and names it", () => {
    const predecessor = liveWorkspace({ workspaceRef: "workspace:999" });
    const gate = predecessorRunGate({ home, predecessor, workspaces: [predecessor] });
    expect(gate).toEqual({ refusal: expect.stringContaining("workspace:999 is not registered") });
  });

  it("passes a finished chair after a restart renumbered its ref, naming the row's own ref for step 5", () => {
    spawned({ slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:164" });
    finishedRun({ slug: "fresh-supervisor-handoff-9290" });
    const predecessor = liveWorkspace({ workspaceRef: "workspace:1" });
    const gate = predecessorRunGate({ home, predecessor, workspaces: [predecessor] });
    expect(gate).toEqual({
      row: expect.objectContaining({ sessionKey: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:164" }),
      slug: "fresh-supervisor-handoff-9290",
    });
  });

  it("refuses a renumbered chair whose run is still open, naming the slug it paired", () => {
    spawned({ slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:164" });
    appendRunEvent({
      event: { atIso: "2026-11-05T09:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      runsDir: stateHomePaths({ home }).runs,
      slug: "fresh-supervisor-handoff-9290",
    });
    const predecessor = liveWorkspace({ workspaceRef: "workspace:1" });
    const gate = predecessorRunGate({ home, predecessor, workspaces: [predecessor] });
    expect(gate).toEqual({ refusal: expect.stringContaining("(phase: open)") });
  });

  it("refuses a chair whose row was never run, rather than reading the empty journal as stepped down", () => {
    spawned({ slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:1" });
    const predecessor = liveWorkspace({ workspaceRef: "workspace:1" });
    const gate = predecessorRunGate({ home, predecessor, workspaces: [predecessor] });
    expect(gate).toEqual({ refusal: expect.stringContaining("(phase: no run)") });
  });

  it("refuses a chair whose journal holds only a pre-start line, which folds to NO_RUN's closed phase", () => {
    spawned({ slug: "fresh-supervisor-handoff-9290", workspaceRef: "workspace:1" });
    appendRunEvent({
      event: { atIso: "2026-11-05T09:00:00.000Z", failed: 0, kind: "probed", passed: 1 },
      runsDir: stateHomePaths({ home }).runs,
      slug: "fresh-supervisor-handoff-9290",
    });
    const predecessor = liveWorkspace({ workspaceRef: "workspace:1" });
    const gate = predecessorRunGate({ home, predecessor, workspaces: [predecessor] });
    expect(gate).toEqual({ refusal: expect.stringContaining("(phase: no run)") });
  });
});
