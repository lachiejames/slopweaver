/*
 * The projection stage of the live `api` pass, driven directly rather than through the whole pass.
 *
 * Until the split these functions were private and reachable only through `runDatadogApiPass`, so a defect
 * in the entity projection surfaced as a failure of the whole pass rather than of the thing that broke.
 * Every fixture here is a real registry row and a real projection, because a hand-built row would let the
 * test and the registry disagree about what an operation is. Every Datadog host in this file reads the synthetic
 * `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { datadogApiAdmittedByKind, datadogApiRowsFor } from "../../../../atlas/datadog/apiAcquisition.js";
import { type DatadogApiObservation, datadogApiBoundFor } from "../../../../atlas/datadog/apiCall.js";
import { datadogEntityId } from "../../../../atlas/datadog/identity.js";
import type { DatadogKind } from "../../../../atlas/datadog/model.js";
import { datadogPagingParametersFor } from "../../../../atlas/datadog/pagingParameters.js";
import { projectDatadogValue } from "../../../../atlas/datadog/projection.js";
import { entityFor, estateFor } from "../../../../atlas/datadog/syncApiEntities.js";
import type { DatadogApiOperationOutcome } from "../../../../atlas/datadog/syncApiTypes.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-14T00:00:00.000Z";
const SCOPE = "ap1 api.ap1.datadoghq.com";
const NO_ESTATE_KIND: DatadogKind = "hosts";
const NO_ESTATE_OPERATION = "v1-hosts-get-host-totals";
const ESTATE_KIND: DatadogKind = "dashboard";
const ESTATE_OPERATION = "v1-dashboards-list-dashboards";

/** One real registry row, resolved by NAME so no assertion depends on the registry's own order. */
function rowFor({ kind, name }: { kind: DatadogKind; name: string }) {
  return datadogApiRowsFor({ byKind: datadogApiAdmittedByKind(), kind }).find((row) => row.name === name)!;
}

/** One answered outcome, built the way the pass builds it: a real bound and a real projection of the bodies. */
function answered({
  kind,
  name,
  body,
}: {
  kind: DatadogKind;
  name: string;
  body: unknown;
}): DatadogApiOperationOutcome {
  const row = rowFor({ kind, name });
  const observation: DatadogApiObservation = {
    bodies: [body],
    bound: datadogApiBoundFor({ row }),
    boundarySource: "measured",
    pagingParameter: datadogPagingParametersFor({ surface: row.name }).walk,
    status: 200,
  };
  return { error: null, observation, projection: projectDatadogValue({ kind, value: [body] }), row };
}

describe("the registry rows these fixtures stand on", () => {
  it("resolves both named operations, so no case below is vacuous", () => {
    expect(rowFor({ kind: NO_ESTATE_KIND, name: NO_ESTATE_OPERATION }).name).toBe(NO_ESTATE_OPERATION);
    expect(rowFor({ kind: ESTATE_KIND, name: ESTATE_OPERATION }).name).toBe(ESTATE_OPERATION);
  });
});

describe("entityFor", () => {
  it("publishes the operation's entity under the id the compiled catalogue already fixed", () => {
    const outcome = answered({ body: { total_up: 3 }, kind: NO_ESTATE_KIND, name: NO_ESTATE_OPERATION });
    const entity = entityFor({ at: AT, kind: NO_ESTATE_KIND, outcome, scope: SCOPE })!;
    expect(entity.id).toBe(datadogEntityId({ kind: NO_ESTATE_KIND, providerId: NO_ESTATE_OPERATION }));
    expect(entity.kind).toBe(NO_ESTATE_KIND);
    expect(entity.providerId).toBe(NO_ESTATE_OPERATION);
  });

  it("fills only the api channel, leaving the compiled and console channels for their own passes", () => {
    const outcome = answered({ body: { total_up: 3 }, kind: NO_ESTATE_KIND, name: NO_ESTATE_OPERATION });
    const entity = entityFor({ at: AT, kind: NO_ESTATE_KIND, outcome, scope: SCOPE })!;
    expect(entity.channels.api!.state).toBe("observed");
    expect(entity.channels.api!.source!.observedAt).toBe(AT);
    expect(entity.channels["compiled-catalogue"]).toBe(null);
    expect(entity.channels.console).toBe(null);
  });

  it("constructs no console deep link, because an API operation has no page to link to", () => {
    const outcome = answered({ body: { total_up: 3 }, kind: NO_ESTATE_KIND, name: NO_ESTATE_OPERATION });
    const entity = entityFor({ at: AT, kind: NO_ESTATE_KIND, outcome, scope: SCOPE })!;
    expect(entity.channels.api!.source!.deepLink).toBe(null);
    expect(entity.channels.api!.source!.deepLinkStatus).toBe("unavailable");
  });

  it("publishes nothing for an operation that never answered", () => {
    const row = rowFor({ kind: NO_ESTATE_KIND, name: NO_ESTATE_OPERATION });
    const refused: DatadogApiOperationOutcome = { error: null, observation: null, projection: null, row };
    expect(entityFor({ at: AT, kind: NO_ESTATE_KIND, outcome: refused, scope: SCOPE })).toBe(null);
  });
});

describe("estateFor", () => {
  it("holds no estate for a kind the estate rows do not name", () => {
    const outcome = answered({ body: { total_up: 3 }, kind: NO_ESTATE_KIND, name: NO_ESTATE_OPERATION });
    const held = unwrap(estateFor({ at: AT, kind: NO_ESTATE_KIND, outcomes: [outcome], scope: SCOPE }));
    expect(held.entities).toEqual([]);
    expect(held.records).toBe(0);
    expect(held.unidentified).toBe(0);
  });

  it("holds no estate when the listing operation was not among this kind's outcomes", () => {
    const held = unwrap(estateFor({ at: AT, kind: ESTATE_KIND, outcomes: [], scope: SCOPE }));
    expect(held.entities).toEqual([]);
    expect(held.records).toBe(0);
  });

  it("explodes this organisation's own records out of the listing, counting what carried no id", () => {
    const outcome = answered({
      body: { dashboards: [{ id: "abc-123" }, { id: "def-456" }, {}] },
      kind: ESTATE_KIND,
      name: ESTATE_OPERATION,
    });
    const held = unwrap(estateFor({ at: AT, kind: ESTATE_KIND, outcomes: [outcome], scope: SCOPE }));
    expect(held.records).toBe(2);
    expect(held.unidentified).toBe(1);
    expect(held.entities.length).toBe(2);
    expect(held.entities.map((one) => one.providerId).toSorted()).toEqual(["abc-123", "def-456"]);
  });

  it("gives an estate entity an api channel and no compiled one, which is how a reader tells the two apart", () => {
    const outcome = answered({
      body: { dashboards: [{ id: "abc-123" }] },
      kind: ESTATE_KIND,
      name: ESTATE_OPERATION,
    });
    const held = unwrap(estateFor({ at: AT, kind: ESTATE_KIND, outcomes: [outcome], scope: SCOPE }));
    const entity = held.entities[0]!;
    expect(entity.channels.api!.state).toBe("observed");
    expect(entity.channels["compiled-catalogue"]).toBe(null);
  });
});
