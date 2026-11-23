import { describe, expect, it } from "vitest";

import { parseGoogleAuditLogArgs } from "../../../cli/commands/google/auditLogArgs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PULL = ["pull", "--org", "1", "--quota-project", "acme-local", "--since", "2025-01-01T00:00:00Z"];

describe("parseGoogleAuditLogArgs", () => {
  it("parses a pull with repeated principals and roles", () => {
    expect(
      unwrap(
        parseGoogleAuditLogArgs({
          rest: [
            ...PULL,
            "--principal",
            "a@x.com",
            "--principal",
            "b@x.com",
            "--role",
            "roles/viewer",
            "--role",
            "roles/owner",
          ],
        }),
      ),
    ).toEqual({
      action: "pull",
      home: undefined,
      org: "1",
      principals: ["a@x.com", "b@x.com"],
      quotaProject: "acme-local",
      roles: ["roles/viewer", "roles/owner"],
      since: "2025-01-01T00:00:00Z",
    });
  });

  it("reads --all-principals as every principal", () => {
    expect(unwrap(parseGoogleAuditLogArgs({ rest: [...PULL, "--all-principals"] }))).toMatchObject({
      principals: "all",
    });
  });

  it("refuses both --principal and --all-principals, and neither", () => {
    const both = "pass --principal <email> (repeatable) or --all-principals, exactly one of the two";
    expect(
      unwrapErr(parseGoogleAuditLogArgs({ rest: [...PULL, "--all-principals", "--principal", "a@x.com"] })),
    ).toEqual([both]);
    expect(unwrapErr(parseGoogleAuditLogArgs({ rest: PULL }))).toEqual([both]);
  });

  it("names every missing pull flag at once", () => {
    expect(unwrapErr(parseGoogleAuditLogArgs({ rest: ["pull", "--all-principals"] }))).toEqual([
      "--org must be the organisation's number",
      "--quota-project is required: the project every call's quota and billing land on",
      "--since is required, an RFC 3339 UTC instant like 2025-08-29T00:00:00Z",
    ]);
  });

  it("refuses another action's flag by name", () => {
    expect(unwrapErr(parseGoogleAuditLogArgs({ rest: ["summary", "--org", "1"] }))).toEqual([
      "--org is not a summary flag",
    ]);
  });

  it("parses a summary with a plan", () => {
    expect(unwrap(parseGoogleAuditLogArgs({ rest: ["summary", "--plan", "/p.json", "--json"] }))).toEqual({
      action: "summary",
      generation: undefined,
      home: undefined,
      json: true,
      plan: "/p.json",
    });
  });

  it("refuses a missing or unknown action", () => {
    expect(unwrapErr(parseGoogleAuditLogArgs({ rest: [] }))).toEqual(["name an action: pull or summary"]);
    expect(unwrapErr(parseGoogleAuditLogArgs({ rest: ["push"] }))).toEqual([
      "name an action: pull or summary, not push",
    ]);
  });
});
