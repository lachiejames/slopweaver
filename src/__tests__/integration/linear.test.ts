/**
 * INTEGRATION test: the Linear OUTBOUND ingest seam against the REAL Linear GraphQL API, recorded + replayed
 * via a Polly cassette (see `setup-polly.ts` + `cassetteRedact.ts`). No gateway: `@linear/sdk` v88 issues its
 * GraphQL over the undici global `fetch`, which Polly's fetch adapter intercepts in-process. Every operation
 * POSTs to the SAME `/graphql` path, so the setup matches by a NORMALISED request body.
 *
 * The `maxItems` fetch cap bounds the recording; a pass-through rate scheduler drops the 0.5 req/s pacer on
 * replay (the real `rawRequest` transport is intact). Recorded against a REAL workspace, so EVERY assertion is
 * STRUCTURAL — never content, which the allowlist redactor blanks (titles → `[REDACTED]`, ids → `id_N`,
 * url paths blanked). Run:
 *   yarn test:integration                                                            # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… SLOPWEAVER_RECORD_LINEAR_TOKEN=… yarn test:integration   # (re)record
 */
import { describe, expect, it } from "vitest";
import { fetchLinearActivity, makeLinearApi } from "../../corpus/linear/fetch.js";
import { makeLinearTransport } from "../../corpus/linear/transport.js";
import { unwrap } from "../../lib/result.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function linearToken(): string {
  if (!RECORD) {
    return "dummy-replay-token-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_LINEAR_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_LINEAR_TOKEN to record the Linear cassette");
  }
  return token;
}

const WINDOW = { since: "2020-01-01", until: "2030-01-01" };
const MAX_ITEMS = 5;

describe("linear outbound (integration — real Linear via Polly cassette)", () => {
  it("fetches a capped set of issues + projects via GraphQL and shapes them for projection", async () => {
    // The shared transport, built directly (not via the process-wide cache) so this test owns its own
    // accounting, with the 0.5 req/s pacer dropped on replay. The real `rawRequest` transport is intact.
    const transport = makeLinearTransport({ scheduler: (task) => task(), token: linearToken() });
    const api = makeLinearApi({ request: transport.request });
    const activity = unwrap(await fetchLinearActivity({ api, maxItems: MAX_ITEMS, window: WINDOW }));

    expect(activity.issues.length).toBeGreaterThan(0);
    expect(activity.issues.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(activity.issues.every((i) => i.identifier.length > 0)).toBe(true);
    expect(activity.issues.every((i) => i.title.length > 0)).toBe(true);
    expect(activity.issues.every((i) => i.url.startsWith("https://"))).toBe(true);

    expect(activity.projects.length).toBeGreaterThan(0);
    expect(activity.projects.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(activity.projects.every((p) => p.id.length > 0)).toBe(true);
    expect(activity.projects.every((p) => p.name.length > 0)).toBe(true);

    // The shared transport OBSERVED the crawl it carried — the accounting is wired at the REAL seam, not
    // only over a fake. Structural, so a cassette replaying an empty result cannot satisfy it.
    const stats = transport.stats();
    expect(stats.requests).toBeGreaterThan(0);
    expect(stats.bytes).toBeGreaterThan(0);
  });
});
