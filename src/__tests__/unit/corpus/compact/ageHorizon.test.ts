/*
 * `compactSource` under an age horizon: `--older-than` is the one lossy mode, dropping only what is past it, and with
 * no horizon nothing is pruned however old it is.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compactSource } from "../../../../corpus/compact.js";
import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { unwrap } from "../../../../lib/result.js";
import { NO_PROTECTION } from "../../../noProtection.js";
import { canonical, home, jsonl, record, useCompactHome, writeWindow } from "./harness.js";

useCompactHome();

describe("compactSource", () => {
  it("drops ONLY past-horizon records under --older-than, keeping everything on or after it", () => {
    writeWindow({
      name: "a.jsonl",
      records: [
        record({ sourceId: "#old", tsIso: "2026-01-01T00:00:00.000Z" }),
        record({ sourceId: "#edge", tsIso: "2026-06-01T00:00:00.000Z" }),
        record({ sourceId: "#new", tsIso: "2026-07-01T00:00:00.000Z" }),
      ],
    });

    const plan = unwrap(
      compactSource({ home, olderThanIso: "2026-06-01T00:00:00.000Z", protection: NO_PROTECTION, source: "github" }),
    );

    expect(plan.pruned).toBe(1);
    expect(plan.after.records).toBe(2);
    expect(canonical()).toBe(
      jsonl({
        records: [
          record({ sourceId: "#edge", tsIso: "2026-06-01T00:00:00.000Z" }),
          record({ sourceId: "#new", tsIso: "2026-07-01T00:00:00.000Z" }),
        ],
      }),
    );
  });

  it("prunes nothing by default — the same corpus with no horizon keeps every record", () => {
    writeWindow({ name: "a.jsonl", records: [record({ sourceId: "#ancient", tsIso: "2019-01-01T00:00:00.000Z" })] });

    const plan = unwrap(compactSource({ home, protection: NO_PROTECTION, source: "github" }));

    expect(plan.pruned).toBe(0);
    expect(plan.after.records).toBe(1);
  });

  it("leaves NO canonical file behind when the horizon prunes everything", () => {
    writeWindow({ name: "a.jsonl", records: [record({ tsIso: "2019-01-01T00:00:00.000Z" })] });

    const plan = unwrap(
      compactSource({ home, olderThanIso: "2026-06-01T00:00:00.000Z", protection: NO_PROTECTION, source: "github" }),
    );

    expect(plan.after.records).toBe(0);
    expect(plan.after.files).toBe(0);
    expect(plan.after.bytes).toBe(0);
    expect(readdirSync(bronzeSourceDir({ home, source: "github" }))).toStrictEqual([]);
  });

  it("keeps a record whose duplicate is IN-horizon, even when the FIRST copy is past it", () => {
    // The fingerprint is tsIso-blind, so a stale copy and a fresh re-capture of the same content share a
    // dedup key. Collapsing first would keep the OLD row and then prune it away.
    writeWindow({ name: "a-old.jsonl", records: [record({ tsIso: "2026-01-01T00:00:00.000Z" })] });
    writeWindow({ name: "b-new.jsonl", records: [record({ tsIso: "2026-07-01T00:00:00.000Z" })] });

    const plan = unwrap(
      compactSource({ home, olderThanIso: "2026-06-01T00:00:00.000Z", protection: NO_PROTECTION, source: "github" }),
    );

    expect(plan.after.records).toBe(1);
    expect(plan.pruned).toBe(1);
    expect(plan.duplicatesCollapsed).toBe(0);
    expect(canonical()).toBe(jsonl({ records: [record({ tsIso: "2026-07-01T00:00:00.000Z" })] }));
  });
});
