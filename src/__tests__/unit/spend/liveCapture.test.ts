// The legacy source-path case went out with the pattern that named it.
// deleted-with-code: PRONOUN_LIVE_SOURCE_PATH
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { snapshotFromCapture } from "../../../spend/liveCapture.js";
import { LiveCaptureErrors } from "../../../spend/liveErrors.js";
import type { CardTransaction } from "../../../spend/types.js";
import {
  CAPTURED_AT,
  CARD_ID,
  calibration,
  details,
  ENTITY,
  limits,
  MERCHANT,
  NICKNAME,
  OTHER_CARD_ID,
  REASON,
  row,
  STORED_DECLINE,
  transactions,
  ZONE,
} from "./liveFixture.js";

describe("snapshotFromCapture", () => {
  it("maps the card's limits and declines in major units, carrying Airwallex's reason", () => {
    const live = unwrap(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [details(), limits(), transactions({ rows: [row({ id: "t1" })], totalCount: 3 })],
        timeZone: ZONE,
      }),
    );
    expect(live.rowsRead).toBe(1);
    expect(live.rowsOnCard).toBe(3);
    expect(live.snapshot).toEqual({
      asOf: "2026-09-29",
      last4: "0042",
      merchantAllow: null,
      monthly: {
        limit: { currency: "AUD", minor: 250000 },
        resetNote: null,
        resetsOn: "2026-09-30",
        used: { currency: "AUD", minor: 123450 },
      },
      nickname: NICKNAME,
      organisation: ENTITY,
      provider: "airwallex",
      schemaVersion: 1,
      source: { importedAt: CAPTURED_AT, kind: "live", path: "the owner's Airwallex card page, read live" },
      transactionLimit: { currency: "AUD", minor: 100000 },
      transactions: [
        {
          amount: { currency: "AUD", minor: 15500 },
          date: "2026-09-25",
          declineReason: REASON,
          merchant: MERCHANT,
          ordinal: 0,
          status: "declined",
        },
      ],
    });
  });

  it("maps every status code the owner's card answered, in a MONTHLY window, as the page's Status column shows it", () => {
    const live = unwrap(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [
          details(),
          limits({ windowType: "MONTHLY" }),
          transactions({
            rows: [
              row({ id: "t1" }),
              row({ failureReason: null, id: "t2", status: "SUCCESSFUL" }),
              row({ failureReason: null, id: "t3", status: "REVERSED" }),
              row({ failureReason: null, id: "t4", status: "VERIFIED" }),
            ],
            totalCount: 4,
          }),
        ],
        timeZone: ZONE,
      }),
    );
    expect(live.snapshot.transactions.map((transaction) => transaction.status)).toEqual([
      "declined",
      "charged",
      "cancelled",
      "card-verification",
    ]);
  });

  it("reads minor units when the live limit already equals the stored minor figure", () => {
    const live = unwrap(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [
          details(),
          limits({ limitAmount: 250000, spendAmount: 123450 }),
          transactions({ rows: [row({ amount: 15500, id: "t1" })], totalCount: 1 }),
        ],
        timeZone: ZONE,
      }),
    );
    expect(live.snapshot.monthly.used).toEqual({ currency: "AUD", minor: 123450 });
    expect(live.snapshot.transactions[0]!.amount).toEqual({ currency: "AUD", minor: 15500 });
  });

  it("reads an instant as the day the owner's zone prints it, across the UTC day boundary", () => {
    const live = unwrap(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: "2026-09-29T15:30:00.000Z",
        responses: [
          details(),
          limits(),
          transactions({ rows: [row({ date: "2026-09-24T15:30:00.000Z", id: "t1" })], totalCount: 1 }),
        ],
        timeZone: ZONE,
      }),
    );
    expect(live.snapshot.transactions[0]!.date).toBe("2026-09-25");
    expect(live.snapshot.asOf).toBe("2026-09-30");
    expect(live.snapshot.monthly.resetsOn).toBe("2026-09-30");
  });

  it("keeps only the stored card's answers when the page also answers for another card", () => {
    const live = unwrap(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [
          details({ id: OTHER_CARD_ID, nickname: "Another card" }),
          details(),
          limits({ id: OTHER_CARD_ID, limitAmount: 9999 }),
          limits(),
          transactions({ rows: [row({ cardId: OTHER_CARD_ID, id: "o1" })], totalCount: 40 }),
          transactions({ rows: [row({ id: "t1" }), row({ id: "t2" })], totalCount: 2 }),
          transactions({ rows: [row({ id: "t2" })], totalCount: 2 }),
        ],
        timeZone: ZONE,
      }),
    );
    expect(live.rowsRead).toBe(2);
    expect(live.rowsOnCard).toBe(2);
    expect(live.snapshot.transactions.map((transaction) => transaction.ordinal)).toEqual([0, 1]);
  });

  it("refuses a page that never answered an operation the snapshot needs", () => {
    expect(
      unwrapErr(
        snapshotFromCapture({
          calibration: calibration(),
          capturedAt: CAPTURED_AT,
          responses: [details(), limits()],
          timeZone: ZONE,
        }),
      ),
    ).toEqual(LiveCaptureErrors.operationMissing({ operation: "TransactionSearchByCardId" }));
  });

  it("refuses a body off the discovered shape by field path, never by value", () => {
    const refusal = unwrapErr(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [details(), limits({ spendAmount: "1234.50 AUD" }), transactions({ rows: [], totalCount: 0 })],
        timeZone: ZONE,
      }),
    );
    expect(refusal.code).toBe("LIVE_BODY_INVALID");
    expect(refusal.message).toContain("data.getCard.monthly.spendAmount");
    expect(refusal.message).not.toContain("1234.50");
  });

  it("refuses when no card on the page carries the stored nickname", () => {
    expect(
      unwrapErr(
        snapshotFromCapture({
          calibration: calibration(),
          capturedAt: CAPTURED_AT,
          responses: [details({ nickname: "Another card" }), limits(), transactions({ rows: [], totalCount: 0 })],
          timeZone: ZONE,
        }),
      ),
    ).toEqual(LiveCaptureErrors.cardNotOnPage({ last4: "0042" }));
  });

  it("names every unknown code in one refusal, and no value off the page", () => {
    const refusal = unwrapErr(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [
          details(),
          limits({ windowType: "ROLLING_30_DAYS" }),
          transactions({
            rows: [
              row({ failureReason: null, id: "t1", status: "APPROVED" }),
              row({ failureReason: null, id: "t2", status: "PENDING" }),
              row({ date: "25/09/2026", id: "t3" }),
            ],
            totalCount: 3,
          }),
        ],
        timeZone: ZONE,
      }),
    );
    expect(refusal).toEqual(
      LiveCaptureErrors.uncalibrated({
        problems: [
          "monthly window type ROLLING_30_DAYS is not in CALENDAR_MONTH_WINDOWS, so its reset is not known",
          "status code(s) APPROVED, PENDING are not in STATUS_OF — add each with what the page's Status column shows",
          "1 row(s) carry a date that is neither a YYYY-MM-DD day nor an instant with an offset",
        ],
      }),
    );
    for (const value of [CARD_ID, NICKNAME, ENTITY, MERCHANT, REASON, "155", "0000"]) {
      expect(refusal.message).not.toContain(value);
    }
  });

  it("refuses a live limit that is the stored one in neither unit", () => {
    const refusal = unwrapErr(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [details(), limits({ limitAmount: 3000 }), transactions({ rows: [], totalCount: 0 })],
        timeZone: ZONE,
      }),
    );
    expect(refusal).toEqual(
      LiveCaptureErrors.uncalibrated({
        problems: [
          "the live monthly limit is the stored one in neither major nor minor units — the limit changed, or the " +
            "unit is neither; re-import a pasted export to recalibrate",
        ],
      }),
    );
  });

  it("refuses rows whose amounts disagree with the stored rows at the limit's unit", () => {
    const refusal = unwrapErr(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [details(), limits(), transactions({ rows: [row({ amount: 15500, id: "t1" })], totalCount: 1 })],
        timeZone: ZONE,
      }),
    );
    expect(refusal).toEqual(
      LiveCaptureErrors.uncalibrated({
        problems: [
          "none of the 1 row(s) the stored snapshot also holds matches its amount at the limit's unit, so the rows " +
            "are in another unit",
        ],
      }),
    );
  });

  it("refuses rows the stored snapshot shares no day with, since nothing then checks their unit", () => {
    const stored: CardTransaction = { ...STORED_DECLINE, date: "2026-08-02" };
    const refusal = unwrapErr(
      snapshotFromCapture({
        calibration: calibration({ transactions: [stored] }),
        capturedAt: CAPTURED_AT,
        responses: [details(), limits(), transactions({ rows: [row({ amount: 15500, id: "t1" })], totalCount: 1 })],
        timeZone: ZONE,
      }),
    );
    expect(refusal).toEqual(
      LiveCaptureErrors.uncalibrated({
        problems: [
          "no live row shares a day, status and currency with a row the stored snapshot holds, so the rows' unit is " +
            "unchecked — `spend import` a paste of the card from inside this month to recalibrate",
        ],
      }),
    );
  });

  it("refuses when the page answered limits only for another card", () => {
    expect(
      unwrapErr(
        snapshotFromCapture({
          calibration: calibration(),
          capturedAt: CAPTURED_AT,
          responses: [details(), limits({ id: OTHER_CARD_ID }), transactions({ rows: [], totalCount: 0 })],
          timeZone: ZONE,
        }),
      ),
    ).toEqual(LiveCaptureErrors.operationMissing({ operation: "GetCardLimits for the card" }));
  });

  it("refuses two cards carrying the stored nickname, since which is --last4 is not known", () => {
    expect(
      unwrapErr(
        snapshotFromCapture({
          calibration: calibration(),
          capturedAt: CAPTURED_AT,
          responses: [details(), details({ id: OTHER_CARD_ID }), limits(), transactions({ rows: [], totalCount: 0 })],
          timeZone: ZONE,
        }),
      ),
    ).toEqual(
      LiveCaptureErrors.uncalibrated({
        problems: ["2 cards on the page carry the stored nickname, so which is --last4 is not known"],
      }),
    );
  });

  it("names a foreign currency, a window with no limit and two entities in one refusal", () => {
    expect(
      unwrapErr(
        snapshotFromCapture({
          calibration: calibration(),
          capturedAt: CAPTURED_AT,
          responses: [
            details({ entities: [ENTITY, "Another Pty Ltd"] }),
            limits({ currency: "USD", limitAmount: null }),
            transactions({ rows: [], totalCount: 0 }),
          ],
          timeZone: ZONE,
        }),
      ),
    ).toEqual(
      LiveCaptureErrors.uncalibrated({
        problems: [
          "the monthly limit is in USD, the stored one in AUD",
          "the monthly window carries no limit, so the amounts' unit cannot be calibrated",
          "the card's cardholders name 2 entities, not one",
        ],
      }),
    );
  });

  it("refuses a capture whose own time is no instant, rather than dating the snapshot by guess", () => {
    expect(
      unwrapErr(
        snapshotFromCapture({
          calibration: calibration(),
          capturedAt: "yesterday",
          responses: [details(), limits(), transactions({ rows: [], totalCount: 0 })],
          timeZone: ZONE,
        }),
      ),
    ).toEqual(LiveCaptureErrors.uncalibrated({ problems: ["the capture's own time is not an instant"] }));
  });

  it("stores a page with no rows at all, since there is no row unit to check", () => {
    const live = unwrap(
      snapshotFromCapture({
        calibration: calibration(),
        capturedAt: CAPTURED_AT,
        responses: [details(), limits(), transactions({ rows: [], totalCount: 0 })],
        timeZone: ZONE,
      }),
    );
    expect(live.snapshot.transactions).toEqual([]);
  });
});
