import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { lapPlan } from "../../../../../cli/commands/github/lapCore.js";
import { runGithubLap } from "../../../../../cli/commands/github/lapRun.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { ARGS, depsFor, observe, takeLapHomes } from "../../../../lapRunFixture.js";

afterEach(() => {
  for (const home of takeLapHomes()) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("runGithubLap's status read-back", () => {
  it("reads a lagging pending back again after 2s and 4s, then runs every lane once it shows", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, reads: ["lag", "lag"] }), rest: ARGS })).toBe(0);
    expect(observed.waits).toEqual([2_000, 4_000]);
    expect(observed.ran).toEqual(lapPlan().map((step) => step.id));
    expect(observed.posted.map((status) => status.state)).toEqual(["pending", "pending", "success", "success"]);
  });

  it("stops before any lane when pending is still not read back after four reads, posting it once", async () => {
    const observed = observe();
    const deps = depsFor({ observed, reads: ["lag", "lag", "lag", "lag"] });
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(1);
    expect(observed.waits).toEqual([2_000, 4_000, 8_000]);
    expect(observed.ran).toEqual([]);
    expect(observed.posted.slice(0, 2).map((status) => status.state)).toEqual(["pending", "pending"]);
    expect(observed.diagnostic[0]).toBe(
      'github lap: "build" was not read back as pending; "integration" was not read back as pending after 4 read-back attempts',
    );
  });

  it("stops at once on a read-back that failed, since its client already retried a transient one", async () => {
    const observed = observe();
    const dropped: IngestError = { kind: "network", message: "socket hang up", operation: "github.lap.statuses" };
    expect(await runGithubLap({ deps: depsFor({ observed, reads: [dropped] }), rest: ARGS })).toBe(1);
    expect(observed.waits).toEqual([]);
    expect(observed.ran).toEqual([]);
    expect(observed.diagnostic[0]).toBe("github lap: the read-back failed: socket hang up");
  });

  it("reads a pending lag that ends on the fourth read back, never pausing a fourth time", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, reads: ["lag", "lag", "lag"] }), rest: ARGS })).toBe(0);
    expect(observed.waits).toEqual([2_000, 4_000, 8_000]);
    expect(observed.ran).toEqual(lapPlan().map((step) => step.id));
  });
});
