import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { lapPlan } from "../../../../../cli/commands/github/lapCore.js";
import { runGithubLap } from "../../../../../cli/commands/github/lapRun.js";
import { isDefinitePostRefusal, sameLapStatus } from "../../../../../cli/commands/github/lapStatusPost.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { ARGS, depsFor, observe, type ScriptedPost, takeLapHomes } from "../../../../lapRunFixture.js";

afterEach(() => {
  for (const home of takeLapHomes()) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The failure that lost a green lap: an `http` failure carrying no status and no message of its own. */
const UNKNOWN: IngestError = { kind: "http", message: "unknown error", operation: "github.repos.createCommitStatus" };
const DROPPED: ScriptedPost = { error: UNKNOWN, landed: false };

describe("isDefinitePostRefusal", () => {
  it("is true only for a 4xx status other than a 429, whatever the kind", () => {
    const http = ({ status }: { status: number }): IngestError => ({ ...UNKNOWN, message: "x", status });
    expect(isDefinitePostRefusal({ error: http({ status: 422 }) })).toBe(true);
    expect(isDefinitePostRefusal({ error: http({ status: 403 }) })).toBe(true);
    expect(isDefinitePostRefusal({ error: { ...http({ status: 403 }), kind: "rate-limit" } })).toBe(true);
    expect(isDefinitePostRefusal({ error: { ...http({ status: 429 }), kind: "rate-limit" } })).toBe(false);
    expect(isDefinitePostRefusal({ error: http({ status: 502 }) })).toBe(false);
    expect(isDefinitePostRefusal({ error: UNKNOWN })).toBe(false);
    expect(isDefinitePostRefusal({ error: { ...UNKNOWN, kind: "network" } })).toBe(false);
  });
});

describe("sameLapStatus", () => {
  it("matches only on context, state and description all three", () => {
    const status = { context: "build", description: "green", state: "success" as const };
    expect(sameLapStatus({ found: { ...status }, status })).toBe(true);
    expect(sameLapStatus({ found: { ...status, state: "pending" }, status })).toBe(false);
    expect(sameLapStatus({ found: { ...status, description: null }, status })).toBe(false);
    expect(sameLapStatus({ found: { ...status, context: "integration" }, status })).toBe(false);
  });
});

describe("runGithubLap's status POST re-send", () => {
  it("re-sends a verdict POST that failed with no status after 2s and 4s, and the green lap stands", async () => {
    const observed = observe();
    const deps = depsFor({ observed, posts: ["ok", "ok", DROPPED, DROPPED] });
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(0);
    expect(observed.waits).toEqual([2_000, 4_000]);
    expect(observed.ran).toEqual(lapPlan().map((step) => step.id));
    expect(observed.posted.map((status) => `${status.context} ${status.state}`)).toEqual([
      "build pending",
      "integration pending",
      "build success",
      "build success",
      "build success",
      "integration success",
    ]);
  });

  it("accepts a failed POST that the read after it shows landed, never re-sending it", async () => {
    const observed = observe();
    const deps = depsFor({ observed, posts: ["ok", "ok", { error: UNKNOWN, landed: true }] });
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(0);
    expect(observed.waits).toEqual([]);
    expect(observed.posted.map((status) => status.state)).toEqual(["pending", "pending", "success", "success"]);
  });

  it("fails after three POSTs, naming them and the last error, with the finished receipt still written", async () => {
    const observed = observe();
    const deps = depsFor({ observed, posts: ["ok", "ok", DROPPED, DROPPED, DROPPED] });
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(1);
    expect(observed.waits).toEqual([2_000, 4_000]);
    expect(observed.ran).toEqual(lapPlan().map((step) => step.id));
    expect(observed.posted.map((status) => status.context)).toEqual([
      "build",
      "integration",
      "build",
      "build",
      "build",
    ]);
    expect(observed.diagnostic).toEqual([
      'github lap: posting "build" failed on all 3 attempts, the last with: unknown error',
    ]);
    expect(observed.receipts.at(-1)!.phase).toBe("finished");
  });

  it("never re-sends a POST GitHub refused with a 422, and runs no lane", async () => {
    const observed = observe();
    const refused: IngestError = { ...UNKNOWN, message: "Validation Failed", status: 422 };
    const deps = depsFor({ observed, posts: [{ error: refused, landed: false }] });
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(1);
    expect(observed.waits).toEqual([]);
    expect(observed.ran).toEqual([]);
    expect(observed.posted.map((status) => status.context)).toEqual(["build"]);
    expect(observed.diagnostic[0]).toBe(
      'github lap: posting "build" was refused, so it is not re-sent: Validation Failed',
    );
  });

  it("re-sends when the read after a failed POST fails too, since that read proves neither way", async () => {
    const observed = observe();
    const unread: IngestError = { kind: "network", message: "socket hang up", operation: "github.lap.statuses" };
    const deps = depsFor({ observed, posts: [DROPPED], reads: [unread] });
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(0);
    expect(observed.waits).toEqual([2_000]);
    expect(observed.posted.map((status) => `${status.context} ${status.state}`)).toEqual([
      "build pending",
      "build pending",
      "integration pending",
      "build success",
      "integration success",
    ]);
  });
});
