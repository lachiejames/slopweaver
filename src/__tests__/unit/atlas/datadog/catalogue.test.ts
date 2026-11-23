import { describe, expect, it } from "vitest";

import {
  DATADOG_COMPILED_CHANNEL,
  DATADOG_COMPILED_SCOPE,
  datadogRowsByKind,
  projectDatadogCatalogue,
} from "../../../../atlas/datadog/catalogue.js";
import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import { datadogEntityId } from "../../../../atlas/datadog/identity.js";
import { DATADOG_KINDS } from "../../../../atlas/datadog/model.js";

const AT = "2026-09-06T01:00:00.000Z";

const monitorRows = () => DATADOG_SURFACES.filter((row) => row.kind === "monitor");

describe("datadogRowsByKind", () => {
  it("groups every registry row, losing none", () => {
    const grouped = datadogRowsByKind();
    const total = [...grouped.values()].reduce((sum, rows) => sum + rows.length, 0);

    expect(total).toBe(DATADOG_SURFACES.length);
  });

  // A kind with rows and no file is a row this atlas would silently drop, which is the one thing an atlas
  // may not do. `model.ts` carries the 50-row measurement that made this an exact-equality check.
  it("produces only kinds the model declares", () => {
    const declared = new Set<string>(DATADOG_KINDS);
    const undeclared = [...datadogRowsByKind().keys()].filter((kind) => !declared.has(kind));

    expect(undeclared).toStrictEqual([]);
  });
});

describe("projectDatadogCatalogue", () => {
  it("publishes an entity for every row of the kind, whatever its disposition", () => {
    const rows = monitorRows();
    const projected = projectDatadogCatalogue({ at: AT, kind: "monitor", rows });

    expect(projected.length).toBe(rows.length);
    expect(projected.length).toBeGreaterThan(0);
  });

  // `exclusions.ts`: an excluded operation stays "addressable by surface name for inventory and coverage",
  // because an atlas that omitted them would answer "Datadog has no such endpoint", which is false.
  it("publishes the EXCLUDED rows too, rather than answering that they do not exist", () => {
    const excluded = monitorRows().filter((row) => row.disposition === "excluded");
    const projected = projectDatadogCatalogue({ at: AT, kind: "monitor", rows: excluded });
    const names = projected.map((entry) => entry.entity.providerId);

    expect(excluded.length).toBeGreaterThan(0);
    expect(names).toStrictEqual(excluded.map((row) => row.name));
  });

  it("fills ONLY the compiled channel, leaving api and console null so neither claims to have looked", () => {
    const entry = projectDatadogCatalogue({ at: AT, kind: "monitor", rows: monitorRows() })[0]!;

    expect(entry.entity.channels.api).toBe(null);
    expect(entry.entity.channels.console).toBe(null);
    expect(entry.entity.channels["compiled-catalogue"]!.channel).toBe(DATADOG_COMPILED_CHANNEL);
    expect(entry.entity.channels["compiled-catalogue"]!.state).toBe("observed");
  });

  it("carries the method and path as the reproduction handle, and no fabricated deep link", () => {
    const row = monitorRows().find((one) => one.name === "v1-monitors-list-monitors")!;
    const entry = projectDatadogCatalogue({ at: AT, kind: "monitor", rows: [row] })[0]!;
    const source = entry.entity.channels["compiled-catalogue"]!.source!;

    expect(source.endpoint).toBe(`${row.method} ${row.path}`);
    expect(source.deepLink).toBe(null);
    expect(source.deepLinkStatus).toBe("unavailable");
    expect(source.surface).toBe(DATADOG_COMPILED_CHANNEL);
  });

  it("scopes every entity to the pinned client rather than to an organisation", () => {
    const entry = projectDatadogCatalogue({ at: AT, kind: "monitor", rows: monitorRows() })[0]!;

    expect(entry.entity.scope).toBe(DATADOG_COMPILED_SCOPE);
    expect(DATADOG_COMPILED_SCOPE).toBe("@datadog/datadog-api-client 1.62.0");
  });

  it("derives the id from the kind and the registry's own surface name", () => {
    const row = monitorRows().find((one) => one.name === "v1-monitors-list-monitors")!;
    const entry = projectDatadogCatalogue({ at: AT, kind: "monitor", rows: [row] })[0]!;

    expect(entry.entity.id).toBe(datadogEntityId({ kind: "monitor", providerId: "v1-monitors-list-monitors" }));
  });

  // The projection is the storage boundary and this path goes through it even though it can drop nothing.
  // If a registry field is ever renamed to a denied name, this is what says so.
  it("drops nothing from a registry row, because none of its fields is a denied name", () => {
    const dropped = DATADOG_KINDS.flatMap((kind) => {
      const rows = datadogRowsByKind().get(kind);
      // A kind the registry holds no rows for projects nothing, so it can drop nothing.
      if (rows === undefined) {
        return [];
      }
      return projectDatadogCatalogue({ at: AT, kind, rows }).flatMap((entry) => entry.projection.dropped);
    });

    expect(dropped).toStrictEqual([]);
  });

  it("stamps both instants with this run's timestamp on a first sight", () => {
    const entry = projectDatadogCatalogue({ at: AT, kind: "monitor", rows: monitorRows() })[0]!;

    expect(entry.entity.channels["compiled-catalogue"]!.firstSeenAt).toBe(AT);
    expect(entry.entity.channels["compiled-catalogue"]!.lastSeenAt).toBe(AT);
  });

  it("produces no entity for a kind the registry carries no row for", () => {
    expect(projectDatadogCatalogue({ at: AT, kind: "monitor", rows: [] })).toStrictEqual([]);
  });
});
