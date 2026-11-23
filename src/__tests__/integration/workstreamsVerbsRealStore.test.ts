/**
 * `workstreams list` and `workstreams put` over the REAL store, through the production register — the tombstone fence
 * included — with a second, independent client standing for another writer between a read and a put.
 *
 * OPT-IN, and never in CI, exactly as `./workstreamStore.test.ts` (whose header carries the commands); point it at the
 * same THROWAWAY database:
 *
 *   WORKSTREAM_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/workstream_store_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/workstreamsVerbsRealStore.test.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runWorkstreamsList } from "../../cli/commands/workstreams/list.js";
import { runWorkstreamsPut } from "../../cli/commands/workstreams/put.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../cli/exitCodes.js";
import { unwrap } from "../../lib/result.js";
import { productionWorkstreamRegister } from "../../workstreams/store/register.js";
import { ACME_META, acmeLocal, acmeOutcome } from "../workstreamStoreFixtures.js";

import { PROOF_URL, useRealStore } from "./workstreamStoreProof.js";

/** What one verb run wrote, and what it exited with. */
interface Recorded {
  readonly exit: number;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
}

describe.skipIf(PROOF_URL === undefined)("the workstreams verbs over the real store", () => {
  let home = "";

  useRealStore({
    onClient: () => undefined,
    onHome: (made) => {
      home = made;
    },
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const list = async ({ json }: { json: boolean }): Promise<Recorded> => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const rest = json ? ["--home", home, "--json"] : ["--home", home];
    const exit = await runWorkstreamsList({
      deps: {
        peopleFor: () => [],
        store: productionWorkstreamRegister(),
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: (line) => out.push(line),
      },
      rest,
    });
    return { diagnostics, exit, out };
  };

  const put = async ({ document }: { document: unknown }): Promise<Recorded> => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const file = join(home, "document.json");
    writeFileSync(file, JSON.stringify(document));
    const exit = await runWorkstreamsPut({
      deps: {
        store: productionWorkstreamRegister(),
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: ["--file", file, "--home", home, "--json"],
    });
    return { diagnostics, exit, out };
  };

  /** Put a document that must land, so a refusal surfaces as itself rather than as a missing line later. */
  const seed = async ({ document }: { document: unknown }): Promise<unknown> => {
    const run = await put({ document });
    expect(run.diagnostics).toEqual([]);
    return JSON.parse(run.out[0]!);
  };

  const listed = async (): Promise<Record<string, unknown>> =>
    JSON.parse((await list({ json: true })).out[0]!) as Record<string, unknown>;

  it("seeds an empty store, lists it as version 2, and takes an edit back keeping every child id", async () => {
    expect((await list({ json: false })).exit).toBe(EXIT_EXPECTED_EMPTY);
    const first = {
      meta: ACME_META,
      schemaVersion: 2,
      workstreams: [acmeOutcome(), acmeLocal({ id: "acme-scratch" })],
    };
    expect(await seed({ document: first })).toEqual({ deleted: 0, workstreams: 2, written: 2 });

    const document = await listed();
    expect(document["schemaVersion"]).toBe(2);
    const workstreams = document["workstreams"] as Record<string, unknown>[];
    const renamed = workstreams.map((one) =>
      one["id"] === "acme-onboarding" ? { ...one, name: "Acme onboarding, renamed" } : one,
    );
    const run = await put({ document: { ...document, workstreams: renamed } });
    expect(JSON.parse(run.out[0]!)).toEqual({ deleted: 0, workstreams: 2, written: 1 });

    const after = unwrap(await productionWorkstreamRegister().read({ home }));
    const onboarding = after.workstreams.find((one) => one.id === "acme-onboarding")!;
    expect([onboarding.name, onboarding.revision]).toEqual(["Acme onboarding, renamed", 2]);
    expect(onboarding.entries.map((entry) => entry.id)).toEqual(acmeOutcome().entries.map((entry) => entry.id));
  });

  it("refuses a document another client moved a workstream under, keeping that client's change", async () => {
    await seed({ document: { meta: ACME_META, schemaVersion: 2, workstreams: [acmeOutcome()] } });
    const stale = await listed();
    const other = productionWorkstreamRegister();
    unwrap(await other.put({ aggregate: acmeOutcome({ name: "the other writer's name" }), expectedRevision: 1, home }));

    const run = await put({ document: stale });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("WORKSTREAM_BASELINE_STALE");
    expect(unwrap(await other.read({ home })).workstreams.map((one) => [one.name, one.revision])).toEqual([
      ["the other writer's name", 2],
    ]);
  });

  it("refuses a document another client changed the register document under, or inserted a workstream under", async () => {
    await seed({ document: { meta: ACME_META, schemaVersion: 2, workstreams: [acmeOutcome()] } });
    const other = productionWorkstreamRegister();

    const beforeMeta = await listed();
    unwrap(await other.putMeta({ document: { ...ACME_META, initiatives: [] }, expectedRevision: 1, home }));
    expect((await put({ document: beforeMeta })).diagnostics[0]).toContain("WORKSTREAM_BASELINE_STALE");

    const beforeInsert = await listed();
    unwrap(await other.put({ aggregate: acmeLocal({ id: "acme-new" }), expectedRevision: null, home }));
    expect((await put({ document: beforeInsert })).diagnostics[0]).toContain("WORKSTREAM_BASELINE_STALE");
    expect(unwrap(await other.read({ home })).workstreams.map((one) => one.id)).toEqual([
      "acme-new",
      "acme-onboarding",
    ]);
  });

  it("deletes a workstream the document omits, and the register document when it carries none", async () => {
    await seed({
      document: { meta: ACME_META, schemaVersion: 2, workstreams: [acmeOutcome(), acmeLocal({ id: "acme-scratch" })] },
    });
    const document = await listed();
    const kept = (document["workstreams"] as Record<string, unknown>[]).filter((one) => one["id"] !== "acme-scratch");
    const run = await put({ document: { ...document, meta: null, workstreams: kept } });
    expect(JSON.parse(run.out[0]!)).toEqual({ deleted: 1, workstreams: 1, written: 0 });
    const after = unwrap(await productionWorkstreamRegister().read({ home }));
    expect([after.meta, after.workstreams.map((one) => one.id)]).toEqual([null, ["acme-onboarding"]]);
  });

  it("refuses to open the store while the retired register file stands, reading nothing from it", async () => {
    await seed({ document: { meta: ACME_META, schemaVersion: 2, workstreams: [acmeOutcome()] } });
    const retired = join(home, "workstreams", "register.json");
    rmSync(retired, { force: true, recursive: true });
    mkdirSync(join(home, "workstreams"), { recursive: true });
    writeFileSync(retired, JSON.stringify({ schemaVersion: 1, workstreams: [] }));

    const run = await list({ json: true });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.out).toEqual([]);
    expect(run.diagnostics[0]).toContain("workstreams list: WORKSTREAM_RETIRED_REGISTER_PRESENT");
  });
});
