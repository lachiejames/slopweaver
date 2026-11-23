/**
 * The `github exposure sweep` shell over plain fake edges and an explicit throwaway home: what it prints, what it
 * writes to the state home, and the exit codes.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type GithubExposureDeps, runGithubExposure } from "../../../../../cli/commands/github/exposureRun.js";
import type { LineListLoad } from "../../../../../hygiene/scan.js";
import { err, ok } from "../../../../../lib/result.js";
import { GithubJobLogErrors } from "../../../../../live/github/jobLogErrors.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { fakeGithubExposureSeam } from "../../../../githubExposureFake.js";

const CANARY_ADDRESS = "owner-canary@acme-mail.io";
const CANARY_WORD = "SECRET-CANARY-BODY";

const CANARY_UPLOAD = "https://github.com/user-attachments/assets/run-canary-1";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** Fake edges over a repository with one address and one denylist word in its text, recording what is printed. */
function edges({ denylist }: { denylist: LineListLoad }): {
  deps: GithubExposureDeps;
  out: string[];
  diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const { seam } = fakeGithubExposureSeam({
    handlers: {
      issues: () => ok([{ body: `reach me at ${CANARY_ADDRESS}`, number: 2, title: "hi" }]),
      pulls: () =>
        ok([{ body: `${CANARY_WORD} ![shot](${CANARY_UPLOAD})`, head: { ref: "f" }, number: 1, title: "t" }]),
      repository: () => ok({ has_discussions: false, has_pages: false, has_wiki: false }),
    },
  });
  return {
    deps: {
      denylist: () => denylist,
      home: () => "/never-read",
      makeSeam: () => seam,
      makeStreamLog:
        () =>
        ({ jobId }) =>
          Promise.resolve(err(GithubJobLogErrors.logUnavailable({ jobId }))),
      nonce: () => "n0nce000",
      ownHome: () => "/never-a-home",
      nowIso: () => "2026-11-19T00:00:00.000Z",
      out: ({ line }) => {
        out.push(line);
      },
      token: () => "token-fixture",
      writeDiagnostic: ({ line }) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    out,
  };
}

/** A throwaway state home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "exposure-run-"));
  homes.push(home);
  return home;
}

describe("runGithubExposure sweep", () => {
  it("writes both findings to the state home, prints neither, and exits 1", async () => {
    const home = freshHome();
    const run = edges({ denylist: { kind: "loaded", lines: [CANARY_WORD] } });
    const code = await runGithubExposure({
      argv: ["node", "slopweaver", "github", "exposure", "sweep", "--repo", "acme/widgets", "--home", home],
      deps: run.deps,
    });
    expect(code).toBe(1);
    const reports = stateHomePaths({ home }).githubExposureReports;
    const [runDirectory] = readdirSync(reports);
    const findings = readFileSync(join(reports, runDirectory!, "findings.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(findings.map((line) => (JSON.parse(line) as { rule: string }).rule)).toEqual([
      "denylist",
      "mailbox-address",
    ]);
    const printed = [...run.out, ...run.diagnostics].join("\n");
    expect([CANARY_ADDRESS, CANARY_WORD, home].filter((leak) => printed.includes(leak))).toEqual([]);
    expect(run.out[1]).toBe("  by rule: denylist 1, mailbox-address 1");
    expect(run.diagnostics).toEqual(["hygiene: private denylist LOADED, 1 word(s) applied"]);
  });

  it("refuses to sweep over a denylist it cannot read, writing nothing", async () => {
    const home = freshHome();
    const run = edges({ denylist: { kind: "unreadable", path: join(home, "hygiene-denylist.txt"), reason: "EACCES" } });
    const code = await runGithubExposure({
      argv: ["node", "slopweaver", "github", "exposure", "sweep", "--repo", "acme/widgets", "--home", home],
      deps: run.deps,
    });
    expect(code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.diagnostics[0]).toContain("$SLOPWEAVER_HOME/hygiene-denylist.txt exists but could not be read (EACCES)");
    expect(readdirSync(home)).toEqual([]);
  });

  it("prints a JSON report that carries counts and no finding or upload", async () => {
    const home = freshHome();
    const run = edges({ denylist: { kind: "absent" } });
    const code = await runGithubExposure({
      argv: ["node", "slopweaver", "github", "exposure", "sweep", "--repo", "acme/widgets", "--json", "--home", home],
      deps: run.deps,
    });
    expect(code).toBe(1);
    const report = JSON.parse(run.out.join("\n")) as Record<string, unknown>;
    expect(report["findings"]).toBe(1);
    expect(report["findingsByRule"]).toEqual({ "mailbox-address": 1 });
    expect(report["complete"]).toBe(false);
    expect([report["uploads"], report["uploadLinks"], report["uploadBytesRead"]]).toEqual([1, 1, false]);
    expect(report["uploadsFile"]).toBe(`${String(report["report"])}/uploads.jsonl`);
    expect([CANARY_ADDRESS, CANARY_UPLOAD].filter((leak) => run.out.join("\n").includes(leak))).toEqual([]);
    const uploads = readFileSync(join(home, String(report["uploadsFile"])), "utf8");
    expect(JSON.parse(uploads)).toEqual({
      linkedFrom: [{ field: "body", locator: "pull #1", surface: "pull-requests" }],
      url: CANARY_UPLOAD,
    });
  });
});
