/*
 * A reopened call's window step survives from the page to the call file's fold: the page's real line producer
 * (`site/components/voice/planWiringLines.ts`'s `reopenReminderLine`) through the real field selection the transcript
 * writer uses (`site/components/voice/transcriptToolLine.ts`), serialised as the wire carries it, parsed by the call
 * file's own schema (`callEntryOf`) and folded by the fold every reader shares (`callToolsPage` over `foldTool`).
 * The writer once dropped the measurement while the only test asserted the page's in-memory line, so nothing caught
 * it. Lives in the `src` lane because `src` reads the call file; the site modules load at run time.
 */
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type CallEntry, callEntryOf } from "../../../talk/callRecord.js";
import { callToolsPage } from "../../../talk/callTools.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const PREVIOUS = "a0000076-0000-4000-8000-000000000083";
const AT = "2026-11-06T01:12:03.140Z";

/** The page's two pure steps, loaded at run time: `src` cannot import `site/` statically. */
interface PageSteps {
  readonly reopenReminderLine: (input: { event: Record<string, unknown> }) => Record<string, unknown>;
  readonly transcriptToolLine: (input: { atIso: string; line: Record<string, unknown> }) => Record<string, unknown>;
}

/**
 * Load the page's line producer and the writer's field selection.
 *
 * @returns both steps
 */
async function loadPage(): Promise<PageSteps> {
  const lines = (await import(
    fileURLToPath(new URL("../../../../site/components/voice/planWiringLines.ts", import.meta.url))
  )) as Record<string, unknown>;
  const writer = (await import(
    fileURLToPath(new URL("../../../../site/components/voice/transcriptToolLine.ts", import.meta.url))
  )) as Record<string, unknown>;
  return {
    reopenReminderLine: lines["reopenReminderLine"] as PageSteps["reopenReminderLine"],
    transcriptToolLine: writer["transcriptToolLine"] as PageSteps["transcriptToolLine"],
  };
}

/**
 * One raw call-file line parsed by the file's own schema, then folded as every reader folds it.
 *
 * @returns the folded rows
 */
const foldedRows = ({ raw }: { raw: unknown }): ReturnType<typeof callToolsPage>["tools"] => {
  const entry: CallEntry = callEntryOf({ value: raw })!;
  return callToolsPage({ callId: CALL, entries: [entry], from: 0, limit: 10 }).tools;
};

/** A legacy-shaped tool line, its window step replaced by `reopenReminder` unless that is `undefined`. */
const rawTool = ({
  name = "reopen-reminder",
  reopenReminder,
}: {
  name?: string;
  reopenReminder: unknown;
}): Record<string, unknown> => ({
  atIso: AT,
  detail: "handed the reminder",
  kind: "tool",
  name,
  refused: false,
  ...(reopenReminder === undefined ? {} : { reopenReminder }),
});

describe("a reopened call's window step, page to fold", () => {
  it("reaches the folded row as numbers, and never as the page's latency field", async () => {
    const page = await loadPage();
    const line = page.reopenReminderLine({
      event: {
        acceptedElapsedMs: 3_140,
        elapsedMs: 3_002,
        failure: null,
        kind: "reopen-reminder",
        phase: "handed",
        previousCallId: PREVIOUS,
        reason: null,
        windowMs: 3_000,
      },
    });
    const written = page.transcriptToolLine({ atIso: AT, line });
    const rows = foldedRows({ raw: JSON.parse(JSON.stringify(written)) });
    expect(rows).toEqual([
      {
        answer: null,
        atIso: AT,
        detail: `handed the reminder after 3002 ms of the 3000 ms window, previous call ${PREVIOUS}; the voice took it at 3140 ms`,
        index: 0,
        name: "reopen-reminder",
        opened: undefined,
        refused: false,
        reopenReminder: { elapsedSinceArmedMs: 3_002, phase: "handed", previousCallId: PREVIOUS, windowMs: 3_000 },
      },
    ]);
    expect(Object.keys(written).includes("ms")).toBe(false);
  });

  it("reads a line written before the field exactly as before", () => {
    expect(foldedRows({ raw: rawTool({ reopenReminder: undefined }) })).toEqual([
      {
        answer: null,
        atIso: AT,
        detail: "handed the reminder",
        index: 0,
        name: "reopen-reminder",
        opened: undefined,
        refused: false,
      },
    ]);
  });

  // Any other tool carrying a valid measurement had it written and folded.
  it("keeps the measurement off every other tool, at the writer and at the fold", async () => {
    const page = await loadPage();
    const measurement = { elapsedSinceArmedMs: 0, phase: "armed", previousCallId: PREVIOUS, windowMs: 3_000 };
    const written = page.transcriptToolLine({
      atIso: AT,
      line: { detail: "x", name: "look", refused: false, reopenReminder: measurement },
    });
    expect([written, foldedRows({ raw: rawTool({ name: "look", reopenReminder: measurement }) })]).toEqual([
      { atIso: AT, detail: "x", kind: "tool", name: "look", refused: false },
      [
        {
          answer: null,
          atIso: AT,
          detail: "handed the reminder",
          index: 0,
          name: "look",
          opened: undefined,
          refused: false,
        },
      ],
    ]);
  });

  it.each([
    ["a negative duration", { elapsedSinceArmedMs: -1, phase: "handed", previousCallId: PREVIOUS, windowMs: 3_000 }],
    ["a fractional duration", { elapsedSinceArmedMs: 3.5, phase: "handed", previousCallId: PREVIOUS, windowMs: 3_000 }],
    ["an unknown phase", { elapsedSinceArmedMs: 3_002, phase: "sent", previousCallId: PREVIOUS, windowMs: 3_000 }],
    [
      "a previous call that is no call id",
      { elapsedSinceArmedMs: 3_002, phase: "handed", previousCallId: "call-0", windowMs: 3_000 },
    ],
    ["a missing member", { elapsedSinceArmedMs: 3_002, phase: "handed", previousCallId: PREVIOUS }],
    ["a value that is no object", "3002"],
  ])("drops %s from the line, never the line", (_label, reopenReminder) => {
    expect(foldedRows({ raw: rawTool({ reopenReminder }) })).toEqual([
      {
        answer: null,
        atIso: AT,
        detail: "handed the reminder",
        index: 0,
        name: "reopen-reminder",
        opened: undefined,
        refused: false,
      },
    ]);
  });
});
