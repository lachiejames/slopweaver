import { describe, expect, it } from "vitest";
import { parkedCheckpointOf } from "../../components/live/readParkedWake";
import { reconcileHoldsOf } from "../../components/live/readReconcileHolds";

/** The six hold keys every current `handover reconcile --json` prints, each empty. */
const CURRENT = {
  repolessRows: [],
  sharedSlugs: [],
  supersededSupervisors: [],
  trunkMovedRows: [],
  trunkPullsUnchecked: [],
  trunkUnread: [],
};

describe("reconcileHoldsOf", () => {
  it("reads every hold list, deduplicating trunk-moved slugs and keeping released runs", () => {
    const holds = reconcileHoldsOf({
      bag: {
        ...CURRENT,
        releasedRows: { ids: ["abc-released"], kind: "read" },
        repolessRows: ["relay-1"],
        supersededSupervisors: ["fresh-supervisor-handoff-9001"],
        trunkMovedRows: [
          { moves: 1, path: "a.ts", slug: "finding-1" },
          { moves: 2, path: "b.ts", slug: "finding-1" },
        ],
        trunkUnread: [{ repo: "acme/app", slugs: ["finding-2"], why: "fetch failed" }],
      },
    });
    expect(holds).toEqual({
      kind: "read",
      lists: {
        released: { ids: ["abc-released"], kind: "read" },
        repoless: ["relay-1"],
        shared: [],
        superseded: ["fresh-supervisor-handoff-9001"],
        supersessionUnresolved: undefined,
        trunkMoved: ["finding-1"],
        trunkPullsUnchecked: [],
        trunkUnread: [{ repo: "acme/app", slugs: ["finding-2"], why: "fetch failed" }],
      },
    });
  });

  it("reads a build before releasedRows as released not carried, and an unread release as unread", () => {
    expect(reconcileHoldsOf({ bag: CURRENT })).toEqual({
      kind: "read",
      lists: {
        released: undefined,
        repoless: [],
        shared: [],
        superseded: [],
        supersessionUnresolved: undefined,
        trunkMoved: [],
        trunkPullsUnchecked: [],
        trunkUnread: [],
      },
    });
    const unread = reconcileHoldsOf({
      bag: {
        ...CURRENT,
        releasedRows: { kind: "unread", unreadableIds: ["abc-1"], why: "1 run journal(s) carry a line" },
      },
    });
    expect(unread).toEqual({
      kind: "read",
      lists: {
        released: { kind: "unread", unreadableIds: ["abc-1"], why: "1 run journal(s) carry a line" },
        repoless: [],
        shared: [],
        superseded: [],
        supersessionUnresolved: undefined,
        trunkMoved: [],
        trunkPullsUnchecked: [],
        trunkUnread: [],
      },
    });
  });

  it("reads a document with none of the keys as an older build", () => {
    expect(reconcileHoldsOf({ bag: { headline: "aligned" } })).toEqual({ kind: "absent" });
  });

  it("reads releasedRows without the six older keys as malformed, keeping its ids, never as an older build", () => {
    expect(reconcileHoldsOf({ bag: { releasedRows: { ids: ["released-x"], kind: "read" } } })).toEqual({
      kind: "malformed",
      named: ["released-x"],
      repos: [],
      why: "it carries some hold lists but not repolessRows, supersededSupervisors, sharedSlugs, trunkMovedRows, trunkUnread, trunkPullsUnchecked",
    });
  });

  it("reads a full key set whose list cannot be iterated as malformed, never a throw", () => {
    const repolessRows = Object.assign(["secret-row"], { [Symbol.iterator]: null });
    expect(reconcileHoldsOf({ bag: { ...CURRENT, repolessRows } })).toEqual({
      kind: "malformed",
      named: ["secret-row"],
      repos: [],
      why: "a hold list it carries will not read",
    });
  });

  it("salvages two levels deep and no further, so a deeply nested list costs no stack", () => {
    const depth = 20_000;
    const nested: unknown = JSON.parse(`${'{"slugs":['.repeat(depth)}"x"${"]}".repeat(depth)}`);
    expect(reconcileHoldsOf({ bag: { repolessRows: [nested, { slugs: ["y"] }] } })).toEqual({
      kind: "malformed",
      named: ["y"],
      repos: [],
      why: "it carries some hold lists but not supersededSupervisors, sharedSlugs, trunkMovedRows, trunkUnread, trunkPullsUnchecked",
    });
  });

  it("stays total over an array whose own flatMap is not a function", () => {
    const repolessRows = Object.assign(["secret-row"], { flatMap: null });
    expect(reconcileHoldsOf({ bag: { repolessRows } })).toEqual({
      kind: "malformed",
      named: ["secret-row"],
      repos: [],
      why: "it carries some hold lists but not supersededSupervisors, sharedSlugs, trunkMovedRows, trunkUnread, trunkPullsUnchecked",
    });
  });

  it("reads a document missing one key, or carrying one that will not read, as malformed and says why", () => {
    const unreadable = { kind: "malformed", named: [], repos: [], why: "a hold list it carries will not read" };
    const { trunkUnread: _dropped, ...missing } = CURRENT;
    expect(reconcileHoldsOf({ bag: missing })).toEqual({
      kind: "malformed",
      named: [],
      repos: [],
      why: "it carries some hold lists but not trunkUnread",
    });
    expect(reconcileHoldsOf({ bag: { ...CURRENT, repolessRows: "relay-1" } })).toEqual(unreadable);
    expect(reconcileHoldsOf({ bag: { ...CURRENT, releasedRows: { kind: "maybe" } } })).toEqual(unreadable);
    expect(reconcileHoldsOf({ bag: { ...CURRENT, supersessionUnresolved: 3 } })).toEqual(unreadable);
    // A trunk scope naming no repository cannot say where it did not look.
    const noRepo = { ...CURRENT, trunkUnread: [{ slugs: ["finding-2"], why: "fetch failed" }] };
    expect(reconcileHoldsOf({ bag: noRepo })).toEqual({ ...unreadable, named: ["finding-2"] });
  });

  it("keeps every row id a malformed set still carries legibly, so none is dropped with the list beside it", () => {
    expect(reconcileHoldsOf({ bag: { repolessRows: ["secret-row"] } })).toEqual({
      kind: "malformed",
      named: ["secret-row"],
      repos: [],
      why: "it carries some hold lists but not supersededSupervisors, sharedSlugs, trunkMovedRows, trunkUnread, trunkPullsUnchecked",
    });
    const bag = {
      ...CURRENT,
      releasedRows: { ids: ["abc-released"], kind: "maybe" },
      sharedSlugs: ["shared-1", 7],
      trunkMovedRows: [{ moves: 1, path: "a.ts", slug: "finding-1" }, { path: "b.ts" }],
    };
    expect(reconcileHoldsOf({ bag })).toEqual({
      kind: "malformed",
      named: ["abc-released", "finding-1", "shared-1"],
      repos: [],
      why: "a hold list it carries will not read",
    });
    const scopes = {
      ...CURRENT,
      trunkUnread: [
        { repo: "acme/one", slugs: ["x"], why: "fetch failed" },
        { repo: "acme/two", slugs: ["y"] },
      ],
    };
    expect(reconcileHoldsOf({ bag: scopes })).toEqual({
      kind: "malformed",
      named: ["x", "y"],
      repos: ["acme/one", "acme/two"],
      why: "a hold list it carries will not read",
    });
  });
});

describe("parkedCheckpointOf", () => {
  /** A checkpoint carrying every key `publishedParkedOf` always writes, and no wake. */
  const WHOLE = {
    atIso: "2026-11-03T06:00:00.000Z",
    branch: "abc-1",
    screenTail: "",
    workspaceRef: "workspace:1",
    worktree: "/x/abc-1",
  };

  it("tells a park with a wake from one waiting on nothing", () => {
    const wake = { kind: "checks", number: 7, repo: "acme/app" };
    expect(parkedCheckpointOf({ row: { parked: { wake } } })).toBe("wake");
    expect(parkedCheckpointOf({ row: { parked: WHOLE } })).toBe("no-wake");
  });

  it("reads a checkpoint missing a key the publisher always writes as unread, never as waiting on nothing", () => {
    expect(parkedCheckpointOf({ row: { parked: {} } })).toBe("unread");
    expect(parkedCheckpointOf({ row: { parked: { atIso: "2026-11-03T06:00:00.000Z" } } })).toBe("unread");
    // Present but not a string reads no better than absent.
    expect(parkedCheckpointOf({ row: { parked: { ...WHOLE, worktree: null } } })).toBe("unread");
  });

  it("reads a wake that will not read as unread, never as a wake", () => {
    expect(parkedCheckpointOf({ row: { parked: { wake: { kind: "checks" } } } })).toBe("unread");
  });

  it("reads an unparked row as no checkpoint and a malformed one as unread", () => {
    expect(parkedCheckpointOf({ row: { slug: "abc-1" } })).toBe(undefined);
    expect(parkedCheckpointOf({ row: { parked: "yes" } })).toBe("unread");
  });
});
