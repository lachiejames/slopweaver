/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { datadogApiAdmittedByKind, datadogApiRowsFor } from "../../../../atlas/datadog/apiAcquisition.js";
import { type DatadogApiObservation, datadogApiBoundFor } from "../../../../atlas/datadog/apiCall.js";
import {
  type DatadogKindFile,
  type DatadogManifest,
  emptyDatadogManifest,
} from "../../../../atlas/datadog/documents.js";
import { DatadogAtlasErrors } from "../../../../atlas/datadog/errors.js";
import { datadogEntityId } from "../../../../atlas/datadog/identity.js";
import type { DatadogKind } from "../../../../atlas/datadog/model.js";
import { datadogPagingParametersFor } from "../../../../atlas/datadog/pagingParameters.js";
import { emptyDatadogKindFile } from "../../../../atlas/datadog/sync.js";
import { datadogApiCensus, datadogApiManifest } from "../../../../atlas/datadog/syncApi.js";
import { runDatadogApiPass } from "../../../../atlas/datadog/syncApiPass.js";
import type { DatadogApiKindOutcome, DatadogApiPassDeps } from "../../../../atlas/datadog/syncApiTypes.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const AT = "2026-09-14T00:00:00.000Z";

/** A kind whose every admitted operation is unpaged and which has no deferred remainder at all. */
const CLEAN_KIND: DatadogKind = "hosts";
/** One unpaged operation in that kind, named so an assertion never depends on the stored sort order. */
const CLEAN_OPERATION = "v1-hosts-get-host-totals";
/** A kind whose admitted operations page, so its cell must be denied `synced`. */
const WALKING_KIND: DatadogKind = "team";
/** A kind the registry refuses WHOLE, so the pass has nothing to issue and no remainder to defer. */
const NOTHING_CALLABLE_KIND: DatadogKind = "graph";
/** A kind reachable ONLY through identifier-taking operations, so this pass makes no call in it. */
const FANOUT_ONLY_KIND: DatadogKind = "dora";

/** Deps answering every call with one fixed body, recording the surfaces asked for. */
function answering({ body = { ok: true } }: { body?: unknown } = {}): {
  deps: DatadogApiPassDeps;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    deps: {
      at: AT,
      call: ({ row }) => {
        asked.push(row.name);
        const observation: DatadogApiObservation = {
          bodies: [body],
          // The real decision, not a restatement of it: a fake that graded its own bound would let the two
          // disagree, and the bound is what denies a kind the word `synced`.
          bound: datadogApiBoundFor({ row }),
          boundarySource: "measured",
          pagingParameter: datadogPagingParametersFor({ surface: row.name }).walk,
          status: 200,
        };
        return Promise.resolve(ok(observation));
      },
      scope: "ap1 api.ap1.datadoghq.com",
    },
  };
}

/** Deps that refuse every call with one typed error. */
function refusingDeps(): DatadogApiPassDeps {
  return {
    at: AT,
    call: ({ row }) => Promise.resolve(err(DatadogAtlasErrors.forbidden({ surface: row.name }))),
    scope: "ap1 api.ap1.datadoghq.com",
  };
}

/** The stored generation a pass merges onto: one empty file per named kind. */
function storedFor({ kinds }: { kinds: readonly DatadogKind[] }): Partial<Record<DatadogKind, DatadogKindFile>> {
  const files: Partial<Record<DatadogKind, DatadogKindFile>> = {};
  for (const kind of kinds) {
    files[kind] = emptyDatadogKindFile({ at: "2026-09-01T00:00:00.000Z", kind });
  }
  return files;
}

/** One kind's `api` coverage cell out of a pass's result. */
function apiCell({ file }: { file: DatadogKindFile }) {
  return file.coverage.find((cell) => cell.surface === "api")!;
}

/**
 * One kind's admitted row, resolved by NAME rather than by position.
 *
 * Entities are stored sorted by id, so an index into `entities` is not the index into the registry's rows
 * for the same kind — the first version of these assertions paired `hosts`'s two operations the wrong way
 * round and read as a paging bug that was not there.
 */
function admittedRow({ kind, name }: { kind: DatadogKind; name: string }) {
  return datadogApiRowsFor({ byKind: datadogApiAdmittedByKind(), kind }).find((row) => row.name === name)!;
}

/** The entity one admitted operation published, found by its own stable id. */
function entityFor({ file, kind, name }: { file: DatadogKindFile; kind: DatadogKind; name: string }) {
  return file.entities.find((one) => one.id === datadogEntityId({ kind, providerId: name }))!;
}

describe("runDatadogApiPass — which kinds it touches", () => {
  it("issues only the admitted operations of the kinds the store already holds", async () => {
    const { asked, deps } = answering();
    await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) });
    const expected = datadogApiRowsFor({ byKind: datadogApiAdmittedByKind(), kind: CLEAN_KIND }).map((row) => row.name);
    expect(asked).toEqual(expected);
  });

  it("makes no call at all in a kind reachable only through identifiers", async () => {
    const { asked, deps } = answering();
    await runDatadogApiPass({ deps, stored: storedFor({ kinds: [FANOUT_ONLY_KIND] }) });
    expect(asked).toEqual([]);
  });

  it("leaves a kind with no stored file entirely alone", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) }));
    expect(passed.files[WALKING_KIND]).toBe(undefined);
  });
});

describe("runDatadogApiPass — what it stores", () => {
  it("fills the api channel of the SAME entity id the compiled catalogue uses, and only that channel", async () => {
    const { deps } = answering({ body: { host_totals: 7 } });
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) }));
    const entity = entityFor({ file: passed.files[CLEAN_KIND]!, kind: CLEAN_KIND, name: CLEAN_OPERATION });
    expect(entity.channels.api!.channel).toBe("api");
    expect(entity.channels["compiled-catalogue"]).toBe(null);
    expect(entity.channels.console).toBe(null);
  });

  it("keeps the body as an envelope rather than as a concatenation", async () => {
    const { deps } = answering({ body: { host_totals: 7 } });
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) }));
    const entity = entityFor({ file: passed.files[CLEAN_KIND]!, kind: CLEAN_KIND, name: CLEAN_OPERATION });
    expect(entity.channels.api!.detail).toEqual({
      bodies: [{ host_totals: 7 }],
      bound: "whole",
      boundarySource: "measured",
      pagingParameter: null,
      status: 200,
    });
  });

  it("records the organisation and site as the entity's scope, not the pinned client", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) }));
    const entity = entityFor({ file: passed.files[CLEAN_KIND]!, kind: CLEAN_KIND, name: CLEAN_OPERATION });
    expect(entity.scope).toBe("ap1 api.ap1.datadoghq.com");
  });

  it("names the endpoint it actually issued on the observation's source", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) }));
    const row = admittedRow({ kind: CLEAN_KIND, name: CLEAN_OPERATION });
    const entity = entityFor({ file: passed.files[CLEAN_KIND]!, kind: CLEAN_KIND, name: CLEAN_OPERATION });
    expect(entity.channels.api!.source!.endpoint).toBe(`${row.method} ${row.path}`);
  });
});

describe("runDatadogApiPass — the coverage cell cannot claim more than it earned", () => {
  it("earns `synced` only where nothing is outstanding", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) }));
    const cell = apiCell({ file: passed.files[CLEAN_KIND]! });
    expect(cell.state).toBe("synced");
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.latestAttemptFailed).toBe(false);
  });

  it("denies `synced` to a kind whose operations walk, while still recording the success", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [WALKING_KIND] }) }));
    const cell = apiCell({ file: passed.files[WALKING_KIND]! });
    expect(cell.state).toBe("deferred");
    expect(cell.latestAttemptFailed).toBe(false);
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.reason).toContain("only their FIRST page was kept");
  });

  it("names the specific work that would widen a bounded kind", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [WALKING_KIND] }) }));
    expect(apiCell({ file: passed.files[WALKING_KIND]! }).unblockedBy).toContain("pagingParameter");
  });

  it("reads a 403 as a permission boundary rather than as an empty organisation", async () => {
    const passed = unwrap(
      await runDatadogApiPass({ deps: refusingDeps(), stored: storedFor({ kinds: [CLEAN_KIND] }) }),
    );
    const cell = apiCell({ file: passed.files[CLEAN_KIND]! });
    expect(cell.state).toBe("unavailable");
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.lastSuccessAt).toBe(null);
  });

  it("says a kind it could not call at all was not called, rather than reporting it empty", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [FANOUT_ONLY_KIND] }) }));
    const cell = apiCell({ file: passed.files[FANOUT_ONLY_KIND]! });
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toContain("take an identifier in their path");
  });
});

describe("runDatadogApiPass — gaps", () => {
  it("closes `api-never-called` for a kind it actually called", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) }));
    const gaps = passed.files[CLEAN_KIND]!.gaps.filter((gap) => gap.condition === "api-never-called");
    expect(gaps).toEqual([]);
  });

  it("opens a first-page gap NAMING the parameter a walk has to send", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [WALKING_KIND] }) }));
    const gap = passed.files[WALKING_KIND]!.gaps.find((one) => one.condition === "api-first-page-only")!;
    expect(gap.status).toBe("open");
    expect(gap.reason).toContain("`page[number]`");
  });

  it("opens a fan-out gap that says a kind with no other operation was never asked", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [FANOUT_ONLY_KIND] }) }));
    const gap = passed.files[FANOUT_ONLY_KIND]!.gaps.find((one) => one.condition === "api-fanout-unbuilt")!;
    expect(gap.reason).toContain("must not take this kind's silence");
  });

  it("leaves `api-never-called` open on a kind it could make no call in", async () => {
    const { deps } = answering();
    const stored = storedFor({ kinds: [FANOUT_ONLY_KIND] });
    stored[FANOUT_ONLY_KIND] = {
      ...stored[FANOUT_ONLY_KIND]!,
      gaps: [
        {
          channel: "api",
          condition: "api-never-called",
          firstDetectedAt: "2026-09-01T00:00:00.000Z",
          id: "seeded",
          kind: FANOUT_ONLY_KIND,
          lastCheckedAt: "2026-09-01T00:00:00.000Z",
          lastDetectedAt: "2026-09-01T00:00:00.000Z",
          reason: "nothing has asked this organisation",
          scope: FANOUT_ONLY_KIND,
          status: "open",
        },
      ],
    };
    const passed = unwrap(await runDatadogApiPass({ deps, stored }));
    const gap = passed.files[FANOUT_ONLY_KIND]!.gaps.find((one) => one.condition === "api-never-called")!;
    expect(gap.status).toBe("open");
  });
});

describe("datadogApiManifest — the manifest records publication, the cell records acquisition", () => {
  const base: DatadogManifest = emptyDatadogManifest({ updatedAt: "2026-09-01T00:00:00.000Z" });
  const withCompiled: DatadogManifest = {
    ...base,
    kinds: {
      ...base.kinds,
      [CLEAN_KIND]: { digest: null, entityCount: 2, lastAttempt: null, lastSuccessAt: "2026-09-01T00:00:00.000Z" },
    },
  };

  function outcome(over: Partial<DatadogApiKindOutcome> = {}): DatadogApiKindOutcome {
    return {
      answered: 1,
      attempted: 1,
      estateRecords: 0,
      estateUnidentified: 0,
      failed: 0,
      firstPageOnly: 0,
      kind: CLEAN_KIND,
      specNamesOnly: 0,
      ...over,
    };
  }

  it("moves the success clock to this run when the file was rewritten, so both clocks agree", () => {
    const next = datadogApiManifest({ at: AT, kinds: [outcome()], manifest: withCompiled });
    expect(next.kinds[CLEAN_KIND].lastSuccessAt).toBe(AT);
    expect(next.kinds[CLEAN_KIND].lastAttempt!.outcome).toBe("ok");
  });

  it("stamps a kind whose every operation failed as failed, and leaves its success clock alone", () => {
    const next = datadogApiManifest({
      at: AT,
      kinds: [outcome({ answered: 0, failed: 3, attempted: 3 })],
      manifest: withCompiled,
    });
    expect(next.kinds[CLEAN_KIND].lastAttempt!.outcome).toBe("failed");
    expect(next.kinds[CLEAN_KIND].lastSuccessAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("counts a partial failure in the attempt's reasons without denying the publish", () => {
    const next = datadogApiManifest({
      at: AT,
      kinds: [outcome({ answered: 2, attempted: 3, failed: 1 })],
      manifest: withCompiled,
    });
    expect(next.kinds[CLEAN_KIND].lastAttempt!.outcome).toBe("ok");
    expect(next.kinds[CLEAN_KIND].lastAttempt!.reasons[0]).toContain("1 of 3");
  });

  it("stamps a kind that had nothing to call as published, since its file was still rewritten", () => {
    const next = datadogApiManifest({
      at: AT,
      kinds: [outcome({ answered: 0, attempted: 0, failed: 0 })],
      manifest: withCompiled,
    });
    expect(next.kinds[CLEAN_KIND].lastSuccessAt).toBe(AT);
  });
});

describe("datadogApiCensus", () => {
  it("reports the three numbers the pass's own report prints", () => {
    const census = datadogApiCensus();
    expect(census.admitted).toBeGreaterThan(0);
    expect(census.fanoutDeferred).toBeGreaterThan(0);
    expect(census.shapeIndexDeferred).toBeGreaterThan(0);
  });
});

describe("runDatadogApiPass — a kind nothing is callable in cannot read as covered", () => {
  it("grades a kind whose every operation the registry refuses `excluded`, never `synced`", async () => {
    const { asked, deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [NOTHING_CALLABLE_KIND] }) }));
    const cell = apiCell({ file: passed.files[NOTHING_CALLABLE_KIND]! });
    expect(asked).toEqual([]);
    expect(cell.state).toBe("excluded");
  });

  it("says nothing was ASKED, so a zero count is not read as an empty organisation", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [NOTHING_CALLABLE_KIND] }) }));
    const cell = apiCell({ file: passed.files[NOTHING_CALLABLE_KIND]! });
    expect(cell.reason).toContain("nothing here is callable at all");
    expect(cell.reason).toContain("never that this organisation holds none");
  });

  it("records no success for it, so the surface verdict cannot count it as reached", async () => {
    const { deps } = answering();
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [NOTHING_CALLABLE_KIND] }) }));
    expect(apiCell({ file: passed.files[NOTHING_CALLABLE_KIND]! }).lastSuccessAt).toBe(null);
  });

  it("is a DIFFERENT verdict from a kind that was called and answered in full", async () => {
    const { deps } = answering();
    const passed = unwrap(
      await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND, NOTHING_CALLABLE_KIND] }) }),
    );
    expect(apiCell({ file: passed.files[CLEAN_KIND]! }).state).toBe("synced");
    expect(apiCell({ file: passed.files[NOTHING_CALLABLE_KIND]! }).state).toBe("excluded");
  });
});

describe("runDatadogApiPass — this organisation's own records, beside the operations", () => {
  /** The kind the finding named: 29 SDK operations stored, and none of the monitors this org runs. */
  const ESTATE_KIND: DatadogKind = "monitor";
  /** The list operation whose answer carries the estate. Monitors come back as a BARE array. */
  const ESTATE_OPERATION = "v1-monitors-list-monitors";
  /** Two real-shaped monitors, so a `not.toContain` is never the evidence — the input CARRIES them. */
  const MONITORS = [
    { id: 12345, name: "staging pool exhausted", type: "query alert" },
    { id: 67890, name: "ingest lag", type: "metric alert" },
  ];

  it("stores each monitor as an entity of its own, keyed by Datadog's own id", async () => {
    const { deps } = answering({ body: MONITORS });
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [ESTATE_KIND] }) }));
    const stored = entityFor({ file: passed.files[ESTATE_KIND]!, kind: ESTATE_KIND, name: "12345" });
    expect(stored.providerId).toBe("12345");
    expect(stored.channels.api!.detail).toEqual(MONITORS[0]);
  });

  it("leaves the OPERATION entity exactly where it was — the estate is published BESIDE it, never instead", async () => {
    const { deps } = answering({ body: MONITORS });
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [ESTATE_KIND] }) }));
    const operation = entityFor({ file: passed.files[ESTATE_KIND]!, kind: ESTATE_KIND, name: ESTATE_OPERATION });
    expect(operation.providerId).toBe(ESTATE_OPERATION);
    expect(operation.channels.api!.detail).toEqual({
      bodies: [MONITORS],
      bound: datadogApiBoundFor({ row: admittedRow({ kind: ESTATE_KIND, name: ESTATE_OPERATION }) }),
      boundarySource: "measured",
      pagingParameter: datadogPagingParametersFor({ surface: ESTATE_OPERATION }).walk,
      status: 200,
    });
  });

  it("gives an estate record no compiled channel, which is what tells it apart from an operation", async () => {
    const { deps } = answering({ body: MONITORS });
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [ESTATE_KIND] }) }));
    const stored = entityFor({ file: passed.files[ESTATE_KIND]!, kind: ESTATE_KIND, name: "67890" });
    expect(stored.channels["compiled-catalogue"]).toBe(null);
    expect(stored.channels.console).toBe(null);
    expect(stored.channels.api!.source!.surface).toBe("api");
  });

  it("counts them on the pass outcome, separately from the operations it issued", async () => {
    const { deps } = answering({ body: MONITORS });
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [ESTATE_KIND] }) }));
    expect(passed.outcome.estateRecords).toBe(2);
    expect(passed.outcome.kinds.find((one) => one.kind === ESTATE_KIND)!.estateRecords).toBe(2);
  });

  it("says so in the kind's own api coverage cell, naming the operation the records came out of", async () => {
    const { deps } = answering({ body: MONITORS });
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [ESTATE_KIND] }) }));
    const cell = apiCell({ file: passed.files[ESTATE_KIND]! });
    expect(cell.reason).toContain("ESTATE: 2 of this organisation's own monitor record(s)");
    expect(cell.reason).toContain(ESTATE_OPERATION);
  });

  it("publishes NO estate when the list operation did not answer, rather than an organisation holding none", async () => {
    const passed = unwrap(
      await runDatadogApiPass({ deps: refusingDeps(), stored: storedFor({ kinds: [ESTATE_KIND] }) }),
    );
    expect(passed.outcome.estateRecords).toBe(0);
    expect(apiCell({ file: passed.files[ESTATE_KIND]! }).reason).toContain(
      "ESTATE: NOT READ — `v1-monitors-list-monitors` did not answer this pass",
    );
  });

  it("leaves a kind this atlas holds no estate row for at zero", async () => {
    const { deps } = answering({ body: { host_totals: 7 } });
    const passed = unwrap(await runDatadogApiPass({ deps, stored: storedFor({ kinds: [CLEAN_KIND] }) }));
    expect(passed.outcome.estateRecords).toBe(0);
    expect(apiCell({ file: passed.files[CLEAN_KIND]! }).reason).not.toContain("ESTATE:");
  });
});
