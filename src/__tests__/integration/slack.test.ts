/**
 * INTEGRATION test: the Slack OUTBOUND ingest seam against the REAL Slack Web API, recorded + replayed via a
 * Polly cassette (see `setup-polly.ts` + `cassetteRedact.ts`). No gateway: `@slack/web-api` v8 issues HTTP
 * through the undici global `fetch`, which Polly's fetch adapter intercepts in-process.
 *
 * Seam: `fetchSlackActivity` over a live `makeSlackApi` — `auth.test` → `conversations.list` → `users.list`
 * → per-channel `conversations.history` (+ thread `replies`) → best-effort `pins`/`bookmarks`/`files`. The
 * `maxItems` fetch cap bounds the recording to a few channels/users/messages.
 *
 * Recorded against a REAL workspace, so EVERY assertion is STRUCTURAL (shape/counts/field-presence) — never on
 * content, which the allowlist redactor blanks (message text → `[REDACTED]`, ids → `id_N`) before commit. Run:
 *   yarn test:integration                                                          # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… SLOPWEAVER_RECORD_SLACK_TOKEN=… yarn test:integration   # (re)record
 */
import { describe, expect, it } from "vitest";
import { makeSlackApi } from "../../corpus/slack/api.js";
import { fetchSlackActivity } from "../../corpus/slack/fetch.js";
import { unwrap } from "../../lib/result.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function slackToken(): string {
  if (!RECORD) {
    return "dummy-replay-token-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_TOKEN to record the Slack cassette");
  }
  return token;
}

const WINDOW = { since: "2020-01-01", until: "2030-01-01" };
const MAX_ITEMS = 5;

describe("slack outbound (integration — real Slack via Polly cassette)", () => {
  it("crawls a capped set of channels + messages and shapes them for projection", async () => {
    const activity = unwrap(
      await fetchSlackActivity({ api: makeSlackApi({ token: slackToken() }), maxItems: MAX_ITEMS, window: WINDOW }),
    );

    expect(activity.retainedChannels.length).toBeGreaterThan(0);
    expect(activity.retainedChannels.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(activity.retainedChannels.every((c) => c.channelId.length > 0)).toBe(true);
    expect(Object.keys(activity.maps.userNames).length).toBeGreaterThan(0);

    const messages = activity.retainedChannels.flatMap((c) => c.messages);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => m.ts.length > 0)).toBe(true);
    expect(messages.every((m) => m.permalink.startsWith("https://"))).toBe(true);
    expect(messages.every((m) => m.channelId.length > 0)).toBe(true);
  });
});
