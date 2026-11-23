/**
 * A retry of a fleet-ceiling slot whose reading no longer earns a card withdraws the card an earlier attempt left
 * open under the same slug — found by `openCardAt`, over a real handovers directory in a throwaway root (a broken
 * retry otherwise left that card asking the owner).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openCardAt } from "../../../../../cli/commands/automation/fleetCeilingDelivery.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SLUG = "fleet-ceiling-2026-01-06";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fc-open-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** One minimal doc claiming `slug`, written as `<slug>.md` in `under`. */
function seed({ under, slug }: { under: string; slug: string }): void {
  mkdirSync(under, { recursive: true });
  writeFileSync(join(under, `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n`, "utf8");
}

describe("openCardAt", () => {
  it("finds the card an earlier attempt left open under today's slug", () => {
    seed({ slug: SLUG, under: dir });

    expect(unwrap(openCardAt({ handoverDir: dir, slug: SLUG }))).toBe(true);
  });

  it("leaves an archived card alone — the owner already settled it", () => {
    seed({ slug: SLUG, under: join(dir, "archive") });

    expect(unwrap(openCardAt({ handoverDir: dir, slug: SLUG }))).toBe(false);
  });

  it("finds nothing when only yesterday's card stands", () => {
    seed({ slug: "fleet-ceiling-2026-01-05", under: dir });

    expect(unwrap(openCardAt({ handoverDir: dir, slug: SLUG }))).toBe(false);
  });

  it("finds nothing over a home with no handovers yet", () => {
    expect(unwrap(openCardAt({ handoverDir: join(dir, "absent"), slug: SLUG }))).toBe(false);
  });

  it("fails naming the slug when the doc at today's path will not read", () => {
    mkdirSync(join(dir, `${SLUG}.md`), { recursive: true });

    const error = unwrapErr(openCardAt({ handoverDir: dir, slug: SLUG }));
    expect(error.code).toBe("CARD_NOT_WITHDRAWN");
    expect(error.slug).toBe(SLUG);
    expect(error.message).toContain(
      `the Queue card ${SLUG} an earlier attempt left may still be open, NOT withdrawn: `,
    );
  });
});
