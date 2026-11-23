import { describe, expect, it } from "vitest";

import { askedInstant } from "../../../../../cli/commands/handover/askRowInstant.js";
import { askRowText, slugFromAsk } from "../../../../../cli/commands/handover/askRowText.js";
import { registerAlignmentVerdict } from "../../../../../handover/cardAlignment.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

describe("slugFromAsk", () => {
  it("kebabs the owner's own words", () => {
    expect(slugFromAsk({ ask: "Account for every stuck chat" })).toBe("account-for-every-stuck-chat");
  });

  it("caps the length so a whole voice dump does not become a filename", () => {
    const ask = "one two three four five six seven eight nine ten";
    expect(slugFromAsk({ ask })).toBe("one-two-three-four-five-six-seven-eight");
  });

  it("drops punctuation rather than encoding it", () => {
    expect(slugFromAsk({ ask: "why can't the bot see #16412?" })).toBe("why-can-t-the-bot-see-16412");
  });

  it("is empty when the ask carries no word characters, so the verb can refuse instead of writing `.md`", () => {
    expect(slugFromAsk({ ask: "!!! ???" })).toBe("");
  });
});

describe("registerAlignmentVerdict — the Vanta reactivation row", () => {
  const ANSWER_NOT_QUESTION =
    "yes to the exact Vanta write that reactivates CVE-2026-47429 (vitest, widget-service), so it " +
    "is triaged under the procedure instead of sitting on the 1 Sep demo deactivation. After it lands, the fix is " +
    "the Renovate PR or a bump to 3.2.6";

  it("refuses a row waiting on the owner's word whose ask is an answer, naming the shape", () => {
    const verdict = registerAlignmentVerdict({ ask: ANSWER_NOT_QUESTION, env: {}, waitsOnOwner: true });

    expect(verdict.kind).toBe("refused");
    const lines = (verdict as { lines: readonly string[] }).lines.join("\n");
    expect(lines).toContain("slopweaver handover register blocked because");
    expect(lines).toContain('neither of its first 2 sentences ends in "?"');
    expect(lines).toContain("SLOPWEAVER_ALLOW_UNALIGNED_CARD=1");
  });

  it("records the same row once its ask is the question the owner answers", () => {
    const ask =
      "Should the fleet switch the Vanta finding for CVE-2026-47429 back on? It is a critical vitest vulnerability " +
      "that the bot switched off on 1 Sep as a demo write.";
    expect(registerAlignmentVerdict({ ask, env: {}, waitsOnOwner: true })).toEqual({ kind: "ok" });
  });

  it("never judges a finding or dispatch row, which asks the owner nothing", () => {
    expect(registerAlignmentVerdict({ ask: ANSWER_NOT_QUESTION, env: {}, waitsOnOwner: false })).toEqual({
      kind: "ok",
    });
  });

  it("records it anyway through the unaligned-card hatch", () => {
    const env = { SLOPWEAVER_ALLOW_UNALIGNED_CARD: "1" };
    expect(registerAlignmentVerdict({ ask: ANSWER_NOT_QUESTION, env, waitsOnOwner: true })).toEqual({ kind: "ok" });
  });
});

describe("askRowText provenance", () => {
  const base = {
    anchor: undefined,
    ask: "Should listen status count every stuck chat?",
    askedIso: "2026-08-30T23:08:43Z",
    branch: undefined,
    checkedIso: "2026-08-30T23:10:00Z",
    dispatch: true,
    finding: undefined,
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug: "stuck-chats",
  };

  it("writes the registering session and the run it held, and the board reads both back", () => {
    const text = askRowText({
      ...base,
      provenance: { registeredBy: "a0000056-0000-4000-8000-000000000062", registeredRun: "carry-out-rulings" },
    });
    const doc = parseHandoverDoc({ path: "/h/stuck-chats.md", text });

    expect(doc.problems).toEqual([]);
    expect(doc.registeredBy).toBe("a0000056-0000-4000-8000-000000000062");
    expect(doc.registeredRun).toBe("carry-out-rulings");
  });

  it("writes neither key when nothing was established", () => {
    const text = askRowText({ ...base, provenance: { registeredBy: undefined, registeredRun: undefined } });

    expect(text).not.toContain("registeredBy:");
    expect(text).not.toContain("registeredRun:");
  });

  it("cannot author a key through a session id carrying a newline", () => {
    const text = askRowText({
      ...base,
      provenance: { registeredBy: "s1\nproblem: injected", registeredRun: undefined },
    });
    const doc = parseHandoverDoc({ path: "/h/stuck-chats.md", text });

    expect(doc.problem).toBe(undefined);
    expect(text).toContain('registeredBy: "s1\\nproblem: injected"');
  });
});

describe("askRowText", () => {
  const text = askRowText({
    anchor: "https://example.invalid/p1",
    ask: "account for every stuck chat",
    askedIso: "2026-08-30T23:08:43Z",
    checkedIso: "2026-08-30T23:10:00Z",
    branch: undefined,
    dispatch: false,
    finding: undefined,
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug: "stuck-chats",
  });

  it("writes a row this repository's own board reader parses cleanly", () => {
    const doc = parseHandoverDoc({ path: "/h/stuck-chats.md", text });

    expect(doc.problems).toEqual([]);
    expect(doc.kind).toBe("ask");
    expect(doc.askedIso).toBe("2026-08-30T23:08:43Z");
    expect(doc.anchor).toBe("https://example.invalid/p1");
    expect(doc.status).toBe("ready");
  });

  it("quotes the summary, so an ask carrying a colon cannot break the front-matter", () => {
    const tricky = askRowText({
      anchor: undefined,
      ask: "fix this: the card is stuck",
      askedIso: "2026-08-30T23:08:43Z",
      checkedIso: "2026-08-30T23:10:00Z",
      branch: undefined,
      dispatch: false,
      finding: undefined,
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug: "card-stuck",
    });
    const doc = parseHandoverDoc({ path: "/h/card-stuck.md", text: tricky });

    expect(doc.problems).toEqual([]);
    expect(doc.summary).toBe("fix this: the card is stuck");
  });

  it("defaults `artifact:` so the register-hygiene gate never reddens someone else's push over it", () => {
    expect(text).toContain("artifact: null");
  });

  it("omits an anchor line entirely when nobody recorded one, rather than writing an empty value", () => {
    const bare = askRowText({
      anchor: undefined,
      ask: "do the thing",
      askedIso: "2026-08-30T23:08:43Z",
      checkedIso: "2026-08-30T23:10:00Z",
      branch: undefined,
      dispatch: false,
      finding: undefined,
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug: "do-the-thing",
    });

    expect(bare).not.toContain("anchor:");
    expect(parseHandoverDoc({ path: "/h/do-the-thing.md", text: bare }).anchor).toBeUndefined();
  });

  it("carries a declared priority and repo through to the parser", () => {
    const placed = askRowText({
      anchor: undefined,
      ask: "do the thing",
      askedIso: "2026-08-30T23:08:43Z",
      checkedIso: "2026-08-30T23:10:00Z",
      branch: undefined,
      dispatch: false,
      finding: undefined,
      priority: "p0",
      repo: "/w/repo",
      shape: undefined,
      slug: "do-the-thing",
    });
    const doc = parseHandoverDoc({ path: "/h/do-the-thing.md", text: placed });

    expect(doc.priority).toBe("p0");
    expect(doc.repo).toBe("/w/repo");
  });

  it("tells the reader how the row ends", () => {
    expect(text).toContain("slopweaver handover settle stuck-chats --as filed|answered|declined");
  });
});

describe("askedInstant", () => {
  /** The permalink for `1788220579.306599`. */
  const slackAnchor = "https://acme.slack.com/archives/C123/p1788220579306599";

  it("derives the instant from --asked-ts rather than taking one typed beside it", () => {
    expect(askedInstant({ values: { "asked-ts": "1788220579.306599" } })).toEqual({
      askedIso: "2026-08-31T23:56:19.000Z",
    });
  });

  it("derives it from a Slack --anchor when no instant flag was given at all", () => {
    expect(askedInstant({ values: { anchor: slackAnchor } })).toEqual({ askedIso: "2026-08-31T23:56:19.000Z" });
  });

  it("prefers --asked-ts over the anchor, so an explicit ts is never silently overridden", () => {
    expect(askedInstant({ values: { anchor: slackAnchor, "asked-ts": "1785114398.557099" } })).toEqual({
      askedIso: "2026-07-27T01:06:38.000Z",
    });
  });

  it("keeps --asked-iso as the escape hatch for an ask that did not arrive in Slack", () => {
    expect(askedInstant({ values: { anchor: slackAnchor, "asked-iso": "2026-08-30T09:00:00Z" } })).toEqual({
      askedIso: "2026-08-30T09:00:00Z",
    });
  });

  it("REFUSES a --asked-iso that does not parse, which used to be written through verbatim", () => {
    expect(askedInstant({ values: { "asked-iso": "yesterdayish" } })).toEqual({
      refusal: "--asked-iso yesterdayish is not an instant — pass --asked-ts to derive one",
    });
  });

  it("refuses an --asked-ts that is not a Slack ts", () => {
    expect(askedInstant({ values: { "asked-ts": "1 Sep" } })).toEqual({
      refusal: "--asked-ts 1 Sep is not a Slack ts",
    });
  });

  it("ignores a non-Slack anchor rather than reading a timestamp into it", () => {
    const now = askedInstant({ values: { anchor: "https://example.invalid/transcript#L40" } });
    expect("askedIso" in now).toBe(true);
  });
});
