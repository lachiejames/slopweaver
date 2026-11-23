/**
 * The `admin-cli` channel's orchestration over a plain fake `op` runner: which surfaces it calls, in what
 * order, what progress it reports, and what a signed-out session does to a kind it already held.
 */
import { describe, expect, it } from "vitest";

import {
  emptyOnepasswordKindFile,
  type OnepasswordKind,
  type OnepasswordKindFile,
} from "../../../../atlas/onepassword/model.js";
import { projectOnepasswordUser } from "../../../../atlas/onepassword/projection.js";
import { syncAdminCliKinds } from "../../../../atlas/onepassword/syncAdminChannel.js";
import type { OnepasswordProgress, OpSurfaceRunner } from "../../../../atlas/onepassword/syncCore.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const AT = "2026-08-29T00:00:00.000Z";
const GROUP_ID = "GGGGGGGGGGGGGGGGGGGGGGGGGG";
const VAULT_ID = "VVVVVVVVVVVVVVVVVVVVVVVVVV";
const USER_ID = "UUUUUUUUUUUUUUUUUUUUUUUUUU";

/** One raw `op` user record, in the shape `op user list` returns. */
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

/** One raw `op` group record. */
const RAW_GROUP = {
  created_at: "2026-01-02T03:04:05Z",
  description: "a group",
  id: GROUP_ID,
  name: "Engineering",
  state: "ACTIVE",
  type: "USER_DEFINED",
  updated_at: "2026-08-01T00:00:00Z",
};

/** One raw `op` vault record, carrying its item count as `op vault get` does. */
const RAW_VAULT = {
  created_at: "2026-01-02T03:04:05Z",
  description: "a vault",
  id: VAULT_ID,
  items: 4,
  name: "Shared",
  type: "USER_CREATED",
  updated_at: "2026-08-01T00:00:00Z",
};

/** A stored file for every kind, empty, as a first run sees the store. */
function emptyStore(): Record<OnepasswordKind, OnepasswordKindFile> {
  const empty = ({ kind }: { kind: OnepasswordKind }): OnepasswordKindFile =>
    emptyOnepasswordKindFile({ kind, updatedAt: AT });
  return {
    event: empty({ kind: "event" }),
    group: empty({ kind: "group" }),
    "group-member": empty({ kind: "group-member" }),
    integration: empty({ kind: "integration" }),
    user: empty({ kind: "user" }),
    vault: empty({ kind: "vault" }),
    "vault-grant": empty({ kind: "vault-grant" }),
  };
}

/** A runner that records every call and answers from a per-surface table, empty when the table is silent. */
function recordingRunner({ rowsFor }: { rowsFor: ReadonlyMap<string, readonly unknown[]> }): {
  run: OpSurfaceRunner;
  calls: { surface: string; id: string | null }[];
} {
  const calls: { surface: string; id: string | null }[] = [];
  const run: OpSurfaceRunner = ({ surface, id }) => {
    calls.push({ id: id === undefined ? null : id, surface });
    const rows = rowsFor.get(surface);
    if (rows === undefined) {
      return ok({ endpoint: `op ${surface}`, rows: [] });
    }
    return ok({ endpoint: `op ${surface}`, rows });
  };
  return { calls, run };
}

/** A progress sink that keeps every line. */
function recordingProgress(): { onProgress: OnepasswordProgress; lines: string[] } {
  const lines: string[] = [];
  const onProgress: OnepasswordProgress = ({ line }) => {
    lines.push(line);
  };
  return { lines, onProgress };
}

describe("syncAdminCliKinds", () => {
  it("calls the four list surfaces in dependency order when nothing is listed", () => {
    const { run, calls } = recordingRunner({ rowsFor: new Map() });
    const { onProgress, lines } = recordingProgress();

    const results = unwrap(syncAdminCliKinds({ at: AT, onProgress, run, storedFiles: emptyStore() }));

    expect(calls).toEqual([
      { id: null, surface: "users-list" },
      { id: null, surface: "groups-list" },
      { id: null, surface: "vaults-list" },
      { id: null, surface: "connect-servers" },
    ]);
    expect(lines).toEqual([
      "user: pulling…",
      "user: synced, 0 record(s)",
      "group: pulling…",
      "group: synced, 0 record(s)",
      "group-member: pulling… (one call per group, 0 to go)",
      "group-member: INCOMPLETE, 0 record(s)",
      "vault: pulling… (a list, then one call per vault for its item count)",
      "vault: synced, 0 record(s)",
      "vault-grant: pulling… (two calls per vault, 0 to go)",
      "vault-grant: INCOMPLETE, 0 record(s)",
      "integration: pulling…",
      "integration: synced, 0 record(s)",
    ]);
    expect(
      Object.entries(results)
        .map(([key, result]) => ({ complete: result.complete, entityCount: result.entityCount, key }))
        .toSorted((left, right) => left.key.localeCompare(right.key)),
    ).toEqual([
      { complete: true, entityCount: 0, key: "group" },
      { complete: false, entityCount: 0, key: "group-member" },
      { complete: true, entityCount: 0, key: "integration" },
      { complete: true, entityCount: 0, key: "user" },
      { complete: true, entityCount: 0, key: "vault" },
      { complete: false, entityCount: 0, key: "vault-grant" },
    ]);
  });

  it("drives one member call per listed group and a detail plus two grant calls per listed vault", () => {
    const { run, calls } = recordingRunner({
      rowsFor: new Map<string, readonly unknown[]>([
        ["group-members", [RAW_USER]],
        ["groups-list", [RAW_GROUP]],
        ["users-list", [RAW_USER]],
        ["vault-detail", [RAW_VAULT]],
        ["vault-groups", [{ ...RAW_GROUP, permissions: ["allow_viewing"] }]],
        ["vault-users", [{ ...RAW_USER, permissions: "allow_viewing, allow_editing" }]],
        ["vaults-list", [RAW_VAULT]],
      ]),
    });
    const { onProgress } = recordingProgress();

    const results = unwrap(syncAdminCliKinds({ at: AT, onProgress, run, storedFiles: emptyStore() }));

    expect(calls).toEqual([
      { id: null, surface: "users-list" },
      { id: null, surface: "groups-list" },
      { id: GROUP_ID, surface: "group-members" },
      { id: null, surface: "vaults-list" },
      { id: VAULT_ID, surface: "vault-detail" },
      { id: VAULT_ID, surface: "vault-groups" },
      { id: VAULT_ID, surface: "vault-users" },
      { id: null, surface: "connect-servers" },
    ]);
    expect(results["group-member"]!.file.entities.map((entity) => entity.channels["admin-cli"]!.detail)).toEqual([
      { group_id: GROUP_ID, role: "MEMBER", user_id: USER_ID },
    ]);
    expect(results["vault-grant"]!.file.entities.map((entity) => entity.channels["admin-cli"]!.detail)).toEqual([
      { permissions: ["allow_viewing"], principal_id: GROUP_ID, principal_kind: "group", vault_id: VAULT_ID },
      {
        permissions: ["allow_viewing", "allow_editing"],
        principal_id: USER_ID,
        principal_kind: "user",
        vault_id: VAULT_ID,
      },
    ]);
    expect(
      ["user", "group", "group-member", "vault", "vault-grant", "integration"].map((key) => [
        key,
        results[key]!.complete,
        results[key]!.entityCount,
      ]),
    ).toEqual([
      ["user", true, 1],
      ["group", true, 1],
      ["group-member", true, 1],
      ["vault", true, 1],
      ["vault-grant", true, 2],
      ["integration", true, 0],
    ]);
  });

  it("marks the user kind not-configured on a signed-out session and keeps the user it already held", () => {
    const heldUser = unwrap(projectOnepasswordUser({ at: "2026-08-01T00:00:00.000Z", raw: RAW_USER }));
    const storedFiles = emptyStore();
    storedFiles.user = { ...storedFiles.user, entities: [heldUser] };
    const signedOut = "[ERROR] 2026/08/29 00:00:00 account is not signed in";
    const run: OpSurfaceRunner = () => err([signedOut]);
    const { onProgress } = recordingProgress();

    const user = unwrap(syncAdminCliKinds({ at: AT, onProgress, run, storedFiles }))["user"]!;

    expect({ complete: user.complete, entities: user.file.entities, reasons: user.reasons }).toEqual({
      complete: false,
      entities: [heldUser],
      reasons: [signedOut],
    });
    expect(
      user.file.coverage.map((cell) => ({
        latestAttemptFailed: cell.latestAttemptFailed,
        state: cell.state,
        surface: cell.surface,
      })),
    ).toEqual([{ latestAttemptFailed: true, state: "not-configured", surface: "users-list" }]);
    expect(user.file.gaps.map((gap) => ({ condition: gap.condition, scope: gap.scope, status: gap.status }))).toEqual([
      { condition: "cli-not-signed-in", scope: "users-list", status: "open" },
    ]);
  });
});
