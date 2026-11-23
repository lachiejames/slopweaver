/*
 * `draftShowLines`: what `slack draft show` prints. The digest the owner's approval binds and the body exactly as it
 * would post are the safety property; the author, act, row, mentions, attachments, prior ask, voice findings,
 * outcome and release command are each said, or said to be absent, rather than left out.
 */
import { describe, expect, it } from "vitest";

import { draftShowLines } from "../../../../../../cli/commands/slack/draftReport.js";
import { item } from "./harness.js";

describe("draftShowLines", () => {
  it("prints the digest the owner's approval binds and the body exactly as it would post", () => {
    const row = item();
    const lines = draftShowLines({ item: row });
    expect(lines).toContain(`digest   ${row.draft.digest}`);
    expect(lines).toContain("— the message, exactly as it would post —");
    expect(lines).toContain("Four groups, one question.");
    expect(lines).toContain("• Everyone");
  });

  it("names who it would go out as, by the id auth.test reported, never an invented display name", () => {
    expect(draftShowLines({ item: item() })).toContain("as       you (U0SYNADAOWN)");
    expect(draftShowLines({ item: item({ over: { authorId: undefined } }) })).toContain(
      "as       you (the user token's own identity was not read)",
    );
  });

  it("names the act a row declared, and prints no act line for a row that declared none", () => {
    expect(draftShowLines({ item: item({ over: { act: "bump" } }) })).toContain("act      bump");
    expect(draftShowLines({ item: item() }).filter((line) => line.startsWith("act "))).toEqual([]);
  });

  it("names the board row a draft came from, and prints no row line for one that named none", () => {
    expect(draftShowLines({ item: item({ over: { row: "thread-chase-daily" } }) })).toContain(
      "row      thread-chase-daily",
    );
    expect(draftShowLines({ item: item() }).filter((line) => line.startsWith("row "))).toEqual([]);
  });

  it("says a draft tags nobody rather than printing nothing about mentions", () => {
    expect(draftShowLines({ item: item({ over: { mentions: [] } }) })).toContain("mentions none");
    expect(draftShowLines({ item: item() })).toContain("mentions @ada-example → U1 (person)");
  });

  it("names each stored attachment by name, size and hash, after the body and before the release command", () => {
    const sha = "a".repeat(64);
    const lines = draftShowLines({
      item: item({ over: { media: [{ bytes: 2747, name: "walkthrough.mp4", sha256: sha }] } }),
    });
    const at = lines.indexOf(`walkthrough.mp4 · 2747 bytes · sha256 ${sha}`);
    expect(at).toBeGreaterThan(lines.indexOf("— the message, exactly as it would post —"));
    expect(lines[at - 1]).toBe("— attached under it (1), the stored bytes the digest binds —");
    expect(lines.findIndex((line) => line.startsWith("to send it as shown:"))).toBeGreaterThan(at);
  });

  it("prints no attachment lines at all for a text-only draft", () => {
    expect(draftShowLines({ item: item() }).filter((line) => line.includes("attached under it"))).toEqual([]);
  });

  it("shows a re-ask's earlier exchange and its proof before the message", () => {
    const lines = draftShowLines({
      item: item({
        over: {
          priorAsk: {
            answerCount: 2,
            answers: [{ text: "expected, the batch job", ts: "1789000100.000100", userId: "U0JONAH" }],
            changed: "spend tripled",
            kind: "prior",
            ours: { text: "is the spend expected?", ts: "1789000000.000100", userId: "U0SYNADAOWN" },
            permalink: "https://acme.slack.com/archives/C0ISO/p1789000000000100",
            proof: [{ bytes: 12, name: "spend.png", sha256: "c".repeat(64) }],
            readThroughTs: "1789000200.000100",
          },
        },
      }),
    });
    const at = lines.indexOf("— asked before: https://acme.slack.com/archives/C0ISO/p1789000000000100 —");
    expect(lines.slice(at, at + 6)).toEqual([
      "— asked before: https://acme.slack.com/archives/C0ISO/p1789000000000100 —",
      "ours     is the spend expected?",
      "answer   U0JONAH: expected, the batch job",
      "         and 1 more",
      "changed  spend tripled",
      `proof    spend.png · 12 bytes · sha256 ${"c".repeat(64)}`,
    ]);
    expect(at).toBeLessThan(lines.indexOf("— the message, exactly as it would post —"));
  });

  it("names a declared never-asked, and prints nothing for a row that asks nothing", () => {
    expect(draftShowLines({ item: item({ over: { priorAsk: { kind: "none" } } }) })).toContain(
      "asked before: never (the recorder's declaration)",
    );
    expect(draftShowLines({ item: item() }).filter((line) => line.includes("asked before"))).toEqual([]);
  });

  it("shows advisory voice findings, because the owner is the one judging the voice", () => {
    const lines = draftShowLines({ item: item({ over: { advisory: ["the opener runs long"] } }) });
    expect(lines).toContain("voice findings (advisory):");
    expect(lines).toContain("the opener runs long");
  });

  it("reports a resolved row's outcome, and says so when a resolved row recorded none", () => {
    const row = item({ state: "released" });
    expect(draftShowLines({ item: { ...row, outcome: "C0ISO 1758500000.1" } })).toContain(
      "released: C0ISO 1758500000.1",
    );
    expect(draftShowLines({ item: row })).toContain("released — no outcome recorded.");
  });

  it("prints the release command for a held row, and none once the row is resolved", () => {
    const row = item();
    expect(draftShowLines({ item: row })).toContain(
      `to send it as shown: slopweaver slack post --as me --draft sd-11111111 --approve ${row.draft.digest}`,
    );
    expect(draftShowLines({ item: item({ state: "dropped" }) }).filter((line) => line.includes("--draft"))).toEqual([]);
  });

  it("carries no outcome line at all while the row is still held", () => {
    expect(draftShowLines({ item: item() }).filter((line) => line.includes("no outcome recorded"))).toEqual([]);
  });
});
