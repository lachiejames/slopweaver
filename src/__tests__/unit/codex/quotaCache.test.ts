/**
 * {@link readCodexQuotaCache}/{@link writeCodexQuotaCache}/{@link codexQuotaCacheStanding}/
 * {@link listCodexQuotaCaches} — a genuine round-trip against a real temp `$SLOPWEAVER_HOME`, per
 * testing.md's fixture allowance.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  codexQuotaCacheStanding,
  listCodexQuotaCaches,
  readCodexQuotaCache,
  readCodexQuotaClearMark,
  writeCodexQuotaCache,
  writeCodexQuotaClearMark,
} from "../../../codex/quotaCache.js";
import type { CodexQuotaEvidence } from "../../../codex/quotaTypes.js";
import { stateHomePaths } from "../../../stateHome.js";

const ALIAS = "codex-one";
const OTHER = "codex-two";

const tempHomes: string[] = [];

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "quota-cache-test-"));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  tempHomes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("codex quota cache", () => {
  it("reads undefined when nothing has ever been written", () => {
    expect(readCodexQuotaCache({ alias: ALIAS, home: tempHome() })).toBeUndefined();
  });

  it("round-trips a credits-out record written and read back", () => {
    const home = tempHome();
    const evidence: CodexQuotaEvidence = { kind: "credits-out", observedAtIso: "2026-08-14T05:00:00.000Z" };

    expect(writeCodexQuotaCache({ alias: ALIAS, evidence, home })).toBe(true);

    expect(readCodexQuotaCache({ alias: ALIAS, home })).toEqual(evidence);
  });

  it("round-trips a weekly-limit record carrying a reset time", () => {
    const home = tempHome();
    const evidence: CodexQuotaEvidence = {
      kind: "window-limit",
      observedAtIso: "2026-08-14T05:00:00.000Z",
      resetAtIso: "2026-08-18T00:25:00.000Z",
    };

    writeCodexQuotaCache({ alias: ALIAS, evidence, home });

    expect(readCodexQuotaCache({ alias: ALIAS, home })).toEqual(evidence);
  });

  it("a later write overwrites the earlier record", () => {
    const home = tempHome();
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "credits-out", observedAtIso: "2026-08-14T00:00:00.000Z" },
      home,
    });
    const latest: CodexQuotaEvidence = { kind: "window-limit", observedAtIso: "2026-08-14T06:00:00.000Z" };

    writeCodexQuotaCache({ alias: ALIAS, evidence: latest, home });

    expect(readCodexQuotaCache({ alias: ALIAS, home })).toEqual(latest);
  });

  it("reads a record observed a millisecond before its mark as covered — and leaves it on disk", () => {
    const home = tempHome();
    const covered: CodexQuotaEvidence = { kind: "credits-out", observedAtIso: "2026-08-13T23:59:59.999Z" };
    writeCodexQuotaCache({ alias: ALIAS, evidence: covered, home });
    expect(codexQuotaCacheStanding({ alias: ALIAS, home })).toBe("standing");

    writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-08-14T00:00:00.000Z", home });

    expect(codexQuotaCacheStanding({ alias: ALIAS, home })).toBe("covered");
    expect(readCodexQuotaCache({ alias: ALIAS, home })).toEqual(covered);
    expect(listCodexQuotaCaches({ home })).toEqual([]);
  });

  it("reads a record observed in the mark's own millisecond as standing — a tie keeps refusing", () => {
    const home = tempHome();
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "credits-out", observedAtIso: "2026-08-14T00:00:00.000Z" },
      home,
    });
    writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-08-14T00:00:00.000Z", home });

    expect(codexQuotaCacheStanding({ alias: ALIAS, home })).toBe("standing");
    expect(listCodexQuotaCaches({ home })).toEqual([ALIAS]);
  });

  it("never overwrites a cached cap with a mark, even with `cleared` linked to the quota root itself", () => {
    const home = tempHome();
    const later: CodexQuotaEvidence = { kind: "usage-limit", observedAtIso: "2999-01-01T00:00:00.000Z" };
    writeCodexQuotaCache({ alias: ALIAS, evidence: later, home });
    symlinkSync(".", join(stateHomePaths({ home }).codexQuotaDir, "cleared"));

    writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-08-14T00:00:00.000Z", home });

    expect(readCodexQuotaCache({ alias: ALIAS, home })).toEqual(later);
    expect(readCodexQuotaClearMark({ alias: ALIAS, home })).toBe("2026-08-14T00:00:00.000Z");
    expect(codexQuotaCacheStanding({ alias: ALIAS, home })).toBe("standing");
    expect(listCodexQuotaCaches({ home })).toEqual([ALIAS]);
  });

  it("reads a record observed after the mark as standing, so a cap cached after the clear still refuses", () => {
    const home = tempHome();
    writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-08-14T00:00:00.000Z", home });
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "usage-limit", observedAtIso: "2026-08-14T00:00:00.001Z" },
      home,
    });

    expect(codexQuotaCacheStanding({ alias: ALIAS, home })).toBe("standing");
    expect(listCodexQuotaCaches({ home })).toEqual([ALIAS]);
  });

  it("reads absent when no record was ever written", () => {
    expect(codexQuotaCacheStanding({ alias: ALIAS, home: tempHome() })).toBe("absent");
  });

  it("reads undefined for a malformed cache file rather than throwing", () => {
    const home = tempHome();
    const dir = stateHomePaths({ home }).codexQuotaDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${ALIAS}.json`), "{}\n", "utf8");

    expect(readCodexQuotaCache({ alias: ALIAS, home })).toBeUndefined();
  });

  it("keeps one destination's cap out of another's record", () => {
    const home = tempHome();
    const capped: CodexQuotaEvidence = { kind: "credits-out", observedAtIso: "2026-08-14T05:00:00.000Z" };

    writeCodexQuotaCache({ alias: ALIAS, evidence: capped, home });

    expect(readCodexQuotaCache({ alias: OTHER, home })).toBeUndefined();
    expect(readCodexQuotaCache({ alias: ALIAS, home })).toEqual(capped);
  });

  it("clearing one destination leaves the other's cap standing", () => {
    const home = tempHome();
    const other: CodexQuotaEvidence = { kind: "window-limit", observedAtIso: "2026-08-14T06:00:00.000Z" };
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "credits-out", observedAtIso: "2026-08-14T05:00:00.000Z" },
      home,
    });
    writeCodexQuotaCache({ alias: OTHER, evidence: other, home });

    writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-08-14T07:00:00.000Z", home });

    expect(codexQuotaCacheStanding({ alias: ALIAS, home })).toBe("covered");
    expect(codexQuotaCacheStanding({ alias: OTHER, home })).toBe("standing");
    expect(listCodexQuotaCaches({ home })).toEqual([OTHER]);
  });

  it("refuses to write or read under an alias no register would accept", () => {
    const home = tempHome();
    const traversal = "../escaped";

    expect(
      writeCodexQuotaCache({
        alias: traversal,
        evidence: { kind: "credits-out", observedAtIso: "2026-08-14T05:00:00.000Z" },
        home,
      }),
    ).toBe(false);
    expect(readCodexQuotaCache({ alias: traversal, home })).toBeUndefined();
    expect(codexQuotaCacheStanding({ alias: traversal, home })).toBe("absent");
    expect(listCodexQuotaCaches({ home })).toEqual([]);
  });

  it("lists every alias holding a record, sorted, and nothing when none does", () => {
    const home = tempHome();
    expect(listCodexQuotaCaches({ home })).toEqual([]);

    writeCodexQuotaCache({
      alias: OTHER,
      evidence: { kind: "credits-out", observedAtIso: "2026-08-14T05:00:00.000Z" },
      home,
    });
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "window-limit", observedAtIso: "2026-08-14T06:00:00.000Z" },
      home,
    });

    expect(listCodexQuotaCaches({ home })).toEqual([ALIAS, OTHER]);
  });

  it("lists a de-registered destination's leftover record, because only a listing can find it", () => {
    const home = tempHome();
    const dir = stateHomePaths({ home }).codexQuotaDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "codex-retired.json"), JSON.stringify({ kind: "credits-out", observedAtIso: "x" }), "utf8");
    writeFileSync(join(dir, "notes.txt"), "not a record", "utf8");

    expect(listCodexQuotaCaches({ home })).toEqual(["codex-retired"]);
  });
});

describe("codex quota clear mark", () => {
  it("reads undefined when no clear was ever recorded", () => {
    expect(readCodexQuotaClearMark({ alias: ALIAS, home: tempHome() })).toBeUndefined();
  });

  it("round-trips a mark, and a later write replaces the earlier one", () => {
    const home = tempHome();
    expect(writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-09-14T09:00:00.000Z", home })).toBe(true);
    expect(readCodexQuotaClearMark({ alias: ALIAS, home })).toBe("2026-09-14T09:00:00.000Z");

    writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-09-15T09:00:00.000Z", home });

    expect(readCodexQuotaClearMark({ alias: ALIAS, home })).toBe("2026-09-15T09:00:00.000Z");
  });

  it("returns an unparseable instant unchanged, for the pure filter to refuse", () => {
    const home = tempHome();
    writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "not-an-instant", home });

    expect(readCodexQuotaClearMark({ alias: ALIAS, home })).toBe("not-an-instant");
  });

  it("reads undefined for a malformed mark rather than throwing", () => {
    const home = tempHome();
    const dir = join(stateHomePaths({ home }).codexQuotaDir, "cleared");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${ALIAS}.json`), '{"clearedAtIso":7}\n', "utf8");

    expect(readCodexQuotaClearMark({ alias: ALIAS, home })).toBeUndefined();
  });

  it("keeps one destination's mark out of another's", () => {
    const home = tempHome();
    writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-09-14T09:00:00.000Z", home });

    expect(readCodexQuotaClearMark({ alias: OTHER, home })).toBeUndefined();
  });

  it("refuses to write or read a mark under an alias no register would accept", () => {
    const home = tempHome();

    expect(writeCodexQuotaClearMark({ alias: "../escaped", clearedAtIso: "2026-09-14T09:00:00.000Z", home })).toBe(
      false,
    );
    expect(readCodexQuotaClearMark({ alias: "../escaped", home })).toBeUndefined();
  });

  it("is never listed as an alias holding a cap", () => {
    const home = tempHome();
    writeCodexQuotaClearMark({ alias: OTHER, clearedAtIso: "2026-09-14T09:00:00.000Z", home });
    expect(listCodexQuotaCaches({ home })).toEqual([]);

    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "credits-out", observedAtIso: "2026-08-14T05:00:00.000Z" },
      home,
    });

    expect(listCodexQuotaCaches({ home })).toEqual([ALIAS]);
  });
});
