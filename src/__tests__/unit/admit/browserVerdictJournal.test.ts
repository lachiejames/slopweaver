/**
 * {@link browserVerdictRecord} and the journal's parser — the pure half of what the browser-door guard
 * writes down.
 *
 * The property under test throughout is that a row carries enough to answer the question the journal was
 * built for: which tool, on which page, decided which way, and — for a historical refusal that did not
 * stick — what it overrode.
 */
import { describe, expect, it } from "vitest";
import {
  BROWSER_VERDICT_SCHEMA_VERSION,
  browserVerdictRecord,
  parseBrowserVerdictJournal,
  parseBrowserVerdictLine,
} from "../../../admit/browserVerdictJournal.js";
import type { BrowserDecision } from "../../../admit/browserVerdictVocabulary.js";

const TS = "2026-09-08T09:00:00.000Z";
const SESSION = "f0bae6e5-0386-4bdc-9863-d25b38f0635e";

const REFUSAL: BrowserDecision & { readonly block: true } = {
  block: true,
  message: "browser-door: refusing computer on tab 42",
  reason: "read-before-write-unread-write",
  subject: { tabId: 42, tool: "computer", url: "https://app.datadoghq.com/dashboard/abc" },
};

describe("browserVerdictRecord", () => {
  it("records a refusal with its reason code, its subject and its message", () => {
    const record = browserVerdictRecord({
      decision: REFUSAL,
      sessionId: SESSION,
      toolName: "mcp__claude-in-chrome__computer",
      tsIso: TS,
    });
    expect(record.verdict).toBe("block");
    expect(record.reason).toBe("read-before-write-unread-write");
    expect(record.tabId).toBe(42);
    expect(record.url).toBe("https://app.datadoghq.com/dashboard/abc");
    expect(record.message).toBe("browser-door: refusing computer on tab 42");
    expect(record.schemaVersion).toBe(BROWSER_VERDICT_SCHEMA_VERSION);
    expect(record.sessionId).toBe(SESSION);
    expect(record.tsIso).toBe(TS);
  });

  it("records an allow with no message at all, because an allow has none", () => {
    const record = browserVerdictRecord({
      decision: { block: false, reason: "pageless-tool", subject: { tool: "tabs_context_mcp" } },
      sessionId: SESSION,
      toolName: "mcp__claude-in-chrome__tabs_context_mcp",
      tsIso: TS,
    });
    expect(record.verdict).toBe("allow");
    expect(record.reason).toBe("pageless-tool");
    expect(Object.hasOwn(record, "message")).toBe(false);
    expect(Object.hasOwn(record, "tabId")).toBe(false);
    expect(Object.hasOwn(record, "url")).toBe(false);
  });

  it("omits the url rather than inventing one when the tab was never observed", () => {
    const record = browserVerdictRecord({
      decision: {
        block: true,
        message: "browser-door: refusing computer on tab 42",
        reason: "unknown-tab-write",
        subject: { tabId: 42, tool: "computer" },
      },
      sessionId: SESSION,
      toolName: "mcp__claude-in-chrome__computer",
      tsIso: TS,
    });
    expect(record.tabId).toBe(42);
    expect(Object.hasOwn(record, "url")).toBe(false);
  });
});

describe("parseBrowserVerdictLine", () => {
  it("round-trips a record through JSON", () => {
    const record = browserVerdictRecord({
      decision: REFUSAL,
      sessionId: SESSION,
      toolName: "mcp__claude-in-chrome__computer",
      tsIso: TS,
    });
    const back = parseBrowserVerdictLine({ line: JSON.stringify(record) })!;
    expect(back.reason).toBe("read-before-write-unread-write");
    expect(back.verdict).toBe("block");
    expect(back.tabId).toBe(42);
    expect(back.url).toBe("https://app.datadoghq.com/dashboard/abc");
  });

  // A historical row, written by the waiver path deleted as unreachable.
  // The journal is append-only, so a row like this still sits on a real install and must still read.
  it("still reads a historical break-glass waiver row, naming the verdict it overrode", () => {
    const back = parseBrowserVerdictLine({
      line: JSON.stringify({
        grantReason: "hand-driving the console to reproduce a refusal",
        message: "browser-door: refusing computer on tab 42",
        reason: "break-glass-grant",
        schemaVersion: 1,
        sessionId: SESSION,
        tabId: 42,
        toolName: "mcp__claude-in-chrome__computer",
        tsIso: TS,
        url: "https://app.datadoghq.com/dashboard/abc",
        verdict: "allow",
        waived: "read-before-write-unread-write",
      }),
    })!;
    expect(back.reason).toBe("break-glass-grant");
    expect(back.verdict).toBe("allow");
    expect(back.waived).toBe("read-before-write-unread-write");
    expect(back.grantReason).toBe("hand-driving the console to reproduce a refusal");
    expect(back.url).toBe("https://app.datadoghq.com/dashboard/abc");
  });

  it("drops a line whose reason is not a code this build defines", () => {
    expect(
      parseBrowserVerdictLine({
        line: '{"reason":"invented-later","sessionId":"s","toolName":"t","tsIso":"x","verdict":"allow"}',
      }),
    ).toBe(undefined);
  });

  it("keeps the row but drops an unrecognised `waived` code, which is not the row's own verdict", () => {
    const back = parseBrowserVerdictLine({
      line: '{"reason":"break-glass-env","sessionId":"s","toolName":"t","tsIso":"x","verdict":"allow","waived":"nope"}',
    })!;
    expect(back.reason).toBe("break-glass-env");
    expect(back.waived).toBe(undefined);
  });

  it("drops a line with no verdict, a blank line and a torn write", () => {
    expect(parseBrowserVerdictLine({ line: "" })).toBe(undefined);
    expect(parseBrowserVerdictLine({ line: '{"reason":"pageless-tool"' })).toBe(undefined);
    expect(
      parseBrowserVerdictLine({
        line: '{"reason":"pageless-tool","sessionId":"s","toolName":"t","tsIso":"x","verdict":"maybe"}',
      }),
    ).toBe(undefined);
  });
});

describe("parseBrowserVerdictJournal", () => {
  it("keeps the decodable rows either side of a torn one, in file order", () => {
    const good = ({ reason }: { reason: string }): string =>
      JSON.stringify({ reason, sessionId: SESSION, toolName: "t", tsIso: TS, verdict: "allow" });
    const rows = parseBrowserVerdictJournal({
      text: `${good({ reason: "pageless-tool" })}\n{oops\n${good({ reason: "granted-read" })}\n`,
    });
    expect(rows.length).toBe(2);
    expect(rows[0]!.reason).toBe("pageless-tool");
    expect(rows[1]!.reason).toBe("granted-read");
  });
});
