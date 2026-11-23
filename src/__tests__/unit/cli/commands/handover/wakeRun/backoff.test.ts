/**
 * `handover wake` under the spawn backoff: a deferred `cmux spawn` reads as NOT YET, keeps every due park, and
 * exits 4 whatever an earlier reseat in the same run did.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXIT_DEFERRED, EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { PAST, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

describe("runHandoverWake", () => {
  beforeEach(() => {
    mintWakeHome();
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("reads a backoff deferral as not yet: keeps every due park, spawns nothing more and exits 4", async () => {
    const slugs = ["held1", "held2", "held3"];
    slugs.forEach((slug) => {
      parkedRow({ slug, wake: { atIso: PAST, kind: "at" } });
    });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ exitCode: EXIT_DEFERRED, recorded }), recorded });
    expect([code, report.attempted, report.spawned, recorded.spawned]).toEqual([EXIT_DEFERRED, 1, 0, ["held1"]]);
    expect(report.rows.map((row) => [row.action, row.detail])).toEqual([
      ["spawn-deferred", "the spawn backoff deferred cmux spawn with exit 4; still parked"],
      ["due-deferred", "the spawn backoff deferred an earlier reseat this run"],
      ["due-deferred", "the spawn backoff deferred an earlier reseat this run"],
    ]);
    expect(slugs.map((slug) => stillParked({ slug }))).toEqual([true, true, true]);
  });

  it("still exits 4 when an earlier reseat came up before the backoff deferred a later one", async () => {
    parkedRow({ slug: "first", wake: { atIso: PAST, kind: "at" } });
    parkedRow({ slug: "second", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const deps = fakes({ exitCodes: [0, EXIT_DEFERRED], recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    expect([code, report.spawned, report.rows.map((row) => row.action)]).toEqual([
      EXIT_DEFERRED,
      1,
      ["spawned", "spawn-deferred"],
    ]);
    expect([stillParked({ slug: "first" }), stillParked({ slug: "second" })]).toEqual([false, true]);
  });

  it("exits 4 over an earlier failed reseat when the backoff deferred a later one, and still reports the failure", async () => {
    parkedRow({ slug: "first", wake: { atIso: PAST, kind: "at" } });
    parkedRow({ slug: "second", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const deps = fakes({ exitCodes: [EXIT_ERROR, EXIT_DEFERRED], recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    expect([code, report.spawned, report.rows.map((row) => row.action)]).toEqual([
      EXIT_DEFERRED,
      0,
      ["spawn-failed", "spawn-deferred"],
    ]);
    expect([stillParked({ slug: "first" }), stillParked({ slug: "second" })]).toEqual([true, true]);
  });
});
