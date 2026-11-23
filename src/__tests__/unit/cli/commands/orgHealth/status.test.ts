import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type OrgHealthStatusDeps, runOrgHealthStatus } from "../../../../../cli/commands/orgHealth/statusRun.js";
import { ORG_HEALTH_STATUS_USAGE } from "../../../../../cli/commands/orgHealth/usage.js";
import { orgHealthManifest } from "../../../../../cli/manifests/orgHealth.js";
import { unwrap } from "../../../../../lib/result.js";
import { acknowledgementRowFor } from "../../../../../orgHealth/acknowledgement.js";
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
import { measuredSnapshot, NOW_MS, orgIncident } from "../../../orgHealth/orgIncidentFixture.js";

/** A registered ask's whole shape — problem, lean, two options — which the board stands up as the owner's question. */
const WHOLE_SHAPE = [
  'problem: "the write-up is ready"',
  'lean: "A"',
  "options:",
  "  - option: share it",
  "    tradeoff: the channel sees it",
  "  - option: hold it",
  "    tradeoff: nobody sees it",
];

/** A dispatch row naming an incident by its homepage, as a session registers one by hand. */
function investigationDoc({
  slug,
  url = "https://app.incident.io/example-org/incidents/98",
  shape = [],
  blockedBy = "[]",
  doneWhen = ["doneWhen: []"],
}: {
  slug: string;
  url?: string;
  shape?: readonly string[];
  blockedBy?: string;
  doneWhen?: readonly string[];
}): string {
  const summary = `Why checkout fails: ${url} is investigated. Ends in one note.`;
  return [
    "---",
    `slug: ${slug}`,
    "kind: ask",
    `summary: "${summary}"`,
    "status: ready",
    "askedIso: 2026-10-04T08:10:00.000Z",
    ...shape,
    `blockedBy: ${blockedBy}`,
    "artifact: null",
    ...doneWhen,
    "---",
    "",
    `# ${summary}`,
    "",
  ].join("\n");
}

/** Seams at NOW over `port`, recording what each sink was given. */
function deps({ port }: { port: OrgHealthPort }): { deps: OrgHealthStatusDeps; out: string[]; diagnostics: string[] } {
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

describe("the org-health status manifest entry", () => {
  it("registers status as a read with no effect and the usage its own help prints", () => {
    const meta = orgHealthManifest["status"]!.meta;
    expect([meta.usage, meta.effect, meta.doorRouted]).toEqual([ORG_HEALTH_STATUS_USAGE, "none", false]);
    expect(ORG_HEALTH_STATUS_USAGE).toBe("usage: slopweaver org-health status [--json] [--now <iso>] [--home <dir>]");
  });
});

describe("slopweaver org-health status", () => {
  let home: string;
  let store: MemoryOrgHealthStore;
  let port: OrgHealthPort;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-status-"));
    store = memoryOrgHealthStore();
    port = memoryOrgHealthPort({ store });
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const seed = ({ snapshot }: { snapshot: IncidentSnapshot }): void => {
    seedOrgHealthSnapshot({ home, snapshot, store });
  };
  /** One status run over this test's store. */
  const status = async ({ rest }: { rest: readonly string[] }) => {
    const run = deps({ port });
    const exit = await runOrgHealthStatus({ deps: run.deps, rest });
    return { ...run, exit };
  };

  it("prints the ongoing count and each open incident in a status page's words", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    const run = await status({ rest: ["--home", home] });
    expect(run.exit).toBe(0);
    expect(run.out).toEqual([
      "yellow — 1 ongoing, 1 under investigation (read 2026-10-04T09:00:00.000Z)",
      "  INC-98 Critical · Payment checkout regression — investigating, root cause unknown so far",
    ]);
  });

  it("prints the status document with --json, and exits 0 on a snapshot no read has written yet", async () => {
    const run = await status({ rest: ["--home", home, "--json"] });
    expect(run.exit).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      because: "no incident read has run — `slopweaver org-health read` writes the snapshot this judges",
      schemaVersion: 1,
      state: "unmeasurable",
    });
  });

  it("exits 0 drawing unmeasurable, naming the store, when the store cannot be reached", async () => {
    const run = deps({ port: unavailableOrgHealthPort() });
    expect(await runOrgHealthStatus({ deps: run.deps, rest: ["--home", home, "--json"] })).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      because: expect.stringContaining("the store could not be opened"),
      schemaVersion: 1,
      state: "unmeasurable",
    });
  });

  it("judges at --now, reading a snapshot past its freshness as not measured", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [] }) });
    const run = await status({ rest: ["--home", home, "--now", "2026-10-04T10:00:00Z"] });
    expect(run.exit).toBe(0);
    expect(run.out).toEqual([
      "not measured — the last complete incident read was 1.0h ago (2026-10-04T09:00:00.000Z), past the 45m it is believed for",
    ]);
  });

  it("names the fleet's investigation under its incident, off the incident-* row and its journal", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    mkdirSync(join(home, "handovers"));
    mkdirSync(join(home, "runs"));
    writeFileSync(
      join(home, "handovers", "incident-inc-98-checkout.md"),
      investigationDoc({ slug: "incident-inc-98-checkout" }),
    );
    writeFileSync(
      join(home, "handovers", "incident-unrelated.md"),
      investigationDoc({ slug: "incident-unrelated", url: "x" }),
    );
    writeFileSync(
      join(home, "runs", "incident-inc-98-checkout.jsonl"),
      `${JSON.stringify({ atIso: "2026-10-04T08:30:00.000Z", branch: "b", docHash: "abc", kind: "started" })}\n`,
    );
    const run = await status({ rest: ["--home", home] });
    expect(run.exit).toBe(0);
    expect(run.out.slice(1)).toEqual([
      "  INC-98 Critical · Payment checkout regression — investigating, root cause unknown so far",
      "    the fleet is looking into this (last moved 2026-10-04T08:30:00.000Z) — Why checkout fails: https://app.incident.io/example-org/incidents/98 is investigated.",
    ]);
  });

  it("reads a row parked on the owner's question as findings on its ask card, and skips an archived row", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    mkdirSync(join(home, "handovers", "archive"), { recursive: true });
    mkdirSync(join(home, "runs"));
    writeFileSync(
      join(home, "handovers", "incident-inc-98-parked.md"),
      investigationDoc({ slug: "incident-inc-98-parked" }),
    );
    writeFileSync(
      join(home, "handovers", "archive", "incident-inc-98-archived.md"),
      investigationDoc({ slug: "incident-inc-98-archived" }),
    );
    writeFileSync(
      join(home, "runs", "incident-inc-98-parked.jsonl"),
      [
        JSON.stringify({ atIso: "2026-10-04T08:30:00.000Z", branch: "b", docHash: "abc", kind: "started" }),
        JSON.stringify({ atIso: "2026-10-04T08:40:00.000Z", kind: "question", question: "Share the write-up?" }),
        "",
      ].join("\n"),
    );
    const run = await status({ rest: ["--home", home] });
    expect(run.exit).toBe(0);
    expect(run.out.slice(2)).toEqual([
      "    findings ready on the Queue, ask:incident-inc-98-parked — Why checkout fails: https://app.incident.io/example-org/incidents/98 is investigated.",
    ]);
  });

  it("reads a whole-shaped registered ask as findings, and as lined up once a dependency or a probe could place it elsewhere", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    mkdirSync(join(home, "handovers"));
    const path = join(home, "handovers", "incident-inc-98-ask.md");
    const stateWith = async ({ doc }: { doc: string }): Promise<unknown> => {
      writeFileSync(path, doc);
      const run = await status({ rest: ["--home", home, "--json"] });
      expect(run.exit).toBe(0);
      return JSON.parse(run.out.join("\n")).incidents[0].investigation.state;
    };
    const ask = { shape: WHOLE_SHAPE, slug: "incident-inc-98-ask" };
    expect([
      await stateWith({ doc: investigationDoc(ask) }),
      await stateWith({ doc: investigationDoc({ ...ask, blockedBy: "[prereq-row]" }) }),
      await stateWith({ doc: investigationDoc({ ...ask, doneWhen: ["doneWhen:", "  - path: shipped.md"] }) }),
    ]).toEqual(["findings", "lined-up", "lined-up"]);
  });

  it("reads an investigation row that will not parse as unmeasured, keeping the incident's own reading", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    mkdirSync(join(home, "handovers"));
    writeFileSync(join(home, "handovers", "incident-broken.md"), "---\nslug: something-else\n---\n");
    const run = await status({ rest: ["--home", home, "--json"] });
    expect(run.exit).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toMatchObject({
      incidents: [{ investigation: { state: "unmeasured" }, ref: "INC-98" }],
      ongoing: 1,
      tone: "yellow",
    });
  });

  it("reads the owner's acknowledgement off the ledger, says so under the incident, and drops it once the incident moves", async () => {
    const pressed = "2026-10-04T08:50:00.000Z";
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    unwrap(
      await port.appendAcknowledgement({
        home,
        row: acknowledgementRowFor({ acknowledgedIso: pressed, bySession: "work-console", incident: orgIncident() }),
      }),
    );
    const before = await status({ rest: ["--home", home] });
    const json = await status({ rest: ["--home", home, "--json"] });
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident({ over: { severity: "Major" } })] }) });
    const after = await status({ rest: ["--home", home, "--json"] });
    expect(before.exit).toBe(0);
    expect(json.exit).toBe(0);
    expect(after.exit).toBe(0);
    expect([
      before.out.slice(1),
      JSON.parse(json.out.join("\n")).incidents[0].acknowledgement,
      JSON.parse(after.out.join("\n")).incidents[0].acknowledgement,
    ]).toEqual([
      [
        "  INC-98 Critical · Payment checkout regression — investigating, root cause unknown so far",
        `    acknowledged ${pressed}, quiet until it changes`,
      ],
      { atIso: pressed, state: "acknowledged" },
      { state: "none" },
    ]);
  });

  it("reads every incident's acknowledgement as unmeasured over a legacy ledger line that will not read", async () => {
    seed({ snapshot: measuredSnapshot({ incidents: [orgIncident()] }) });
    const path = stateHomePaths({ home }).orgHealthAcknowledgementsJsonl;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json\n");
    const run = await status({ rest: ["--home", home, "--json"] });
    expect(run.exit).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toMatchObject({
      incidents: [
        {
          acknowledgement: {
            because: `the incident-acknowledgement ledger at ${path} could not be used: 1 line(s) did not read (1)`,
            state: "unmeasured",
          },
          ref: "INC-98",
        },
      ],
      tone: "yellow",
    });
  });

  it("refuses an unknown flag as a usage error, printing the usage", async () => {
    const run = await status({ rest: ["--home", home, "--since", "1d"] });
    expect(run.exit).toBe(2);
    expect(run.diagnostics.at(-1)).toBe(ORG_HEALTH_STATUS_USAGE);
  });
});
