import { describe, expect, it } from "vitest";

import { SUPERVISOR_WORKSPACE_TITLE } from "../../../cmux/supervisorWorkspace.js";
import {
  firstSeatedInstants,
  type PinCandidate,
  pinnedSupervisorSlug,
  type SupervisorDocRow,
  supersededSupervisorDocs,
} from "../../../handover/supervisorSupersession.js";
import type { SessionItem } from "../../../sessions/session.js";

/** One workspace listing entry, defaulting to an ordinary unpinned workstream row. */
const workspace = (over: Partial<PinCandidate> = {}): PinCandidate => ({
  currentDirectory: "/w/.claude/worktrees.noindex/some-row",
  pinned: false,
  title: "some-row",
  ...over,
});

/** One folded session ledger row. */
const session = (over: Partial<SessionItem> = {}): SessionItem => ({
  lastEventIso: "2026-09-11T06:00:00.000Z",
  sessionKey: "fresh-supervisor-handoff-9235",
  status: "closed",
  ...over,
});

/** One board doc, as the two fields this decision reads. */
const doc = (over: Partial<SupervisorDocRow> = {}): SupervisorDocRow => ({
  role: "supervisor",
  slug: "fresh-supervisor-handoff-9235",
  ...over,
});

describe("pinnedSupervisorSlug", () => {
  it("reads the slug off the pinned supervisor's own working directory", () => {
    const slug = pinnedSupervisorSlug({
      workspaces: [
        workspace(),
        workspace({
          currentDirectory: "/w/.claude/worktrees.noindex/fresh-supervisor-handoff-9291",
          pinned: true,
          title: SUPERVISOR_WORKSPACE_TITLE,
        }),
      ],
    });
    expect(slug).toBe("fresh-supervisor-handoff-9291");
  });

  it("answers undefined for a pinned workspace that does NOT carry the supervisor title", () => {
    const slug = pinnedSupervisorSlug({
      workspaces: [
        workspace({
          currentDirectory: "/w/.claude/worktrees.noindex/some-row",
          pinned: true,
          title: "some-row",
        }),
      ],
    });
    expect(slug).toBeUndefined();
  });

  it("answers undefined when TWO workspaces answer the pin test, because cmux enforces no single-pin rule", () => {
    const slug = pinnedSupervisorSlug({
      workspaces: [
        workspace({
          currentDirectory: "/w/.claude/worktrees.noindex/fresh-supervisor-handoff-9290",
          pinned: true,
          title: SUPERVISOR_WORKSPACE_TITLE,
        }),
        workspace({
          currentDirectory: "/w/.claude/worktrees.noindex/fresh-supervisor-handoff-9291",
          pinned: true,
          title: SUPERVISOR_WORKSPACE_TITLE,
        }),
      ],
    });
    expect(slug).toBeUndefined();
  });

  it("answers undefined on an empty listing", () => {
    expect(pinnedSupervisorSlug({ workspaces: [] })).toBeUndefined();
  });
});

describe("firstSeatedInstants", () => {
  it("keeps the EARLIEST spawn when one slug was seated twice", () => {
    const seated = firstSeatedInstants({
      sessions: [
        session({ slug: "fresh-supervisor-handoff-9235", spawnedIso: "2026-09-15T12:59:19.040Z" }),
        session({ slug: "fresh-supervisor-handoff-9235", spawnedIso: "2026-09-11T05:50:11.646Z" }),
      ],
    });
    expect(seated.get("fresh-supervisor-handoff-9235")).toBe("2026-09-11T05:50:11.646Z");
  });

  it("omits a session that names no slug", () => {
    const seated = firstSeatedInstants({
      sessions: [session({ sessionKey: "ask-worker-1", spawnedIso: "2026-09-11T05:50:11.646Z" })],
    });
    expect(seated.size).toBe(0);
  });

  it("omits a session registered with no spawn instant", () => {
    const seated = firstSeatedInstants({ sessions: [session({ slug: "some-row" })] });
    expect(seated.size).toBe(0);
  });
});

describe("supersededSupervisorDocs", () => {
  const seatedIso = new Map([
    ["fresh-supervisor-handoff-9235", "2026-09-11T05:50:11.646Z"],
    ["fresh-supervisor-handoff-9290", "2026-09-18T11:46:50.085Z"],
    ["fresh-supervisor-handoff-9291", "2026-09-19T04:03:58.128Z"],
  ]);

  it("supersedes every supervisor doc seated before the pinned chair", () => {
    const result = supersededSupervisorDocs({
      docs: [
        doc({ slug: "fresh-supervisor-handoff-9235" }),
        doc({ slug: "fresh-supervisor-handoff-9290" }),
        doc({ slug: "fresh-supervisor-handoff-9291" }),
      ],
      pinnedSlug: "fresh-supervisor-handoff-9291",
      seatedIso,
    });
    expect([...result.superseded].toSorted()).toEqual([
      "fresh-supervisor-handoff-9235",
      "fresh-supervisor-handoff-9290",
    ]);
    expect(result.unresolved).toBeUndefined();
  });

  it("never supersedes the pinned chair's own doc", () => {
    const result = supersededSupervisorDocs({
      docs: [doc({ slug: "fresh-supervisor-handoff-9291" })],
      pinnedSlug: "fresh-supervisor-handoff-9291",
      seatedIso,
    });
    expect(result.superseded.size).toBe(0);
  });

  it("leaves a supervisor doc that has NEVER been seated runnable — the successor written ahead of a handoff", () => {
    const result = supersededSupervisorDocs({
      docs: [doc({ slug: "fresh-supervisor-handoff-9292" })],
      pinnedSlug: "fresh-supervisor-handoff-9291",
      seatedIso,
    });
    expect(result.superseded.size).toBe(0);
    expect(result.unresolved).toBeUndefined();
  });

  it("leaves an ordinary row alone even when it was seated before the chair", () => {
    const result = supersededSupervisorDocs({
      docs: [doc({ role: undefined, slug: "fresh-supervisor-handoff-9235" })],
      pinnedSlug: "fresh-supervisor-handoff-9291",
      seatedIso,
    });
    expect(result.superseded.size).toBe(0);
  });

  it("does not supersede a chair seated AFTER the pinned one — a re-seat is not a retirement", () => {
    const result = supersededSupervisorDocs({
      docs: [doc({ slug: "fresh-supervisor-handoff-9290" }), doc({ slug: "fresh-supervisor-handoff-9235" })],
      pinnedSlug: "fresh-supervisor-handoff-9235",
      seatedIso,
    });
    expect(result.superseded.size).toBe(0);
  });

  it("names why it could not look when no chair holds the pin, rather than reporting a silent zero", () => {
    const result = supersededSupervisorDocs({
      docs: [doc({ slug: "fresh-supervisor-handoff-9235" })],
      pinnedSlug: undefined,
      seatedIso,
    });
    expect(result.superseded.size).toBe(0);
    expect(result.unresolved).toBe(
      "no single pinned /slopweaver:supervisor workspace resolved, so no chair could be ordered against one",
    );
  });

  it("names why it could not look when the pinned chair has no recorded seating", () => {
    const result = supersededSupervisorDocs({
      docs: [doc({ slug: "fresh-supervisor-handoff-9235" })],
      pinnedSlug: "fresh-supervisor-handoff-9999",
      seatedIso,
    });
    expect(result.superseded.size).toBe(0);
    expect(result.unresolved).toBe(
      "the pinned chair fresh-supervisor-handoff-9999 has no recorded seating, so nothing can be ordered against it",
    );
  });

  it("supersedes nothing on an empty board", () => {
    const result = supersededSupervisorDocs({ docs: [], pinnedSlug: "fresh-supervisor-handoff-9291", seatedIso });
    expect(result.superseded.size).toBe(0);
    expect(result.unresolved).toBeUndefined();
  });
});
