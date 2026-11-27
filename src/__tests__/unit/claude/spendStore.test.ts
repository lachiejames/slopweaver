/**
 * Spend readings round-tripped through a real readings ledger in a throwaway home: the newest reading for the plan
 * asked about, inside the freshness bound only, and a refusal rather than a skip on a document it cannot read.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { ClaudeSpendErrors } from "../../../claude/spendErrors.js";
import type { ClaudeSpendReading } from "../../../claude/spendPolicy.js";
import {
  CLAUDE_SPEND_PRODUCER,
  latestClaudeSpendReading,
  parseClaudeSpendReading,
  recordClaudeSpendReading,
} from "../../../claude/spendStore.js";
import { readingsInWindow, recordReading } from "../../../readings/store.js";

const NOW = "2026-11-04T10:00:00.000Z";

/** A reading for one plan at one instant. */
function readingOf({
  alias,
  observedAtIso,
  usedMinor,
}: {
  alias: string;
  observedAtIso: string;
  usedMinor: number;
}): ClaudeSpendReading {
  return {
    alias,
    currency: "USD",
    decimalPlaces: 2,
    isEnabled: true,
    monthlyLimitMinor: 50_000,
    observedAtIso,
    spendLimitReached: false,
    usedMinor,
  };
}

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-claude-spend-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Record one reading, at its own observed instant. */
function record({ reading }: { reading: ClaudeSpendReading }): void {
  unwrap(recordClaudeSpendReading({ home, nowIso: reading.observedAtIso, reading }));
}

describe("latestClaudeSpendReading", () => {
  it("is undefined on a home that recorded nothing", () => {
    const latest = latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW });
    expect(latest.isOk()).toBe(true);
    expect(unwrap(latest)).toBeUndefined();
  });

  it("reads back the newest reading for the plan asked about, past another plan's newer one", () => {
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:10:00.000Z", usedMinor: 100 }) });
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:40:00.000Z", usedMinor: 200 }) });
    record({ reading: readingOf({ alias: "plan-seven", observedAtIso: "2026-11-04T09:50:00.000Z", usedMinor: 900 }) });
    const latest = latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW });
    expect(unwrap(latest)).toEqual(
      readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:40:00.000Z", usedMinor: 200 }),
    );
  });

  it("reads the reading recorded LAST when two were observed at the same instant, so a lower one cannot mask it", () => {
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:40:00.000Z", usedMinor: 10_000 }) });
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:40:00.000Z", usedMinor: 30_000 }) });
    const latest = latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW });
    expect(unwrap(latest)).toEqual(
      readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:40:00.000Z", usedMinor: 30_000 }),
    );
  });

  it("reads a reading observed after now, never the older one before it, so the verdict sees the untrusted clock", () => {
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:50:00.000Z", usedMinor: 10_000 }) });
    const future = readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T10:30:00.000Z", usedMinor: 30_000 });
    unwrap(recordClaudeSpendReading({ home, nowIso: "2026-11-04T09:55:00.000Z", reading: future }));
    expect(unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }))).toEqual(future);
  });

  it("reads a reading observed past year 9999, an instant that still parses, rather than the older one", () => {
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:50:00.000Z", usedMinor: 10_000 }) });
    const far = readingOf({ alias: "plan-six", observedAtIso: "+010000-01-01T00:00:00.000Z", usedMinor: 30_000 });
    unwrap(recordClaudeSpendReading({ home, nowIso: "2026-11-04T09:55:00.000Z", reading: far }));
    expect(unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }))).toEqual(far);
  });

  it("leaves unread a reading RECORDED after now, so a replay at a frozen instant sees nothing from after it", () => {
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:50:00.000Z", usedMinor: 10_000 }) });
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T10:30:00.000Z", usedMinor: 30_000 }) });
    expect(unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }))).toEqual(
      readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T09:50:00.000Z", usedMinor: 10_000 }),
    );
  });

  it("leaves a reading older than an hour unread", () => {
    record({ reading: readingOf({ alias: "plan-six", observedAtIso: "2026-11-04T08:30:00.000Z", usedMinor: 100 }) });
    expect(unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }))).toBeUndefined();
  });

  it("refuses a recorded document that is not a spend reading, rather than passing over it", () => {
    unwrap(
      recordReading({
        by: "a test",
        document: JSON.stringify({ alias: "plan-six", spent: "lots" }),
        home,
        nowIso: "2026-11-04T09:45:00.000Z",
        observedAtIso: "2026-11-04T09:45:00.000Z",
        producer: CLAUDE_SPEND_PRODUCER,
      }),
    );
    const latest = latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW });
    expect(unwrapErr(latest).code).toBe("SPEND_READING_UNREADABLE");
  });

  it("refuses a ledger it cannot read rather than reporting no reading", () => {
    mkdirSync(join(home, "readings"), { recursive: true });
    writeFileSync(join(home, "readings", "index.jsonl"), "not json\n");
    const latest = latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW });
    expect(unwrapErr(latest).code).toBe("SPEND_READING_UNREADABLE");
  });

  it("refuses a corrupt index line by its number alone, never quoting a path the line holds", () => {
    const quoted = join(home, "readings", "private.json");
    mkdirSync(join(home, "readings"), { recursive: true });
    writeFileSync(
      join(home, "readings", "index.jsonl"),
      `{${JSON.stringify(quoted)}: 1, ${JSON.stringify(quoted)}: 2}\n`,
    );
    // The witness that the input carries the path: the ledger's own failure quotes it.
    const raw = unwrapErr(
      readingsInWindow({ fromIso: "2026-11-04T09:00:00.000Z", home, producer: CLAUDE_SPEND_PRODUCER, toIso: NOW }),
    );
    expect(raw.message).toContain(quoted);

    const latest = latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW });

    expect(unwrapErr(latest)).toStrictEqual({
      code: "SPEND_READING_UNREADABLE",
      message: "a recorded spend reading could not be read: readings index line 1 is not a reading row",
    });
  });

  it("refuses to record while another writer holds the ledger's lock, naming no path of the lock it met", () => {
    const lock = unwrap(acquireOperationLock({ home, key: "readings-ledger", nowIso: NOW }));
    try {
      const recorded = recordClaudeSpendReading({
        home,
        nowIso: NOW,
        reading: readingOf({ alias: "plan-six", observedAtIso: NOW, usedMinor: 100 }),
      });
      expect(unwrapErr(recorded)).toStrictEqual({
        code: "SPEND_READING_UNREADABLE",
        message:
          "a recorded spend reading could not be read: " +
          "another session is writing the readings ledger right now — nothing was written; try again",
      });
    } finally {
      lock.release();
    }
  });

  it("refuses a now that is not an instant", () => {
    const latest = latestClaudeSpendReading({ alias: "plan-six", home, nowIso: "soon" });
    expect(unwrapErr(latest).message).toContain("soon");
  });
});

describe("recordClaudeSpendReading", () => {
  it("refuses a reading that can cover sends yet carries no spend, and records nothing", () => {
    const reading = { ...readingOf({ alias: "plan-six", observedAtIso: NOW, usedMinor: 1 }), usedMinor: null };
    const recorded = recordClaudeSpendReading({ home, nowIso: NOW, reading });
    expect(unwrapErr(recorded)).toEqual(ClaudeSpendErrors.amountAbsent({ fields: ["used_credits"] }));
    expect(unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }))).toBeUndefined();
  });

  it("refuses a spend that is not a number, which would otherwise serialise as null, and records nothing", () => {
    const reading = readingOf({ alias: "plan-six", observedAtIso: NOW, usedMinor: Number.NaN });
    const recorded = recordClaudeSpendReading({ home, nowIso: NOW, reading });
    expect(unwrapErr(recorded)).toEqual(ClaudeSpendErrors.amountAbsent({ fields: ["used_credits"] }));
    expect(unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }))).toBeUndefined();
  });

  it("records a disabled reading with null amounts, since the refusal is the provider's own", () => {
    const reading: ClaudeSpendReading = {
      alias: "plan-six",
      currency: null,
      decimalPlaces: null,
      isEnabled: false,
      monthlyLimitMinor: null,
      observedAtIso: NOW,
      spendLimitReached: false,
      usedMinor: null,
    };
    record({ reading });
    expect(unwrap(latestClaudeSpendReading({ alias: "plan-six", home, nowIso: NOW }))).toEqual(reading);
  });
});

describe("parseClaudeSpendReading", () => {
  it("refuses a recorded document that can cover sends yet carries no limit, rather than reading a hole", () => {
    const parsed = parseClaudeSpendReading({
      document: { ...readingOf({ alias: "plan-six", observedAtIso: NOW, usedMinor: 1 }), monthlyLimitMinor: null },
    });
    expect(unwrapErr(parsed).code).toBe("SPEND_READING_UNREADABLE");
    expect(unwrapErr(parsed).message).toContain("monthly_limit");
  });

  it("refuses a document with a field this build does not write", () => {
    const parsed = parseClaudeSpendReading({
      document: { ...readingOf({ alias: "plan-six", observedAtIso: NOW, usedMinor: 1 }), seats: 3 },
    });
    expect(unwrapErr(parsed).code).toBe("SPEND_READING_UNREADABLE");
  });
});
