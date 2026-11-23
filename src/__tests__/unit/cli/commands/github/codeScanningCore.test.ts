import { describe, expect, it } from "vitest";

import {
  codeScanningDoorRequest,
  configurationLine,
  enforcedRefusal,
  GITHUB_CODE_SCANNING_FLAG_NAMES,
  isEnforced,
  parseGithubCodeScanningArgs,
  patchFailureLines,
  planDefaultSetupDisable,
  setupLine,
} from "../../../../../cli/commands/github/codeScanningCore.js";
import { GITHUB_CODE_SCANNING_USAGE } from "../../../../../cli/commands/github/codeScanningUsage.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap } from "../../../../../lib/result.js";
import type { DefaultSetup, RepoSecurityConfiguration } from "../../../../../outbound/github/defaultSetup.js";

const CONFIGURED: DefaultSetup = {
  languages: ["actions", "javascript-typescript"],
  querySuite: "default",
  schedule: "weekly",
  state: "configured",
  updatedAt: "2026-09-01T00:00:00Z",
};

const ATTACHED: RepoSecurityConfiguration = {
  codeScanningDefaultSetup: "enabled",
  enforcement: "unenforced",
  htmlUrl: "https://github.com/organizations/o/settings/security_products/configurations/view/7",
  id: 7,
  name: "GitHub recommended",
  status: "attached",
  targetType: "global",
};

describe("parseGithubCodeScanningArgs", () => {
  it("parses show with its repository and output mode", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["show", "--repo", "o/r", "--json"] });

    expect(unwrap(parsed)).toEqual({
      dryRun: false,
      home: undefined,
      json: true,
      owner: "o",
      repo: "r",
      subVerb: "show",
    });
  });

  it("parses disable with a dry run and a home", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["disable", "--repo", "o/r", "--dry-run", "--home", "/h"] });

    expect(unwrap(parsed)).toEqual({
      dryRun: true,
      home: "/h",
      json: false,
      owner: "o",
      repo: "r",
      subVerb: "disable",
    });
  });

  it("refuses an unknown sub-verb", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["toggle", "--repo", "o/r"] });

    expect(parsed._unsafeUnwrapErr()).toEqual([]);
  });

  it("parses enable as a preview when no approval is given", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["enable", "--repo", "o/r"] });

    expect(unwrap(parsed)).toEqual({
      approve: undefined,
      home: undefined,
      json: false,
      owner: "o",
      repo: "r",
      subVerb: "enable",
    });
  });

  it("parses enable carrying the preview's digest", () => {
    const parsed = parseGithubCodeScanningArgs({
      argv: ["enable", "--repo", "o/r", "--approve", "ghrepo-0123456789abcdef", "--home", "/h"],
    });

    expect(unwrap(parsed)).toEqual({
      approve: "ghrepo-0123456789abcdef",
      home: "/h",
      json: false,
      owner: "o",
      repo: "r",
      subVerb: "enable",
    });
  });

  it("refuses a malformed approval without echoing it", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["enable", "--repo", "o/r", "--approve", "yes-please"] });

    expect(parsed._unsafeUnwrapErr()).toEqual([
      "--approve takes the digest an `enable` preview printed: ghrepo- and 16 hex characters",
    ]);
  });

  it("refuses --approve on show and on disable", () => {
    const approve = ["--approve", "ghrepo-0123456789abcdef"];
    const show = parseGithubCodeScanningArgs({ argv: ["show", "--repo", "o/r", ...approve] });
    const disable = parseGithubCodeScanningArgs({ argv: ["disable", "--repo", "o/r", ...approve] });

    const refusal = "--approve is an `enable` flag; it takes the digest an `enable` preview printed";
    expect(show._unsafeUnwrapErr()).toEqual([refusal]);
    expect(disable._unsafeUnwrapErr()).toEqual([refusal]);
  });

  it("refuses a dry run on enable, which previews by default", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["enable", "--repo", "o/r", "--dry-run"] });

    expect(parsed._unsafeUnwrapErr()).toEqual([
      "--dry-run is a `disable` flag; `enable` previews by default and sends only with --approve",
    ]);
  });

  it("requires --repo", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["disable"] });

    expect(parsed._unsafeUnwrapErr()).toEqual(["--repo owner/name is required"]);
  });

  it("refuses a dry run on show, which never writes", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["show", "--repo", "o/r", "--dry-run"] });

    expect(parsed._unsafeUnwrapErr()).toEqual(["--dry-run is a `disable` flag; `show` never writes"]);
  });

  it("refuses a stray positional", () => {
    const parsed = parseGithubCodeScanningArgs({ argv: ["show", "--repo", "o/r", "extra"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("extra");
  });

  it("documents every accepted flag in its usage", () => {
    expect(GITHUB_CODE_SCANNING_FLAG_NAMES.length).toBeGreaterThan(0);
    expect(GITHUB_CODE_SCANNING_FLAG_NAMES.filter((flag) => !GITHUB_CODE_SCANNING_USAGE.includes(flag))).toEqual([]);
  });
});

describe("isEnforced", () => {
  it("reads the attachment's own status", () => {
    expect(isEnforced({ configuration: { ...ATTACHED, status: "enforced" } })).toBe(true);
  });

  it("reads the configuration's enforcement", () => {
    expect(isEnforced({ configuration: { ...ATTACHED, enforcement: "enforced" } })).toBe(true);
  });

  it("is false when neither signal says enforced", () => {
    expect(isEnforced({ configuration: ATTACHED })).toBe(false);
  });

  it("is false for a configuration carrying no metadata at all", () => {
    const bare: RepoSecurityConfiguration = {
      codeScanningDefaultSetup: undefined,
      enforcement: undefined,
      htmlUrl: undefined,
      id: undefined,
      name: undefined,
      status: undefined,
      targetType: undefined,
    };

    expect(isEnforced({ configuration: bare })).toBe(false);
  });
});

describe("planDefaultSetupDisable", () => {
  it("disables a configured repository with no configuration attached", () => {
    expect(planDefaultSetupDisable({ configuration: { kind: "none" }, setup: CONFIGURED })).toEqual({
      kind: "disable",
    });
  });

  it("disables under an unenforced configuration", () => {
    const plan = planDefaultSetupDisable({ configuration: { kind: "read", value: ATTACHED }, setup: CONFIGURED });

    expect(plan).toEqual({ kind: "disable" });
  });

  it("refuses under an enforced configuration, even one whose own setting is not_set", () => {
    const enforced = { ...ATTACHED, codeScanningDefaultSetup: "not_set", status: "enforced" as const };
    const plan = planDefaultSetupDisable({ configuration: { kind: "read", value: enforced }, setup: CONFIGURED });

    expect(plan).toEqual({ kind: "blocked-enforced", value: enforced });
  });

  it("still attempts when the configuration could not be read", () => {
    const plan = planDefaultSetupDisable({
      configuration: {
        error: { kind: "http", message: "Not Found", operation: "op", status: 404 },
        kind: "unavailable",
      },
      setup: CONFIGURED,
    });

    expect(plan).toEqual({ kind: "disable" });
  });

  it("is a no-op on an already-disabled repository", () => {
    const plan = planDefaultSetupDisable({
      configuration: { kind: "none" },
      setup: { ...CONFIGURED, state: "not-configured" },
    });

    expect(plan).toEqual({ kind: "already-disabled" });
  });

  it("treats an absent state as unknown, never as disabled", () => {
    const plan = planDefaultSetupDisable({
      configuration: { kind: "none" },
      setup: { ...CONFIGURED, state: undefined },
    });

    expect(plan).toEqual({ kind: "unknown-state" });
  });
});

describe("report lines", () => {
  it("names every default-setup field GitHub gave", () => {
    expect(setupLine({ setup: CONFIGURED })).toBe(
      "default setup: configured languages=actions,javascript-typescript suite=default schedule=weekly " +
        "updated=2026-09-01T00:00:00Z",
    );
  });

  it("says UNKNOWN for a missing state", () => {
    expect(
      setupLine({
        setup: { languages: [], querySuite: undefined, schedule: undefined, state: undefined, updatedAt: undefined },
      }),
    ).toBe("default setup: UNKNOWN (GitHub reported no state)");
  });

  it("names the attached configuration a refusal points an admin at", () => {
    expect(configurationLine({ configuration: { kind: "read", value: ATTACHED } })).toBe(
      'security configuration: "GitHub recommended" id=7 target=global attachment=attached enforcement=unenforced ' +
        "default-setup=enabled https://github.com/organizations/o/settings/security_products/configurations/view/7",
    );
  });

  it("says none only for a 204", () => {
    expect(configurationLine({ configuration: { kind: "none" } })).toBe("security configuration: none attached");
  });

  it("says unknown for an unreadable configuration", () => {
    const line = configurationLine({
      configuration: {
        error: { kind: "http", message: "Forbidden", operation: "op", status: 403 },
        kind: "unavailable",
      },
    });

    expect(line).toBe("security configuration: UNKNOWN — could not read it (Forbidden)");
  });
});

describe("codeScanningDoorRequest", () => {
  it("names the exact repository setting as an external write", () => {
    const request = codeScanningDoorRequest({
      args: { dryRun: false, home: undefined, json: false, owner: "o", repo: "r", subVerb: "disable" },
      home: "/h",
    });

    expect(request).toEqual({
      action: { kind: "verb", noun: "github", verb: "code-scanning disable" },
      artifact: { id: "o/r code-scanning/default-setup" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });
});

describe("patchFailureLines", () => {
  const failure = ({ status }: { status: number }): IngestError => ({
    kind: "http",
    message: "refused",
    operation: "github.codeScanning.updateDefaultSetup",
    provider: "github",
    status,
  });

  it("adds the org-admin line on a 422", () => {
    expect(patchFailureLines({ error: failure({ status: 422 }) })).toEqual([
      "github github.codeScanning.updateDefaultSetup HTTP 422: refused",
      "an organisation-level setting controls default setup here — an organisation admin must lift it " +
        "(detach the enforcing security configuration or set its default setup to not_set); a repository admin cannot",
    ]);
  });

  it("claims nothing beyond the error itself on any other status", () => {
    expect(patchFailureLines({ error: failure({ status: 500 }) })).toEqual([
      "github github.codeScanning.updateDefaultSetup HTTP 500: refused",
    ]);
  });
});

describe("enforcedRefusal", () => {
  it("names the repository and the org admin as the hand that lifts it", () => {
    const line = enforcedRefusal({
      args: { dryRun: false, home: undefined, json: false, owner: "o", repo: "r", subVerb: "disable" },
    });

    expect(line).toBe(
      "o/r: an ENFORCED security configuration is attached (named above), so a repository admin cannot switch " +
        "default setup off — an organisation admin must detach the configuration from this repository, or set " +
        "its code-scanning default setup to not_set, before `disable` can take effect",
    );
  });
});
