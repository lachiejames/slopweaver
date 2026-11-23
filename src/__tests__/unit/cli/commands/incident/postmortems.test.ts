/**
 * `incident postmortems` over a throwaway home and a memory org-health store holding a REAL snapshot, read through the
 * shipped port, so the freshness judgement under test is the shipped one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runIncidentPostmortems } from "../../../../../cli/commands/incident/postmortems.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { OrgHealthPort } from "../../../../../orgHealth/port.js";
import type { OrgIncident } from "../../../../../orgHealth/types.js";
import {
  type MemoryOrgHealthStore,
  memoryOrgHealthPort,
  memoryOrgHealthStore,
  seedOrgHealthSnapshot,
  unavailableOrgHealthPort,
} from "../../../../orgHealthStoreFixture.js";

const READ_ISO = "2026-09-24T01:00:00.000Z";

const RESOLVED: OrgIncident = {
  channelId: "C0SYN000004",
  declaredIso: "2026-09-23T01:00:00.000Z",
  homepageUrl: "https://app.incident.io/acme/incidents/98",
  phase: "resolved",
  phaseChangedIso: "2026-09-23T06:00:00.000Z",
  phaseProvenance: "update",
  ref: "INC-98",
  severity: "Major",
  status: "Closed",
  title: "Payment checkout's regression",
};

describe("incident postmortems", async () => {
  let home: string;
  let store: MemoryOrgHealthStore;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "incident-postmortems-home-"));
    store = memoryOrgHealthStore();
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const snapshot = ({ incidents }: { incidents: readonly OrgIncident[] }): void => {
    seedOrgHealthSnapshot({
      home,
      snapshot: {
        announcementCount: incidents.length,
        channelId: "C0SYNINCIDENTS",
        incidents,
        readIso: READ_ISO,
        schemaVersion: 1,
        state: "measured",
      },
      store,
    });
  };

  const run = async ({
    extra = [],
    nowIso = "2026-09-24T01:10:00.000Z",
    port = memoryOrgHealthPort({ store }),
  }: { extra?: readonly string[]; nowIso?: string; port?: OrgHealthPort } = {}): Promise<{
    code: number;
    out: string[];
    diag: string[];
  }> => {
    const out: string[] = [];
    const diag: string[] = [];
    const code = await runIncidentPostmortems({
      deps: {
        nowMs: () => Date.parse(nowIso),
        orgHealthPort: port,
        writeDiagnostic: (line) => diag.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: ["--home", home, ...extra],
    });
    return { code, diag, out };
  };

  it("prints each candidate with a register command a shell can run, the apostrophe quoted", async () => {
    snapshot({ incidents: [RESOLVED] });

    const { code, out, diag } = await run();

    expect(diag).toEqual([]);
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("INC-98 (Major), resolved 2026-09-23T06:00:00.000Z: Payment checkout's regression");
    expect(out[1]).toContain(
      "  slopweaver handover register --ask 'Put a postmortem card in front of the owner for INC-98 (Payment checkout'\\''s regression)",
    );
    expect(out[1]).toContain(
      "--dispatch --slug postmortem-c0syn000004 --priority p2 --tag context=work --workspace team",
    );
    expect(out[1]!.endsWith(` --home ${home}`)).toBe(true);
  });

  it("offers the card, never a second register, for a row already on the board under any filename", async () => {
    snapshot({ incidents: [RESOLVED] });
    mkdirSync(join(home, "handovers"), { recursive: true });
    writeFileSync(
      join(home, "handovers", "legacy-name.md"),
      "---\nslug: postmortem-c0syn000004\nstatus: ready\n---\n# doc\n",
    );

    const { code, out } = await run();

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      "INC-98 (Major), resolved 2026-09-23T06:00:00.000Z: Payment checkout's regression",
      `  row postmortem-c0syn000004 is registered — compose its card with \`slopweaver incident postmortem --form <file> --home ${home}\``,
    ]);
  });

  it("offers the card, never a register the create would refuse, when the canonical path holds another row's doc", async () => {
    snapshot({ incidents: [RESOLVED] });
    mkdirSync(join(home, "handovers"), { recursive: true });
    writeFileSync(
      join(home, "handovers", "postmortem-c0syn000004.md"),
      "---\nslug: some-other-row\nstatus: ready\n---\n# doc\n",
    );

    const { code, out } = await run();

    expect(code).toBe(EXIT_OK);
    expect(out[1]).toBe(
      `  row postmortem-c0syn000004 is registered — compose its card with \`slopweaver incident postmortem --form <file> --home ${home}\``,
    );
  });

  it("names a title register would refuse as an unrooted path, and prints the command past that gate", async () => {
    snapshot({ incidents: [{ ...RESOLVED, title: "Failure in runs/foo.txt" }] });
    mkdirSync(join(home, "runs"), { recursive: true });

    const { code, out } = await run();

    expect(code).toBe(EXIT_OK);
    expect(out[1]).toBe(
      "  its ask names runs/foo.txt, which handover register refuses as unrooted path(s) — if that is the incident's own title, register past the gate:",
    );
    expect(out[2]!.startsWith("  SLOPWEAVER_ALLOW_UNROOTED_BRIEF_PATH=1 slopweaver handover register --ask ")).toBe(
      true,
    );
  });

  it("prints one JSON document with --json", async () => {
    snapshot({ incidents: [RESOLVED] });

    const { code, out } = await run({ extra: ["--json"] });

    expect(code).toBe(EXIT_OK);
    const document = JSON.parse(out[0]!) as {
      state: string;
      readIso: string;
      candidates: { row: string }[];
      held: unknown[];
    };
    expect([
      document.state,
      document.readIso,
      document.candidates.map((candidate) => candidate.row),
      document.held,
    ]).toEqual(["measured", READ_ISO, ["postmortem-c0syn000004"], []]);
  });

  it("exits 3 when nothing resolved is waiting on a card", async () => {
    snapshot({ incidents: [{ ...RESOLVED, phase: "monitoring" }] });

    const { code, out, diag } = await run();

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual([]);
    expect(diag).toEqual([
      `incident postmortems: no resolved incident is waiting on a postmortem card (snapshot read ${READ_ISO})`,
    ]);
  });

  it("refuses a stale snapshot rather than reading it as nothing resolved", async () => {
    snapshot({ incidents: [RESOLVED] });

    const { code, out, diag } = await run({ nowIso: "2026-09-24T02:00:00.000Z" });

    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diag[0]).toContain(
      "incident postmortems: the incident snapshot cannot be believed — the last complete incident read was",
    );
  });

  it("refuses a home where no read has run", async () => {
    const { code, diag } = await run();

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      "incident postmortems: the incident snapshot cannot be believed — no incident read has run — `slopweaver org-health read` writes the snapshot this judges",
    ]);
  });

  it("refuses rather than listing nothing when the store cannot be reached", async () => {
    const { code, out, diag } = await run({ port: unavailableOrgHealthPort() });

    expect([code, out]).toEqual([EXIT_ERROR, []]);
    expect(diag[0]).toContain("incident postmortems: the incident snapshot cannot be believed — ");
    expect(diag[0]).toContain("the store could not be opened");
  });
});
