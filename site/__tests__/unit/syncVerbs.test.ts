/*
 * The closed list of readings the console may take: each row's argv is a literal, so no request input can become
 * argv, and the currency row runs exactly the self-recording verb the Queue re-reads.
 */
import { describe, expect, it } from "vitest";

import { SYNC_VERBS, syncVerbFor } from "../../lib/syncVerbs";

describe("syncVerbFor", () => {
  it("resolves the currency row to its literal argv, title, budget and re-read channel", () => {
    expect(syncVerbFor({ slug: "currency" })).toStrictEqual({
      argv: ["handover", "currency", "--json", "--record-reading", "sync-now"],
      readsSlug: "currency-reading",
      slug: "currency",
      timeoutMs: 120_000,
      title: "slopweaver handover currency --json --record-reading sync-now",
    });
  });

  it("reads the landing row WITH drafts, the one reading the Pull requests badge can count from", () => {
    const landing = syncVerbFor({ slug: "landing" })!;
    expect([landing.argv, landing.title, landing.readsSlug]).toStrictEqual([
      ["github", "landing", "--author", "@me", "--json", "--include-drafts", "--record-reading", "sync-now"],
      "slopweaver github landing --author @me --json --include-drafts --record-reading sync-now",
      "landing-reading",
    ]);
  });

  it("holds exactly the landing and currency rows, and nothing for an unknown slug", () => {
    expect(SYNC_VERBS.map((row) => row.slug)).toStrictEqual(["landing", "currency"]);
    expect(syncVerbFor({ slug: "handover currency --press" })).toBe(undefined);
  });

  it("carries no flag that acts on the world on any row", () => {
    expect(SYNC_VERBS.length).toBeGreaterThan(0);
    expect(SYNC_VERBS.filter((row) => row.argv.some((arg) => arg === "--press" || arg === "--register"))).toEqual([]);
  });
});
