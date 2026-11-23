import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CrowdstrikeSyncOutcome } from "../../../atlas/crowdstrike/sync.js";
import {
  CROWDSTRIKE_RECONCILE_USAGE,
  CROWDSTRIKE_RESET_USAGE,
  CROWDSTRIKE_SYNC_USAGE,
  CROWDSTRIKE_WALK_USAGE,
  exitCodeForCrowdstrikeSync,
  parseCrowdstrikeReconcileOptions,
  parseCrowdstrikeResetOptions,
  parseCrowdstrikeSyncOptions,
  parseCrowdstrikeWalkOptions,
  renderCrowdstrikeReconciliation,
  renderCrowdstrikeSyncLines,
} from "../../../cli/commands/crowdstrike/core.js";
import { CrowdstrikeVerbErrors, crowdstrikeVerbErrorLines } from "../../../cli/commands/crowdstrike/errors.js";
import { crowdstrikeReconcileCommand, readForeignFleet } from "../../../cli/commands/crowdstrike/reconcileRun.js";
import { crowdstrikeResetCommand } from "../../../cli/commands/crowdstrike/resetRun.js";
import { crowdstrikeSyncCommand } from "../../../cli/commands/crowdstrike/syncRun.js";
import { crowdstrikeWalkCommand } from "../../../cli/commands/crowdstrike/walkRun.js";
import {
  crowdstrikeManifest,
  RECONCILE_USAGE,
  RESET_USAGE,
  SYNC_USAGE,
  WALK_USAGE,
} from "../../../cli/manifests/crowdstrike.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("the crowdstrike verbs are wired", () => {
  it("dispatches all three verbs the manifest declares", () => {
    expect(Object.keys(crowdstrikeManifest).toSorted()).toEqual(["reconcile", "reset", "sync", "walk"]);
    // Each command is a runnable the CLI dispatches by ARITY — one argv in, an exit code out. Asserting the
    // arity rather than the type is what proves it is the contract `defineCommand` produces.
    expect([
      crowdstrikeSyncCommand.length,
      crowdstrikeWalkCommand.length,
      crowdstrikeResetCommand.length,
      crowdstrikeReconcileCommand.length,
    ]).toEqual([1, 1, 1, 1]);
  });

  it("keeps each usage line identical to the manifest's own copy", () => {
    expect(CROWDSTRIKE_SYNC_USAGE).toBe(SYNC_USAGE);
    expect(CROWDSTRIKE_WALK_USAGE).toBe(WALK_USAGE);
    expect(CROWDSTRIKE_RESET_USAGE).toBe(RESET_USAGE);
    expect(CROWDSTRIKE_RECONCILE_USAGE).toBe(RECONCILE_USAGE);
  });

  it("declares no verb that writes outside the state home", () => {
    expect(Object.values(crowdstrikeManifest).map((entry) => entry.meta.effect)).toEqual([
      "none",
      "local-state",
      "local-state",
      "local-state",
    ]);
    expect(Object.values(crowdstrikeManifest).every((entry) => !entry.meta.doorRouted)).toBe(true);
  });
});

describe("parseCrowdstrikeSyncOptions", () => {
  it("falls back to the given home", () => {
    expect(unwrap(parseCrowdstrikeSyncOptions({ defaultHome: "/var/example-state", rest: [] }))).toEqual({
      home: "/var/example-state",
      json: false,
    });
  });

  it("takes an explicit home and --json", () => {
    expect(
      unwrap(parseCrowdstrikeSyncOptions({ defaultHome: "/var/example-state", rest: ["--home", "/other", "--json"] })),
    ).toEqual({ home: "/other", json: true });
  });
});

describe("parseCrowdstrikeWalkOptions", () => {
  it("reads a positive limit", () => {
    expect(unwrap(parseCrowdstrikeWalkOptions({ defaultHome: "/h", rest: ["--limit", "5"] })).limit).toBe(5);
  });

  it("means the whole sitemap when no limit is given", () => {
    expect(unwrap(parseCrowdstrikeWalkOptions({ defaultHome: "/h", rest: [] })).limit).toBe(undefined);
  });

  it("REFUSES a limit that is not a positive whole number", () => {
    expect(unwrapErr(parseCrowdstrikeWalkOptions({ defaultHome: "/h", rest: ["--limit", "0"] })).message).toContain(
      "positive whole number",
    );
    expect(unwrapErr(parseCrowdstrikeWalkOptions({ defaultHome: "/h", rest: ["--limit", "all"] })).message).toContain(
      "positive whole number",
    );
    expect(unwrapErr(parseCrowdstrikeWalkOptions({ defaultHome: "/h", rest: ["--limit", "0"] }))).toEqual(
      CrowdstrikeVerbErrors.limitNotPositive({ got: "0" }),
    );
  });
});

describe("parseCrowdstrikeResetOptions", () => {
  it("REFUSES a reset nobody confirmed", () => {
    expect(unwrapErr(parseCrowdstrikeResetOptions({ defaultHome: "/h", rest: [] })).message).toContain(
      "--confirm archive",
    );
    expect(unwrapErr(parseCrowdstrikeResetOptions({ defaultHome: "/h", rest: [] }))).toEqual(
      CrowdstrikeVerbErrors.confirmationMissing(),
    );
  });

  it("accepts the confirmed form", () => {
    expect(unwrap(parseCrowdstrikeResetOptions({ defaultHome: "/h", rest: ["--confirm", "archive"] }))).toEqual({
      home: "/h",
      json: false,
    });
  });
});

describe("renderCrowdstrikeSyncLines", () => {
  const outcome: CrowdstrikeSyncOutcome = {
    kinds: [
      { entityCount: 175, kind: "host", ok: true, reasons: ["read 175 host(s)"] },
      { entityCount: 0, kind: "detection", ok: false, reasons: ["scope not permitted"] },
    ],
    written: ["hosts.json"],
  };

  it("prints the refused kind LAST, so a skimming reader lands on what is wrong", () => {
    const lines = renderCrowdstrikeSyncLines({ outcome });
    expect(lines[0]).toContain("host");
    expect(lines[1]).toContain("FAIL");
    expect(lines[1]).toContain("detection");
  });

  it("names how many kinds did not sync, and where to read why", () => {
    expect(renderCrowdstrikeSyncLines({ outcome }).at(-1)).toContain("1 of 2 kind(s) did not sync");
    expect(renderCrowdstrikeSyncLines({ outcome }).at(-1)).toContain("atlas crowdstrike coverage");
  });

  it("says every kind synced when none failed", () => {
    const clean: CrowdstrikeSyncOutcome = { kinds: [outcome.kinds[0]!], written: ["hosts.json"] };
    expect(renderCrowdstrikeSyncLines({ outcome: clean }).at(-1)).toContain("every kind synced");
  });

  it("shows a kind's first reason, and says so when it recorded none", () => {
    const bare: CrowdstrikeSyncOutcome = {
      kinds: [
        { entityCount: 2, kind: "host", ok: true, reasons: ["read 2 host(s)", "second reason"] },
        { entityCount: 0, kind: "detection", ok: false, reasons: [] },
      ],
      written: [],
    };
    const lines = renderCrowdstrikeSyncLines({ outcome: bare });
    expect(lines[0]).toBe(`  ok   ${"host".padEnd(22)} ${"2".padStart(6)}  read 2 host(s)`);
    expect(lines[1]).toBe(`  FAIL ${"detection".padEnd(22)} ${"0".padStart(6)}  no detail recorded`);
  });
});

describe("exitCodeForCrowdstrikeSync", () => {
  const codes = { exitError: 1, exitExpectedEmpty: 3, exitOk: 0 };

  it("is clean only when every kind synced", () => {
    const outcome: CrowdstrikeSyncOutcome = {
      kinds: [{ entityCount: 1, kind: "host", ok: true, reasons: [] }],
      written: [],
    };
    expect(exitCodeForCrowdstrikeSync({ outcome, ...codes })).toBe(0);
  });

  it("fails when SOME kind did not, so a scope hole never exits clean", () => {
    const outcome: CrowdstrikeSyncOutcome = {
      kinds: [
        { entityCount: 1, kind: "host", ok: true, reasons: [] },
        { entityCount: 0, kind: "detection", ok: false, reasons: [] },
      ],
      written: [],
    };
    expect(exitCodeForCrowdstrikeSync({ outcome, ...codes })).toBe(1);
  });

  it("reports nothing-read distinctly from something-missing", () => {
    const outcome: CrowdstrikeSyncOutcome = {
      kinds: [{ entityCount: 0, kind: "host", ok: false, reasons: [] }],
      written: [],
    };
    expect(exitCodeForCrowdstrikeSync({ outcome, ...codes })).toBe(3);
  });
});

describe("parseCrowdstrikeReconcileOptions", () => {
  it("means the fleet half is not run when no export is given", () => {
    expect(unwrap(parseCrowdstrikeReconcileOptions({ defaultHome: "/h", rest: [] })).fleet).toBe(undefined);
  });

  it("takes a fleet export path", () => {
    expect(
      unwrap(parseCrowdstrikeReconcileOptions({ defaultHome: "/h", rest: ["--fleet", "/tmp/f.json"] })).fleet,
    ).toBe("/tmp/f.json");
  });
});

describe("readForeignFleet", () => {
  const withFile = ({ body, run }: { body: string; run: (input: { path: string }) => void }): void => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-fleet-"));
    try {
      const path = join(dir, "fleet.json");
      writeFileSync(path, body);
      run({ path });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  };

  it("reads a bare list and a { devices } envelope alike", () => {
    const row = '{"providerId":"jc-1","serialNumber":"SERIAL-1","assignedTo":"a.person"}';
    withFile({
      body: `[${row}]`,
      run: ({ path }) => {
        expect(unwrap(readForeignFleet({ path }))).toEqual([
          { assignedTo: "a.person", hostname: null, macAddress: null, providerId: "jc-1", serialNumber: "SERIAL-1" },
        ]);
      },
    });
    withFile({
      body: `{"devices":[${row}]}`,
      run: ({ path }) => {
        expect(unwrap(readForeignFleet({ path })).length).toBe(1);
      },
    });
  });

  it("DROPS a record with no join key, which could never have matched anything", () => {
    withFile({
      body: '[{"providerId":"jc-1"},{"providerId":"jc-2","hostname":"EXAMPLE-1"}]',
      run: ({ path }) => {
        expect(unwrap(readForeignFleet({ path })).map((device) => device.providerId)).toEqual(["jc-2"]);
      },
    });
  });

  it("takes the plain `id` when `providerId` is missing or blank, and trims both", () => {
    withFile({
      body: '[{"id":" jc-3 ","hostname":"EXAMPLE-3"},{"providerId":"  ","id":"jc-4","hostname":"EXAMPLE-4"}]',
      run: ({ path }) => {
        expect(unwrap(readForeignFleet({ path })).map((device) => device.providerId)).toEqual(["jc-3", "jc-4"]);
      },
    });
  });

  it("prefers `providerId` over `id` when a row carries both", () => {
    withFile({
      body: '[{"providerId":"jc-5","id":"other","hostname":"EXAMPLE-5"}]',
      run: ({ path }) => {
        expect(unwrap(readForeignFleet({ path })).map((device) => device.providerId)).toEqual(["jc-5"]);
      },
    });
  });

  it("refuses a document that is not a device list", () => {
    withFile({
      body: '{"total":4}',
      run: ({ path }) => {
        expect(unwrapErr(readForeignFleet({ path })).message).toContain("not a list of devices");
      },
    });
  });

  it("names the file when it cannot be read", () => {
    expect(unwrapErr(readForeignFleet({ path: "/var/example-state/absent.json" })).message).toContain(
      "cannot read the fleet export",
    );
  });
});

describe("renderCrowdstrikeReconciliation", () => {
  const surfaces = [{ method: "GET", observedOnPages: ["/a", "/b"], pathShape: "/api2/devices/queries/fga-hosts/v1" }];

  it("says the fleet half was NOT RUN rather than printing an empty agreement", () => {
    const lines = renderCrowdstrikeReconciliation({ hostCount: 175, report: { fleet: null, surfaces } });
    expect(lines.at(-1)).toContain("not run: no --fleet export was given");
  });

  it("states that a console-observed endpoint is not a capability", () => {
    const lines = renderCrowdstrikeReconciliation({ hostCount: 175, report: { fleet: null, surfaces } });
    expect(lines[1]).toContain("never that this installation may ask for it");
  });

  it("counts each fleet disagreement class separately", () => {
    const lines = renderCrowdstrikeReconciliation({
      hostCount: 175,
      report: {
        fleet: {
          matched: [{ crowdstrikeProviderId: "aid-1", disagreements: ["hostname"], joinedOn: "serial-number" }],
          onlyInCrowdstrike: ["aid-9"],
          onlyInForeign: ["jc-7", "jc-8"],
          unjoinable: [],
        },
        surfaces,
      },
    });
    expect(lines.join("\n")).toContain("2 device(s) the other source lists carry NO Falcon sensor");
    expect(lines.join("\n")).toContain("1 sensored machine(s) the other source does not list");
    expect(lines.join("\n")).toContain("aid-1 (joined on serial-number): hostname");
  });
});

describe("crowdstrikeVerbErrorLines", () => {
  it("prints a list another module produced as that list, one record per reason", () => {
    const reasons = ["first reason", "second reason"];
    expect(crowdstrikeVerbErrorLines({ error: CrowdstrikeVerbErrors.flagsInvalid({ reasons }) })).toEqual(reasons);
    expect(crowdstrikeVerbErrorLines({ error: CrowdstrikeVerbErrors.credentialsUnresolved({ reasons }) })).toEqual(
      reasons,
    );
    expect(crowdstrikeVerbErrorLines({ error: CrowdstrikeVerbErrors.extensionTokenUnread({ reasons }) })).toEqual(
      reasons,
    );
    expect(crowdstrikeVerbErrorLines({ error: CrowdstrikeVerbErrors.sitemapInvalid({ reasons }) })).toEqual(reasons);
  });

  it("prints a missing sitemap as two records, what is missing then the hint, while message keeps them joined", () => {
    const error = CrowdstrikeVerbErrors.sitemapAbsent({ path: "/sitemap.json" });
    const lead = "the console returned no /sitemap.json body, so the walk has no denominator";
    const hint = "this usually means the browser session is signed out — open the Falcon console in Chrome and sign in";
    expect(crowdstrikeVerbErrorLines({ error })).toEqual([lead, hint]);
    expect(error.hint).toBe(hint);
    expect(error.message).toBe(`${lead}\n${hint}`);
  });

  it("prints every other failure as its one message", () => {
    expect(crowdstrikeVerbErrorLines({ error: CrowdstrikeVerbErrors.limitNotPositive({ got: "0" }) })).toEqual([
      "--limit takes a positive whole number of routes, not 0",
    ]);
  });
});
