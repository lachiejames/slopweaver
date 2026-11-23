import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { outsideLegs } from "../../../../../cli/commands/store/detectLegs.js";
import type { AtlasProbeExecute } from "../../../../../store/atlas/probeRun.js";

/** Every home this file mints, removed after each case. */
const homes: string[] = [];

/** A state home with nothing in it — no Datadog census, no Hex atlas. */
function emptyHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "legs-"));
  homes.push(dir);
  return dir;
}

/** A store holding no atlas rows at all: the total answers zero, and every probe after it answers nothing. */
function emptyStore(): AtlasProbeExecute {
  let asked = -1;
  return async () => {
    asked += 1;
    if (asked === 0) {
      return [{ rows: "0" }];
    }
    return [];
  };
}

/** A store that refuses every statement, standing in for a table that is not there. */
const brokenStore: AtlasProbeExecute = async () => {
  throw new Error('relation "atlas_entity" does not exist');
};

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("outsideLegs — a leg that could not be consulted returns a NOTE, never an error", () => {
  it("plans a wave with no leads at all rather than failing when every leg is unreachable", async () => {
    const legs = await outsideLegs({
      execute: brokenStore,
      home: emptyHome(),
      nowMs: Date.parse("2026-09-21T03:00:00.000Z"),
      terms: ["airtable"],
    });
    expect(legs.leads).toEqual([]);
    expect(legs.datadog.note).toContain("Datadog was not consulted");
    expect(legs.hex.note).toContain("Hex was not consulted");
    expect(legs.atlas.note).toContain("the atlases were not consulted");
  });

  it("names the store, not a platform, when the atlas tables hold no entity rows", async () => {
    const legs = await outsideLegs({
      execute: emptyStore(),
      home: emptyHome(),
      nowMs: Date.parse("2026-09-21T03:00:00.000Z"),
      terms: ["airtable"],
    });
    expect(legs.atlas.note).toContain("the store holds no atlas entity rows");
    expect(legs.atlas.note).toContain("slopweaver store import-atlas");
  });

  it("carries no census age when the census could not be read", async () => {
    const legs = await outsideLegs({
      execute: emptyStore(),
      home: emptyHome(),
      nowMs: Date.parse("2026-09-21T03:00:00.000Z"),
      terms: ["airtable"],
    });
    expect(legs.datadog.age).toBe(null);
  });

  it("finds an atlas lead and puts it in the one list planWave spends detectives from", async () => {
    const answers: Record<string, unknown>[][] = [
      [{ rows: "695759" }],
      [
        {
          byDetail: "0",
          byName: "162",
          entities: "162",
          kind: "vulnerability",
          lastAttemptOutcome: "ok",
          lastSuccessAt: "2026-09-19T17:40:04.640Z",
          platform: "vanta",
        },
      ],
      [],
    ];
    let asked = -1;
    const legs = await outsideLegs({
      execute: async () => {
        asked += 1;
        const answer = answers[asked];
        if (answer === undefined) {
          return [];
        }
        return answer;
      },
      home: emptyHome(),
      nowMs: Date.parse("2026-09-21T03:00:00.000Z"),
      terms: ["airtable"],
    });
    expect(legs.atlas.leads.length).toBe(1);
    expect(legs.atlas.leads[0]!.startShape).toBe("vanta");
    expect(legs.atlas.note).toBe(null);
    expect(legs.leads).toEqual(legs.atlas.leads);
  });
});
