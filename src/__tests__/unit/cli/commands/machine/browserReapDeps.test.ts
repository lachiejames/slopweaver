/**
 * The production browser-reap seams over a real throwaway home: the record seams read and forget what the store
 * holds, and the lock seam is the SAME lock a command's claim takes, so a reap can never let go of a session a
 * command is acting through. Only the seams that touch the home are exercised; the client, the process table and
 * `terminate` reach the machine and stay out of a unit test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readInteractionSession, writeInteractionSession } from "../../../../../browser/interactionSessionStore.js";
import { holdBrowserSession } from "../../../../../browser/sessionLock.js";
import { productionBrowserReapDeps } from "../../../../../cli/commands/machine/browserReapDeps.js";
import { unwrap } from "../../../../../lib/result.js";

const ID = "5f2a1c30-0000-4000-8000-0000000000d1";

const STORED = {
  observation: null,
  session: {
    clientSession: "slopweaver-5f2a1c30",
    id: ID,
    openedAtIso: "2026-09-16T08:00:00.000Z",
    origins: [],
    owner: { cmuxWorkspace: null, pid: 4242, runSlug: null },
    ownerSessionId: "agent-1",
    placement: "background" as const,
    touchedAtIso: "2026-09-16T08:00:00.000Z",
    workspace: "/nowhere/client",
  },
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "reap-deps-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("productionBrowserReapDeps", () => {
  it("lists the records the home holds, and forgets one so the store no longer answers to it", () => {
    unwrap(writeInteractionSession({ home, stored: STORED }));
    const deps = productionBrowserReapDeps({ home });
    expect(deps.browserSessions().map(({ session }) => session.id)).toEqual([ID]);
    expect(deps.forgetBrowserSession({ id: ID })).toBe(undefined);
    expect(readInteractionSession({ home, id: ID })).toBe(undefined);
    expect(deps.browserSessions()).toEqual([]);
  });

  it("takes the session's lock, and answers held while it is taken — by itself or by a command's claim", () => {
    const deps = productionBrowserReapDeps({ home });
    const release = deps.holdBrowserSession({ id: ID })!;
    expect(deps.holdBrowserSession({ id: ID })).toBe(undefined);
    expect(holdBrowserSession({ home, id: ID, nowIso: "2026-11-04T07:00:00.000Z" }).isErr()).toBe(true);
    release();
    const claim = holdBrowserSession({ home, id: ID, nowIso: "2026-11-04T07:00:00.000Z" });
    expect(claim.isOk()).toBe(true);
    expect(deps.holdBrowserSession({ id: ID })).toBe(undefined);
    unwrap(claim).release();
    deps.holdBrowserSession({ id: ID })!();
    const after = holdBrowserSession({ home, id: ID, nowIso: "2026-11-04T07:00:00.000Z" });
    expect(after.isOk()).toBe(true);
    unwrap(after).release();
  });
});
