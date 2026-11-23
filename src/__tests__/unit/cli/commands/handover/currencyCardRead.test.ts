/**
 * The strict read behind every non-ask Queue card, over a throwaway home: a whole register yields its cards, and one
 * that passed over a line yields an error naming it rather than a shorter list.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { queueLogPath } from "../../../../../admit/queueStore.js";
import { readCurrencyCardSources } from "../../../../../cli/commands/handover/currencyCardRead.js";
import { buildHandStep } from "../../../../../hand/step.js";
import { appendHandRow, handRegisterPath } from "../../../../../hand/store.js";
import { CurrencyCardReadErrors } from "../../../../../handover/currencyCards.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const CHECKED = "2026-10-02T12:00:00.000Z";
const POSTED = "2026-10-02T11:00:00.000Z";
const minted: string[] = [];

const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "currency-cards-"));
  minted.push(home);
  return home;
};

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("readCurrencyCardSources", () => {
  it("reads an empty home as no cards at all", () => {
    const read = readCurrencyCardSources({ checkedIso: CHECKED, home: freshHome() });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual([]);
  });

  it("reads a hand step waiting on the owner as its card, confirmed by the register at the check", async () => {
    const home = freshHome();
    const step = unwrap(
      buildHandStep({
        draft: {
          id: "gcloud-signin",
          postedBy: "workspace:129",
          postedIso: POSTED,
          unblocks: "handover run datadog-monitor-deploy",
          url: "https://console.cloud.google.com/",
          what: "Sign in to Google Cloud so the monitor deploy can finish",
          witness: "slopweaver hand done gcloud-signin",
        },
      }),
    );
    unwrap(await appendHandRow({ home, nowIso: POSTED, row: { kind: "posted", step } }));

    expect(unwrap(readCurrencyCardSources({ checkedIso: CHECKED, home }))).toEqual([
      {
        ask: undefined,
        fact: { atIso: CHECKED, by: "the hand register still holding it", kind: "confirmed" },
        floorIso: POSTED,
        key: "hand:gcloud-signin",
      },
    ]);
  });

  it("refuses a hand register that is a dangling link rather than reading it as a home that never posted a step", () => {
    const home = freshHome();
    mkdirSync(dirname(handRegisterPath({ home })), { recursive: true });
    symlinkSync(join(home, "gone.jsonl"), handRegisterPath({ home }));

    const read = readCurrencyCardSources({ checkedIso: CHECKED, home });

    expect(unwrapErr(read).code).toBe("CARD_SOURCE_UNREADABLE");
  });

  it("refuses a held-reply queue that is a pipe instead of hanging on it", () => {
    const home = freshHome();
    mkdirSync(join(home, "queue"), { recursive: true });
    execFileSync("mkfifo", [queueLogPath({ home })]);

    const read = readCurrencyCardSources({ checkedIso: CHECKED, home });

    expect(unwrapErr(read).code).toBe("CARD_SOURCE_UNREADABLE");
  });

  it("refuses a held-reply queue that passed over a line, naming it, rather than returning fewer cards", () => {
    const home = freshHome();
    mkdirSync(join(home, "queue"), { recursive: true });
    writeFileSync(queueLogPath({ home }), "{not json\n");

    const read = readCurrencyCardSources({ checkedIso: CHECKED, home });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)).toEqual(CurrencyCardReadErrors.partial({ lines: 1, source: "held-reply queue" }));
    expect(unwrapErr(read).message).toBe(
      "the held-reply queue passed over 1 line(s) it could not read, so a card may be missing",
    );
  });
});
