/**
 * The ask-lifecycle log's durability path: a real round-trip against a temp `home`, because this function's
 * whole job IS a filesystem effect — there is no pure core to extract it into and test instead.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AskLifecycleEvent, type CapturedEvent, parseAskLifecycleLog } from "../../../../live/ask/lifecycle.js";
import {
  appendAskLifecycleEvent,
  askLifecyclePath,
  readAskLifecycleText,
  startedRefForAsk,
} from "../../../../live/ask/store.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const CAPTURED: CapturedEvent = {
  channel: "C1",
  kind: "captured",
  messageTs: "1785000000.000100",
  surface: "channel",
  threadTs: "1785000000.000100",
  tsIso: "2026-08-05T13:26:00.000Z",
  userId: "U1",
};

describe("askLifecyclePath", () => {
  it("resolves under live/slack/asks.jsonl beneath the given home", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-asks-"));
    fixtureDirs.push(home);

    expect(askLifecyclePath({ home })).toBe(join(home, "live", "slack", "asks.jsonl"));
  });
});

describe("appendAskLifecycleEvent / readAskLifecycleText", () => {
  it("creates the file and its parent directory when neither exists", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-asks-"));
    fixtureDirs.push(home);

    appendAskLifecycleEvent({ event: CAPTURED, home });

    expect(readAskLifecycleText({ home })).toBe(`${JSON.stringify({ ...CAPTURED, schemaVersion: 1 })}\n`);
  });

  it("appends rather than overwrites — one JSONL line per call, in call order", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-asks-"));
    fixtureDirs.push(home);
    const triaged = { ...CAPTURED, kind: "triaged-no-response" as const, reason: "already resolved elsewhere" };

    appendAskLifecycleEvent({ event: CAPTURED, home });
    appendAskLifecycleEvent({ event: triaged, home });

    expect(readAskLifecycleText({ home })).toBe(
      `${JSON.stringify({ ...CAPTURED, schemaVersion: 1 })}\n${JSON.stringify({ ...triaged, schemaVersion: 1 })}\n`,
    );
  });

  it("reads an absent log as the empty string, not an error", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-asks-"));
    fixtureDirs.push(home);

    expect(readAskLifecycleText({ home })).toBe("");
  });

  /**
   * Without the leading-separator guard, this appends straight onto the missing-newline line, producing ONE
   * invalid concatenated line that `parseAskLifecycleLog` rejects whole — losing the FIRST event too, not
   * just failing to record the second.
   */
  it("inserts a separator before appending onto a file whose last line has no trailing newline", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-asks-"));
    fixtureDirs.push(home);
    const path = askLifecyclePath({ home });
    const existing = { ...CAPTURED, channel: "C_EXISTING" };
    // A hand-authored/truncated file: valid JSON, but no trailing `\n`.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, ...existing }), "utf8");

    appendAskLifecycleEvent({ event: CAPTURED, home });

    const { events, unreadable } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
    expect(unreadable).toEqual([]);
    expect(events).toEqual([existing, CAPTURED]);
  });
});

describe("startedRefForAsk", () => {
  it("recovers the checklist ref once a checklist-posted event was appended for this exact ask", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-asks-"));
    fixtureDirs.push(home);
    const posted: AskLifecycleEvent = {
      ...CAPTURED,
      kind: "checklist-posted",
      turnId: "turn-1",
      workingTs: "1785000000.000900",
    };
    appendAskLifecycleEvent({ event: CAPTURED, home });
    appendAskLifecycleEvent({ event: posted, home });

    expect(startedRefForAsk({ askIdentity: CAPTURED, home })).toEqual({
      turnId: "turn-1",
      workingTs: "1785000000.000900",
    });
  });

  it("is undefined when no checklist-posted event was ever appended for this ask", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-asks-"));
    fixtureDirs.push(home);
    appendAskLifecycleEvent({ event: CAPTURED, home });

    expect(startedRefForAsk({ askIdentity: CAPTURED, home })).toBe(undefined);
  });

  it("is undefined against an absent log — a home that has never captured an ask", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-asks-"));
    fixtureDirs.push(home);

    expect(startedRefForAsk({ askIdentity: CAPTURED, home })).toBe(undefined);
  });
});
