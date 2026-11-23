/*
 * The order the voice raises cards in should match the Queue's, which
 * should match the alignment order. The page, the voice and its triage pass are held to that order over this call's card
 * set by `site/__tests__/unit/queueOrderReplay.test.ts`; this is the board's reconcile over the SAME fixture, held to
 * the same ruled head. It lives here because `rank.ts` reaches the whole board graph, which the site's build would
 * type-check if a site test imported it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { boardQueueFacts } from "../../../handover/queueFacts.js";
import { type BoardRow, rankRows } from "../../../handover/rank.js";

const FIXTURE = fileURLToPath(new URL("../../fixtures/queue-order/call-d730d95c.json", import.meta.url));

/** The call's card set, as the fixture holds it. */
const CALL = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  readonly priorities: readonly string[];
  readonly rows: readonly {
    readonly blockedBy: readonly string[];
    readonly slug: string;
    readonly tags: readonly (readonly [string, string])[];
  }[];
  readonly ruled: readonly string[];
};

/**
 * The board's reconcile over the call's rows: each row's fact from its own tags, ranked with the owner's priorities in order.
 *
 * @returns the ranked slugs
 */
function reconcileOrder(): readonly string[] {
  const models = CALL.rows.map((row) => ({
    doc: { blockedBy: row.blockedBy, slug: row.slug },
    section: "WAITING ON OWNER" as const,
    tags: {
      tags: row.tags.map(([key, value]) => ({ key, source: "declared" as const, value })),
      unrecognised: [],
    },
    tagsIncomplete: false,
  }));
  const rows = CALL.rows.map((row): BoardRow => ({
    groomed: true,
    id: row.slug,
    kind: "ask",
    label: row.slug,
    openedIso: "2026-10-19T08:00:00.000Z",
    priority: "p1",
    ready: true,
    ruled: false,
    standing: "ready",
    waitingHours: 14,
  }));
  return rankRows({
    facts: boardQueueFacts({ deferred: new Set(), models, priorities: CALL.priorities }),
    rows,
  }).map((row) => row.id);
}

describe("one ranking: the board's reconcile leads with the order the Queue shows (P0)", () => {
  it("ranks the call's cards with the owner's ruled head, the order the site replay holds the page to", () => {
    expect(CALL.ruled.length).toBe(6);
    expect(reconcileOrder().slice(0, CALL.ruled.length)).toEqual(CALL.ruled);
  });
});
