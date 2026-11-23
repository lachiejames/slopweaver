/**
 * {@link readFrictionReviewPublishStamp}/{@link writeFrictionReviewPublishStamp} — a genuine round-trip
 * against a real temp `$SLOPWEAVER_HOME`, per testing.md's fixture allowance.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishedReportDate,
  readFrictionReviewPublishStamp,
  writeFrictionReviewPublishStamp,
} from "../../../reflect/frictionReviewPublish.js";
import { stateHomePaths } from "../../../stateHome.js";

const tempHomes: string[] = [];

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "friction-review-publish-test-"));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  tempHomes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("friction review publish stamp", () => {
  it("reads undefined when nothing has ever been written", () => {
    expect(readFrictionReviewPublishStamp({ home: tempHome() })).toBeUndefined();
  });

  it("round-trips a stamp written and read back", () => {
    const home = tempHome();
    const stamp = { localDate: "2026-09-02", publishedAtIso: "2026-09-02T21:10:00.000Z" };

    writeFrictionReviewPublishStamp({ home, stamp });

    expect(readFrictionReviewPublishStamp({ home })).toEqual(stamp);
  });

  it("a later write overwrites the earlier stamp", () => {
    const home = tempHome();
    writeFrictionReviewPublishStamp({
      home,
      stamp: { localDate: "2026-09-01", publishedAtIso: "2026-09-01T21:00:00.000Z" },
    });
    const latest = { localDate: "2026-09-02", publishedAtIso: "2026-09-02T21:10:00.000Z" };

    writeFrictionReviewPublishStamp({ home, stamp: latest });

    expect(readFrictionReviewPublishStamp({ home })).toEqual(latest);
  });

  it("reads undefined for a malformed stamp file rather than throwing", () => {
    const home = tempHome();
    const path = stateHomePaths({ home }).live.frictionReview.publishedJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}\n", "utf8");

    expect(readFrictionReviewPublishStamp({ home })).toBeUndefined();
  });
});

describe("publishedReportDate", () => {
  it("is null when the artifact was never republished", () => {
    expect(publishedReportDate({ home: tempHome() })).toBeNull();
  });

  it("is the report date the last republish carried", () => {
    const home = tempHome();
    writeFrictionReviewPublishStamp({
      home,
      stamp: { localDate: "2026-09-02", publishedAtIso: "2026-09-02T21:10:00.000Z" },
    });

    expect(publishedReportDate({ home })).toBe("2026-09-02");
  });
});
