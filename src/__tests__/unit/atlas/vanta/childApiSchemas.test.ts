/**
 * The three row shapes the child fan-out owns itself: a resource kind, a discovered vendor account (a
 * discriminated union whose arms genuinely differ) and a risk scenario's control link. Each parse is whole.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  vantaDiscoveredVendorAccountDtoSchema,
  vantaResourceKindDtoSchema,
  vantaRiskControlLinkDtoSchema,
} from "../../../../atlas/vanta/childApiSchemas.js";

/** What a refusal looked like: the verdict and each issue with its message left out. */
function rejection({ input, schema }: { input: unknown; schema: z.ZodType }): {
  issues: Record<string, unknown>[];
  success: boolean;
} {
  const result = schema.safeParse(input);
  const issues = result.success ? [] : result.error.issues;
  return {
    issues: issues.map((issue) => Object.fromEntries(Object.entries(issue).filter(([key]) => key !== "message"))),
    success: result.success,
  };
}

const KIND_MUTABLE = {
  canUpdateDescription: true,
  canUpdateOwner: false,
  integrationId: "child-kind-mutable-integration-id",
  isScopable: true,
  resourceKind: "ChildKindMutableBucket",
} as const;

const KIND_FROZEN = {
  canUpdateDescription: false,
  canUpdateOwner: true,
  integrationId: "child-kind-frozen-integration-id",
  isScopable: false,
  resourceKind: "ChildKindFrozenQueue",
} as const;

/* With only the two kinds above, description and scope move together. This third kind splits them, so across
   all three no flag's values match another's. */
const KIND_MIXED = {
  canUpdateDescription: true,
  canUpdateOwner: true,
  integrationId: "child-kind-mixed-integration-id",
  isScopable: false,
  resourceKind: "ChildKindMixedTopic",
} as const;

const ACCOUNT_USER = {
  displayName: "Child User Account Display",
  email: "child.user.account@example.test",
  id: "child-account-user-id",
  type: "USER",
} as const;

const ACCOUNT_COMPUTER_OWNED = {
  id: "child-account-computer-owned-id",
  owner: {
    displayName: "Child Computer Owner Display",
    email: "child.owner.email@example.test",
    id: "child-computer-owner-id",
    type: "USER",
  },
  type: "COMPUTER",
} as const;

const ACCOUNT_COMPUTER_ORPHAN = {
  displayName: "Child Orphan Computer Display",
  id: "child-account-computer-orphan-id",
  owner: null,
  type: "COMPUTER",
} as const;

/* The two computers above never have a display name and an owner together or neither: a display name is present
   exactly when the owner is null. This one has both, so the two fields no longer move as each other's negation. */
const ACCOUNT_COMPUTER_NAMED_AND_OWNED = {
  displayName: "Child Named Computer Display",
  id: "child-account-computer-named-and-owned-id",
  owner: {
    displayName: "Child Named Computer Owner Display",
    email: "child.named.owner.email@example.test",
    id: "child-named-computer-owner-id",
    type: "USER",
  },
  type: "COMPUTER",
} as const;

describe("vantaResourceKindDtoSchema", () => {
  it("reads a kind whose description and scope are flagged and whose owner is not, whole", () => {
    expect(vantaResourceKindDtoSchema.parse(KIND_MUTABLE)).toStrictEqual(KIND_MUTABLE);
  });

  it("reads a kind with every flag the other way round, whole", () => {
    expect(vantaResourceKindDtoSchema.parse(KIND_FROZEN)).toStrictEqual(KIND_FROZEN);
  });

  it("reads a kind whose description is flagged and whose scope is not, whole", () => {
    expect(vantaResourceKindDtoSchema.parse(KIND_MIXED)).toStrictEqual(KIND_MIXED);
  });

  it("requires every one of its five fields, each missing one refusing at its own path", () => {
    const keys = ["canUpdateDescription", "canUpdateOwner", "integrationId", "isScopable", "resourceKind"] as const;
    const outcomes = keys.map((missing) =>
      rejection({ input: { ...KIND_FROZEN, [missing]: undefined }, schema: vantaResourceKindDtoSchema }),
    );
    expect(outcomes).toStrictEqual([
      { issues: [{ code: "invalid_type", expected: "boolean", path: ["canUpdateDescription"] }], success: false },
      { issues: [{ code: "invalid_type", expected: "boolean", path: ["canUpdateOwner"] }], success: false },
      { issues: [{ code: "invalid_type", expected: "string", path: ["integrationId"] }], success: false },
      { issues: [{ code: "invalid_type", expected: "boolean", path: ["isScopable"] }], success: false },
      { issues: [{ code: "invalid_type", expected: "string", path: ["resourceKind"] }], success: false },
    ]);
  });

  it("refuses a flag sent as text, at that flag's own path", () => {
    expect(
      rejection({ input: { ...KIND_MUTABLE, canUpdateOwner: "false" }, schema: vantaResourceKindDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "boolean", path: ["canUpdateOwner"] }],
      success: false,
    });
  });

  it("refuses a key it does not know, naming it", () => {
    expect(
      rejection({ input: { ...KIND_FROZEN, displayName: "child-kind-extra" }, schema: vantaResourceKindDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["displayName"], path: [] }],
      success: false,
    });
  });
});

describe("vantaDiscoveredVendorAccountDtoSchema", () => {
  it("reads a user account, whole", () => {
    expect(vantaDiscoveredVendorAccountDtoSchema.parse(ACCOUNT_USER)).toStrictEqual(ACCOUNT_USER);
  });

  it("reads a computer whose owner is a person and whose display name is omitted, with no display name invented", () => {
    expect(vantaDiscoveredVendorAccountDtoSchema.parse(ACCOUNT_COMPUTER_OWNED)).toStrictEqual(ACCOUNT_COMPUTER_OWNED);
  });

  it("reads a computer with a display name and no owner, whole", () => {
    expect(vantaDiscoveredVendorAccountDtoSchema.parse(ACCOUNT_COMPUTER_ORPHAN)).toStrictEqual(ACCOUNT_COMPUTER_ORPHAN);
  });

  it("reads a computer with both a display name and an owner, whole", () => {
    expect(vantaDiscoveredVendorAccountDtoSchema.parse(ACCOUNT_COMPUTER_NAMED_AND_OWNED)).toStrictEqual(
      ACCOUNT_COMPUTER_NAMED_AND_OWNED,
    );
  });

  it("refuses a user that carries an owner, because only a computer has one", () => {
    expect(
      rejection({
        input: { ...ACCOUNT_USER, owner: ACCOUNT_COMPUTER_OWNED.owner },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["owner"], path: [] }],
      success: false,
    });
  });

  it("refuses a computer that carries an email, because only a user has one", () => {
    expect(
      rejection({
        input: { ...ACCOUNT_COMPUTER_ORPHAN, email: "child.computer.email@example.test" },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["email"], path: [] }],
      success: false,
    });
  });

  it("refuses a user with no display name, because only a computer may omit one", () => {
    expect(
      rejection({
        input: { email: "child.nameless@example.test", id: "child-account-nameless-id", type: "USER" },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "string", path: ["displayName"] }],
      success: false,
    });
  });

  it("refuses a computer with no id, at the id's path", () => {
    expect(
      rejection({
        input: { owner: null, type: "COMPUTER" },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "string", path: ["id"] }],
      success: false,
    });
  });

  it("refuses a user with no email, at the email's path", () => {
    expect(
      rejection({
        input: { displayName: "Child Emailless Display", id: "child-account-emailless-id", type: "USER" },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "string", path: ["email"] }],
      success: false,
    });
  });

  it("refuses a computer that has no owner key at all, because null is the only absence it accepts", () => {
    expect(
      rejection({
        input: { id: "child-account-ownerless-id", type: "COMPUTER" },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "object", path: ["owner"] }],
      success: false,
    });
  });

  it("refuses an account type outside the two arms, at the discriminator", () => {
    expect(
      rejection({
        input: { id: "child-account-robot-id", type: "ROBOT" },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [
        {
          code: "invalid_union",
          discriminator: "type",
          errors: [],
          note: "No matching discriminator",
          options: ["USER", "COMPUTER"],
          path: ["type"],
        },
      ],
      success: false,
    });
  });

  it("refuses an owner whose type is not USER, at the owner's type path", () => {
    expect(
      rejection({
        input: { ...ACCOUNT_COMPUTER_OWNED, owner: { ...ACCOUNT_COMPUTER_OWNED.owner, type: "TEAM" } },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["owner", "type"], values: ["USER"] }],
      success: false,
    });
  });

  it("requires each of a computer owner's four documented fields", () => {
    const owner = ACCOUNT_COMPUTER_OWNED.owner;
    const outcomes = Object.keys(owner).map((missing) =>
      rejection({
        input: { ...ACCOUNT_COMPUTER_OWNED, owner: { ...owner, [missing]: undefined } },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }).issues.map((issue) => issue["path"]),
    );
    expect(outcomes).toStrictEqual([
      [["owner", "displayName"]],
      [["owner", "email"]],
      [["owner", "id"]],
      [["owner", "type"]],
    ]);
  });

  it("refuses the emailAddress this owner once required, which the document's closed owner never declares", () => {
    expect(
      rejection({
        input: {
          ...ACCOUNT_COMPUTER_OWNED,
          owner: { ...ACCOUNT_COMPUTER_OWNED.owner, emailAddress: "child.owner.address@example.test" },
        },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["emailAddress"], path: ["owner"] }],
      success: false,
    });
  });

  it("refuses an owner carrying a key it does not know, at the owner's path", () => {
    expect(
      rejection({
        input: { ...ACCOUNT_COMPUTER_OWNED, owner: { ...ACCOUNT_COMPUTER_OWNED.owner, team: "child-owner-team" } },
        schema: vantaDiscoveredVendorAccountDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["team"], path: ["owner"] }],
      success: false,
    });
  });
});

describe("vantaRiskControlLinkDtoSchema", () => {
  it("reads both control kinds, whole and in order", () => {
    const parsed = [
      { controlId: "child-risk-link-existing-control-id", controlType: "EXISTING" },
      { controlId: "child-risk-link-plan-control-id", controlType: "TREATMENT_PLAN" },
    ].map((link) => vantaRiskControlLinkDtoSchema.parse(link));
    expect(parsed).toStrictEqual([
      { controlId: "child-risk-link-existing-control-id", controlType: "EXISTING" },
      { controlId: "child-risk-link-plan-control-id", controlType: "TREATMENT_PLAN" },
    ]);
  });

  it("requires both of its fields, each missing one refusing at its own path", () => {
    const link = { controlId: "child-risk-link-whole-control-id", controlType: "EXISTING" };
    const outcomes = Object.keys(link).map((missing) =>
      rejection({ input: { ...link, [missing]: undefined }, schema: vantaRiskControlLinkDtoSchema }).issues.map(
        (issue) => issue["path"],
      ),
    );
    expect(outcomes).toStrictEqual([[["controlId"]], [["controlType"]]]);
  });

  it("refuses a control kind outside the two, naming both", () => {
    expect(
      rejection({
        input: { controlId: "child-risk-link-draft-control-id", controlType: "DRAFT" },
        schema: vantaRiskControlLinkDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["controlType"], values: ["EXISTING", "TREATMENT_PLAN"] }],
      success: false,
    });
  });

  it("refuses a key it does not know, naming it", () => {
    expect(
      rejection({
        input: {
          controlId: "child-risk-link-extra-control-id",
          controlName: "child-risk-link-name",
          controlType: "EXISTING",
        },
        schema: vantaRiskControlLinkDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["controlName"], path: [] }],
      success: false,
    });
  });
});
