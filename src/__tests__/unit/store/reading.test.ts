/**
 * Observing the store without one: the two readings a brief gets before any socket opens.
 *
 * An unselected store refuses at the selection, and a malformed selected URL throws inside `postgres()`'s
 * own synchronous parse — before a connection is ever attempted — so both run with no database and no
 * network. A reachable store is the integration lane's.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StoreErrors } from "../../../store/errors.js";
import { observeStore, STORE_OBSERVATION_BUDGET_MS } from "../../../store/reading.js";

/** A local URL whose password is not valid percent-encoding, which `postgres()` refuses as it parses. */
const MALFORMED_URL = "postgresql://u:%ZZ@localhost:5999/db";

const ENV_NAMES = ["SLOPWEAVER_STORE_URL"] as const;

describe("observeStore", () => {
  let home = "";
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "store-reading-"));
    for (const name of ENV_NAMES) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = saved.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a home with no selection as unselected, carrying the selection's own refusal", async () => {
    const reading = await observeStore({ home });

    const because = StoreErrors.urlMissing({ envVar: "SLOPWEAVER_STORE_URL", secretName: "store-url" }).message;
    expect(reading).toEqual({ because, kind: "unselected" });
    expect(because).toContain("refusing to reach the store: no database is selected");
  });

  it("reads a malformed remembered selection as unreachable within the budget it was given", async () => {
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "secrets", "store-url"), `${MALFORMED_URL}\n`, { mode: 0o600 });

    const reading = await observeStore({ budgetMs: 1500, home });

    expect(reading).toEqual({
      because: "the selected store could not be reached within 1500 ms — URI malformed",
      kind: "unreachable",
    });
  });

  it("reads a malformed environment selection the same way, at the default budget", async () => {
    process.env["SLOPWEAVER_STORE_URL"] = MALFORMED_URL;

    const reading = await observeStore({ home });

    expect(reading).toEqual({
      because: "the selected store could not be reached within 2000 ms — URI malformed",
      kind: "unreachable",
    });
  });

  it("exports an observation budget of 2000 ms", () => {
    expect(STORE_OBSERVATION_BUDGET_MS).toBe(2000);
  });
});
