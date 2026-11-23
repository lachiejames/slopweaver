import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { orgHealthReadOptions } from "../../../../../cli/commands/orgHealth/core.js";
import { type OrgHealthReadDeps, runOrgHealthRead } from "../../../../../cli/commands/orgHealth/readRun.js";
import { ORG_HEALTH_READ_USAGE } from "../../../../../cli/commands/orgHealth/usage.js";
import { orgHealthManifest } from "../../../../../cli/manifests/orgHealth.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { OrgHealthPort } from "../../../../../orgHealth/port.js";
import type { IncidentReadApi } from "../../../../../orgHealth/read.js";
import { takeReadLock } from "../../../../../orgHealth/readLock.js";
import { memoryOrgHealthPort, unavailableOrgHealthPort } from "../../../../orgHealthStoreFixture.js";
import { announcement, update } from "../../../orgHealth/incidentIoFixtures.js";
import { NOW_MS } from "../../../orgHealth/orgIncidentFixture.js";

/** INC-98, fixing, and the thread that moved it there. */
const FIXING = announcement({ status: "Fixing" });
const THREAD = [FIXING, update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" })];

/** A plain fake channel holding INC-98 alone. */
const API: IncidentReadApi = {
  history: () => Promise.resolve({ hasMore: false, messages: [FIXING] }),
  replies: () => Promise.resolve({ hasMore: false, messages: THREAD }),
};

/** Seams over the fake channel, recording what each sink was given. */
function deps({ token, port }: { token: string | undefined; port: OrgHealthPort }): {
  deps: OrgHealthReadDeps;
  out: string[];
  diagnostics: string[];
  tokensUsed: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const tokensUsed: string[] = [];
  return {
    deps: {
      botToken: () => undefined,
      elapsedMs: () => 0,
      makeApi: ({ token: used }) => {
        tokensUsed.push(used);
        return API;
      },
      nowMs: () => NOW_MS,
      orgHealthPort: port,
      takeLock: takeReadLock,
      userToken: () => token,
      wait: () => new Promise(() => undefined),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
    tokensUsed,
  };
}

describe("the org-health manifest", () => {
  it("registers read as a local-state read with the usage its own help prints", () => {
    const meta = orgHealthManifest["read"]!.meta;
    expect([meta.usage, meta.effect, meta.doorRouted]).toEqual([ORG_HEALTH_READ_USAGE, "local-state", false]);
    expect(ORG_HEALTH_READ_USAGE).toBe("usage: slopweaver org-health read [--json] [--now <iso>] [--home <dir>]");
  });
});

describe("orgHealthReadOptions", () => {
  it("reads --json, --home and --now", () => {
    expect(unwrap(orgHealthReadOptions({ rest: ["--json", "--home", "/h", "--now", "2026-10-04T09:00:00Z"] }))).toEqual(
      {
        home: "/h",
        json: true,
        nowMs: NOW_MS,
      },
    );
  });

  it("refuses a --now that is not an instant", () => {
    expect(unwrapErr(orgHealthReadOptions({ rest: ["--now", "tomorrow"] }))).toEqual([
      "--now tomorrow is not an ISO-8601 instant",
    ]);
  });
});

describe("slopweaver org-health read", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-verb-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Write a profile naming `channelId` as the incident channel, or naming none. */
  const seedProfile = ({ channelId }: { channelId: string | undefined }): void => {
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        sources: ["slack"],
        ...(channelId === undefined ? {} : { orgHealth: { incidentChannelId: channelId } }),
      }),
    );
  };

  it("reads the profile's channel, publishes the snapshot and prints one line per incident", async () => {
    seedProfile({ channelId: "C0SYNINCIDENTS" });
    const port = memoryOrgHealthPort();
    const run = deps({ port, token: "xoxp-test" });
    expect(await runOrgHealthRead({ deps: run.deps, rest: ["--home", home] })).toBe(0);
    expect(run.tokensUsed).toEqual(["xoxp-test"]);
    expect(run.out).toEqual([
      "read C0SYNINCIDENTS at 2026-10-04T09:00:00.000Z: 1 announcement(s), 1 history page(s), 1 thread(s) opened",
      "  INC-98 Critical · Payment checkout regression — Fixing (identified since 2026-09-23T04:33:57.000Z, update)",
    ]);
    expect(unwrap(await port.readSnapshot({ home }))).toMatchObject({ state: "measured" });
  });

  it("publishes unmeasurable and exits 1 when the profile names no channel, saying where to set one", async () => {
    seedProfile({ channelId: undefined });
    const port = memoryOrgHealthPort();
    const run = deps({ port, token: "xoxp-test" });
    expect(await runOrgHealthRead({ deps: run.deps, rest: ["--home", home] })).toBe(1);
    expect(run.diagnostics).toEqual([
      `org-health read: the snapshot now reads unmeasurable — no incident channel is configured — set \`orgHealth.incidentChannelId\` in ${join(home, "profile.json")}`,
    ]);
    expect(unwrap(await port.readSnapshot({ home }))).toMatchObject({ state: "unmeasurable" });
  });

  it("publishes unmeasurable when no Slack token is configured, and never builds a client", async () => {
    seedProfile({ channelId: "C0SYNINCIDENTS" });
    const run = deps({ port: memoryOrgHealthPort(), token: undefined });
    expect(await runOrgHealthRead({ deps: run.deps, rest: ["--home", home] })).toBe(1);
    expect(run.tokensUsed).toEqual([]);
    expect(run.diagnostics[0]).toContain("no Slack token configured");
  });

  it("exits 1 naming the store when it cannot be reached, never claiming the snapshot now reads unmeasurable", async () => {
    seedProfile({ channelId: "C0SYNINCIDENTS" });
    const run = deps({ port: unavailableOrgHealthPort(), token: "xoxp-test" });
    expect(await runOrgHealthRead({ deps: run.deps, rest: ["--home", home] })).toBe(1);
    expect([run.tokensUsed, run.diagnostics.length, run.diagnostics[0]!.includes("now reads unmeasurable")]).toEqual([
      ["xoxp-test"],
      1,
      false,
    ]);
    expect(run.diagnostics[0]).toContain("the store could not be opened");
  });

  it("refuses an unknown flag as a usage error, writing nothing", async () => {
    const port = memoryOrgHealthPort();
    const run = deps({ port, token: "xoxp-test" });
    expect(await runOrgHealthRead({ deps: run.deps, rest: ["--home", home, "--since", "1d"] })).toBe(2);
    expect(unwrap(await port.readSnapshot({ home }))).toBe(null);
  });
});
