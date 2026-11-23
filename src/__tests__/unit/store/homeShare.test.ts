/**
 * The home-versus-store declaration, checked against the schema it claims to be total over.
 *
 * The load-bearing case is the last one. `tableOrigin` is declared TOTAL over `declaredTableNames()`, and a
 * declaration can only stay total if something fails when the drizzle barrel grows — the first run of
 * `slopweaver store share` found `codex_pass` and `run_event` unclassified exactly this way, which is the
 * mechanism working rather than a one-off. The rest pin the fold's two denominators apart: a register that
 * cannot be SIZED is not a register that does not MATTER, and conflating them is the mistake the module's
 * own doc is written against.
 */
import { describe, expect, it } from "vitest";

import { declaredTableNames } from "../../../store/declared.js";
import { HOME_REGISTERS } from "../../../store/homeRegisters.js";
import { type HomeResidue, homeShare, type RegisterShare, tableOrigin } from "../../../store/homeShare.js";

/** A residue fixture; the fold carries it through untouched. */
const RESIDUE: HomeResidue = { sample: ["artifacts"], topLevelEntries: 167, unclassified: 156 };

/**
 * A measured register with every field defaulted, so a case states only what it is about.
 *
 * @param over the fields this case cares about
 * @returns the measured row
 */
const share = (over: Partial<RegisterShare> & { kind: string }): RegisterShare => ({
  homeBytes: 1024,
  homeRecords: 4,
  path: `/home/${over.kind}`,
  present: true,
  relativePath: over.kind,
  storeRows: undefined,
  storeUnreadBecause: undefined,
  table: undefined,
  tier: "durable",
  unmeasuredBecause: undefined,
  unmirroredBecause: "nothing mirrors it",
  ...over,
});

describe("HOME_REGISTERS", () => {
  it("declares registers at all, so every filter below is a claim about a non-empty list", () => {
    expect(HOME_REGISTERS.length).toBeGreaterThan(0);
  });

  it("gives every unmirrored register a reason, because a row with neither is one a reader cannot weigh", () => {
    const silent = HOME_REGISTERS.filter(
      (register) => register.table === undefined && register.unmirroredBecause === undefined,
    );
    expect(silent).toEqual([]);
  });

  it("gives every walked register a path key, and every declared-only register none", () => {
    const mismatched = HOME_REGISTERS.filter(
      (register) => (register.measure === "walk") !== (register.pathKey !== undefined),
    );
    expect(mismatched).toEqual([]);
  });

  it("keeps measurability independent of tier — orchestration is durable, mirrored AND unwalkable", () => {
    const codex = HOME_REGISTERS.find((register) => register.relativePath === "orchestration")!;
    expect(codex.measure).toBe("declared-only");
    expect(codex.tier).toBe("durable");
    expect(codex.table).toBe("codex_pass");
  });

  it("carves the owner-turn files out of the scratch tier as a durable, mirrored register of their own", () => {
    const turns = HOME_REGISTERS.find((register) => register.kind === "owner turns")!;
    expect(turns.tier).toBe("durable");
    expect(turns.table).toBe("owner_turn");
    expect(turns.measure).toBe("declared-only");
    expect(turns.relativePath).toBe("supervisor-scratch/*/owner-turn-*.txt + handovers/archive/owner-turn-*.txt");
    const scratch = HOME_REGISTERS.find((register) => register.kind === "supervisor scratch")!;
    expect(scratch.tier).toBe("scratch");
    expect(scratch.unmirroredBecause).toContain("less its owner-turn-*.txt files");
  });

  it("counts the retired Codex sign-in directory against the table that is now its authority", () => {
    const signIn = HOME_REGISTERS.find((register) => register.relativePath === "codex-signin")!;
    expect([signIn.table, signIn.pathKey, signIn.shape, signIn.tier]).toEqual([
      "codex_sign_in_observation",
      "codexSignInDir",
      "directory",
      "durable",
    ]);
  });
});

describe("the measurement registers", () => {
  it("names one walked register per root, each counting only its own class of measurement_location", () => {
    const measured = HOME_REGISTERS.filter((register) => register.table === "measurement_location");

    expect(measured.map((register) => [register.relativePath, register.rowFilter, register.measure])).toEqual([
      ["bakeoff", { column: "class", value: "bakeoff" }, "walk"],
      ["datadog-shots", { column: "class", value: "datadog-shots" }, "walk"],
      ["evidence", { column: "class", value: "evidence" }, "walk"],
      ["proof", { column: "class", value: "proof" }, "walk"],
    ]);
  });

  it("declares datadog/ unmirrored, with the reason on each row", () => {
    const datadog = HOME_REGISTERS.filter((register) => register.relativePath.startsWith("datadog/"));

    expect(datadog.map((register) => [register.relativePath, register.table])).toEqual([
      ["datadog/hits.jsonl", undefined],
      ["datadog/catalogue", undefined],
    ]);
    expect(datadog[0]!.unmirroredBecause).toContain("must never become a store of Datadog");
  });
});

describe("homeShare", () => {
  const folded = homeShare({
    declaredTables: ["board_row", "content"],
    observedAtIso: "2026-09-20T04:00:00Z",
    registers: [
      share({ kind: "handover board", table: "board_row", unmirroredBecause: undefined }),
      share({ homeBytes: 2048, kind: "provider atlases" }),
      share({ homeBytes: undefined, homeRecords: undefined, kind: "supervisor scratch", tier: "scratch" }),
    ],
    residue: RESIDUE,
  });

  it("splits the denominator so the scratch tier never enters the durable share", () => {
    expect(folded.durableMirrored).toBe(1);
    expect(folded.durableUnmirrored).toBe(1);
    expect(folded.scratchRegisters).toEqual(["supervisor scratch"]);
  });

  it("sums only the unmirrored durable bytes — the migration's actual remainder", () => {
    expect(folded.durableUnmirroredBytes).toBe(2048);
  });

  it("counts an unmeasured durable register without adding a zero to the byte total", () => {
    const withUnmeasured = homeShare({
      declaredTables: [],
      observedAtIso: "2026-09-20T04:00:00Z",
      registers: [share({ homeBytes: undefined, homeRecords: undefined, kind: "codex passes" })],
      residue: RESIDUE,
    });
    expect(withUnmeasured.durableUnmirrored).toBe(1);
    expect(withUnmeasured.durableUnmirroredBytes).toBe(0);
  });

  it("carries the residue through, so the report states the bound of what it measured", () => {
    expect(folded.residue.unclassified).toBe(156);
    expect(folded.observedAtIso).toBe("2026-09-20T04:00:00Z");
  });

  it("names a declared table nothing here classifies rather than filing it into a bucket", () => {
    const drifted = homeShare({
      declaredTables: ["content", "brand_new_table"],
      observedAtIso: "2026-09-20T04:00:00Z",
      registers: [],
      residue: RESIDUE,
    });
    expect(drifted.unclassifiedTables).toEqual(["brand_new_table"]);
  });
});

describe("tableOrigin", () => {
  it("places a register's own table, a corpus table, a derived table and a child table", () => {
    expect(tableOrigin({ table: "board_row" })).toBe("home-register");
    expect(tableOrigin({ table: "run_event" })).toBe("home-register");
    expect(tableOrigin({ table: "owner_turn" })).toBe("home-register");
    expect(tableOrigin({ table: "owner_turn_location" })).toBe("home-register");
    expect(tableOrigin({ table: "measurement_location" })).toBe("home-register");
    expect(tableOrigin({ table: "measurement_blob" })).toBe("home-register");
    expect(tableOrigin({ table: "atlas_entity" })).toBe("home-register");
    expect(tableOrigin({ table: "atlas_gap" })).toBe("home-register");
    expect(tableOrigin({ table: "content_slack" })).toBe("corpus-ingest");
    expect(tableOrigin({ table: "memory_recalls" })).toBe("derived");
    expect(tableOrigin({ table: "spend_merchant" })).toBe("derived");
    expect(tableOrigin({ table: "store_import_item" })).toBe("derived");
    expect(tableOrigin({ table: "store_import_resolution" })).toBe("derived");
    expect(tableOrigin({ table: "store_import_part" })).toBe("derived");
    expect(tableOrigin({ table: "store_import_application" })).toBe("derived");
  });

  it("files both owner-judgement tables under the register their one legacy file seeds, never as derived", () => {
    const judgement = HOME_REGISTERS.find((register) => register.kind === "owner directives and corrections")!;
    expect([judgement.table, judgement.pathKey, judgement.shape, judgement.tier]).toEqual([
      "owner_directive",
      "ownerDirectivesJson",
      "file",
      "durable",
    ]);
    expect(tableOrigin({ table: "owner_directive" })).toBe("home-register");
    expect(tableOrigin({ table: "owner_correction" })).toBe("home-register");
  });

  it("is TOTAL over the drizzle barrel, so a new table cannot drift in unclassified", () => {
    const declared = declaredTableNames();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((table) => tableOrigin({ table }) === undefined)).toEqual([]);
  });
});
