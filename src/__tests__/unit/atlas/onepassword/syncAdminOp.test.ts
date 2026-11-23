/*
 * The `admin-cli` channel's shared `op` primitives over a plain fake runner: what one surface call turns into
 * either way it goes, and how a per-parent walk scopes and projects each parent's rows.
 */
import { describe, expect, it } from "vitest";

import { emptyOnepasswordKindFile } from "../../../../atlas/onepassword/model.js";
import { projectOnepasswordGroupMember, projectOnepasswordUser } from "../../../../atlas/onepassword/projection.js";
import { attemptOp, syncPerParentKind, syncSimpleKind } from "../../../../atlas/onepassword/syncAdminOp.js";
import type { OpSurfaceRunner } from "../../../../atlas/onepassword/syncCore.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const AT = "2026-08-29T00:00:00.000Z";
const USER_ID = "UUUUUUUUUUUUUUUUUUUUUUUUUU";
const FIRST_GROUP = "GGGGGGGGGGGGGGGGGGGGGGGGGA";
const SECOND_GROUP = "GGGGGGGGGGGGGGGGGGGGGGGGGB";

/** One raw `op` user record, in the shape `op user list` and `op group user list` return. */
const RAW_USER = {
  created_at: "2026-01-02T03:04:05Z",
  email: "person@example.com",
  id: USER_ID,
  last_auth_at: "2026-08-01T00:00:00Z",
  name: "A Person",
  state: "ACTIVE",
  type: "MEMBER",
  updated_at: "2026-08-01T00:00:00Z",
};

/** A runner that records every call and answers every surface with the same rows. */
function recordingRunner({ rows }: { rows: readonly unknown[] }): {
  run: OpSurfaceRunner;
  calls: { surface: string; id: string | null }[];
} {
  const calls: { surface: string; id: string | null }[] = [];
  const run: OpSurfaceRunner = ({ surface, id }) => {
    calls.push({ id: id === undefined ? null : id, surface });
    return ok({ endpoint: `op ${surface}`, rows });
  };
  return { calls, run };
}

describe("attemptOp", () => {
  it("passes a succeeded call's rows through with a synced cell and no gap", () => {
    const { run } = recordingRunner({ rows: [RAW_USER] });

    const attempt = attemptOp({
      at: AT,
      id: null,
      kind: "user",
      run,
      scope: "users-list",
      stored: emptyOnepasswordKindFile({ kind: "user", updatedAt: AT }),
      surface: "users-list",
    });

    expect(attempt.rows).toEqual([RAW_USER]);
    expect(attempt.gap).toBe(null);
    expect({ scope: attempt.coverageCell.scope, state: attempt.coverageCell.state }).toEqual({
      scope: "users-list",
      state: "synced",
    });
  });

  it("classifies a signed-out call's stderr into a not-configured cell and an open gap", () => {
    const signedOut = "[ERROR] no active session found for account atlas";
    const run: OpSurfaceRunner = () => err([signedOut]);

    const attempt = attemptOp({
      at: AT,
      id: null,
      kind: "user",
      run,
      scope: "users-list",
      stored: emptyOnepasswordKindFile({ kind: "user", updatedAt: AT }),
      surface: "users-list",
    });

    expect(attempt.rows).toBe(null);
    expect(attempt.coverageCell.state).toBe("not-configured");
    expect({ condition: attempt.gap!.condition, reason: attempt.gap!.reason, scope: attempt.gap!.scope }).toEqual({
      condition: "cli-not-signed-in",
      reason: signedOut,
      scope: "users-list",
    });
  });
});

describe("syncSimpleKind", () => {
  it("projects one call's rows into the kind's entities and a complete result", () => {
    const { run, calls } = recordingRunner({ rows: [RAW_USER] });

    const synced = unwrap(
      syncSimpleKind({
        at: AT,
        kind: "user",
        project: ({ raw }) => projectOnepasswordUser({ at: AT, raw }),
        run,
        stored: emptyOnepasswordKindFile({ kind: "user", updatedAt: AT }),
        surface: "users-list",
      }),
    );

    expect(calls).toEqual([{ id: null, surface: "users-list" }]);
    expect(synced.entities.map((entity) => entity.providerId)).toEqual([USER_ID]);
    expect({
      complete: synced.result.complete,
      entityCount: synced.result.entityCount,
      kind: synced.result.kind,
    }).toEqual({ complete: true, entityCount: 1, kind: "user" });
  });
});

describe("syncPerParentKind", () => {
  it("makes one call per parent, scoped to that parent, and hands each projection its parent id", () => {
    const { run, calls } = recordingRunner({ rows: [RAW_USER] });

    const walked = syncPerParentKind({
      at: AT,
      kind: "group-member",
      parentIds: [FIRST_GROUP, SECOND_GROUP],
      project: ({ raw, parentId }) => projectOnepasswordGroupMember({ at: AT, groupId: parentId, raw }),
      run,
      stored: emptyOnepasswordKindFile({ kind: "group-member", updatedAt: AT }),
      surface: "group-members",
    });

    expect(calls).toEqual([
      { id: FIRST_GROUP, surface: "group-members" },
      { id: SECOND_GROUP, surface: "group-members" },
    ]);
    expect(walked.attempts.map((attempt) => attempt.coverageCell.scope)).toEqual([
      `group-members:${FIRST_GROUP}`,
      `group-members:${SECOND_GROUP}`,
    ]);
    expect(walked.entities.map((entity) => entity.channels["admin-cli"]!.detail)).toEqual([
      { group_id: FIRST_GROUP, role: "MEMBER", user_id: USER_ID },
      { group_id: SECOND_GROUP, role: "MEMBER", user_id: USER_ID },
    ]);
    expect(walked.reasons).toEqual([]);
  });

  it("makes no call and reports nothing for an empty parent list", () => {
    const { run, calls } = recordingRunner({ rows: [RAW_USER] });

    const walked = syncPerParentKind({
      at: AT,
      kind: "group-member",
      parentIds: [],
      project: ({ raw, parentId }) => projectOnepasswordGroupMember({ at: AT, groupId: parentId, raw }),
      run,
      stored: emptyOnepasswordKindFile({ kind: "group-member", updatedAt: AT }),
      surface: "group-members",
    });

    expect(calls).toEqual([]);
    expect({ attempts: walked.attempts.length, entities: walked.entities.length, reasons: walked.reasons }).toEqual({
      attempts: 0,
      entities: 0,
      reasons: [],
    });
  });
});
