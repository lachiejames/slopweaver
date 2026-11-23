/*
 * The lap seat's pure half: decoding `seat.json` strictly, and judging whether one invocation of `github lap` may
 * run while a designation stands.
 */

import { describe, expect, it } from "vitest";

import {
  decodeLapSeat,
  type LapSeat,
  lapSeatRefusalDetail,
  lapSeatVerdict,
} from "../../../../../cli/commands/github/lapSeat.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SEAT: LapSeat = { setIso: "2026-11-11T12:00:00.000Z", slug: "lap-seat-run" };

describe("lapSeatVerdict", () => {
  it("proceeds when no seat is designated", () => {
    expect(lapSeatVerdict({ facts: { callerRun: "any-run", seat: undefined, seatRunClosed: false } })).toEqual({
      kind: "proceed",
    });
  });

  it("proceeds when the caller holds the seat's run", () => {
    expect(lapSeatVerdict({ facts: { callerRun: "lap-seat-run", seat: SEAT, seatRunClosed: false } })).toEqual({
      kind: "proceed",
    });
  });

  it("refuses a caller holding another run, naming the seat", () => {
    expect(lapSeatVerdict({ facts: { callerRun: "reseated-run", seat: SEAT, seatRunClosed: false } })).toEqual({
      kind: "refuse",
      reason: "off-seat",
      seatSlug: "lap-seat-run",
    });
  });

  it("refuses a caller whose run cannot be established", () => {
    expect(lapSeatVerdict({ facts: { callerRun: undefined, seat: SEAT, seatRunClosed: false } })).toEqual({
      kind: "refuse",
      reason: "caller-undetermined",
      seatSlug: "lap-seat-run",
    });
  });

  it("refuses everyone once the seat's run has closed, the seat's own run included, rather than lapsing the rota", () => {
    expect(lapSeatVerdict({ facts: { callerRun: "reseated-run", seat: SEAT, seatRunClosed: true } })).toEqual({
      kind: "refuse",
      reason: "seat-closed",
      seatSlug: "lap-seat-run",
    });
    expect(lapSeatVerdict({ facts: { callerRun: "lap-seat-run", seat: SEAT, seatRunClosed: true } })).toEqual({
      kind: "refuse",
      reason: "seat-closed",
      seatSlug: "lap-seat-run",
    });
  });
});

describe("lapSeatRefusalDetail", () => {
  it("names the seat, the caller's run and the route through the chair", () => {
    const detail = lapSeatRefusalDetail({
      callerRun: "reseated-run",
      verdict: { kind: "refuse", reason: "off-seat", seatSlug: "lap-seat-run" },
    });
    expect(detail).toContain("the lap seat is lap-seat-run");
    expect(detail).toContain("this session holds the run reseated-run");
    expect(detail).toContain("Send your pull request number(s) and head SHA(s) to the chair instead");
  });

  it("says the caller holds no run when none was established", () => {
    const detail = lapSeatRefusalDetail({
      callerRun: undefined,
      verdict: { kind: "refuse", reason: "caller-undetermined", seatSlug: "lap-seat-run" },
    });
    expect(detail).toContain("this session holds no run its branch, its directory or a sole open journal names");
  });

  it("names the closed seat and the chair's two ways out", () => {
    const detail = lapSeatRefusalDetail({
      callerRun: "reseated-run",
      verdict: { kind: "refuse", reason: "seat-closed", seatSlug: "lap-seat-run" },
    });
    expect(detail).toBe(
      "the lap seat lap-seat-run names a closed run, so no session holds the seat. " +
        "The chair designates an open run (`github lap-seat set <slug>`) or ends the rota (`github lap-seat clear`)",
    );
  });
});

describe("decodeLapSeat", () => {
  it("decodes a designation without a setter", () => {
    expect(unwrap(decodeLapSeat({ value: { setIso: SEAT.setIso, slug: SEAT.slug } }))).toEqual(SEAT);
  });

  it("keeps the setter when one is recorded", () => {
    const value = { setBy: "session-1", setIso: SEAT.setIso, slug: SEAT.slug };
    expect(unwrap(decodeLapSeat({ value }))).toEqual(value);
  });

  it("refuses an unknown field rather than dropping it", () => {
    const decoded = decodeLapSeat({ value: { extra: 1, setIso: SEAT.setIso, slug: SEAT.slug } });
    expect(decoded.isErr()).toBe(true);
    expect(unwrapErr(decoded).join("; ")).toContain("extra");
  });

  it("refuses a slug that is not a usable run name", () => {
    const decoded = decodeLapSeat({ value: { setIso: SEAT.setIso, slug: "../escape" } });
    expect(unwrapErr(decoded)).toEqual(["slug: not a usable run slug"]);
  });

  it("refuses an instant that is not an ISO datetime", () => {
    const decoded = decodeLapSeat({ value: { setIso: "yesterday", slug: SEAT.slug } });
    expect(unwrapErr(decoded).join("; ")).toContain("setIso");
  });

  it("refuses a document that is not an object, naming the root", () => {
    const decoded = decodeLapSeat({ value: "seat" });
    expect(unwrapErr(decoded).join("; ")).toContain("(root)");
  });
});
