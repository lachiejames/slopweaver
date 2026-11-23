/**
 * INTEGRATION test: a PAGED Slack read, recorded + replayed via a Polly cassette, proving that page-token
 * propagation is a property a cassette can fail on.
 *
 * Before cursors had identity this test could not exist: `next_cursor` fell to the allowlist redactor's safe
 * default and every page's bookmark was persisted as `[REDACTED]`, the lenient matcher ignored the request
 * body, and a follow-up carrying any cursor — or none — replayed page one and passed. Now a recorded cursor is
 * a stable `cursor_N` (`cassetteRedact.ts`), and a request that carries one is keyed on it
 * (`setup-polly.ts`'s `configureCursorMatching`), so the follow-up below is served page two ONLY when it sends
 * the exact bookmark page one handed out. Break the propagation in `corpus/slack/api.ts` (drop the `cursor`
 * field, or send a different one) and this fails — the first as two identical pages, the second as a missing
 * recording.
 *
 * Every assertion is STRUCTURAL: ids are synthetic in the committed cassette, so the witness is that page two's
 * members are a non-empty set disjoint from page one's, which only the second page's recording can produce.
 * Run:
 *   yarn test:integration                                                          # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… SLOPWEAVER_RECORD_SLACK_TOKEN=… yarn test:integration   # (re)record
 */
import { describe, expect, it } from "vitest";
import { makeSlackApi } from "../../corpus/slack/api.js";
import { isRecord } from "../../lib/parsers.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function slackToken(): string {
  if (!RECORD) {
    return "dummy-replay-token-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_TOKEN to record the Slack paging cassette");
  }
  return token;
}

/** Small enough that any real workspace has more than one page of each. */
const PAGE_SIZE = 2;

/** The `id` of a raw page item — every Slack user and conversation carries one, so a missing id is a failure. */
function idOf({ item }: { item: unknown }): string {
  if (!isRecord(item) || typeof item["id"] !== "string") {
    throw new Error("page item carries no string id");
  }
  return item["id"];
}

describe("slack paging (integration — real Slack via Polly cassette)", () => {
  it("walks users.list across two pages, and the second page is the one the first page's cursor names", async () => {
    const api = makeSlackApi({ token: slackToken() });

    const first = await api.listUsers({ pageSize: PAGE_SIZE });
    expect(first.members.length).toBe(PAGE_SIZE);
    expect(first.nextCursor).toBeDefined();

    const second = await api.listUsers({ cursor: first.nextCursor!, pageSize: PAGE_SIZE });
    const firstIds = new Set(first.members.map((item) => idOf({ item })));

    expect(second.members.length).toBeGreaterThan(0);
    expect(second.members.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(second.members.map((item) => idOf({ item })).filter((id) => firstIds.has(id))).toEqual([]);
  });

  it("walks conversations.list across two pages the same way", async () => {
    const api = makeSlackApi({ token: slackToken() });

    const first = await api.listChannels({ lane: "channels-and-dms", pageSize: PAGE_SIZE });
    expect(first.channels.length).toBe(PAGE_SIZE);
    expect(first.nextCursor).toBeDefined();

    const second = await api.listChannels({ cursor: first.nextCursor!, lane: "channels-and-dms", pageSize: PAGE_SIZE });
    const firstIds = new Set(first.channels.map((item) => idOf({ item })));

    expect(second.channels.length).toBeGreaterThan(0);
    expect(second.channels.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(second.channels.map((item) => idOf({ item })).filter((id) => firstIds.has(id))).toEqual([]);
  });
});
