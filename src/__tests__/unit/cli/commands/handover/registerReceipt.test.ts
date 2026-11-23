/**
 * `handover register`'s receipt: the line a caller watches for comes first, a finding's origin, a held row's
 * set-repo step and an unplaced row's set-workspace step print only when they apply, and the path and the settle
 * command print only under `--full`.
 */

import { describe, expect, it } from "vitest";

import {
  printRegistered,
  registeredReceiptLine,
  registeredReceiptLines,
} from "../../../../../cli/commands/handover/registerReceipt.js";

/** Print one receipt through the `out` seam and return its lines. */
function receipt({
  full,
  observedBy,
  held,
  unplaced = false,
}: {
  full: boolean;
  observedBy: string | undefined;
  held: boolean;
  unplaced?: boolean;
}): readonly string[] {
  const lines: string[] = [];
  printRegistered({
    full,
    held,
    observedBy,
    unplaced,
    out: ({ line }) => {
      lines.push(line);
    },
    path: "/board/ship-the-atlas.md",
    slug: "ship-the-atlas",
  });
  return lines;
}

const RECEIPT = "handover register: ship-the-atlas is on the board";
const PATH = "  /board/ship-the-atlas.md";
const ORIGIN =
  "  origin: a fleet finding observed by session-1 — a team-facing door refuses it until the owner rules: " +
  'slopweaver handover rule ship-the-atlas --anchor <where> --words "<the owner\'s words>"';
const HELD =
  "  no --repo: `cmux spawn` cannot seat this row, so it is held rather than ready until: " +
  "slopweaver handover set-repo ship-the-atlas --repo <checkout>";
const UNPLACED =
  "  no --workspace: unless a pull request or Slack destination it names places it, only the self Queue view " +
  "shows it, marked placed by default, until: " +
  'slopweaver handover set-workspace ship-the-atlas --workspace team|self --because "<why>"';
const SETTLE =
  "  settle it with: slopweaver handover settle ship-the-atlas --as <state> --witness <value> [--card done|recut|kept]";

describe("registerReceipt", () => {
  it("names the row on the board in the line a caller watches for", () => {
    expect(registeredReceiptLine({ slug: "ship-the-atlas" })).toBe(RECEIPT);
  });

  it("prints only the receipt for an ordinary row by default", () => {
    expect(receipt({ full: false, held: false, observedBy: undefined })).toEqual([RECEIPT]);
  });

  it("prints the receipt, the path and how to settle an ordinary row under --full", () => {
    expect(receipt({ full: true, held: false, observedBy: undefined })).toEqual([RECEIPT, PATH, SETTLE]);
  });

  it("keeps a finding's observer and a held row's set-repo step by default", () => {
    expect(receipt({ full: false, held: true, observedBy: "session-1" })).toEqual([RECEIPT, ORIGIN, HELD]);
  });

  it("puts the path before and the settle line after the warnings under --full", () => {
    expect(receipt({ full: true, held: true, observedBy: "session-1" })).toEqual([RECEIPT, PATH, ORIGIN, HELD, SETTLE]);
  });

  it("keeps how to place a row registered with no workspace by default", () => {
    expect(receipt({ full: false, held: false, observedBy: undefined, unplaced: true })).toEqual([RECEIPT, UNPLACED]);
  });

  it("returns the same lines it prints", () => {
    expect(
      registeredReceiptLines({
        full: false,
        held: true,
        observedBy: undefined,
        path: "/board/ship-the-atlas.md",
        slug: "ship-the-atlas",
        unplaced: true,
      }),
    ).toEqual([RECEIPT, HELD, UNPLACED]);
  });

  it("names how to place a row registered with no workspace before the settle line under --full", () => {
    expect(receipt({ full: true, held: false, observedBy: undefined, unplaced: true })).toEqual([
      RECEIPT,
      PATH,
      UNPLACED,
      SETTLE,
    ]);
  });
});
