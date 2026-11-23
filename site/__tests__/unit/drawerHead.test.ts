/*
 * The drawer's header, which is the defect the owner actually reported: the heading said "Recorded ask"
 * — the register's word for itself — where the ask belonged. These cases pin the SUBTITLE; that the heading is
 * the question is asserted over the derived card in `queueCard.test.ts`, since that is where the question is
 * composed.
 */

import { describe, expect, it } from "vitest";

import { panelSubtitleParts } from "../../lib/drawerHead";

describe("panelSubtitleParts", () => {
  it("carries the subject and the age, in that order, and never the register's word for itself", () => {
    expect(panelSubtitleParts({ age: "2h", subject: "acme/app review ask" })).toEqual([
      { kind: "subject", text: "acme/app review ask" },
      { kind: "age", text: "2h" },
    ]);
  });

  it("drops an absent age rather than saying it", () => {
    expect(panelSubtitleParts({ age: undefined, subject: "acme/app review ask" })).toEqual([
      { kind: "subject", text: "acme/app review ask" },
    ]);
  });

  it("draws no subject where the row's subject is only its slug", () => {
    expect(panelSubtitleParts({ age: "2h", subject: undefined })).toEqual([{ kind: "age", text: "2h" }]);
  });
});
