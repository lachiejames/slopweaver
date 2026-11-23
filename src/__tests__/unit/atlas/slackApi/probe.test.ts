/**
 * The read-only probe: the allowlist that makes a write unreachable, and the reductions that make its
 * report a shape rather than a body.
 *
 * The reduction assertions are not cosmetic. The first live run of this verb printed real Slack user
 * ids under the heading `users[]`, because `search.messages` returns a map KEYED BY user id and the member
 * names of such a field are data. A shape report gets pasted into places a body never would, so the
 * redaction is tested here as a property of the verb, not left to whoever reads the output.
 */
import { describe, expect, it } from "vitest";

import { PROBE_READ_ONLY_METHODS, resolveProbe } from "../../../../atlas/slackApi/probePolicy.js";
import { SlackArgumentErrors } from "../../../../cli/commands/slack/argumentErrors.js";
import { countWhere, expectationVerdict, shapeOf, sumField } from "../../../../cli/commands/slack/probeBody.js";
import { parseSlackProbeArgs, renderProbe, SLACK_PROBE_FLAG_NAMES } from "../../../../cli/commands/slack/probeCore.js";
import { SLACK_PROBE_USAGE } from "../../../../cli/commands/slack/verbUsage.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

describe("resolveProbe", () => {
  it("admits an allowlisted method and reads its key=value arguments", () => {
    const resolved = resolveProbe({ method: "conversations.history", params: ["channel=C1", "limit=999"] });
    expect(resolved).toEqual(ok({ method: "conversations.history", params: { channel: "C1", limit: "999" } }));
  });

  it("refuses a WRITE, naming why and refusing to widen a pattern", () => {
    const resolved = resolveProbe({ method: "chat.postMessage", params: [] });
    expect(resolved.isOk()).toBe(false);
    expect(resolved.isErr() && resolved.error[0]!.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("refuses an irreversible admin write that reads like its own sibling", () => {
    // `admin.apps.approved.list` reads; `admin.apps.approve` approves an app workspace-wide. One character
    // apart, and any `list|info|get` pattern that admits the first eventually admits the second.
    expect(resolveProbe({ method: "admin.apps.approve", params: [] }).isOk()).toBe(false);
    expect(PROBE_READ_ONLY_METHODS.has("admin.apps.approve")).toBe(false);
  });

  it("admits stars.list, the one published read near Later, so its answer stays measurable", () => {
    expect(resolveProbe({ method: "stars.list", params: ["limit=5"] })).toEqual(
      ok({ method: "stars.list", params: { limit: "5" } }),
    );
  });

  it("refuses an argument that is not key=value", () => {
    const resolved = resolveProbe({ method: "auth.test", params: ["justaword"] });
    expect(resolved.isOk()).toBe(false);
    expect(resolved.isErr() && resolved.error[0]!.code).toBe("BAD_PARAM");
  });

  it("refuses an argument whose key is empty", () => {
    const resolved = resolveProbe({ method: "auth.test", params: ["=value"] });
    expect(unwrapErr(resolved)[0]!.code).toBe("BAD_PARAM");
  });

  it("keeps an `=` inside a VALUE, so a search query survives", () => {
    const resolved = resolveProbe({ method: "search.messages", params: ["query=in:#a after:2026-08-01"] });
    expect(resolved.isOk() && resolved.value.params["query"]).toBe("in:#a after:2026-08-01");
  });

  it("reports every problem at once rather than the first", () => {
    const resolved = resolveProbe({ method: "chat.delete", params: ["oops"] });
    expect(resolved.isErr() && resolved.error).toHaveLength(2);
  });

  it("admits no method whose name contains a write verb", () => {
    const writeish = [...PROBE_READ_ONLY_METHODS].filter((name) =>
      /\.(post|delete|update|create|set|add|remove|invite|join|leave|archive|approve|restrict)/i.test(name),
    );
    expect(writeish).toEqual([]);
  });
});

describe("parseSlackProbeArgs", () => {
  it("has at least one entry in SLACK_PROBE_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(SLACK_PROBE_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("reads arguments as POSITIONALS, because a repeated string flag collapses to its last value", () => {
    const parsed = unwrap(
      parseSlackProbeArgs({ rest: ["--method", "conversations.history", "channel=C1", "limit=1"] }),
    );
    expect(parsed.method).toBe("conversations.history");
    expect(parsed.params).toEqual(["channel=C1", "limit=1"]);
  });

  it("requires --method", () => {
    const result = parseSlackProbeArgs({ rest: ["channel=C1"] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(SlackArgumentErrors.probeMethodMissing());
    expect(result._unsafeUnwrapErr().message).toContain("--method is required");
  });

  it("names in the usage line exactly the flags the parser accepts", () => {
    for (const flag of SLACK_PROBE_FLAG_NAMES) {
      expect(SLACK_PROBE_USAGE).toContain(flag);
    }
  });

  it("defaults to the user token, and --bot switches it", () => {
    expect(unwrap(parseSlackProbeArgs({ rest: ["--method", "auth.test"] })).bot).toBe(false);
    expect(unwrap(parseSlackProbeArgs({ rest: ["--method", "auth.test", "--bot"] })).bot).toBe(true);
  });
});

describe("shapeOf", () => {
  const body = {
    has_more: false,
    messages: [
      { reply_count: 3, ts: "1.1" },
      { reply_count: 4, ts: "2.2" },
    ],
    ok: true,
    response_metadata: { next_cursor: "abc" },
    users: { CFAKECHANNEL: { name: "x" }, UFAKEPERSON: { name: "y" } },
  };

  it("reports top-level field names and one level of member names", () => {
    const report = shapeOf({
      body,
      countField: undefined,
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 5,
      paging: undefined,
      method: "m",
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.fields).toEqual(["has_more", "messages", "ok", "response_metadata", "users"]);
    expect(report.nested["messages"]).toEqual(["reply_count", "ts"]);
  });

  it("REDACTS member names that are Slack object ids, because such a map's keys are data", () => {
    const report = shapeOf({
      body,
      countField: undefined,
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 5,
      paging: undefined,
      method: "m",
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.nested["users"]).toEqual(["<id>"]);
  });

  it("separates has_more from the cursor, because the two can disagree", () => {
    const report = shapeOf({
      body,
      countField: undefined,
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 5,
      paging: undefined,
      method: "m",
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.hasMore).toBe(false);
    expect(report.hasNextCursor).toBe(true);
  });

  it("counts an array's length at a dotted path", () => {
    const report = shapeOf({
      body,
      countField: "messages",
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 5,
      paging: undefined,
      method: "m",
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.count).toBe(2);
  });

  it("counts a scalar Slack computed, so a full page can be told from a truncated one", () => {
    const searchBody = { messages: { matches: [{}, {}], total: 272 }, ok: true };
    const report = shapeOf({
      body: searchBody,
      countField: "messages.total",
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 5,
      paging: undefined,
      method: "m",
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.count).toBe(272);
  });

  it("reports an empty shape-at as [] rather than undefined, so absence is distinguishable from unasked", () => {
    const report = shapeOf({
      body,
      countField: undefined,
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 5,
      paging: undefined,
      method: "m",
      shapeAt: "nothing.here",
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.shapeAtPath).toEqual([]);
  });

  it("carries Slack's own error string when the call failed", () => {
    const report = shapeOf({
      body: { error: "missing_scope", ok: false },
      countField: undefined,
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 5,
      method: "m",
      paging: undefined,
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.ok).toBe(false);
    expect(report.error).toBe("missing_scope");
  });
});

describe("--expect — the lane checks its own work without the verb printing a value", () => {
  const permalink = "https://acme.slack.com/archives/C1/p1756000000000100?thread_ts=1756000000.000000&cid=C1";
  const body = { channel: "C1", messages: [{ text: "the words nobody may print" }], ok: true, permalink };

  it("parses <path>=<value> at the FIRST `=`, so a permalink's own query survives", () => {
    const parsed = unwrap(
      parseSlackProbeArgs({ rest: ["--method", "chat.getPermalink", "--expect", `permalink=${permalink}`] }),
    );

    expect(parsed.expect).toEqual({ path: "permalink", value: permalink });
  });

  it("refuses an --expect with no `=` at all", () => {
    expect(unwrapErr(parseSlackProbeArgs({ rest: ["--method", "auth.test", "--expect", "permalink"] }))).toEqual(
      SlackArgumentErrors.probeExpectInvalid({ got: "permalink" }),
    );
    expect(unwrapErr(parseSlackProbeArgs({ rest: ["--method", "auth.test", "--expect", "permalink"] })).message).toBe(
      '--expect needs <path>=<value>, e.g. --expect permalink=https://…; got "permalink"',
    );
  });

  it("refuses an --expect whose path is empty", () => {
    expect(unwrapErr(parseSlackProbeArgs({ rest: ["--method", "auth.test", "--expect", "=x"] }))).toEqual(
      SlackArgumentErrors.probeExpectInvalid({ got: "=x" }),
    );
    expect(unwrapErr(parseSlackProbeArgs({ rest: ["--method", "auth.test", "--expect", "=x"] })).message).toBe(
      '--expect needs <path>=<value>, e.g. --expect permalink=https://…; got "=x"',
    );
  });

  it("says MATCHES when the built permalink is the one Slack hands out", () => {
    expect(expectationVerdict({ body, expect: { path: "permalink", value: permalink } })).toBe("matches");
  });

  it("says DIFFERS when it is not, without the caller learning what Slack actually said", () => {
    expect(expectationVerdict({ body, expect: { path: "permalink", value: `${permalink}&extra=1` } })).toBe("differs");
  });

  it("compares a non-string scalar as text, because a caller holds it as text off its own command line", () => {
    expect(expectationVerdict({ body, expect: { path: "ok", value: "true" } })).toBe("matches");
  });

  it("says ABSENT for a path this response does not carry, which is not the same as a wrong value", () => {
    expect(expectationVerdict({ body, expect: { path: "no_such_field", value: "x" } })).toBe("absent");
  });

  it("says NOT-SCALAR for a path holding a container, so the reader fixes the path and not the value", () => {
    expect(expectationVerdict({ body, expect: { path: "messages", value: "x" } })).toBe("not-scalar");
  });

  it("indexes into an array, so a stored message's own text can be checked against what was sent", () => {
    expect(expectationVerdict({ body, expect: { path: "messages.0.text", value: "the words nobody may print" } })).toBe(
      "matches",
    );
  });

  it("reports the verdict and the PATH, and never the value on either side", () => {
    const report = shapeOf({
      body,
      countField: undefined,
      countWhereSpec: undefined,
      elapsedMs: 4,
      expect: { path: "messages.0.text", value: "the words nobody may print" },
      method: "conversations.history",
      paging: undefined,
      scopes: false,
      shapeAt: undefined,
      sumSpec: undefined,
    });

    expect(report.expectation).toEqual({ path: "messages.0.text", verdict: "matches" });
    expect(renderProbe({ report })).toContain("  expect   : messages.0.text MATCHES the value given");
    expect(renderProbe({ report })).not.toContain("the words nobody may print");
  });

  it("prints no expect line at all when none was asked for", () => {
    const report = shapeOf({
      body,
      countField: undefined,
      countWhereSpec: undefined,
      elapsedMs: 4,
      expect: undefined,
      method: "conversations.history",
      paging: undefined,
      scopes: false,
      shapeAt: undefined,
      sumSpec: undefined,
    });

    expect(report.expectation).toBe(undefined);
    expect(renderProbe({ report })).not.toContain("expect");
  });
});

describe("countWhere", () => {
  const body = {
    matches: [
      { permalink: "https://x/archives/C1/p1?thread_ts=1.1" },
      { permalink: "https://x/archives/C1/p2" },
      { permalink: "https://x/archives/C1/p3?thread_ts=3.3" },
    ],
  };

  it("reports a fraction, because a count without a denominator is not a measurement", () => {
    expect(countWhere({ body, spec: "matches:permalink~thread_ts" })).toEqual({ matched: 2, of: 3 });
  });

  it("reports zero matched rather than nothing, so absence is a measured result", () => {
    expect(countWhere({ body, spec: "matches:permalink~cid=" })).toEqual({ matched: 0, of: 3 });
  });

  it("returns undefined when the path names no array", () => {
    expect(countWhere({ body, spec: "nope:permalink~x" })).toBeUndefined();
  });

  it("returns undefined for a spec missing its separator", () => {
    expect(countWhere({ body, spec: "matches.permalink" })).toBeUndefined();
  });
});

describe("sumField", () => {
  it("sums a numeric field across an array", () => {
    const body = { messages: [{ reply_count: 3 }, { reply_count: 229 }, { ts: "1.1" }] };
    expect(sumField({ body, spec: "messages:reply_count" })).toBe(232);
  });

  it("sums to zero when no element carries the field", () => {
    expect(sumField({ body: { messages: [{ ts: "1.1" }] }, spec: "messages:reply_count" })).toBe(0);
  });

  it("returns undefined when the path names no array", () => {
    expect(sumField({ body: { messages: 4 }, spec: "messages:reply_count" })).toBeUndefined();
  });
});

describe("renderProbe", () => {
  it("leads with the method, the outcome and the timing", () => {
    const text = renderProbe({
      report: {
        count: 34,
        elapsedMs: 645,
        error: undefined,
        fields: ["messages", "ok"],
        hasMore: false,
        hasNextCursor: false,
        method: "conversations.history",
        nested: { messages: ["reply_count", "ts"] },
        ok: true,
        paging: undefined,
        grantedScopes: undefined,
        acceptedScopes: undefined,
        expectation: undefined,
        shapeAtPath: undefined,
        sum: 232,
        where: undefined,
      },
    });
    expect(text.split("\n")[0]).toBe("conversations.history: ok  (645 ms)");
    expect(text).toContain("count    : 34");
    expect(text).toContain("sum      : 232");
    expect(text).toContain("cursor   : none · has_more false");
  });

  it("names Slack's own error when the call failed", () => {
    const text = renderProbe({
      report: {
        count: undefined,
        elapsedMs: 12,
        error: "channel_not_found",
        fields: ["error", "ok"],
        hasMore: false,
        hasNextCursor: false,
        method: "conversations.history",
        nested: {},
        ok: false,
        paging: undefined,
        grantedScopes: undefined,
        acceptedScopes: undefined,
        expectation: undefined,
        shapeAtPath: undefined,
        sum: undefined,
        where: undefined,
      },
    });
    expect(text.split("\n")[0]).toBe("conversations.history: FAILED — channel_not_found  (12 ms)");
  });

  it("still says a call failed when Slack gave no error string for it", () => {
    const text = renderProbe({
      report: {
        count: undefined,
        elapsedMs: 7,
        error: undefined,
        fields: ["ok"],
        hasMore: false,
        hasNextCursor: false,
        method: "conversations.history",
        nested: {},
        ok: false,
        paging: undefined,
        grantedScopes: undefined,
        acceptedScopes: undefined,
        expectation: undefined,
        shapeAtPath: undefined,
        sum: undefined,
        where: undefined,
      },
    });
    expect(text.split("\n")[0]).toBe("conversations.history: FAILED — no error string  (7 ms)");
  });
});

describe("memberNames, via shapeOf, over a heterogeneous array", () => {
  it("unions the field names across EVERY element, not just the first", () => {
    // A join-notice message carries no thread fields. Reading only element 0 reported `reply_count` as
    // absent from a response that plainly has it — a false absence, measured against the live API.
    const body = {
      messages: [
        { subtype: "channel_join", ts: "1.1" },
        { reply_count: 4, ts: "2.2" },
      ],
    };
    const report = shapeOf({
      body,
      countField: undefined,
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 1,
      paging: undefined,
      method: "conversations.history",
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.nested["messages"]).toEqual(["reply_count", "subtype", "ts"]);
  });

  it("still reports undefined for a field holding no object at all", () => {
    const report = shapeOf({
      body: { count: 4 },
      countField: undefined,
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 1,
      method: "m",
      paging: undefined,
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });
    expect(report.nested["count"]).toBeUndefined();
  });
});

describe("cursor discovery", () => {
  const shape = (body: Record<string, unknown>) =>
    shapeOf({
      body,
      countField: undefined,
      countWhereSpec: undefined,
      expect: undefined,
      elapsedMs: 1,
      method: "m",
      paging: undefined,
      shapeAt: undefined,
      scopes: false,
      sumSpec: undefined,
    });

  it("finds a cursor where Slack's documented convention puts it", () => {
    expect(shape({ response_metadata: { next_cursor: "abc" } }).hasNextCursor).toBe(true);
  });

  it("finds search.messages' cursor, which is NOT where the convention puts it", () => {
    // Measured: a pager that only knew `response_metadata` read the first page of a multi-page result
    // set as complete, and reported "cursor exhausted" while doing it.
    expect(shape({ messages: { pagination: { next_cursor: "abc" }, total: 250 } }).hasNextCursor).toBe(true);
  });

  it("treats an empty cursor as no next page, in either location", () => {
    expect(shape({ response_metadata: { next_cursor: "" } }).hasNextCursor).toBe(false);
    expect(shape({ messages: { pagination: { next_cursor: "" } } }).hasNextCursor).toBe(false);
  });

  it("reports no cursor when the response carries none at all", () => {
    expect(shape({ ok: true }).hasNextCursor).toBe(false);
  });
});
