/**
 * One Google Admin fill, with the Admin API replaced by a typed collection-reader fake and an OAuth client
 * nothing ever calls: every planned call is read in plan order on the caller's client under one rate scope
 * that is not the account itself, a refused call is reported and the run carries on, and the report totals
 * what answered, what was refused and how many records came back, beside every exclusion the plan made.
 */
import { OAuth2Client } from "googleapis-common";
import { describe, expect, it } from "vitest";

import { runGoogleAdminFill } from "../../../../../atlas/googleAdmin/adminApi/fill.js";
import { googleAdminFillPlan } from "../../../../../atlas/googleAdmin/adminApi/plan.js";
import { err, ok } from "../../../../../lib/result.js";

/**
 * The fill's collection-reader seam, taken from the fill's own signature. Deliberately not imported from
 * `live/googleAdmin/read.ts`: that module has no direct test, and importing it here would credit it as tested.
 */
type CollectionReader = NonNullable<Parameters<typeof runGoogleAdminFill>[0]["readCollection"]>;

const GROUP_READONLY = "https://www.googleapis.com/auth/admin.directory.group.readonly";
const USER_READONLY = "https://www.googleapis.com/auth/admin.directory.user.readonly";
const ACCOUNT = "admin@example.invalid";
const AT = "2026-10-13T02:00:00.000Z";

/** An OAuth client the fake reader never touches — constructing one makes no call. */
const CLIENT = new OAuth2Client({ clientId: "client-1", clientSecret: "secret-1" });

/** A reader fake recording each call: groups answer two records, users are refused 403. */
function recordingReader(): {
  calls: Parameters<CollectionReader>[0][];
  readCollection: CollectionReader;
} {
  const calls: Parameters<CollectionReader>[0][] = [];
  const readCollection: CollectionReader = async (input) => {
    calls.push(input);
    if (input.call.id === "directory.users.list") {
      return err({ message: "Not Authorized to access this resource/api", status: 403 });
    }
    return ok({
      records: [
        { fields: ["email", "id", "name"], providerId: "group-1" },
        { fields: ["email", "id"], providerId: "group-2" },
      ],
      shape: "records",
      truncated: false,
    });
  };
  return { calls, readCollection };
}

describe("runGoogleAdminFill", () => {
  it("reads every planned call in plan order on the caller's client, under one rate scope that is not the account", async () => {
    const { calls, readCollection } = recordingReader();

    await runGoogleAdminFill({
      account: ACCOUNT,
      at: AT,
      client: CLIENT,
      granted: [GROUP_READONLY, USER_READONLY],
      readCollection,
    });

    expect(calls.map(({ call }) => call.id)).toEqual(["directory.groups.list", "directory.users.list"]);
    expect(calls.map(({ client }) => client === CLIENT)).toEqual([true, true]);
    expect(new Set(calls.map(({ scopeId }) => scopeId)).size).toBe(1);
    expect(calls[0]!.scopeId).not.toBe(ACCOUNT);
  });

  it("reports the answered call, carries on past the refused one, and totals answered 1, refused 1, records 2", async () => {
    const { readCollection } = recordingReader();

    const report = await runGoogleAdminFill({
      account: ACCOUNT,
      at: AT,
      client: CLIENT,
      granted: [GROUP_READONLY, USER_READONLY],
      readCollection,
    });

    expect(report.answered).toBe(1);
    expect(report.refused).toBe(1);
    expect(report.records).toBe(2);
    expect(report.observation.operations).toEqual([
      {
        aggregate: false,
        document: "admin.directory_v1",
        id: "directory.groups.list",
        kind: "directory-groups",
        records: [
          { fields: ["email", "id", "name"], providerId: "group-1" },
          { fields: ["email", "id"], providerId: "group-2" },
        ],
        truncated: false,
      },
    ]);
    expect(report.observation.failed).toEqual([
      {
        id: "directory.users.list",
        kind: "directory-users",
        message: "Not Authorized to access this resource/api",
        status: 403,
      },
    ]);
    expect(report.observation.filledAtIso).toBe("2026-10-13T02:00:00.000Z");
    expect(report.observation.grantedScopes).toEqual([GROUP_READONLY, USER_READONLY]);
  });

  it("reports what the plan excluded, each with its reason, without calling it", async () => {
    const { calls, readCollection } = recordingReader();

    const report = await runGoogleAdminFill({
      account: ACCOUNT,
      at: AT,
      client: CLIENT,
      granted: [GROUP_READONLY, USER_READONLY],
      readCollection,
    });

    expect(report.observation.excluded).toContainEqual({
      detail: "it requires groupKey.id, which names a record this atlas has not read",
      exclusion: "parameter-needs-a-record",
      id: "cloudidentity.groups.lookup",
      kind: "cloud-identity-groups",
    });
    expect(report.observation.excluded).toContainEqual({
      detail: "its path templates {groupsId}, which names a record this atlas has not read",
      exclusion: "path-needs-a-record",
      id: "cloudidentity.groups.memberships.get",
      kind: "cloud-identity-groups-memberships",
    });
    const planned = googleAdminFillPlan({ granted: [GROUP_READONLY, USER_READONLY] }).excluded;
    expect(planned.length).toBeGreaterThan(2);
    expect(report.observation.excluded).toEqual(
      planned.map(({ detail, exclusion, id, kind }) => ({ detail, exclusion, id, kind })),
    );
    const calledIds = new Set(calls.map(({ call }) => call.id));
    expect(planned.filter(({ id }) => calledIds.has(id))).toEqual([]);
  });
});
