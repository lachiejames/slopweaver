import { describe, expect, it } from "vitest";

import {
  admitDatadogApiSurface,
  DATADOG_API_ADMITTED,
  DATADOG_API_FANOUT_DEFERRED,
  DATADOG_API_SHAPE_INDEX_DEFERRED,
  datadogApiAdmittedByKind,
  datadogApiFanoutDeferredByKind,
  datadogApiRowsFor,
  datadogPathIsSelfContained,
} from "../../../../atlas/datadog/apiAcquisition.js";
import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import { datadogPagingParametersFor } from "../../../../atlas/datadog/pagingParameters.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("datadogPathIsSelfContained", () => {
  it("accepts a template naming no parameter", () => {
    expect(datadogPathIsSelfContained({ path: "/api/v1/monitor" })).toBe(true);
  });

  it("refuses one that takes an identifier", () => {
    expect(datadogPathIsSelfContained({ path: "/api/v1/dashboard/{dashboard_id}" })).toBe(false);
  });
});

describe("the admitted set is a derivation of the committed registry", () => {
  it("is not empty, so every guard below is over something", () => {
    expect(DATADOG_API_ADMITTED.length).toBeGreaterThan(0);
  });

  it("admits exactly the entity operations that take no identifier", () => {
    const expected = DATADOG_SURFACES.filter((row) => row.disposition === "entity" && !row.path.includes("{")).length;
    expect(DATADOG_API_ADMITTED.length).toBe(expected);
  });

  it("admits nothing the registry refuses, whatever the reason", () => {
    expect(DATADOG_API_ADMITTED.filter((row) => row.disposition !== "entity")).toEqual([]);
  });

  it("admits no operation whose path takes an identifier", () => {
    expect(DATADOG_API_ADMITTED.filter((row) => row.path.includes("{")).map((row) => row.name)).toEqual([]);
  });

  it("admits only methods the read-only transport type can express", () => {
    const wrong = DATADOG_API_ADMITTED.filter((row) => row.method !== "GET" && row.method !== "POST");
    expect(wrong.map((row) => `${row.method} ${row.path}`)).toEqual([]);
  });

  it("carries a paging parameter on every admitted row that walks, and none on one that does not", () => {
    const missing = DATADOG_API_ADMITTED.filter(
      (row) => row.paging !== "none" && datadogPagingParametersFor({ surface: row.name }).walk === null,
    );
    const spurious = DATADOG_API_ADMITTED.filter(
      (row) => row.paging === "none" && datadogPagingParametersFor({ surface: row.name }).walk !== null,
    );
    expect(missing.map((row) => row.name)).toEqual([]);
    expect(spurious.map((row) => row.name)).toEqual([]);
  });
});

describe("the two remainders are enumerated rather than dropped", () => {
  it("accounts for every entity operation across the admitted set and the fan-out remainder", () => {
    const entities = DATADOG_SURFACES.filter((row) => row.disposition === "entity").length;
    expect(DATADOG_API_ADMITTED.length + DATADOG_API_FANOUT_DEFERRED.length).toBe(entities);
  });

  it("defers every operation in the fan-out remainder for the same one reason", () => {
    expect(DATADOG_API_FANOUT_DEFERRED.filter((row) => !row.path.includes("{"))).toEqual([]);
  });

  it("holds every shape-index operation out of this pass", () => {
    const declared = DATADOG_SURFACES.filter((row) => row.disposition === "shape-index").length;
    expect(DATADOG_API_SHAPE_INDEX_DEFERRED.length).toBe(declared);
  });

  it("names a kind reachable only through identifiers, which is what its gap has to say", () => {
    const admitted = datadogApiAdmittedByKind();
    const deferred = datadogApiFanoutDeferredByKind();
    const unreachable = [...deferred.keys()]
      .filter((kind) => datadogApiRowsFor({ byKind: admitted, kind }).length === 0)
      .toSorted();
    expect(unreachable).toContain("dora");
    expect(unreachable).toContain("deployments");
  });
});

describe("admitDatadogApiSurface — the one entry point, and each way it refuses", () => {
  it("resolves an admitted operation to its own registry row", () => {
    const row = unwrap(admitDatadogApiSurface({ surface: "v1-monitors-list-monitors" }));
    expect(row.path).toBe("/api/v1/monitor");
    expect(row.disposition).toBe("entity");
  });

  it("refuses a name the registry does not carry as a programming error, not a provider condition", () => {
    const error = unwrapErr(admitDatadogApiSurface({ surface: "v9-invented-operation" }));
    expect(error.code).toBe("SURFACE_REFUSED");
    expect(error.message).toContain("the registry is closed");
  });

  it("refuses an excluded operation and SHOWS the registry's own reason", () => {
    const excluded = DATADOG_SURFACES.find((row) => row.disposition === "excluded")!;
    const error = unwrapErr(admitDatadogApiSurface({ surface: excluded.name }));
    expect(error.code).toBe("SURFACE_REFUSED");
    expect(error.message).toContain("inventoried and deliberately never called");
  });

  it("refuses a shape-index operation as a different pass rather than as a missing one", () => {
    const shaped = DATADOG_SURFACES.find((row) => row.disposition === "shape-index")!;
    const error = unwrapErr(admitDatadogApiSurface({ surface: shaped.name }));
    expect(error.message).toContain("a shape index needs a bounded window");
  });

  it("refuses a credential-validation probe, which publishes nothing", () => {
    const probe = DATADOG_SURFACES.find((row) => row.disposition === "probe-only")!;
    const error = unwrapErr(admitDatadogApiSurface({ surface: probe.name }));
    expect(error.message).toContain("a probe publishes nothing");
  });

  it("refuses an identifier-taking entity operation by naming the fan-out that does not exist", () => {
    const error = unwrapErr(admitDatadogApiSurface({ surface: "v1-dashboards-get-dashboard" }));
    expect(error.message).toContain("takes an identifier");
    expect(error.message).toContain("does not exist yet");
  });
});
