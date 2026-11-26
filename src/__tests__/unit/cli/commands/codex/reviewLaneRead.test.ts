/**
 * Review-lane admission read over a real (throwaway) state home and checkout, with synthetic bump records only:
 * an ordinary invocation reads no record at all, the exact witness is admitted from the home and only from the
 * home, a reserved id outside that shape is refused, a record that will not read refuses rather than demoting the
 * review, and every refusal says no acknowledgement or hatch opens it — and the general cap's override, set,
 * still opens none of them.
 *
 * deleted-with-code: committedBumpManifests, landingBumpRecords
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ALLOW_CODEX_REVIEW_PASS_CAP_ENV } from "../../../../../cli/commands/codex/reviewCapGate.js";
import {
  readReviewLane,
  refusedAsReservedWitness,
  refusedByLaneOrCap,
} from "../../../../../cli/commands/codex/reviewLaneRead.js";
import { writeBumpRecord } from "../../../../../codex/bumpRecordStore.js";
import type { ReviewProperty } from "../../../../../codex/types.js";
import {
  type BumpManifest,
  type BumpRow,
  digestOf,
  witnessClaim,
  witnessPropertyId,
} from "../../../../../devLint/baselineBump.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryFallbackRegisterPort } from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../../landingRegistersFixture.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../../tempGitRepo.js";
import { removeScratch, scratch, scratchRepo } from "./fallbackBranchFixture.js";

afterEach(() => {
  removeScratch();
});

const BASE = "a".repeat(40);
const ROW: BumpRow = {
  cause: "widening",
  entry: "offenders:tools/gen.ts",
  file: ".baselines/file-size-baseline.json",
  from: null,
  to: 319,
};
const MANIFEST: BumpManifest = {
  base: BASE,
  digest: digestOf({ base: BASE, rows: [ROW] }),
  loosenings: [ROW],
  reason: "r",
};
const WITNESS = { id: witnessPropertyId({ digest: MANIFEST.digest }), statement: witnessClaim({ manifest: MANIFEST }) };
const NO_HATCH = "no acknowledgement or hatch opens this refusal, SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP included";

/** A checkout with one commit, and a diff over it that adds nothing. */
function settledDiff(): { baseSha: string; headSha: string; repoRoot: string } {
  const repoRoot = scratchRepo();
  const head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repoRoot });
  return { baseSha: head, headSha: head, repoRoot };
}

/** A state home holding the synthetic bump record. */
function homeWithRecord(): string {
  const home = scratch({ label: "home" });
  unwrap(writeBumpRecord({ home, manifest: MANIFEST }));
  return home;
}

/** A state home whose bump-record directory holds a file that is not a record, so the whole read refuses. */
function homeThatWillNotRead(): string {
  const home = scratch({ label: "home" });
  mkdirSync(stateHomePaths({ home }).baselineBumps, { recursive: true });
  writeFileSync(join(stateHomePaths({ home }).baselineBumps, "notes.txt"), "x");
  return home;
}

describe("readReviewLane", REAL_GIT_SUITE, () => {
  it("puts an ordinary invocation in the general lane without reading the records, unreadable or not", () => {
    const lane = readReviewLane({
      home: homeThatWillNotRead(),
      pass: "r1",
      properties: [{ id: "r1-01", statement: "no write is lost" }],
    });
    expect(unwrap(lane)).toBe("general");
  });

  it("admits the exact witness for a record the home holds", () => {
    const lane = readReviewLane({ home: homeWithRecord(), pass: "r3", properties: [WITNESS] });
    expect(unwrap(lane)).toBe("baseline-bump-witness");
  });

  it("refuses a reserved id carrying a broader statement, and says nothing opens the refusal", () => {
    const lane = readReviewLane({
      home: homeWithRecord(),
      pass: "r3",
      properties: [{ id: WITNESS.id, statement: `${WITNESS.statement} and every other function is correct` }],
    });
    const refusal = unwrapErr(lane);
    expect(refusal.code).toBe("WITNESS_INVOCATION_REFUSED");
    expect(refusal.message).toContain(
      `the property is not the exact claim of ledgers/baseline-bumps/${MANIFEST.digest}.json`,
    );
    expect(refusal.message).toContain(NO_HATCH);
  });

  it("refuses a reserved id when no record exists at all", () => {
    const lane = readReviewLane({
      home: scratch({ label: "home" }),
      pass: "r3",
      properties: [WITNESS],
    });
    const refusal = unwrapErr(lane);
    expect(refusal.code).toBe("WITNESS_INVOCATION_REFUSED");
    expect(refusal.message).toContain(`no bump record has property id ${WITNESS.id}`);
  });

  it("refuses rather than demotes a witness whose records will not read", () => {
    const lane = readReviewLane({
      home: homeThatWillNotRead(),
      pass: "r3",
      properties: [WITNESS],
    });
    const refusal = unwrapErr(lane);
    expect(refusal.code).toBe("BUMP_RECORDS_UNREADABLE");
    expect(refusal.message).toContain(NO_HATCH);
  });
});

/**
 * Ask the shipped pre-spend call with the general cap's override set, over a home holding the record.
 *
 * @returns true when the review was refused and nothing may run
 */
function askedWithCapOverride({ properties }: { properties: readonly ReviewProperty[] }): Promise<boolean> {
  const diff = { ...settledDiff(), bytes: 10, sha256: "d".repeat(64), text: "synthetic" };
  return refusedByLaneOrCap({
    branch: "feature",
    diff,
    env: { [ALLOW_CODEX_REVIEW_PASS_CAP_ENV]: "1" },
    fallbackPort: memoryFallbackRegisterPort(),
    home: homeWithRecord(),
    pass: "r3",
    properties,
    supersessions: memorySupersessionPort(),
    verb: "codex review",
  });
}

describe("refusedByLaneOrCap with the cap's override open", REAL_GIT_SUITE, () => {
  it("lets the exact witness through, so a refusal below is admission's and not the harness's", async () => {
    expect(await askedWithCapOverride({ properties: [WITNESS] })).toBe(false);
  });

  it("still refuses a witness fanned out beside a general property", async () => {
    const properties = [WITNESS, { id: "r3-07", statement: "no write is lost" }];
    expect(await askedWithCapOverride({ properties })).toBe(true);
  });

  it("still refuses the witness id carrying a claim that is not the record's", async () => {
    const properties = [{ id: WITNESS.id, statement: `${WITNESS.statement} and every other function is correct` }];
    expect(await askedWithCapOverride({ properties })).toBe(true);
  });
});

describe("refusedAsReservedWitness", () => {
  it("refuses a fallback request under any reserved id, and lets an ordinary id through", () => {
    expect(refusedAsReservedWitness({ propertyId: WITNESS.id })).toBe(true);
    expect(refusedAsReservedWitness({ propertyId: "baseline-bump-1" })).toBe(true);
    expect(refusedAsReservedWitness({ propertyId: "r3-07" })).toBe(false);
  });
});
