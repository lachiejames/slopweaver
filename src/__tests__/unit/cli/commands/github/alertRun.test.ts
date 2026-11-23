import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { type GithubAlertDeps, runGithubAlert } from "../../../../../cli/commands/github/alertRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { CodeScanningAlert, GithubAlertApi } from "../../../../../outbound/github/codeScanning.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const ARGV_PREFIX = ["node", "slopweaver", "github", "alert"];

const OPEN_ALERT: CodeScanningAlert = {
  dismissedComment: undefined,
  dismissedReason: undefined,
  htmlUrl: "https://github.com/o/r/security/code-scanning/29",
  location: { endLine: 49, path: "src/atlas/kit/identity.ts", startLine: 49 },
  number: 29,
  rule: {
    id: "js/insufficient-password-hash",
    name: "Use of a broken or weak cryptographic hashing algorithm",
    securitySeverityLevel: "high",
    severity: "error",
  },
  state: "open",
};

const DISMISSED_ALERT: CodeScanningAlert = {
  ...OPEN_ALERT,
  dismissedComment: "the sensitivity fixture builds the taint on purpose",
  dismissedReason: "used in tests",
  state: "dismissed",
};

/** A plain fake recording every `dismiss` call it receives. */
function alertApi({
  page,
  getResult,
  dismissResult,
  dismisses,
}: {
  page: { alerts: readonly CodeScanningAlert[]; truncated: boolean };
  getResult: CodeScanningAlert;
  dismissResult: CodeScanningAlert;
  dismisses: unknown[];
}): GithubAlertApi {
  return {
    dismiss: (args) => {
      dismisses.push(args);
      return ResultAsync.fromSafePromise(Promise.resolve(dismissResult));
    },
    get: () => ResultAsync.fromSafePromise(Promise.resolve(getResult)),
    list: () => ResultAsync.fromSafePromise(Promise.resolve(page)),
  };
}

function depsFor({
  door = memoryDoorLedger().port,
  home,
  page,
  getResult,
  dismissResult,
  dismisses,
  out,
  diagnostic,
}: {
  door?: DoorLedgerPort;
  home: string;
  page: { alerts: readonly CodeScanningAlert[]; truncated: boolean };
  getResult: CodeScanningAlert;
  dismissResult: CodeScanningAlert;
  dismisses: unknown[];
  out: string[];
  diagnostic: string[];
}): GithubAlertDeps {
  return {
    doorLedger: door,
    home: () => home,
    makeApi: () => alertApi({ dismissResult, dismisses, getResult, page }),
    out: (line) => out.push(line),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

describe("runGithubAlert list", () => {
  it("prints one line per alert", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const dismisses: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-alert-list-"));
    const code = await runGithubAlert({
      argv: [...ARGV_PREFIX, "list", "--repo", "o/r"],
      deps: depsFor({
        diagnostic,
        dismissResult: DISMISSED_ALERT,
        dismisses,
        getResult: OPEN_ALERT,
        home,
        out,
        page: { alerts: [OPEN_ALERT], truncated: false },
      }),
    });

    expect(code).toBe(0);
    expect(out).toEqual([
      "#29  open  js/insufficient-password-hash  high  src/atlas/kit/identity.ts:49  " +
        "https://github.com/o/r/security/code-scanning/29",
    ]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("reports no alerts as a plain line rather than an empty list", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const dismisses: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-alert-list-empty-"));
    const code = await runGithubAlert({
      argv: [...ARGV_PREFIX, "list", "--repo", "o/r"],
      deps: depsFor({
        diagnostic,
        dismissResult: DISMISSED_ALERT,
        dismisses,
        getResult: OPEN_ALERT,
        home,
        out,
        page: { alerts: [], truncated: false },
      }),
    });

    expect(code).toBe(0);
    expect(out).toEqual(["no code-scanning alerts on o/r"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("warns rather than refuses when the paginated read is truncated", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const dismisses: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-alert-list-truncated-"));
    const code = await runGithubAlert({
      argv: [...ARGV_PREFIX, "list", "--repo", "o/r"],
      deps: depsFor({
        diagnostic,
        dismissResult: DISMISSED_ALERT,
        dismisses,
        getResult: OPEN_ALERT,
        home,
        out,
        page: { alerts: [OPEN_ALERT], truncated: true },
      }),
    });

    expect(code).toBe(0);
    expect(diagnostic).toEqual(["o/r carries more alerts than this read covers; list is partial"]);
    rmSync(home, { force: true, recursive: true });
  });
});

const DISMISS_ARGV = [
  ...ARGV_PREFIX,
  "dismiss",
  "--repo",
  "o/r",
  "--number",
  "29",
  "--reason",
  "used_in_tests",
  "--comment",
  "the sensitivity fixture builds the taint on purpose",
];

describe("runGithubAlert dismiss", () => {
  it("re-reads the alert, dry-runs, and performs no mutation", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const dismisses: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-alert-dry-"));
    const code = await runGithubAlert({
      argv: [...DISMISS_ARGV, "--dry-run"],
      deps: depsFor({
        diagnostic,
        dismissResult: DISMISSED_ALERT,
        dismisses,
        getResult: OPEN_ALERT,
        home,
        out,
        page: { alerts: [], truncated: false },
      }),
    });

    expect(code).toBe(0);
    expect(dismisses).toEqual([]);
    expect(out).toEqual([
      "would dismiss  #29  js/insufficient-password-hash  src/atlas/kit/identity.ts:49  " +
        'reason=used_in_tests  comment="the sensitivity fixture builds the taint on purpose"  ' +
        "https://github.com/o/r/security/code-scanning/29",
    ]);
    rmSync(home, { force: true, recursive: true });
  });

  it("translates the CLI reason and routes the mutation through the door", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const dismisses: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-alert-live-"));
    const code = await runGithubAlert({
      argv: DISMISS_ARGV,
      deps: depsFor({
        diagnostic,
        dismissResult: DISMISSED_ALERT,
        dismisses,
        getResult: OPEN_ALERT,
        home,
        out,
        page: { alerts: [], truncated: false },
      }),
    });

    expect(code).toBe(0);
    expect(dismisses).toEqual([
      {
        alertNumber: 29,
        comment: "the sensitivity fixture builds the taint on purpose",
        owner: "o",
        reason: "used in tests",
        repo: "r",
      },
    ]);
    expect(out).toEqual([
      "dismissed  #29  js/insufficient-password-hash  src/atlas/kit/identity.ts:49  " +
        'reason=used_in_tests  comment="the sensitivity fixture builds the taint on purpose"  ' +
        "https://github.com/o/r/security/code-scanning/29",
    ]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("dismisses nothing when the door cannot record the dismissal", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const dismisses: unknown[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-alert-down-"));
    const code = await runGithubAlert({
      argv: DISMISS_ARGV,
      deps: depsFor({
        diagnostic,
        dismissResult: DISMISSED_ALERT,
        dismisses,
        door: unreachableDoorLedger(),
        getResult: OPEN_ALERT,
        home,
        out,
        page: { alerts: [], truncated: false },
      }),
    });

    expect(code).toBe(1);
    expect(dismisses).toEqual([]);
    expect(diagnostic.join("\n")).toContain("not performed:");
    rmSync(home, { force: true, recursive: true });
  });

  it("reports a usage error for a missing --comment without touching the network", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const dismisses: unknown[] = [];
    const code = await runGithubAlert({
      argv: [...ARGV_PREFIX, "dismiss", "--repo", "o/r", "--number", "29", "--reason", "wont_fix"],
      deps: depsFor({
        diagnostic,
        dismissResult: DISMISSED_ALERT,
        dismisses,
        getResult: OPEN_ALERT,
        home: "/unused",
        out,
        page: { alerts: [], truncated: false },
      }),
    });

    expect(code).toBe(2);
    expect(diagnostic[0]).toBe("--comment <text> is required");
    expect(dismisses).toEqual([]);
  });

  it("refuses an unrecognised sub-verb without touching the network", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const dismisses: unknown[] = [];
    const code = await runGithubAlert({
      argv: [...ARGV_PREFIX, "close", "--repo", "o/r", "--number", "29"],
      deps: depsFor({
        diagnostic,
        dismissResult: DISMISSED_ALERT,
        dismisses,
        getResult: OPEN_ALERT,
        home: "/unused",
        out,
        page: { alerts: [], truncated: false },
      }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(dismisses).toEqual([]);
    expect(diagnostic[0]).toBe("usage: slopweaver github alert <list|dismiss> [...]");
  });
});
