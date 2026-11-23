/*
 * The live update history — `liveProjectUpdates` reading a live `projectUpdates` connection, refusing one it
 * cannot prove complete, and `withLiveUpdates` folding what it saw over bronze so a stale proposal disappears. It
 * moved here when the project-update tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { liveProjectUpdates, withLiveUpdates } from "../../../../cycle/projectHistory.js";
import { projectUpdateProposals } from "../../../../cycle/projectUpdate.js";
import { NOW, OWNER, project } from "./harness.js";

describe("live update history", () => {
  it("reads a live projectUpdates connection, newest last whatever order it arrived in", () => {
    const history = liveProjectUpdates({
      connection: {
        nodes: [{ createdAt: "2026-08-30T11:16:20.584Z" }, { createdAt: "2026-06-01T00:00:00.000Z" }],
        pageInfo: { hasNextPage: false },
      },
    })!;
    expect(history.lastUpdateIso).toBe("2026-08-30T11:16:20.584Z");
    expect(history.updateCount).toBe(2);
  });

  // Counterexample: sorted as text, the -12:00 update lands first though it is 25 hours later.
  it("takes the latest update by instant, not by how its offset is spelled", () => {
    const history = liveProjectUpdates({
      connection: {
        nodes: [{ createdAt: "2026-09-20T23:00:00-12:00" }, { createdAt: "2026-09-21T00:00:00+14:00" }],
        pageInfo: { hasNextPage: false },
      },
    })!;
    expect(history.lastUpdateIso).toBe("2026-09-20T23:00:00-12:00");
  });

  it("reports a never-updated project as an empty history it DID see", () => {
    expect(liveProjectUpdates({ connection: { nodes: [], pageInfo: { hasNextPage: false } } })).toEqual({
      lastUpdateIso: undefined,
      updateCount: 0,
    });
  });

  // The defect as measured: the object read never selected the connection, and an absent one was read
  // as an empty one — so every verified project was reported never updated.
  it("refuses an ABSENT connection rather than reading it as never updated", () => {
    expect(liveProjectUpdates({ connection: undefined })).toBe(undefined);
  });

  it("refuses a connection read as a bare array, never answering zero from it", () => {
    expect(liveProjectUpdates({ connection: [{ createdAt: "2026-08-30T11:16:20.584Z" }] })).toBe(undefined);
  });

  it("refuses a connection whose nodes it cannot read a createdAt from, never answering a short history", () => {
    const malformed = {
      nodes: [{ createdAt: "2026-06-01T00:00:00.000Z" }, { id: "u2" }],
      pageInfo: { hasNextPage: false },
    };
    expect(liveProjectUpdates({ connection: malformed })).toBe(undefined);
  });

  // Counterexample: `{nodes: [], pageInfo: {}}` read as a complete empty history.
  it("refuses an empty connection whose pageInfo does not SAY it is the last page", () => {
    expect(liveProjectUpdates({ connection: { nodes: [], pageInfo: {} } })).toBe(undefined);
    expect(liveProjectUpdates({ connection: { nodes: [] } })).toBe(undefined);
  });

  it("never moves a project's last update backwards, whatever the live read says", () => {
    const bronze = project({ id: "project:p1", lastUpdateIso: "2026-08-30T11:16:20.584Z", updateCount: 2 });
    const [emptyLive] = withLiveUpdates({
      projects: [bronze],
      seen: new Map([["project:p1", { lastUpdateIso: undefined, updateCount: 0 }]]),
    });
    const [olderLive] = withLiveUpdates({
      projects: [bronze],
      seen: new Map([["project:p1", { lastUpdateIso: "2026-06-01T00:00:00.000Z", updateCount: 1 }]]),
    });
    expect(emptyLive!.lastUpdateIso).toBe("2026-08-30T11:16:20.584Z");
    expect(olderLive!.lastUpdateIso).toBe("2026-08-30T11:16:20.584Z");
  });

  it("refuses an EMPTY page with another page after it, which cannot prove the project was never updated", () => {
    expect(liveProjectUpdates({ connection: { nodes: [], pageInfo: { hasNextPage: true } } })).toBe(undefined);
  });

  // Counterexample: 250 of 251 updates on one page, the newest among them, discarded whole.
  it("reads a partial page as a lower bound that raises bronze and never lowers it", () => {
    const partial = {
      nodes: [{ createdAt: "2026-09-20T00:00:00.000Z" }, { createdAt: "2026-06-01T00:00:00.000Z" }],
      pageInfo: { hasNextPage: true },
    };
    const floor = liveProjectUpdates({ connection: partial })!;
    expect(floor).toEqual({ lastUpdateIso: "2026-09-20T00:00:00.000Z", updateCount: 2 });

    const staleBronze = project({ id: "project:p1", lastUpdateIso: "2026-01-01T00:00:00.000Z", updateCount: 251 });
    const [raised] = withLiveUpdates({ projects: [staleBronze], seen: new Map([["project:p1", floor]]) });
    expect(raised!.lastUpdateIso).toBe("2026-09-20T00:00:00.000Z");
    expect(raised!.updateCount).toBe(251);

    const newerBronze = project({ id: "project:p1", lastUpdateIso: "2026-09-22T00:00:00.000Z" });
    const [kept] = withLiveUpdates({ projects: [newerBronze], seen: new Map([["project:p1", floor]]) });
    expect(kept!.lastUpdateIso).toBe("2026-09-22T00:00:00.000Z");
  });

  it("replaces only the update history, leaving every other field alone", () => {
    const before = project({ id: "project:p1", lastUpdateIso: undefined, name: "Never-updated project" });
    const after = withLiveUpdates({
      projects: [before],
      seen: new Map([["project:p1", { lastUpdateIso: "2026-08-30T11:16:20.584Z", updateCount: 1 }]]),
    });
    expect(after[0]!.lastUpdateIso).toBe("2026-08-30T11:16:20.584Z");
    expect(after[0]!.updateCount).toBe(1);
    expect(after[0]!.name).toBe("Never-updated project");
    expect(after[0]!.leadId).toBe(OWNER);
    expect(after[0]!.status).toBe("In Progress");
  });

  it("returns a project absent from the live read untouched", () => {
    const before = project({ id: "project:p2", lastUpdateIso: undefined });
    const after = withLiveUpdates({ projects: [before], seen: new Map() });
    expect(after[0]!.lastUpdateIso).toBe(undefined);
    expect(after[0]!.updateCount).toBe(0);
  });

  // The defect this leg exists for, as its own case: bronze five days stale said "never updated", the live
  // read says an update landed today, and the proposal must DISAPPEAR rather than be annotated — an
  // annotated row still carries `post`, and one word posts the duplicate.
  it("drops a proposal for a project updated since the corpus last saw it", () => {
    const stale = project({ id: "project:p1", lastUpdateIso: undefined, name: "Never-updated project" });
    const before = projectUpdateProposals({ issues: [], leadId: OWNER, nowIso: NOW, projects: [stale] });
    expect(before.length).toBe(1);
    expect(before[0]!.headline).toBe("Never-updated project has never had a status update.");

    const patched = withLiveUpdates({
      projects: [stale],
      seen: new Map([["project:p1", { lastUpdateIso: "2026-08-30T11:16:20.584Z", updateCount: 1 }]]),
    });
    const after = projectUpdateProposals({ issues: [], leadId: OWNER, nowIso: NOW, projects: patched });
    expect(after.length).toBe(0);
  });

  it("keeps a proposal when the live read shows the update is still older than the threshold", () => {
    const stale = project({ id: "project:p1", lastUpdateIso: undefined });
    const patched = withLiveUpdates({
      projects: [stale],
      seen: new Map([["project:p1", { lastUpdateIso: "2026-07-01T00:00:00.000Z", updateCount: 1 }]]),
    });
    const after = projectUpdateProposals({ issues: [], leadId: OWNER, nowIso: NOW, projects: patched });
    expect(after.length).toBe(1);
    expect(after[0]!.headline).toBe("Example project has had no status update for 62 days.");
  });
});
