/**
 * The read-back contract: a stored entity must come back out of the file schema as the SAME entity.
 *
 * This exists because it did not. `onepasswordDetailSchema` is a plain `z.union`, which takes the first
 * member that parses — and a vault satisfies the GROUP schema, since both carry created_at/description/
 * id/name/type/updated_at. Five of the seven detail schemas were non-strict, so Zod matched `group` first
 * and STRIPPED the keys only a vault has. The one it stripped that matters is `items`: the vault's item
 * COUNT, which is this atlas's entire substitute for never storing item titles.
 *
 * Measured on a real generation: every vault lost its count on every read (each count
 * became undefined), and the resulting digest disagreement made a perfectly good generation report itself
 * untrusted — which is the gate working, catching real data loss rather than a corrupt file.
 */
import { describe, expect, it } from "vitest";

import {
  emptyOnepasswordKindFile,
  type OnepasswordEntity,
  onepasswordEventDetailSchema,
  onepasswordKindFileSchema,
  onepasswordVaultDetailSchema,
} from "../../../../atlas/onepassword/model.js";
import {
  projectOnepasswordGroup,
  projectOnepasswordGroupMember,
  projectOnepasswordUser,
  projectOnepasswordVault,
  projectOnepasswordVaultGrant,
} from "../../../../atlas/onepassword/projection.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-08-29T00:00:00.000Z";

/** One kind file holding one entity, so a round-trip is the only thing under test. */
const fileHolding = ({
  entity,
  kind,
}: {
  entity: OnepasswordEntity;
  kind: "user" | "group" | "group-member" | "vault" | "vault-grant";
}) => ({
  ...emptyOnepasswordKindFile({ kind, updatedAt: AT }),
  entities: [entity],
});

/** The detail as it survives a write-then-read cycle. */
const readBack = ({
  entity,
  kind,
}: {
  entity: OnepasswordEntity;
  kind: "user" | "group" | "group-member" | "vault" | "vault-grant";
}) => {
  const parsed = onepasswordKindFileSchema.parse(JSON.parse(JSON.stringify(fileHolding({ entity, kind }))));
  return parsed.entities[0]!.channels["admin-cli"]!.detail!;
};

const VAULT_RAW = {
  attribute_version: 2,
  content_version: 41,
  created_at: "2023-12-07T01:32:27Z",
  description: "shared credentials",
  id: "BBBBBBBBBBBBBBBBBBBBBBBBBB",
  items: 6,
  name: "Shared",
  type: "USER_CREATED",
  updated_at: "2026-08-01T00:00:00Z",
};

describe("a vault survives the read-back schema", () => {
  it("keeps its item COUNT, which a group-shaped match would strip", () => {
    const entity = unwrap(projectOnepasswordVault({ at: AT, raw: VAULT_RAW }));

    const detail = readBack({ entity, kind: "vault" }) as { items?: number };

    expect(detail.items).toBe(6);
  });

  it("comes back with exactly the keys it went in with", () => {
    const entity = unwrap(projectOnepasswordVault({ at: AT, raw: VAULT_RAW }));
    const before = Object.keys(entity.channels["admin-cli"]!.detail!).toSorted();

    const after = Object.keys(readBack({ entity, kind: "vault" })).toSorted();

    expect(after).toEqual(before);
  });

  it("does not acquire a `state` field it never had — the tell that `group` matched first", () => {
    const entity = unwrap(projectOnepasswordVault({ at: AT, raw: VAULT_RAW }));

    expect(Object.keys(readBack({ entity, kind: "vault" }))).not.toContain("state");
  });
});

describe("every other kind round-trips with its own key set", () => {
  const cases = [
    {
      entity: () =>
        unwrap(
          projectOnepasswordUser({
            at: AT,
            raw: {
              created_at: "2026-01-02T03:04:05Z",
              email: "person@example.test",
              id: "AAAAAAAAAAAAAAAAAAAAAAAAAA",
              last_auth_at: "2026-08-01T00:00:00Z",
              name: "A Person",
              state: "ACTIVE",
              type: "MEMBER",
              updated_at: "2026-08-01T00:00:00Z",
            },
          }),
        ),
      kind: "user" as const,
    },
    {
      entity: () =>
        unwrap(
          projectOnepasswordGroup({
            at: AT,
            raw: {
              created_at: "2026-01-02T03:04:05Z",
              description: "the on-call rotation",
              id: "CCCCCCCCCCCCCCCCCCCCCCCCCC",
              name: "On call",
              state: "ACTIVE",
              type: "USER_DEFINED",
              updated_at: "2026-08-01T00:00:00Z",
            },
          }),
        ),
      kind: "group" as const,
    },
    {
      entity: () =>
        unwrap(
          projectOnepasswordGroupMember({
            at: AT,
            groupId: "CCCCCCCCCCCCCCCCCCCCCCCCCC",
            raw: {
              created_at: "2026-01-02T03:04:05Z",
              email: "person@example.test",
              id: "AAAAAAAAAAAAAAAAAAAAAAAAAA",
              last_auth_at: "2026-08-01T00:00:00Z",
              name: "A Person",
              state: "ACTIVE",
              type: "MEMBER",
              updated_at: "2026-08-01T00:00:00Z",
            },
          }),
        ),
      kind: "group-member" as const,
    },
    {
      entity: () =>
        unwrap(
          projectOnepasswordVaultGrant({
            at: AT,
            principalKind: "group",
            raw: {
              created_at: "2026-01-02T03:04:05Z",
              description: "the on-call rotation",
              id: "CCCCCCCCCCCCCCCCCCCCCCCCCC",
              name: "On call",
              permissions: ["view_items"],
              state: "ACTIVE",
              type: "USER_DEFINED",
              updated_at: "2026-08-01T00:00:00Z",
            },
            vaultId: "BBBBBBBBBBBBBBBBBBBBBBBBBB",
          }),
        ),
      kind: "vault-grant" as const,
    },
  ];

  it.each(cases)("$kind keeps every key it stored", ({ entity, kind }) => {
    const built = entity();
    const before = Object.keys(built.channels["admin-cli"]!.detail!).toSorted();

    const after = Object.keys(readBack({ entity: built, kind })).toSorted();

    expect(after).toEqual(before);
  });
});

describe("a provider field 1Password left out is stored as null", () => {
  it("stores every optional vault field the provider omitted as null, and keeps an explicit null as null", () => {
    const parsed = onepasswordVaultDetailSchema.parse({
      id: "BBBBBBBBBBBBBBBBBBBBBBBBBB",
      items: null,
      name: "Shared",
    });
    expect(parsed).toStrictEqual({
      attribute_version: null,
      content_version: null,
      created_at: null,
      description: null,
      id: "BBBBBBBBBBBBBBBBBBBBBBBBBB",
      items: null,
      name: "Shared",
      type: null,
      updated_at: null,
    });
  });

  it("stores an event with no location or session as null for both, and an absent session field as null", () => {
    const bare = onepasswordEventDetailSchema.parse({ action: "join", timestamp: AT, uuid: "E1" });
    const withSession = onepasswordEventDetailSchema.parse({
      action: "join",
      session: { ip: "203.0.113.9" },
      timestamp: AT,
      uuid: "E1",
    });
    expect([bare.location, bare.session, bare.actor_uuid]).toEqual([null, null, null]);
    expect(withSession.session).toStrictEqual({ device_uuid: null, ip: "203.0.113.9", login_time: null, uuid: null });
  });

  it("still refuses an empty provider timestamp rather than storing it", () => {
    const parsed = onepasswordVaultDetailSchema.safeParse({ created_at: "", id: "B", name: "Shared" });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path)).toEqual([["created_at"]]);
  });
});

describe("a vault grant reads whichever permissions spelling op sent", () => {
  const GROUP_ROW = { id: "CCCCCCCCCCCCCCCCCCCCCCCCCC", name: "On call" };
  const permissionsOf = ({ row }: { row: Record<string, unknown> }) => {
    const entity = unwrap(
      projectOnepasswordVaultGrant({
        at: AT,
        principalKind: "group",
        raw: { ...GROUP_ROW, ...row },
        vaultId: "BBBBBBBBBBBBBBBBBBBBBBBBBB",
      }),
    );
    return (entity.channels["admin-cli"]!.detail as { permissions: readonly string[] }).permissions;
  };

  it("reads the plural field when it is present", () => {
    expect(permissionsOf({ row: { permission: "manage_vault", permissions: ["view_items"] } })).toEqual(["view_items"]);
  });

  it("reads the singular comma-separated field when the plural one is absent or null", () => {
    expect(permissionsOf({ row: { permission: "view_items, edit_items" } })).toEqual(["view_items", "edit_items"]);
    expect(permissionsOf({ row: { permission: "view_items", permissions: null } })).toEqual(["view_items"]);
  });

  it("marks the grant unreadable, never empty, when neither spelling is present", () => {
    expect(permissionsOf({ row: {} })).toEqual(["<unreadable>"]);
  });
});
