/**
 * The surface `datadog monitor` presents before any monitor is read: its manifest row, its usage, its hatch,
 * the re-run line a preview prints, and each write leg reached directly rather than through the shell.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DATADOG_MONITOR_FLAG_NAMES,
  iacGuard,
  parseDatadogMonitorOptions,
} from "../../../../../cli/commands/datadog/monitorCore.js";
import { runMonitorDelete } from "../../../../../cli/commands/datadog/monitorDeleteRun.js";
import { previewTokens } from "../../../../../cli/commands/datadog/monitorDoor.js";
import { runMonitorUpdate } from "../../../../../cli/commands/datadog/monitorUpdateRun.js";
import { DATADOG_MONITOR_USAGE } from "../../../../../cli/commands/datadog/monitorUsage.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { datadogMonitorManifest } from "../../../../../cli/manifests/datadogMonitor.js";
import { DATADOG_MONITOR_HATCHES } from "../../../../../hatch/datadogMonitorHatches.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { cpuMonitor, fakeMonitorApi } from "../../../../monitorApiFake.js";

describe("the datadog monitor manifest row", () => {
  it("is a door-routed external write whose usage is the verb's own", () => {
    const { meta } = datadogMonitorManifest["monitor"]!;
    expect(meta).toMatchObject({ doorRouted: true, effect: "external-write", usage: DATADOG_MONITOR_USAGE });
  });

  it.each(DATADOG_MONITOR_FLAG_NAMES)("names %s in its usage", (flag) => {
    expect(DATADOG_MONITOR_USAGE).toContain(flag);
  });
});

describe("the IaC hatch", () => {
  it("is the one row, read by the parser that accepts its flag", () => {
    expect(DATADOG_MONITOR_HATCHES.map((hatch) => hatch.id)).toEqual(["datadog-monitor-iac-managed"]);
    expect(DATADOG_MONITOR_HATCHES[0].reader).toBe("src/cli/commands/datadog/monitorCore.ts");
  });

  it("is what the refusal tells the caller to type", () => {
    const monitors = [cpuMonitor({ tags: ["managed-by:acme-iac"] })];
    const error = unwrapErr(iacGuard({ iacManagedTags: ["managed-by:acme-iac"], iacOverride: undefined, monitors }));
    expect(error.message).toContain(DATADOG_MONITOR_HATCHES[0].key.incantation);
  });

  it("keeps its id, incantation and reader, and names no concrete tag, repository or stack", () => {
    const [hatch] = DATADOG_MONITOR_HATCHES;
    expect(hatch.key.incantation).toBe('slopweaver datadog monitor <update|delete> ... --iac-override "<why>"');
    expect(hatch.caught).toContain("configured infrastructure-as-code ownership tag");
    expect(hatch.exceptions[0]).toContain("the infrastructure-as-code deployment");
    expect(JSON.stringify(hatch)).not.toContain("Pulumi");
  });
});

describe("the datadog monitor usage", () => {
  it("names the profile field that arms the IaC guard, its empty default, and no concrete tag", () => {
    expect(DATADOG_MONITOR_USAGE).toContain("profile.json datadog.iacManagedTags");
    expect(DATADOG_MONITOR_USAGE).toContain("infrastructure-as-code");
    expect(DATADOG_MONITOR_USAGE).toContain("empty by default");
    expect(DATADOG_MONITOR_USAGE).not.toContain("Pulumi");
  });
});

describe("previewTokens", () => {
  it("drops --approve and its value in either spelling, and keeps everything else in order", () => {
    expect(previewTokens({ rest: ["update", "1", "--approve", "d", "--query", "q", "--approve=e", "--json"] })).toEqual(
      ["update", "1", "--query", "q", "--json"],
    );
  });
});

describe("each write leg, reached directly", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-dd-monitor-leg-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("update previews without --approve and sends nothing", async () => {
    const rest = ["update", "50100", "--name", "Host CPU high (no laptop)", "--home", home];
    const options = {
      approve: undefined,
      change: { kind: "flags", value: { name: "Host CPU high (no laptop)" } },
      home,
      iacOverride: undefined,
      id: 50100,
      json: false,
      mode: "update",
    } as const;
    expect(unwrap(parseDatadogMonitorOptions({ rest }))).toEqual(options);
    const { api, writes } = fakeMonitorApi({ monitors: [cpuMonitor()] });
    expect(
      await runMonitorUpdate({ api, home, iacManagedTags: [], ledger: memoryDoorLedger().port, options, rest }),
    ).toBe(EXIT_OK);
    expect(writes).toEqual([]);
  });

  it("delete previews without --approve and deletes nothing", async () => {
    const rest = ["delete", "50100", "--home", home];
    const { api, writes } = fakeMonitorApi({ monitors: [cpuMonitor()] });
    const options = {
      approve: undefined,
      home,
      iacOverride: undefined,
      ids: [50100],
      json: false,
      mode: "delete",
    } as const;
    expect(
      await runMonitorDelete({ api, home, iacManagedTags: [], ledger: memoryDoorLedger().port, options, rest }),
    ).toBe(EXIT_OK);
    expect(writes).toEqual([]);
  });
});
