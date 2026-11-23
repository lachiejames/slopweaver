import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type OrgHealthAckDeps, runOrgHealthAck } from "../../../../../cli/commands/orgHealth/ackRun.js";
import { ORG_HEALTH_ACK_USAGE } from "../../../../../cli/commands/orgHealth/usage.js";
import { orgHealthManifest } from "../../../../../cli/manifests/orgHealth.js";
import { unwrap } from "../../../../../lib/result.js";
import type { OrgHealthPort } from "../../../../../orgHealth/port.js";
import type { IncidentSnapshot } from "../../../../../orgHealth/types.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import {
  type MemoryOrgHealthStore,
  memoryOrgHealthPort,
  memoryOrgHealthStore,
  seedOrgHealthSnapshot,
  unavailableOrgHealthPort,
} from "../../../../orgHealthStoreFixture.js";
import { measuredSnapshot, NOW_ISO, NOW_MS, orgIncident } from "../../../orgHealth/orgIncidentFixture.js";

/** Seams at NOW over `port`, recording what each sink was given. */
function deps({ port }: { port: OrgHealthPort }): { deps: OrgHealthAckDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      nowMs: () => NOW_MS,
      orgHealthPort: port,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("the org-health ack manifest entry", () => {
  it("registers ack as local state, never door-routed, with the usage its own help prints", () => {
    const meta = orgHealthManifest["ack"]!.meta;
    expect([meta.usage, meta.effect, meta.doorRouted]).toEqual([ORG_HEALTH_ACK_USAGE, "local-state", false]);
    expect(ORG_HEALTH_ACK_USAGE).toBe(
      "usage: slopweaver org-health ack --ref <INC-n> [--by-session <s>] [--json] [--home <dir>] [--now <iso>]",
    );
  });
});

describe("slopweaver org-health ack", () => {
  let home: string;
  let store: MemoryOrgHealthStore;
  let port: OrgHealthPort;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-ack-"));
    store = memoryOrgHealthStore();
    port = memoryOrgHealthPort({ store });
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const ledgerPath = (): string => stateHomePaths({ home }).orgHealthAcknowledgementsJsonl;
  const seed = ({ snapshot }: { snapshot: IncidentSnapshot }): void => {
    seedOrgHealthSnapshot({ home, snapshot, store });
  };
  const presses = (): number =>
    store.homes.get(home)!.acknowledgements.filter((row) => row.kind === "acknowledgement").length;

  it("records a row whose whole fingerprint came from the snapshot, and prints it under --json", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    const run = deps({ port });
    const rest = ["--home", home, "--ref", "INC-98", "--by-session", "work-console", "--json"];
    expect(await runOrgHealthAck({ deps: run.deps, rest })).toBe(0);
    const row = {
      acknowledgedIso: NOW_ISO,
      bySession: "work-console",
      loudIso: "2026-10-04T08:00:00.000Z",
      phase: "investigating",
      phaseChangedIso: "2026-10-04T08:00:00.000Z",
      ref: "INC-98",
      severity: "Critical",
    };
    expect([run.out.map((line) => JSON.parse(line)), unwrap(await port.readAcknowledgements({ home }))]).toEqual([
      [{ ok: true, row }],
      [row],
    ]);
    expect(existsSync(ledgerPath())).toBe(false);
  });

  it("says in words that nothing was sent, recording a terminal press by default", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    const run = deps({ port });
    expect(await runOrgHealthAck({ deps: run.deps, rest: ["--home", home, "--ref", "INC-98"] })).toBe(0);
    expect([run.out, unwrap(await port.readAcknowledgements({ home })).map((row) => row.bySession)]).toEqual([
      [
        "acknowledged INC-98 (Critical, investigating): org-health status reads it quiet until its severity or phase " +
          "changes or it reopens. Nothing was sent to incident.io or anyone.",
      ],
      ["terminal"],
    ]);
  });

  it("refuses with no snapshot, or one past its freshness, writing nothing", async () => {
    const none = deps({ port });
    expect(await runOrgHealthAck({ deps: none.deps, rest: ["--home", home, "--ref", "INC-98", "--json"] })).toBe(3);
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    const stale = deps({ port });
    expect(
      await runOrgHealthAck({
        deps: stale.deps,
        rest: ["--home", home, "--ref", "INC-98", "--now", "2026-10-04T10:00:00Z"],
      }),
    ).toBe(3);
    expect([
      JSON.parse(none.out[0]!).code,
      stale.diagnostics[0]!.startsWith("org-health ack: nothing to acknowledge"),
      presses(),
    ]).toEqual(["NOT_MEASURED", true, 0]);
  });

  it("refuses a reference that is resolved or not in the snapshot, writing nothing", async () => {
    const resolved = orgIncident({ over: { phase: "resolved", ref: "INC-70", status: "Closed" } });
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident(), resolved] }) });
    const codes: unknown[] = [];
    for (const ref of ["INC-70", "INC-99"]) {
      const run = deps({ port });
      codes.push([
        await runOrgHealthAck({ deps: run.deps, rest: ["--home", home, "--ref", ref, "--json"] }),
        JSON.parse(run.out[0]!).why,
      ]);
    }
    expect(codes).toEqual([
      [3, "INC-70 is not an open incident in the current snapshot, so there is nothing to acknowledge"],
      [3, "INC-99 is not an open incident in the current snapshot, so there is nothing to acknowledge"],
    ]);
    expect(store.homes.get(home)!.acknowledgements).toEqual([]);
  });

  it("refuses a reference the snapshot holds open twice, writing nothing", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident({ over: { severity: "Major" } }), orgIncident()] }) });
    const run = deps({ port });
    expect(await runOrgHealthAck({ deps: run.deps, rest: ["--home", home, "--ref", "INC-98", "--json"] })).toBe(3);
    expect([JSON.parse(run.out[0]!), store.homes.get(home)!.acknowledgements]).toEqual([
      {
        code: "AMBIGUOUS_REF",
        ok: false,
        why: "nothing was acknowledged: INC-98 appears 2 times among the open incidents, so which one an acknowledgement describes cannot be told",
      },
      [],
    ]);
  });

  it("refuses to record behind a legacy ledger line that will not read, importing nothing", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    mkdirSync(dirname(ledgerPath()), { recursive: true });
    writeFileSync(ledgerPath(), "not json\n");
    const run = deps({ port });
    expect(await runOrgHealthAck({ deps: run.deps, rest: ["--home", home, "--ref", "INC-98", "--json"] })).toBe(1);
    expect([JSON.parse(run.out[0]!).code, store.homes.get(home)!.acknowledgements]).toEqual(["LEDGER_IO", []]);
  });

  it("refuses a legacy ledger path that is a dangling symlink, creating nothing where it points", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    mkdirSync(dirname(ledgerPath()), { recursive: true });
    const target = join(home, "missing-acks.jsonl");
    symlinkSync(target, ledgerPath());
    const run = deps({ port });
    expect(await runOrgHealthAck({ deps: run.deps, rest: ["--home", home, "--ref", "INC-98", "--json"] })).toBe(1);
    expect([JSON.parse(run.out[0]!).code, existsSync(target)]).toEqual(["LEDGER_IO", false]);
  });

  it("refuses as unmeasured, writing nothing, when the store cannot be reached", async () => {
    const run = deps({ port: unavailableOrgHealthPort() });
    expect(await runOrgHealthAck({ deps: run.deps, rest: ["--home", home, "--ref", "INC-98", "--json"] })).toBe(3);
    expect([JSON.parse(run.out[0]!).code, run.diagnostics[0]]).toEqual([
      "NOT_MEASURED",
      expect.stringContaining("the store could not be opened"),
    ]);
  });

  it("refuses a missing or malformed reference and an unknown flag as usage errors, printing the usage", async () => {
    const outcomes: unknown[] = [];
    for (const rest of [
      ["--home", home],
      ["--ref", "34"],
      ["--ref", "INC-98", "--since", "1d"],
    ]) {
      const run = deps({ port });
      outcomes.push([await runOrgHealthAck({ deps: run.deps, rest }), run.diagnostics.at(-1)]);
    }
    expect(outcomes).toEqual([
      [2, ORG_HEALTH_ACK_USAGE],
      [2, ORG_HEALTH_ACK_USAGE],
      [2, ORG_HEALTH_ACK_USAGE],
    ]);
  });
});
