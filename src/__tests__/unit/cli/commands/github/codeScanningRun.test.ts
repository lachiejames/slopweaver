import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import type { GithubCodeScanningArgs } from "../../../../../cli/commands/github/codeScanningCore.js";
import { observeCodeScanning } from "../../../../../cli/commands/github/codeScanningObserve.js";
import {
  type GithubCodeScanningDeps,
  githubCodeScanningCommand,
  runGithubCodeScanning,
} from "../../../../../cli/commands/github/codeScanningRun.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type {
  DefaultSetup,
  DefaultSetupAcknowledgement,
  GithubDefaultSetupApi,
  RepoSecurityConfiguration,
} from "../../../../../outbound/github/defaultSetup.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const ARGV_PREFIX = ["node", "slopweaver", "github", "code-scanning"];

const CONFIGURED: DefaultSetup = {
  languages: ["javascript-typescript"],
  querySuite: "default",
  schedule: "weekly",
  state: "configured",
  updatedAt: undefined,
};
const DISABLED: DefaultSetup = { ...CONFIGURED, languages: [], schedule: undefined, state: "not-configured" };

const ENFORCED: RepoSecurityConfiguration = {
  codeScanningDefaultSetup: "enabled",
  enforcement: "enforced",
  htmlUrl: "https://github.com/organizations/o/settings/security_products/configurations/view/7",
  id: 7,
  name: "Org baseline",
  status: "enforced",
  targetType: "organization",
};

const FORBIDDEN: IngestError = {
  kind: "http",
  message: "Resource not accessible",
  operation: "op",
  provider: "github",
  status: 403,
};
const SERVER: IngestError = { kind: "http", message: "boom", operation: "op", provider: "github", status: 500 };

/** A plain fake: `setups` answers each default-setup read in order; every call is logged. */
function fakeApi({
  setups,
  configuration,
  acknowledgement = { runUrl: undefined, status: 200 },
  calls,
}: {
  setups: DefaultSetup[];
  configuration: RepoSecurityConfiguration | undefined | IngestError;
  acknowledgement?: DefaultSetupAcknowledgement | IngestError;
  calls: string[];
}): GithubDefaultSetupApi {
  return {
    defaultSetup: () => {
      calls.push("read-setup");
      const next = setups.shift();
      return next === undefined ? errAsync(SERVER) : okAsync(next);
    },
    disableDefaultSetup: () => {
      calls.push("patch");
      return "kind" in acknowledgement ? errAsync(acknowledgement) : okAsync(acknowledgement);
    },
    // `enable`'s two calls, which `show` and `disable` must never reach: each logs, then fails loudly.
    enableDefaultSetup: () => {
      calls.push("enable-patch");
      return errAsync(SERVER);
    },
    repository: () => {
      calls.push("read-repository");
      return errAsync(SERVER);
    },
    securityConfiguration: () => {
      calls.push("read-configuration");
      return configuration !== undefined && "kind" in configuration ? errAsync(configuration) : okAsync(configuration);
    },
  };
}

interface Harness {
  readonly deps: GithubCodeScanningDeps;
  readonly out: string[];
  readonly diagnostic: string[];
  readonly homes: string[];
}

function harness({
  home,
  api,
  door = memoryDoorLedger().port,
}: {
  home: string;
  api: GithubDefaultSetupApi;
  door?: DoorLedgerPort;
}): Harness {
  const out: string[] = [];
  const diagnostic: string[] = [];
  const homes: string[] = [];
  return {
    deps: {
      doorLedger: door,
      home: () => home,
      makeApi: () => api,
      out: (line) => out.push(line),
      token: ({ home: seen }) => {
        homes.push(seen);
        return "token";
      },
      writeDiagnostic: (line) => diagnostic.push(line),
    },
    diagnostic,
    homes,
    out,
  };
}

describe("runGithubCodeScanning", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-code-scanning-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("shows both settings and writes nothing", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: undefined, setups: [CONFIGURED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "show", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.out).toEqual([
      "read o/r",
      "  default setup: configured languages=javascript-typescript suite=default schedule=weekly",
      "  security configuration: none attached",
    ]);
  });

  it("marks show as enforced from above when a configuration enforces it", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: ENFORCED, setups: [CONFIGURED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "show", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(0);
    expect(h.out[0]).toBe("enforced from above o/r");
  });

  it("dry-runs after both reads and sends nothing", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: undefined, setups: [CONFIGURED] }), home });
    const code = await runGithubCodeScanning({
      argv: [...ARGV_PREFIX, "disable", "--repo", "o/r", "--dry-run"],
      deps: h.deps,
    });

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.out[0]).toBe("would disable o/r");
  });

  it("sends the PATCH once, then reports disabled only on a confirming read-back", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: undefined, setups: [CONFIGURED, DISABLED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration", "patch", "read-setup", "read-configuration"]);
    expect(h.out).toEqual([
      "disabled o/r",
      "  default setup: not-configured suite=default",
      "  security configuration: none attached",
    ]);
    expect(h.diagnostic).toEqual([]);
  });

  it("sends no PATCH when the door cannot record the disable", async () => {
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({ calls, configuration: undefined, setups: [CONFIGURED] }),
      door: unreachableDoorLedger(),
      home,
    });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.diagnostic.join("\n")).toContain("not performed:");
  });

  it("carries before, acknowledgement and after in one JSON document", async () => {
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({
        acknowledgement: { runUrl: "https://run", status: 202 },
        calls,
        configuration: undefined,
        setups: [CONFIGURED, DISABLED],
      }),
      home,
    });
    const code = await runGithubCodeScanning({
      argv: [...ARGV_PREFIX, "disable", "--repo", "o/r", "--json"],
      deps: h.deps,
    });
    const doc: unknown = JSON.parse(h.out.join("\n"));

    expect(code).toBe(0);
    expect(doc).toEqual({
      acknowledgement: { runUrl: "https://run", status: 202 },
      before: CONFIGURED,
      configuration: { kind: "none" },
      outcome: "disabled",
      repo: "o/r",
      setup: DISABLED,
    });
  });

  it("refuses under an enforced configuration and sends nothing", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: ENFORCED, setups: [CONFIGURED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.out[0]).toBe("refused o/r");
    expect(h.diagnostic[0]).toContain("an organisation admin must detach the configuration");
  });

  it("is a no-op on an already-disabled repository", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: undefined, setups: [DISABLED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.out[0]).toBe("already disabled o/r");
  });

  it("keeps an unreadable configuration as unknown and still attempts the repository write", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: FORBIDDEN, setups: [CONFIGURED, DISABLED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration", "patch", "read-setup", "read-configuration"]);
    expect(h.out[2]).toBe("  security configuration: UNKNOWN — could not read it (Resource not accessible)");
  });

  it("aborts on a configuration read failure that is not a visibility refusal", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: SERVER, setups: [CONFIGURED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.diagnostic).toEqual(["github op HTTP 500: boom"]);
  });

  it("reports a 202 with an unchanged state as deferred, not disabled", async () => {
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({
        acknowledgement: { runUrl: undefined, status: 202 },
        calls,
        configuration: undefined,
        setups: [CONFIGURED, CONFIGURED],
      }),
      home,
    });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(4);
    expect(h.out[0]).toBe("accepted, not yet applied o/r");
  });

  it("reports a 200 with an unchanged state as not confirmed", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: undefined, setups: [CONFIGURED, CONFIGURED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(1);
    expect(h.out[0]).toBe("NOT confirmed o/r");
    expect(h.diagnostic[0]).toContain("still reads configured");
  });

  it("says the PATCH was acknowledged when only the read-back fails", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: undefined, setups: [CONFIGURED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration", "patch", "read-setup"]);
    expect(h.diagnostic[1]).toBe(
      "GitHub acknowledged the disable (HTTP 200) but the read-back failed; run `github code-scanning show` to confirm",
    );
  });

  it("names the org-level block on a 422, never retries, and reports the state it reads back", async () => {
    const orgControlled: IngestError = {
      kind: "http",
      message:
        "Code scanning default setup cannot be modified. This setting is controlled by organization administrators.",
      operation: "github.codeScanning.updateDefaultSetup",
      provider: "github",
      status: 422,
    };
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({
        acknowledgement: orgControlled,
        calls,
        configuration: FORBIDDEN,
        setups: [CONFIGURED, CONFIGURED],
      }),
      home,
    });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration", "patch", "read-setup", "read-configuration"]);
    expect(h.diagnostic).toEqual([
      "github github.codeScanning.updateDefaultSetup HTTP 422: Code scanning default setup cannot be modified. " +
        "This setting is controlled by organization administrators.",
      "an organisation-level setting controls default setup here — an organisation admin must lift it " +
        "(detach the enforcing security configuration or set its default setup to not_set); a repository admin cannot",
    ]);
    expect(h.out[0]).toBe("unchanged o/r");
  });

  it("never claims a 5xx left the state alone — the read-back decides", async () => {
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({ acknowledgement: SERVER, calls, configuration: undefined, setups: [CONFIGURED, DISABLED] }),
      home,
    });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration", "patch", "read-setup", "read-configuration"]);
    expect(h.diagnostic).toEqual(["github op HTTP 500: boom"]);
    expect(h.out[0]).toBe("disabled despite the error o/r");
  });

  it("says the outcome is unknown when the PATCH and its read-back both fail", async () => {
    const dropped: IngestError = {
      code: "UND_ERR_SOCKET",
      kind: "network",
      message: "other side closed",
      operation: "op",
      provider: "github",
    };
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({ acknowledgement: dropped, calls, configuration: undefined, setups: [CONFIGURED] }),
      home,
    });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable", "--repo", "o/r"], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration", "patch", "read-setup"]);
    expect(h.diagnostic).toEqual([
      "github op UND_ERR_SOCKET: other side closed",
      "the read-back failed too, so whether the PATCH landed is unknown — run `github code-scanning show` before retrying",
    ]);
  });

  it("resolves the token against --home", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: undefined, setups: [CONFIGURED] }), home: "/unused" });
    await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "show", "--repo", "o/r", "--home", home], deps: h.deps });

    expect(h.homes).toEqual([home]);
  });

  it("refuses bad input before touching any seam", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, configuration: undefined, setups: [CONFIGURED] }), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV_PREFIX, "disable"], deps: h.deps });

    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(h.homes).toEqual([]);
  });

  it("exports a command that refuses a malformed invocation before any I/O", async () => {
    expect(await githubCodeScanningCommand([...ARGV_PREFIX, "disable"])).toBe(2);
  });
});

describe("observeCodeScanning", () => {
  const SHOW_ARGS: GithubCodeScanningArgs = {
    dryRun: false,
    home: undefined,
    json: false,
    owner: "o",
    repo: "r",
    subVerb: "show",
  };

  it("keeps a configuration the token cannot see as unavailable, never as none attached", async () => {
    const calls: string[] = [];
    const api = fakeApi({ calls, configuration: FORBIDDEN, setups: [CONFIGURED] });
    const observed = unwrap(await observeCodeScanning({ api, args: SHOW_ARGS }));
    expect(observed).toEqual({ configuration: { error: FORBIDDEN, kind: "unavailable" }, setup: CONFIGURED });
    expect(calls).toEqual(["read-setup", "read-configuration"]);
  });

  it("reads no configuration at all once the default-setup read has failed", async () => {
    const calls: string[] = [];
    const api = fakeApi({ calls, configuration: undefined, setups: [] });
    const observed = await observeCodeScanning({ api, args: SHOW_ARGS });
    expect(unwrapErr(observed)).toEqual(["github op HTTP 500: boom"]);
    expect(calls).toEqual(["read-setup"]);
  });
});
