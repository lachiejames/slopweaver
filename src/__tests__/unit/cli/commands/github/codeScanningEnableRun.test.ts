import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import {
  type CodeScanningEnableSeams,
  runCodeScanningEnable,
} from "../../../../../cli/commands/github/codeScanningEnableRun.js";
import {
  type GithubCodeScanningDeps,
  runGithubCodeScanning,
} from "../../../../../cli/commands/github/codeScanningRun.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import type {
  DefaultSetup,
  DefaultSetupAcknowledgement,
  GithubDefaultSetupApi,
  RepoSecurityConfiguration,
} from "../../../../../outbound/github/defaultSetup.js";
import type { RepoAdministrationState } from "../../../../../outbound/github/repoAdministration.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const ARGV = ["node", "slopweaver", "github", "code-scanning", "enable", "--repo", "acme/widgets"];

const OFF: DefaultSetup = {
  languages: [],
  querySuite: "default",
  schedule: undefined,
  state: "not-configured",
  updatedAt: undefined,
};
const ON: DefaultSetup = {
  languages: ["javascript-typescript"],
  querySuite: "default",
  schedule: "weekly",
  state: "configured",
  updatedAt: "2026-11-19T00:00:00Z",
};

const REPOSITORY: RepoAdministrationState = {
  archived: false,
  fullName: "acme/widgets",
  htmlUrl: "https://github.com/acme/widgets",
  id: 4242,
  name: "widgets",
  ownerLogin: "acme",
};

const ENFORCED: RepoSecurityConfiguration = {
  codeScanningDefaultSetup: "disabled",
  enforcement: "enforced",
  htmlUrl: undefined,
  id: 7,
  name: "Org baseline",
  status: "enforced",
  targetType: "organization",
};

const SERVER: IngestError = { kind: "http", message: "boom", operation: "op", provider: "github", status: 500 };
const NOT_FOUND: IngestError = { kind: "http", message: "Not Found", operation: "op", provider: "github", status: 404 };
const PRIVATE_FREE_PLAN: IngestError = {
  kind: "http",
  message: "Code scanning is not enabled for this repository. Please enable code scanning in the repository settings.",
  operation: "github.codeScanning.getDefaultSetup",
  provider: "github",
  status: 403,
};

/** A plain fake: each read answers from its queue in order; every call is logged. */
function fakeApi({
  setups,
  configuration = undefined,
  repositories = [REPOSITORY],
  acknowledgement = { runUrl: undefined, status: 200 },
  calls,
}: {
  setups: (DefaultSetup | IngestError)[];
  configuration?: RepoSecurityConfiguration | undefined | IngestError;
  repositories?: RepoAdministrationState[];
  acknowledgement?: DefaultSetupAcknowledgement | IngestError;
  calls: string[];
}): GithubDefaultSetupApi {
  return {
    defaultSetup: () => {
      calls.push("read-setup");
      const next = setups.shift();
      if (next === undefined) {
        return errAsync(SERVER);
      }
      return "kind" in next ? errAsync(next) : okAsync(next);
    },
    disableDefaultSetup: () => {
      calls.push("disable-patch");
      return errAsync(SERVER);
    },
    enableDefaultSetup: () => {
      calls.push("enable-patch");
      return "kind" in acknowledgement ? errAsync(acknowledgement) : okAsync(acknowledgement);
    },
    repository: () => {
      calls.push("read-repository");
      const next = repositories.shift();
      return next === undefined ? errAsync(SERVER) : okAsync(next);
    },
    securityConfiguration: () => {
      calls.push("read-configuration");
      return configuration !== undefined && "kind" in configuration ? errAsync(configuration) : okAsync(configuration);
    },
  };
}

function harness({ home, api, door }: { home: string; api: GithubDefaultSetupApi; door: DoorLedgerPort }): {
  deps: GithubCodeScanningDeps;
  out: string[];
  diagnostic: string[];
} {
  const out: string[] = [];
  const diagnostic: string[] = [];
  return {
    deps: {
      doorLedger: door,
      home: () => home,
      makeApi: () => api,
      out: (line) => out.push(line),
      token: () => "token",
      writeDiagnostic: (line) => diagnostic.push(line),
    },
    diagnostic,
    out,
  };
}

/** Run one preview over the default world and return the digest it printed. */
async function previewDigest({ home }: { home: string }): Promise<string> {
  const h = harness({ api: fakeApi({ calls: [], setups: [OFF] }), door: memoryDoorLedger().port, home });
  await runGithubCodeScanning({ argv: ARGV, deps: h.deps });
  return h.out.find((line) => line.startsWith("  digest "))!.slice("  digest ".length);
}

describe("github code-scanning enable", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-cs-enable-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("previews the exact change and a digest, sending nothing and recording nothing", async () => {
    const calls: string[] = [];
    const ledger = memoryDoorLedger();
    const h = harness({ api: fakeApi({ calls, setups: [OFF] }), door: ledger.port, home });
    const code = await runGithubCodeScanning({ argv: ARGV, deps: h.deps });
    const digest = h.out.find((line) => line.startsWith("  digest "))!.slice("  digest ".length);

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration", "read-repository"]);
    expect(digest).toMatch(/^ghrepo-[0-9a-f]{16}$/);
    expect(h.out).toEqual([
      "preview acme/widgets",
      "  default setup: not-configured suite=default",
      "  security configuration: none attached",
      "  repository: acme/widgets id=4242",
      '  patch {"state":"configured"} (not-configured -> configured)',
      `  digest ${digest}`,
      `  apply:  slopweaver github code-scanning enable --repo acme/widgets --approve ${digest}`,
    ]);
    expect(ledger.records()).toEqual([]);
  });

  it("sends once on a matching approval re-read from scratch, and reports enabled off the read-back", async () => {
    const digest = await previewDigest({ home });
    const calls: string[] = [];
    const ledger = memoryDoorLedger();
    const h = harness({ api: fakeApi({ calls, setups: [OFF, ON] }), door: ledger.port, home });
    const code = await runGithubCodeScanning({ argv: [...ARGV, "--approve", digest], deps: h.deps });

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration", "read-repository", "enable-patch", "read-setup"]);
    expect(h.out.slice(0, 2)).toEqual([
      "enabled acme/widgets",
      "  default setup: configured languages=javascript-typescript suite=default schedule=weekly updated=2026-11-19T00:00:00Z",
    ]);
    expect(h.diagnostic).toEqual([]);
    expect(ledger.records().length).toBe(1);
  });

  it("holds an approval once the repository behind the address changed, and sends nothing", async () => {
    const digest = await previewDigest({ home });
    const calls: string[] = [];
    const moved = { ...REPOSITORY, id: 9999 };
    const h = harness({
      api: fakeApi({ calls, repositories: [moved], setups: [OFF] }),
      door: memoryDoorLedger().port,
      home,
    });
    const code = await runGithubCodeScanning({ argv: [...ARGV, "--approve", digest], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration", "read-repository"]);
    expect(h.diagnostic.join("\n")).toContain("github.code-scanning-enable-unapproved");
  });

  it("holds an approval once default setup changed after the preview", async () => {
    const digest = await previewDigest({ home });
    const calls: string[] = [];
    const touched = { ...OFF, updatedAt: "2026-11-20T00:00:00Z" };
    const h = harness({ api: fakeApi({ calls, setups: [touched] }), door: memoryDoorLedger().port, home });
    const code = await runGithubCodeScanning({ argv: [...ARGV, "--approve", digest], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration", "read-repository"]);
    expect(h.diagnostic.join("\n")).toContain("github.code-scanning-enable-unapproved");
  });

  it("sends no PATCH when the door cannot record the write", async () => {
    const digest = await previewDigest({ home });
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, setups: [OFF] }), door: unreachableDoorLedger(), home });
    const code = await runGithubCodeScanning({ argv: [...ARGV, "--approve", digest], deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration", "read-repository"]);
    expect(h.diagnostic.join("\n")).toContain("fixture: the store is down");
  });

  it("is a no-op when default setup is already on: no identity read, no digest, no write", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, setups: [ON] }), door: memoryDoorLedger().port, home });
    const code = await runGithubCodeScanning({ argv: ARGV, deps: h.deps });

    expect(code).toBe(0);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.out[0]).toBe("already enabled acme/widgets");
  });

  it("refuses under an enforced configuration and sends nothing", async () => {
    const calls: string[] = [];
    const api = fakeApi({ calls, configuration: ENFORCED, setups: [OFF] });
    const h = harness({ api, door: memoryDoorLedger().port, home });
    const code = await runGithubCodeScanning({ argv: ARGV, deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.out[0]).toBe("refused acme/widgets");
    expect(h.diagnostic[0]).toContain("acme/widgets: an ENFORCED security configuration is attached");
  });

  it("refuses when the configuration cannot be read, unlike disable", async () => {
    const calls: string[] = [];
    const api = fakeApi({ calls, configuration: NOT_FOUND, setups: [OFF] });
    const h = harness({ api, door: memoryDoorLedger().port, home });
    const code = await runGithubCodeScanning({ argv: ARGV, deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration"]);
    expect(h.diagnostic[0]).toContain("an enforced one cannot be ruled out");
  });

  it("refuses an absent state as unknown", async () => {
    const api = fakeApi({ calls: [], setups: [{ ...OFF, state: undefined }] });
    const h = harness({ api, door: memoryDoorLedger().port, home });
    const code = await runGithubCodeScanning({ argv: ARGV, deps: h.deps });

    expect(code).toBe(1);
    expect(h.diagnostic).toEqual(["acme/widgets: GitHub reported no default-setup state; nothing sent"]);
  });

  it("reports a private free-plan repository's 403 verbatim, reading nothing further", async () => {
    const calls: string[] = [];
    const h = harness({ api: fakeApi({ calls, setups: [PRIVATE_FREE_PLAN] }), door: memoryDoorLedger().port, home });
    const code = await runGithubCodeScanning({ argv: ARGV, deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup"]);
    expect(h.diagnostic).toEqual([
      "github github.codeScanning.getDefaultSetup HTTP 403: Code scanning is not enabled for this repository. " +
        "Please enable code scanning in the repository settings.",
    ]);
  });

  it("reports a failed identity read and sends nothing", async () => {
    const calls: string[] = [];
    const h = harness({
      api: fakeApi({ calls, repositories: [], setups: [OFF] }),
      door: memoryDoorLedger().port,
      home,
    });
    const code = await runGithubCodeScanning({ argv: ARGV, deps: h.deps });

    expect(code).toBe(1);
    expect(calls).toEqual(["read-setup", "read-configuration", "read-repository"]);
    expect(h.diagnostic).toEqual(["github op HTTP 500: boom"]);
  });
});

describe("github code-scanning enable — what the read-back decides", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-cs-enable-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Approve a fresh preview, then send with the given acknowledgement and read-back. */
  async function send({
    acknowledgement,
    after,
  }: {
    acknowledgement: DefaultSetupAcknowledgement | IngestError;
    after: DefaultSetup | IngestError;
  }): Promise<{ code: number; out: string[]; diagnostic: string[]; calls: string[] }> {
    const digest = await previewDigest({ home });
    const calls: string[] = [];
    const api = fakeApi({ acknowledgement, calls, setups: [OFF, after] });
    const h = harness({ api, door: memoryDoorLedger().port, home });
    const code = await runGithubCodeScanning({ argv: [...ARGV, "--approve", digest], deps: h.deps });
    return { calls, code, diagnostic: h.diagnostic, out: h.out };
  }

  it("a 202 still reading not-configured is deferred, never enabled", async () => {
    const result = await send({ acknowledgement: { runUrl: "https://run", status: 202 }, after: OFF });

    expect(result.code).toBe(4);
    expect(result.out[0]).toBe("accepted, not yet applied acme/widgets");
    expect(result.diagnostic).toEqual([
      "GitHub queued the change (HTTP 202); re-read with `github code-scanning show`",
    ]);
  });

  it("a 200 still reading not-configured is not confirmed", async () => {
    const result = await send({ acknowledgement: { runUrl: undefined, status: 200 }, after: OFF });

    expect(result.code).toBe(1);
    expect(result.out[0]).toBe("NOT confirmed acme/widgets");
    expect(result.diagnostic).toEqual([
      "GitHub answered HTTP 200 but default setup still reads not-configured — a configuration this token cannot " +
        "see may be overriding it",
    ]);
  });

  it("a failed PATCH that nonetheless landed is reported as enabled despite the error", async () => {
    const result = await send({ acknowledgement: SERVER, after: ON });

    expect(result.code).toBe(0);
    expect(result.calls.filter((call) => call === "enable-patch")).toEqual(["enable-patch"]);
    expect(result.out[0]).toBe("enabled despite the error acme/widgets");
    expect(result.diagnostic).toEqual(["github op HTTP 500: boom"]);
  });

  it("a failed PATCH that did not land is reported unchanged", async () => {
    const result = await send({ acknowledgement: SERVER, after: OFF });

    expect(result.code).toBe(1);
    expect(result.out[0]).toBe("unchanged acme/widgets");
  });

  it("a failed read-back says the outcome is unknown", async () => {
    const result = await send({ acknowledgement: { runUrl: undefined, status: 200 }, after: SERVER });

    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.diagnostic).toEqual([
      "github op HTTP 500: boom",
      "the read-back failed, so whether default setup is now on is unknown — run " +
        "`slopweaver github code-scanning show --repo acme/widgets` before retrying",
    ]);
  });

  it("carries the bound view, the acknowledgement and the after state in one JSON document", async () => {
    const digest = await previewDigest({ home });
    const api = fakeApi({ acknowledgement: { runUrl: "https://run", status: 202 }, calls: [], setups: [OFF, ON] });
    const h = harness({ api, door: memoryDoorLedger().port, home });
    const code = await runGithubCodeScanning({ argv: [...ARGV, "--approve", digest, "--json"], deps: h.deps });
    const doc: unknown = JSON.parse(h.out.join("\n"));

    expect(code).toBe(0);
    expect(doc).toEqual({
      acknowledgement: { runUrl: "https://run", status: 202 },
      action: "code-scanning enable",
      after: ON,
      before: { languages: [], querySuite: "default", state: "not-configured" },
      configuration: { kind: "none" },
      digest,
      outcome: "enabled",
      patch: { state: "configured" },
      repo: "acme/widgets",
      repository: { archived: false, fullName: "acme/widgets", id: 4242 },
      sent: true,
      setup: ON,
      source: "acme/widgets",
    });
  });
});

describe("runCodeScanningEnable over reads already taken", () => {
  const ARGS = {
    approve: undefined,
    home: undefined,
    json: false,
    owner: "acme",
    repo: "widgets",
    subVerb: "enable",
  } as const;

  /** Seams over a fake that logs every call, so a case can show the run read nothing again. */
  function seams({ calls }: { calls: string[] }): {
    seams: CodeScanningEnableSeams;
    out: string[];
    diagnostic: string[];
  } {
    const out: string[] = [];
    const diagnostic: string[] = [];
    return {
      diagnostic,
      out,
      seams: {
        api: fakeApi({ calls, setups: [] }),
        home: "/unused",
        ledger: unreachableDoorLedger(),
        out: (line) => out.push(line),
        writeDiagnostic: (line) => diagnostic.push(line),
      },
    };
  }

  it("answers already enabled from the observed state, calling GitHub not once more", async () => {
    const calls: string[] = [];
    const s = seams({ calls });
    const code = await runCodeScanningEnable({
      args: ARGS,
      observed: { configuration: { kind: "none" }, setup: ON },
      seams: s.seams,
    });

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(s.out[0]).toBe("already enabled acme/widgets");
  });

  it("refuses under an observed enforced configuration before reading the repository or sending", async () => {
    const calls: string[] = [];
    const s = seams({ calls });
    const observed = { configuration: { kind: "read", value: ENFORCED }, setup: OFF } as const;
    const code = await runCodeScanningEnable({ args: ARGS, observed, seams: s.seams });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(s.out[0]).toBe("refused acme/widgets");
  });
});
