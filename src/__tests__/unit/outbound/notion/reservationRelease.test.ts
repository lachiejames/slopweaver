/**
 * Releasing a `notion page create` reservation the write transport refused before the wire: only this invocation's
 * own still-unconfirmed record goes, matched by intent and reservation instant. And the reading that decides it: only
 * an instance of one of the two pre-wire refusals, found along a bounded `cause` chain, proves nothing was sent.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { IngestError } from "../../../../lib/ingestError.js";
import { InvalidDatadogHostRefusedError } from "../../../../outbound/invalidDatadogHost.js";
import {
  confirmPage,
  intentRecordPath,
  readIntentRecord,
  reserveIntent,
} from "../../../../outbound/notion/pageLedger.js";
import { releaseIntentReservation } from "../../../../outbound/notion/reservationRelease.js";
import { refusedBeforeNotionWire } from "../../../../outbound/notion/sendFailure.js";
import { NotionPrivacyRefusedError } from "../../../../outbound/notion/writePrivacy.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "notion-release-"));
  homes.push(home);
  return home;
}

const AT = "2026-08-02T10:00:00.000Z";
const LATER = "2026-08-02T10:05:00.000Z";
const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";

describe("releaseIntentReservation", () => {
  it("removes this invocation's own fresh reservation, so a retry reserves fresh", () => {
    const home = tempHome();
    reserveIntent({ home, intent: "i1", nowIso: AT });
    expect(releaseIntentReservation({ home, intent: "i1", reservedIso: AT })).toBe(true);
    expect(readIntentRecord({ home, intent: "i1" })).toBe(undefined);
    expect(reserveIntent({ home, intent: "i1", nowIso: LATER })).toEqual({ kind: "fresh", reservedIso: LATER });
  });

  it("keeps a reservation another run took at a different instant", () => {
    const home = tempHome();
    reserveIntent({ home, intent: "i1", nowIso: AT });
    expect(releaseIntentReservation({ home, intent: "i1", reservedIso: LATER })).toBe(false);
    expect(readIntentRecord({ home, intent: "i1" })!.reservedIso).toBe(AT);
  });

  it("keeps a confirmed record even at the same instant", () => {
    const home = tempHome();
    reserveIntent({ home, intent: "i1", nowIso: AT });
    confirmPage({ canonical: "h", home, images: [], intent: "i1", nowIso: LATER, pageId: PAGE, url: "u" });
    expect(releaseIntentReservation({ home, intent: "i1", reservedIso: AT })).toBe(false);
    expect(readIntentRecord({ home, intent: "i1" })!.pageId).toBe(PAGE);
  });

  it("keeps an unreadable record exactly where it is", () => {
    const home = tempHome();
    reserveIntent({ home, intent: "i1", nowIso: AT });
    const path = intentRecordPath({ home, intent: "i1" });
    writeFileSync(path, "{ not json");
    expect(releaseIntentReservation({ home, intent: "i1", reservedIso: AT })).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });

  it("never removes a record another process confirmed after this one looked, before it claimed", () => {
    const home = tempHome();
    reserveIntent({ home, intent: "i1", nowIso: AT });
    const released = releaseIntentReservation({
      home,
      intent: "i1",
      interleave: ({ stage }) => {
        if (stage === "before-claim") {
          confirmPage({ canonical: "h", home, images: [], intent: "i1", nowIso: LATER, pageId: PAGE, url: "u" });
        }
      },
      reservedIso: AT,
    });
    expect(released).toBe(false);
    expect(readIntentRecord({ home, intent: "i1" })!.pageId).toBe(PAGE);
  });

  it("never touches a confirm that lands after the claim, removing only its own claimed reservation", () => {
    const home = tempHome();
    reserveIntent({ home, intent: "i1", nowIso: AT });
    const released = releaseIntentReservation({
      home,
      intent: "i1",
      interleave: ({ stage }) => {
        if (stage === "after-claim") {
          confirmPage({ canonical: "h", home, images: [], intent: "i1", nowIso: LATER, pageId: PAGE, url: "u" });
        }
      },
      reservedIso: AT,
    });
    expect(released).toBe(true);
    expect(readIntentRecord({ home, intent: "i1" })!.pageId).toBe(PAGE);
  });

  it("releases nothing when there is no record", () => {
    const home = tempHome();
    expect(releaseIntentReservation({ home, intent: "i1", reservedIso: AT })).toBe(false);
    expect(existsSync(intentRecordPath({ home, intent: "i1" }))).toBe(false);
  });
});

describe("refusedBeforeNotionWire", () => {
  const failure = ({ cause, message }: { cause: unknown; message: string }): IngestError => ({
    cause,
    kind: "network",
    message,
    operation: "notion.write",
    provider: "notion",
  });

  it("settles a privacy refusal and a dead-host refusal found as the failure's cause", () => {
    expect(
      [
        failure({ cause: new NotionPrivacyRefusedError("refused"), message: "refused" }),
        failure({ cause: new InvalidDatadogHostRefusedError("blocked"), message: "blocked" }),
      ].map((error) => refusedBeforeNotionWire({ error })),
    ).toEqual([true, true]);
  });

  it("follows a refusal wrapped a few causes deep", () => {
    const wrapped = new Error("outer", { cause: new Error("middle", { cause: new NotionPrivacyRefusedError("r") }) });
    expect(refusedBeforeNotionWire({ error: failure({ cause: wrapped, message: "outer" }) })).toBe(true);
  });

  it("never settles a lost response, a counterfeit flag or a message that only SAYS it was refused", () => {
    expect(
      [
        failure({ cause: new Error("socket hang up"), message: "socket hang up" }),
        failure({ cause: { refusedBeforeWire: true }, message: "refused before sending" }),
        failure({
          cause: { name: "NotionPrivacyRefusedError" },
          message: "notion pages.create refused before sending",
        }),
        failure({ cause: undefined, message: "the outbound privacy check stopped it" }),
      ].map((error) => refusedBeforeNotionWire({ error })),
    ).toEqual([false, false, false, false]);
  });

  it("ends on a cause cycle and on a chain longer than the bound", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    let deep: unknown = new NotionPrivacyRefusedError("too deep");
    for (let link = 0; link < 20; link += 1) {
      deep = { cause: deep };
    }
    expect(
      [failure({ cause: loop, message: "loop" }), failure({ cause: deep, message: "deep" })].map((error) =>
        refusedBeforeNotionWire({ error }),
      ),
    ).toEqual([false, false]);
  });
});
