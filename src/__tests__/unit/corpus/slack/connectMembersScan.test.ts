/**
 * `harvestConnectMembers` over a real temp home: Slack bronze the owner's protect list refuses is never read, and
 * the refusal comes back as one, never as an empty harvest that reads as "nobody to recover".
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { harvestConnectMembers } from "../../../../corpus/slack/connectMembersScan.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const FETCHED = "2026-10-01T00:00:00.000Z";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connect-members-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("harvestConnectMembers", () => {
  it("harvests nothing from a home Slack was never ingested into", () => {
    expect(unwrap(harvestConnectMembers({ fetchedAtIso: FETCHED, home, protection: () => ok([]) }))).toEqual([]);
  });

  it("refuses Slack bronze the protect list marks no-access, rather than harvesting it as empty", () => {
    const dir = bronzeSourceDir({ home, source: "slack" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-10-01_2026-10-02.jsonl"), '{"sourceId":"C1:1.0"}\n', "utf8");
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: dir, why: "fixture" };

    const refusal = unwrapErr(harvestConnectMembers({ fetchedAtIso: FETCHED, home, protection: () => ok([entry]) }));

    expect(refusal).toEqual([
      `refusing to read slack: it would search ${dir}, which the owner's protect list marks no-access at ${dir} (fixture)`,
    ]);
  });
});
