/**
 * Parsing an ask row out of real front-matter, and where the board then puts it.
 *
 * Separate from `doc/` because the subject is the ROW KIND rather than the parser's flat/nested
 * split — and because the settlement's board placement is the half that decides whether an ask the owner made was
 * actioned or talked away, which is the number this whole register exists to report.
 */
import { describe, expect, it } from "vitest";

import { composeBoardModels } from "../../../handover/boardState.js";
import { parseHandoverDoc } from "../../../handover/doc.js";

/** One ask row's file text, with whatever extra front-matter lines a case needs. */
function askFile({ extra = [] }: { extra?: readonly string[] } = {}): string {
  return [
    "---",
    "slug: stuck-chats",
    "kind: ask",
    'summary: "account for every stuck chat"',
    "status: ready",
    "askedIso: 2026-08-30T23:08:43Z",
    "anchor: https://example.invalid/p1",
    "blockedBy: []",
    "artifact: null",
    ...extra,
    "---",
    "",
    "# account for every stuck chat",
    "",
  ].join("\n");
}

/** Place one parsed doc on the board with no probes and no run journal. */
function section({ text }: { text: string }): string {
  const doc = parseHandoverDoc({ path: "/h/stuck-chats.md", text });
  const models = composeBoardModels({
    journals: new Map(),
    probeStates: new Map(),
    resolutionDocs: [doc],
    roots: [doc],
  });
  return models[0]!.section;
}

describe("parseHandoverDoc on an ask row", () => {
  it("reads the kind, the instant the owner asked and the anchor", () => {
    const doc = parseHandoverDoc({ path: "/h/stuck-chats.md", text: askFile() });

    expect(doc.kind).toBe("ask");
    expect(doc.askedIso).toBe("2026-08-30T23:08:43Z");
    expect(doc.anchor).toBe("https://example.invalid/p1");
    expect(doc.settlement).toBeUndefined();
    expect(doc.problems).toEqual([]);
  });

  it("reads a declared priority", () => {
    const doc = parseHandoverDoc({ path: "/h/stuck-chats.md", text: askFile({ extra: ["priority: p0"] }) });

    expect(doc.priority).toBe("p0");
  });

  it("leaves priority undeclared rather than defaulting it in the parser", () => {
    expect(parseHandoverDoc({ path: "/h/stuck-chats.md", text: askFile() }).priority).toBeUndefined();
  });

  it("reads a settlement and its witness", () => {
    const doc = parseHandoverDoc({
      path: "/h/stuck-chats.md",
      text: askFile({ extra: ["settlement: filed", "settlementWitness: supervisor-accounts-for-every-stuck-chat"] }),
    });

    expect(doc.settlement).toBe("filed");
    expect(doc.settlementWitness).toBe("supervisor-accounts-for-every-stuck-chat");
  });

  it("carries the ask-row defect onto the doc's own problems, so every board reader sees it", () => {
    const doc = parseHandoverDoc({ path: "/h/stuck-chats.md", text: askFile({ extra: ["settlement: answered"] }) });

    expect(doc.problems).toEqual([
      "settlement: answered declares no settlementWitness — a settled ask names the doc slug, the permalink " +
        "or the anchor behind it, so nobody has to take a session's word for it",
    ]);
  });

  it("defaults an ordinary doc to kind doc with no ask fields", () => {
    const text = ["---", "slug: refactor", "status: ready", "blockedBy: []", "artifact: null", "---", ""].join("\n");
    const doc = parseHandoverDoc({ path: "/h/refactor.md", text });

    expect(doc.kind).toBe("doc");
    expect(doc.askedIso).toBeUndefined();
    expect(doc.problems).toEqual([]);
  });
});

describe("where the board puts an ask row", () => {
  it("keeps an open ask runnable, because turning it into work is what picking it up means", () => {
    expect(section({ text: askFile() })).toBe("RUN NOW");
  });

  it("counts a filed ask as done — the owner's ask WAS actioned", () => {
    expect(section({ text: askFile({ extra: ["settlement: filed", "settlementWitness: some-doc"] }) })).toBe("DONE");
  });

  it("counts an answered ask as done", () => {
    const extra = ["settlement: answered", "settlementWitness: https://example.invalid/answer"];
    expect(section({ text: askFile({ extra }) })).toBe("DONE");
  });

  it("keeps a declined ask apart from an actioned one, so the two are never counted together", () => {
    const extra = [
      "settlement: declined",
      "settlementWitness: https://example.invalid/p2",
      'settlementReason: "not doing this"',
    ];
    expect(section({ text: askFile({ extra }) })).toBe("CLOSED — NOT SHIPPED");
  });

  it("reports a settlement with no witness as a contradiction rather than closing the ask", () => {
    expect(section({ text: askFile({ extra: ["settlement: filed"] }) })).toBe("CONTRADICTION");
  });
});
