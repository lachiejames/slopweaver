import type { ContextBlock } from "@slack/types";
import { describe, expect, it } from "vitest";

import { footerText, linkSafeUrl, renderFooter } from "../../../../outbound/assistant/footer.js";

/**
 * The two footer values that still appear, in the shape read raw off the reference thread (minus
 * the session link, which the owner ruled out — see the module header). The workspace-specific configure
 * id is redacted — this is a public repository — and the model id is a real public one.
 */
const MODEL = "claude-fable-5[1m]";
const CONFIGURE = "https://claude.ai/claude-in-slack/T_REDACTED/C_REDACTED/configure";

describe("linkSafeUrl", () => {
  it("leaves an ordinary URL untouched", () => {
    expect(linkSafeUrl({ url: CONFIGURE })).toBe(CONFIGURE);
  });

  it("percent-encodes the three characters that would truncate an mrkdwn link", () => {
    expect(linkSafeUrl({ url: "https://e.com/a<b>c|d" })).toBe("https://e.com/a%3Cb%3Ec%7Cd");
  });

  it("encodes every occurrence, not just the first", () => {
    expect(linkSafeUrl({ url: "https://e.com/|a|b|" })).toBe("https://e.com/%7Ca%7Cb%7C");
  });

  it("does not touch an ampersand, which is legal in a URL and legal inside a link", () => {
    expect(linkSafeUrl({ url: "https://e.com/?a=1&b=2" })).toBe("https://e.com/?a=1&b=2");
  });
});

describe("footerText", () => {
  it("reproduces the reference footer's remaining shape byte for byte — model, then configure", () => {
    expect(footerText({ configureUrl: CONFIGURE, modelId: MODEL })).toBe(`${MODEL} · <${CONFIGURE}|Configure>`);
  });

  it("separates with U+00B7 and single spaces, not an em dash", () => {
    expect(footerText({ configureUrl: CONFIGURE, modelId: MODEL })).toContain(" · ");
  });

  it("drops the configure part when the deployment has no configure link", () => {
    expect(footerText({ modelId: MODEL })).toBe(MODEL);
  });

  it("treats an EMPTY configure URL as absent rather than emitting an empty link", () => {
    expect(footerText({ configureUrl: "", modelId: MODEL })).toBe(MODEL);
  });

  it("escapes the model id, which is bare mrkdwn text", () => {
    expect(footerText({ modelId: "claude-<x>-5 & co" })).toBe("claude-&lt;x&gt;-5 &amp; co");
  });

  it("keeps the model id's square brackets, which are inert in mrkdwn", () => {
    expect(footerText({ modelId: "claude-opus-5[1m]" })).toBe("claude-opus-5[1m]");
  });

  it("encodes a hostile configure URL instead of letting it spill out of the link", () => {
    expect(footerText({ configureUrl: "https://e.com/a|Evil", modelId: MODEL })).toBe(
      `${MODEL} · <https://e.com/a%7CEvil|Configure>`,
    );
  });

  it("carries no session link — the owner ruled it out, and the model line is what remains", () => {
    expect(footerText({ configureUrl: CONFIGURE, modelId: MODEL })).not.toContain("Open session in Claude");
  });
});

describe("renderFooter", () => {
  it("emits one context block holding one mrkdwn element, and no verbatim key", () => {
    expect(renderFooter({ configureUrl: CONFIGURE, modelId: MODEL })).toEqual({
      elements: [
        {
          text: `${MODEL} · <${CONFIGURE}|Configure>`,
          type: "mrkdwn",
        },
      ],
      type: "context",
    } satisfies ContextBlock);
  });

  it("is deterministic for a given input", () => {
    const args = { configureUrl: CONFIGURE, modelId: MODEL };
    expect(JSON.stringify(renderFooter(args))).toBe(JSON.stringify(renderFooter(args)));
  });
});
