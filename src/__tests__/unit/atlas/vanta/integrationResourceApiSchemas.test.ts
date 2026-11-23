import { describe, expect, it } from "vitest";

import {
  VANTA_RESOURCE_ARMS,
  vantaIntegrationResourceDtoSchema,
  vantaResourceArmsAccepting,
  vantaUndeclaredResourceFields,
} from "../../../../atlas/vanta/integrationResourceApiSchemas.js";

/** The nine fields every arm requires. Every value is synthetic. */
const base = {
  connectionId: null,
  creationDate: "2026-01-01T00:00:00.000Z",
  description: null,
  displayName: "example-role",
  inScope: true,
  owner: null,
  resourceId: "res-1",
  resourceKind: "AwsRole",
  responseType: "Resource",
};

const account = {
  ...base,
  accountName: "someone",
  groups: [],
  isDeactivated: false,
  isMfaEnabled: null,
  resourceKind: "GithubAccount",
  responseType: "Account",
  roles: ["member"],
};

/** One row per arm, each the shape the document declares for it. */
const ONE_ROW_PER_ARM = {
  Account: account,
  AwsAccount: {
    ...account,
    accessKeys: [{ accessKeyId: "synthetic-key-id", status: "Active" }],
    awsAccountNumber: "000000000000",
    awsUserAccountId: "synthetic-user-id",
  },
  CloudInfrastructure: { ...base, account: "acct", region: "region-1", responseType: "ComputeInstance" },
  ContainerRepository: { ...base, account: "acct", isAutoscanEnabled: null, region: "region-1" },
  Database: {
    ...base,
    account: "acct",
    areBackupsEnabled: true,
    containsEphi: null,
    containsUserData: null,
    isEncrypted: true,
  },
  Device: { ...base, containsEphi: null, containsUserData: null, isEncrypted: true, operatingSystemName: "os" },
  OrganizationSubunit: { ...base, accountId: null },
  PaaS: { ...base, containsEphi: false, containsUserData: false },
  Queue: { ...base, account: "acct", containsEphi: null, containsUserData: null, region: "region-1" },
  Resource: base,
  StorageBucket: {
    ...base,
    account: "acct",
    containsEphi: null,
    containsUserData: null,
    isEncrypted: true,
    isVersioned: null,
    region: "region-1",
  },
} as const;

describe("the AnyResource union", () => {
  it("declares exactly the eleven arms the published document does", () => {
    expect(Object.keys(VANTA_RESOURCE_ARMS).toSorted()).toEqual(Object.keys(ONE_ROW_PER_ARM).toSorted());
    expect(Object.keys(VANTA_RESOURCE_ARMS)).toHaveLength(11);
  });

  it("has exactly ONE strict arm accept each arm's own row — the shape decides the arm", () => {
    const accepted = Object.entries(ONE_ROW_PER_ARM).map(([arm, row]) => ({
      accepting: vantaResourceArmsAccepting({ row }),
      arm,
    }));
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.filter(({ arm, accepting }) => accepting.length !== 1 || accepting[0] !== arm)).toEqual([]);
  });

  it("keeps a row carrying deletedDate on its own arm", () => {
    expect(vantaResourceArmsAccepting({ row: { ...account, deletedDate: "2026-02-01T00:00:00.000Z" } })).toEqual([
      "Account",
    ]);
    expect(vantaResourceArmsAccepting({ row: { ...base, deletedDate: null } })).toEqual(["Resource"]);
  });

  it("follows the SHAPE where the tag names a different arm, as measured on this tenant", () => {
    // `gcp:GCPComputeInstance` answers "ComputeInstance", an enum value no arm is named for.
    expect(
      vantaResourceArmsAccepting({ row: { ...base, account: "a", region: "r", responseType: "ComputeInstance" } }),
    ).toEqual(["CloudInfrastructure"]);
    // `aws:AwsAccount` answers "Account" with the AwsAccount arm's fields.
    expect(vantaResourceArmsAccepting({ row: ONE_ROW_PER_ARM.AwsAccount })).toEqual(["AwsAccount"]);
  });

  it("keeps a null in a nullable required field on its arm, and refuses a null where the document forbids one", () => {
    expect(vantaResourceArmsAccepting({ row: { ...ONE_ROW_PER_ARM.Device, isEncrypted: null } })).toEqual(["Device"]);
    expect(vantaResourceArmsAccepting({ row: { ...ONE_ROW_PER_ARM.Database, isEncrypted: null } })).toEqual([]);
  });

  it("reads an access key strictly, so a key carrying an undeclared field is not an AwsAccount", () => {
    const leaky = { ...ONE_ROW_PER_ARM.AwsAccount, accessKeys: [{ accessKeyId: "k", extra: "x", status: "s" }] };
    expect(vantaResourceArmsAccepting({ row: leaky })).toEqual([]);
  });

  it("refuses a responseType outside the document's enum on every declared arm", () => {
    expect(vantaResourceArmsAccepting({ row: { ...base, responseType: "Spaceship" } })).toEqual([]);
  });
});

describe("the strict superset the boundary reads", () => {
  it("accepts one row of every declared arm unchanged", () => {
    const rows = Object.values(ONE_ROW_PER_ARM);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => vantaIntegrationResourceDtoSchema.safeParse(row).data)).toEqual(rows);
  });

  it("refuses a key no arm declares, naming it", () => {
    const parsed = vantaIntegrationResourceDtoSchema.safeParse({ ...ONE_ROW_PER_ARM.Device, colour: "red" });
    expect(parsed.error!.issues.map((issue) => [issue.code, issue.path])).toEqual([["unrecognized_keys", []]]);
  });
});

describe("a row no declared arm accepts", () => {
  // The whole-API probe once read a 1Password row missing fields `Account` requires; this one drops two.
  const twelveFieldAccount = { ...account, isDeactivated: undefined, isMfaEnabled: undefined };
  const twelve = Object.fromEntries(Object.entries(twelveFieldAccount).filter(([, value]) => value !== undefined));

  it("is still accepted by the strict superset, so one odd row cannot fail the whole kind", () => {
    const parsed = vantaIntegrationResourceDtoSchema.safeParse(twelve);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(twelve);
  });

  it("is named by its sorted field NAMES, which is what the gap carries", () => {
    expect(vantaUndeclaredResourceFields({ row: twelve })).toEqual([
      "accountName",
      "connectionId",
      "creationDate",
      "description",
      "displayName",
      "groups",
      "inScope",
      "owner",
      "resourceId",
      "resourceKind",
      "responseType",
      "roles",
    ]);
  });

  it("is refused when it lacks the resourceId an entity is keyed on", () => {
    const { resourceId: _dropped, ...noId } = base;
    expect(vantaIntegrationResourceDtoSchema.safeParse(noId).error!.issues.map((issue) => issue.path)).toEqual([
      ["resourceId"],
    ]);
  });

  it("is named, not refused, when only its responseType is one no arm declares", () => {
    const spaceship = { ...base, responseType: "Spaceship" };
    expect(vantaIntegrationResourceDtoSchema.safeParse(spaceship).success).toBe(true);
    expect(vantaUndeclaredResourceFields({ row: spaceship })).toEqual(Object.keys(base).toSorted());
  });

  it("is not reported for a row a declared arm accepts", () => {
    expect(vantaUndeclaredResourceFields({ row: ONE_ROW_PER_ARM.StorageBucket })).toBe(null);
  });
});
