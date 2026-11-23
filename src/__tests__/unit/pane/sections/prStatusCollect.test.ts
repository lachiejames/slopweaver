/**
 * `collectPrStatus` — the `gh` edge of `pane pr-status`, driven through a plain fake reader so every branch a
 * real `gh` can take (a missing token, a failed list, an unreadable scan, an unmeasured budget) is exercised
 * without a network.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CommandReader } from "../../../../measurement/measure.js";
import { type Measured, measured, unmeasurable } from "../../../../measurement/status.js";
import { collectPrStatus } from "../../../../pane/sections/prStatusCollect.js";

/** One call the fake was asked to run. */
type Call = Parameters<CommandReader>[0];

const NOW_MS = Date.parse("2026-11-01T12:00:00.000Z");

const AUTH_STATUS = ["github.com", "  ✓ Logged in to github.com account me (keyring)", "  - Active account: true"].join(
  "\n",
);

const RATE_LIMIT = JSON.stringify({
  resources: {
    core: { limit: 5000, remaining: 5000, used: 0 },
    graphql: { limit: 5000, remaining: 4822, used: 178 },
    search: { limit: 30, remaining: 30, used: 0 },
  },
});

const MINE = JSON.stringify([
  {
    author: { login: "me" },
    body: "",
    headRefName: "a-branch",
    isDraft: false,
    mergeable: "MERGEABLE",
    number: 1,
    reviewDecision: "",
    statusCheckRollup: [],
    title: "the one on the page",
    updatedAt: "2026-11-01T00:00:00Z",
    url: "https://github.com/o/r/pull/1",
  },
]);

const SCAN = JSON.stringify([
  { author: { login: "me" }, number: 1 },
  { author: { login: "me" }, number: 2 },
  { author: { login: "colleague" }, number: 3 },
]);

/** Every answer a healthy `gh` gives, keyed by {@link routeOf}. */
const HEALTHY: Readonly<Record<string, Measured<string>>> = {
  "api rate_limit": measured({ value: RATE_LIMIT }),
  "auth status": measured({ value: AUTH_STATUS }),
  "auth token": measured({ value: "a-token" }),
  "pr list": measured({ value: SCAN }),
  "pr list --author": measured({ value: MINE }),
};

// Every home directory this file has minted, so `afterEach` can remove them.
const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh state home holding no Slack corpus at all. */
function emptyHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-status-collect-"));
  homes.push(dir);
  return dir;
}

/** Which of the five `gh` calls this is: the own-author list is the one that names `--author`. */
function routeOf({ args }: { args: readonly string[] }): string {
  return args.includes("--author") ? "pr list --author" : args.slice(0, 2).join(" ");
}

/** A fake `gh` answering from a table, recording every call it was asked to run. */
function fakeGh({ answers }: { answers: Readonly<Record<string, Measured<string>>> }): {
  readonly read: CommandReader;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  const read: CommandReader = (call) => {
    calls.push(call);
    const answer = answers[routeOf({ args: call.args })];
    if (answer === undefined) {
      return unmeasurable({ why: `the fake has no answer for gh ${call.args.join(" ")}` });
    }
    return answer;
  };
  return { calls, read };
}

describe("collectPrStatus", () => {
  it("asks nothing and says so when no repository is watched", () => {
    const gh = fakeGh({ answers: HEALTHY });

    const section = collectPrStatus({ cwd: "/", home: emptyHome(), nowMs: NOW_MS, read: gh.read, repos: [] });

    expect(section.rows).toEqual([]);
    expect(section.unavailable).toBe(
      "no repository is being watched — pass `--pr-repo owner/name[@gh-account]`. Nothing was asked.",
    );
    expect(gh.calls).toEqual([]);
  });

  it("ranks the owner's rows and counts what is open but not shown", () => {
    const gh = fakeGh({ answers: HEALTHY });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.rows.map((row) => row.key)).toEqual(["prs:o/r#1"]);
    expect(section.measuredAtIso).toEqual({ known: true, value: "2026-11-01T12:00:00.000Z" });
    expect(section.blurb).toContain("o/r (as the ambient gh account): 3 open, 1 yours, 2 not on this page");
    expect(section.blurb).toContain("4822 remaining");
  });

  it("names the owner's own pull request a second login opened, as a partial list", () => {
    const gh = fakeGh({ answers: HEALTHY });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.unavailable).toContain("1 of 1 repo(s) did not fully answer");
    expect(section.unavailable).toContain("Missing: #2.");
  });

  it("asks under the named account's own token, never the ambient one", () => {
    const gh = fakeGh({ answers: HEALTHY });

    collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: "work" }],
    });

    const lists = gh.calls.filter((call) => call.args[0] === "pr");
    expect(lists.map((call) => call.extraEnv)).toEqual([{ GH_TOKEN: "a-token" }, { GH_TOKEN: "a-token" }]);
    expect(gh.calls.map((call) => call.args.slice(0, 2).join(" "))).toEqual([
      "auth status",
      "auth token",
      "pr list",
      "pr list",
      "api rate_limit",
    ]);
  });

  it("reports a missing token as unread, not as no pull requests", () => {
    const gh = fakeGh({ answers: { ...HEALTHY, "auth token": unmeasurable({ why: "no such account" }) } });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: "work" }],
    });

    expect(section.rows).toEqual([]);
    expect(section.unavailable).toContain('no token for gh account "work" (o/r)');
    expect(section.blurb).toContain("how many are open in TOTAL was NOT measured");
  });

  it("reports a failed list as unread, not as no pull requests", () => {
    const gh = fakeGh({ answers: { ...HEALTHY, "pr list --author": unmeasurable({ why: "HTTP 504" }) } });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.rows).toEqual([]);
    expect(section.unavailable).toContain('o/r: HTTP 504 — it was NOT read, so it is not "no open pull requests"');
  });

  it("reports a list that is not JSON with the parser's reason", () => {
    const gh = fakeGh({ answers: { ...HEALTHY, "pr list --author": measured({ value: "not json" }) } });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.rows).toEqual([]);
    expect(section.unavailable).toContain("o/r: ");
    expect(section.unavailable).toContain("not JSON");
  });

  it("says the own-login check did not run when the scan is not JSON", () => {
    const gh = fakeGh({ answers: { ...HEALTHY, "pr list": measured({ value: "not json" }) } });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.rows.map((row) => row.key)).toEqual(["prs:o/r#1"]);
    expect(section.unavailable).toContain(
      "the own-login check did NOT run (`gh pr list --json number,author` returned output that is not JSON)",
    );
  });

  it("says the own-login check did not run when the scan is not an array", () => {
    const gh = fakeGh({ answers: { ...HEALTHY, "pr list": measured({ value: "{}" }) } });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.unavailable).toContain("`gh pr list --json number,author` did not return an array");
  });

  it("says the own-login check did not run when the logins cannot be read", () => {
    const gh = fakeGh({ answers: { ...HEALTHY, "auth status": unmeasurable({ why: "gh is not installed" }) } });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.unavailable).toContain("the own-login check did NOT run (`gh auth status` could not be read)");
  });

  it("states an unmeasured budget rather than printing one", () => {
    const gh = fakeGh({ answers: { ...HEALTHY, "api rate_limit": unmeasurable({ why: "rate limit read failed" }) } });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.blurb).toContain("BUDGET NOT MEASURED — rate limit read failed.");
  });

  it("states a budget whose payload does not parse rather than printing one", () => {
    const gh = fakeGh({ answers: { ...HEALTHY, "api rate_limit": measured({ value: "not json" }) } });

    const section = collectPrStatus({
      cwd: "/",
      home: emptyHome(),
      nowMs: NOW_MS,
      read: gh.read,
      repos: [{ nameWithOwner: "o/r", tokenUser: undefined }],
    });

    expect(section.blurb).toContain("BUDGET NOT MEASURED");
  });
});
