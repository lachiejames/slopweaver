/**
 * The fleet-ceiling card is placed once per day even when the doc claiming its slug sits under ANOTHER filename,
 * live or archived — the case an exact-path read misses and an untagged `handover register` would re-place.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { slugClaimant } from "../../../../../cli/commands/automation/fleetCeilingDelivery.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SLUG = "fleet-ceiling-2026-10-05";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fc-claimant-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** One minimal doc claiming `slug`, written under `name` in `under`. */
function seed({ under, name, slug }: { under: string; name: string; slug: string }): void {
  mkdirSync(under, { recursive: true });
  writeFileSync(join(under, name), `---\nslug: ${slug}\nstatus: ready\n---\n`, "utf8");
}

describe("slugClaimant", () => {
  it("finds an archived card filed under another name, and calls it settled", () => {
    seed({ name: "renamed.md", slug: SLUG, under: join(dir, "archive") });

    expect(unwrap(slugClaimant({ handoverDir: dir, slug: SLUG }))).toBe("settled");
  });

  it("finds a live card filed under another name, and calls it still standing", () => {
    seed({ name: "renamed.md", slug: SLUG, under: dir });

    expect(unwrap(slugClaimant({ handoverDir: dir, slug: SLUG }))).toBe("existing");
  });

  it("answers nothing when only other slugs stand, live or archived", () => {
    seed({ name: "other.md", slug: "fleet-ceiling-2026-10-04", under: dir });
    seed({ name: "older.md", slug: "fleet-ceiling-2026-10-03", under: join(dir, "archive") });

    expect(unwrap(slugClaimant({ handoverDir: dir, slug: SLUG }))).toBeUndefined();
  });

  it("answers nothing over a home with no handovers yet", () => {
    expect(unwrap(slugClaimant({ handoverDir: join(dir, "absent"), slug: SLUG }))).toBeUndefined();
  });

  it("refuses when a doc will not read, since absence is then unprovable", () => {
    mkdirSync(join(dir, "archive", "a-directory.md"), { recursive: true });

    const claimed = slugClaimant({ handoverDir: dir, slug: SLUG });

    const error = unwrapErr(claimed);
    expect(error.code).toBe("CARD_FAILED");
    expect(error.message).toContain("would not read, so no claimant is provable");
  });
});
