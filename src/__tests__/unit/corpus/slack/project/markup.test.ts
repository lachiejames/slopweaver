/*
 * `resolveSlackMarkup`: user, channel, link, broadcast and usergroup markup resolve to readable names, never a raw
 * id, in one linear pass that a stray `<` in prose cannot derail. It moved here when `project.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";
import { resolveSlackMarkup } from "../../../../../corpus/slack/visibleProse.js";
import { maps } from "./harness.js";

describe("resolveSlackMarkup", () => {
  it("resolves a known user mention to @DisplayName", () => {
    expect(resolveSlackMarkup({ maps, text: "ping <@U1> now" })).toBe("ping @Ada now");
  });

  it("renders @user (never the raw id) on a user-map miss with no pipe label", () => {
    expect(resolveSlackMarkup({ maps, text: "ping <@U_MISSING>" })).toBe("ping @user");
  });

  it("resolves a known channel mention to #channel-name", () => {
    expect(resolveSlackMarkup({ maps, text: "in <#C_RELEASES>" })).toBe("in #releases");
  });

  it("renders #channel (never the raw id) on a channel-map miss", () => {
    expect(resolveSlackMarkup({ maps, text: "in <#C_MISSING>" })).toBe("in #channel");
  });

  it("prefers the pipe label over a generic fallback when the id is unknown", () => {
    expect(resolveSlackMarkup({ maps, text: "<@U_X|bob> and <#C_Y|random>" })).toBe("@bob and #random");
  });

  it("renders a <url|label> link as its label and a bare <url> as the url", () => {
    expect(resolveSlackMarkup({ maps, text: "<https://x.test|docs> or <https://y.test>" })).toBe(
      "docs or https://y.test",
    );
  });

  it("renders a broadcast special mention as @here", () => {
    expect(resolveSlackMarkup({ maps, text: "<!here> heads up" })).toBe("@here heads up");
  });

  it("leaves plain text untouched", () => {
    expect(resolveSlackMarkup({ maps, text: "no markup, just #123 and @nobody" })).toBe(
      "no markup, just #123 and @nobody",
    );
  });

  it("resolves a BARE usergroup mention to @group, never to its workspace id", () => {
    const resolved = resolveSlackMarkup({ maps, text: "heads up <!subteam^S0GROUPID>" });
    expect(resolved).toBe("heads up @group");
    expect(resolved.includes("subteam")).toBe(false);
    expect(resolved.includes("S0GROUPID")).toBe(false);
  });

  it("renders a LABELLED usergroup mention as the label Slack sent, with exactly one @", () => {
    expect(resolveSlackMarkup({ maps, text: "<!subteam^S0GROUPID|@platform> ship it" })).toBe("@platform ship it");
  });

  it("prefixes a usergroup label that arrives without its own @", () => {
    expect(resolveSlackMarkup({ maps, text: "<!subteam^S0GROUPID|platform>" })).toBe("@platform");
  });

  it("resolves the INNER reference of nested markup, so no raw id survives the single pass", () => {
    expect(resolveSlackMarkup({ maps, text: "<<@U1>>" })).toBe("<@Ada>");
  });

  it("leaves a literal heredoc alone — `<<` is not nested markup", () => {
    expect(resolveSlackMarkup({ maps, text: "run <<'EOF' then <<<x" })).toBe("run <<'EOF' then <<<x");
  });

  // A stray `<` in ordinary prose (`<48h`, `<1%`, `<3s`, `Promise<T>`) used to open a match that ran to the
  // next `>` — anywhere — swallowing the prose in between AND leaving the mention's raw id behind, because a
  // ref beginning `48h, ping <@U…` matches none of the branches and is returned verbatim. Seven records in the
  // local corpus carried an opaque id into stored text this way.
  it("does not let a stray `<` in prose swallow the mention that follows it", () => {
    const resolved = resolveSlackMarkup({ maps, text: "for <48h, ping <@U1>" });
    expect(resolved).toBe("for <48h, ping @Ada");
    expect(resolved.includes("U1")).toBe(false);
  });

  it("keeps an arrow in prose and still resolves the mention beside it", () => {
    expect(resolveSlackMarkup({ maps, text: "still blocked <- <@U1> and <#C_RELEASES>" })).toBe(
      "still blocked <- @Ada and #releases",
    );
  });

  it("resolves every markup shape identically to the shapes the corpus already contains", () => {
    const shapes = [
      { in: "<@U1>", out: "@Ada" },
      { in: "<@U_MISSING>", out: "@user" },
      { in: "<@U_X|bob>", out: "@bob" },
      { in: "<#C_RELEASES>", out: "#releases" },
      { in: "<#C_MISSING>", out: "#channel" },
      { in: "<#C_Y|random>", out: "#random" },
      { in: "<https://x.test|docs>", out: "docs" },
      { in: "<https://y.test>", out: "https://y.test" },
      { in: "<!here>", out: "@here" },
      { in: "<!channel>", out: "@channel" },
      { in: "<!date^1700000000^{date_short}|May 29, 2026>", out: "@May 29, 2026" },
    ];
    expect(shapes.map((shape) => resolveSlackMarkup({ maps, text: shape.in }))).toEqual(
      shapes.map((shape) => shape.out),
    );
  });

  // The clock is read deliberately: linearity is a complexity claim, and a wall-clock budget is the only
  // falsifiable assertion for it. The payload is a message at Slack's documented limits (50 section blocks,
  // each a 3,000-char text plus ten 2,000-char fields) filled with `<` — the input that made the previous
  // `[^>]+` body re-scan to end-of-input from every start position. Measured on an M-series Mac:
  // roughly 2.8-3.4 s before, 1.4-4.9 ms after. The 500 ms budget sits ~100x above the linear cost and ~5.6x
  // below the quadratic one, so a loaded machine cannot flip it but a reintroduced `[^>]+` always will.
  it("flattens a message at Slack's documented block and field limits in linear time", () => {
    const fields = Array.from({ length: 50 }, () => [
      "<".repeat(3000),
      ...Array.from({ length: 10 }, () => "<".repeat(2000)),
    ]).flat();
    const startedMs = performance.now();
    const resolved = fields.map((text) => resolveSlackMarkup({ maps, text }));
    const elapsedMs = performance.now() - startedMs;
    expect(resolved).toEqual(fields);
    expect(elapsedMs).toBeLessThan(500);
  });
});
