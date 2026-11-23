/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { datadogCatalogueCommand } from "../../../../../cli/commands/datadog/catalogueRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { writeCatalogue } from "../../../../../datadog/detective/store.js";

const CREDENTIAL_VARS = ["DD_API_KEY", "DD_APP_KEY", "DD_SITE"] as const;

const homes: string[] = [];

/** A throwaway home, removed after the test that minted it. */
function mintHome(): string {
  const home = mkdtempSync(join(tmpdir(), "dd-cat-run-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A whole argv, as the router hands one to the command. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "datadog", "catalogue", ...rest];
}

describe("datadogCatalogueCommand — the dispatcher, before any network", () => {
  it("--help prints usage and exits EXIT_OK without touching credentials", async () => {
    expect(await datadogCatalogueCommand(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses a bare invocation naming neither half", async () => {
    expect(await datadogCatalogueCommand(argv({ rest: [] }))).toBe(EXIT_USAGE);
  });

  it("refuses a sub-verb that is not build or show", async () => {
    expect(await datadogCatalogueCommand(argv({ rest: ["rebuild"] }))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown --product before it resolves a window or a credential", async () => {
    expect(await datadogCatalogueCommand(argv({ rest: ["build", "--product", "traces"] }))).toBe(EXIT_USAGE);
  });

  it("refuses an unparseable window before it resolves a credential", async () => {
    expect(await datadogCatalogueCommand(argv({ rest: ["build", "--from", "a fortnight"] }))).toBe(EXIT_USAGE);
  });

  it("reports EXIT_EXPECTED_EMPTY on show when no census has been built", async () => {
    expect(await datadogCatalogueCommand(argv({ rest: ["show", "--home", mintHome()] }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("reads a built census back and exits EXIT_OK", async () => {
    const home = mintHome();
    writeCatalogue({
      catalogue: {
        manifest: {
          builtAtIso: "2026-09-16T02:05:00.000Z",
          map: {
            dashboards: [],
            edges: [],
            entities: [],
            indexes: [{ name: "main", retentionDays: 15 }],
            metricNamespaces: [],
            monitors: [],
            pipelines: [],
            rumApplications: [],
          },
          notMeasured: [],
          products: [],
          retentionDays: 15,
          rows: 0,
          schemaVersion: 2,
          services: [],
          site: "ap1.datadoghq.com",
          window: { fromIso: "2026-09-09T02:05:00.000Z", toIso: "2026-09-16T02:05:00.000Z" },
        },
        rows: [],
      },
      home,
    });
    expect(await datadogCatalogueCommand(argv({ rest: ["show", "--home", home, "--json"] }))).toBe(EXIT_OK);
  });

  describe("with credentials genuinely absent", () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const name of CREDENTIAL_VARS) {
        saved[name] = process.env[name];
        delete process.env[name];
      }
    });
    afterEach(() => {
      for (const name of CREDENTIAL_VARS) {
        const value = saved[name];
        if (value !== undefined) {
          process.env[name] = value;
        }
      }
    });

    it("exits EXIT_EXPECTED_EMPTY on build rather than reaching the network", async () => {
      expect(await datadogCatalogueCommand(argv({ rest: ["build", "--home", mintHome()] }))).toBe(EXIT_EXPECTED_EMPTY);
    });
  });
});
