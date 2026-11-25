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

  it("resolves the Fleet page's session watch row to the self-recording report drain it re-reads", () => {
    expect(syncVerbFor({ slug: "session-watch" })).toStrictEqual({
      argv: ["session", "watch", "--json-report", "--record-reading", "sync-now"],
      readsSlug: "watch-reading",
      slug: "session-watch",
      timeoutMs: 60_000,
      title: "slopweaver session watch --json-report --record-reading sync-now",
    });
  });

  it("resolves the Fleet page's burn row to the self-recording --json scan it re-reads", () => {
    expect(syncVerbFor({ slug: "fleet-burn" })).toStrictEqual({
      argv: ["fleet", "burn", "--json", "--record-reading", "sync-now"],
      readsSlug: "burn-reading",
      slug: "fleet-burn",
      timeoutMs: 20_000,
      title: "slopweaver fleet burn --json --record-reading sync-now",
    });
  });

  it("holds exactly the landing, currency, session watch and burn rows, and nothing for an unknown slug", () => {
    expect(SYNC_VERBS.map((row) => row.slug)).toStrictEqual(["landing", "currency", "session-watch", "fleet-burn"]);
    expect(syncVerbFor({ slug: "handover currency --press" })).toBe(undefined);
  });

  it("never offers machine capacity, whose plan-ceiling read spends a token at Anthropic", () => {
    expect(SYNC_VERBS.length).toBeGreaterThan(0);
    expect(SYNC_VERBS.filter((row) => row.argv.includes("capacity") || row.argv.includes("machine"))).toEqual([]);
  });

  it("carries no flag that acts on the world on any row", () => {
    expect(SYNC_VERBS.length).toBeGreaterThan(0);
    expect(SYNC_VERBS.filter((row) => row.argv.some((arg) => arg === "--press" || arg === "--register"))).toEqual([]);
  });
});
