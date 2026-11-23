/**
 * Selector matching over `authentication.rules`: exact and `Service.*` selectors, "last one wins", and a
 * method no rule matches being a refusal rather than an empty scope list.
 */
import { describe, expect, it } from "vitest";

import { type AuthRule, scopesForSelector, splitCanonicalScopes } from "../../../../atlas/googleSecops/authRules.js";
import { GoogleSecopsInventoryErrors } from "../../../../atlas/googleSecops/errors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const READONLY = "https://www.googleapis.com/auth/chronicle.readonly";
const PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
const CHRONICLE = "https://www.googleapis.com/auth/chronicle";

/** The shape of the real config: one exact rule, two service wildcards, one rule's scopes out of order. */
const RULES: readonly AuthRule[] = [
  { scopes: [PLATFORM], selector: "google.cloud.chronicle.v1.InstanceService.GetInstance" },
  { scopes: [PLATFORM, READONLY, CHRONICLE], selector: "google.cloud.chronicle.v1.DataTableService.*" },
  { scopes: [PLATFORM], selector: "google.cloud.chronicle.v1.RuleService.*" },
];

describe("scopesForSelector", () => {
  it("matches a Service.* wildcard and returns its scopes sorted", () => {
    const scopes = unwrap(
      scopesForSelector({ rules: RULES, selector: "google.cloud.chronicle.v1.DataTableService.ListDataTables" }),
    );
    expect(scopes).toStrictEqual([CHRONICLE, READONLY, PLATFORM]);
  });

  it("matches an exact selector", () => {
    const scopes = unwrap(
      scopesForSelector({ rules: RULES, selector: "google.cloud.chronicle.v1.InstanceService.GetInstance" }),
    );
    expect(scopes).toStrictEqual([PLATFORM]);
  });

  it("refuses a method no rule matches as AUTH_RULE_MISSING, never an empty list", () => {
    const error = unwrapErr(
      scopesForSelector({ rules: RULES, selector: "google.cloud.chronicle.v1.InstanceService.UpdateInstance" }),
    );
    expect(error.code).toBe("AUTH_RULE_MISSING");
    expect(error.message).toBe(
      "no authentication rule in chronicle_v1.yaml matches google.cloud.chronicle.v1.InstanceService.UpdateInstance, so the config grants it no scope",
    );
  });

  it("does not let an exact selector match a method whose name merely starts the same", () => {
    const error = unwrapErr(
      scopesForSelector({ rules: RULES, selector: "google.cloud.chronicle.v1.InstanceService.GetInstanceStatus" }),
    );
    expect(error.code).toBe("AUTH_RULE_MISSING");
  });

  it("does not let a Service.* wildcard match a service whose name merely starts the same", () => {
    const error = unwrapErr(
      scopesForSelector({ rules: RULES, selector: "google.cloud.chronicle.v1.RuleServiceExtra.ListThings" }),
    );
    expect(error.code).toBe("AUTH_RULE_MISSING");
  });

  it("takes the LAST matching rule, as service config rules are ordered", () => {
    const rules: readonly AuthRule[] = [
      { scopes: [READONLY], selector: "google.cloud.chronicle.v1.RuleService.GetRule" },
      { scopes: [PLATFORM], selector: "google.cloud.chronicle.v1.RuleService.*" },
    ];
    expect(
      unwrap(scopesForSelector({ rules, selector: "google.cloud.chronicle.v1.RuleService.GetRule" })),
    ).toStrictEqual([PLATFORM]);
    expect(
      unwrap(
        scopesForSelector({ rules: rules.toReversed(), selector: "google.cloud.chronicle.v1.RuleService.GetRule" }),
      ),
    ).toStrictEqual([READONLY]);
  });

  it("refuses a deciding rule whose canonical_scopes is ',', empty or blank, never answering []", () => {
    const blocks = [",", "", " \n\t "];
    expect(blocks.map((canonicalScopes) => splitCanonicalScopes({ canonicalScopes }))).toStrictEqual([[], [], []]);
    const errors = blocks.map((canonicalScopes) =>
      unwrapErr(
        scopesForSelector({
          rules: [
            { scopes: [PLATFORM], selector: "google.cloud.chronicle.v1.RuleService.*" },
            {
              scopes: splitCanonicalScopes({ canonicalScopes }),
              selector: "google.cloud.chronicle.v1.RuleService.DeleteRule",
            },
          ],
          selector: "google.cloud.chronicle.v1.RuleService.DeleteRule",
        }),
      ),
    );
    const expected = GoogleSecopsInventoryErrors.authRuleGrantsNoScope({
      ruleSelector: "google.cloud.chronicle.v1.RuleService.DeleteRule",
      selector: "google.cloud.chronicle.v1.RuleService.DeleteRule",
    });
    expect(errors).toStrictEqual([expected, expected, expected]);
    expect(expected.message).toBe(
      "the authentication rule google.cloud.chronicle.v1.RuleService.DeleteRule decides google.cloud.chronicle.v1.RuleService.DeleteRule but its canonical_scopes lists no scope",
    );
  });

  it("matches any pattern of a comma-separated selector, and a bare *", () => {
    const rules: readonly AuthRule[] = [
      { scopes: [READONLY], selector: "a.B.C, a.D.*" },
      { scopes: [PLATFORM], selector: "*" },
    ];
    expect(unwrap(scopesForSelector({ rules: rules.slice(0, 1), selector: "a.D.E" }))).toStrictEqual([READONLY]);
    expect(unwrap(scopesForSelector({ rules: rules.slice(0, 1), selector: "a.B.C" }))).toStrictEqual([READONLY]);
    expect(unwrap(scopesForSelector({ rules, selector: "z.Y.X" }))).toStrictEqual([PLATFORM]);
  });
});

describe("splitCanonicalScopes", () => {
  it("splits the config's comma-and-newline block into its scopes", () => {
    const block = `${CHRONICLE},\n${READONLY},\n${PLATFORM}`;
    expect(splitCanonicalScopes({ canonicalScopes: block })).toStrictEqual([CHRONICLE, READONLY, PLATFORM]);
  });

  it("drops a trailing comma's empty entry", () => {
    expect(splitCanonicalScopes({ canonicalScopes: `${PLATFORM},\n` })).toStrictEqual([PLATFORM]);
  });
});
