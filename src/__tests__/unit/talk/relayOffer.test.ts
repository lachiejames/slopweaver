/*
 * What `talk relay` accepts of a staged copy-tray offer: the call file's own bounds, an id that is the page's
 * `offer-<made>`, and the five fields and nothing else — and the digest line that binds all five.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TalkErrors } from "../../../talk/errors.js";
import { relayOfferDigestLine, relayOfferOf } from "../../../talk/relayOffer.js";

const WIRE = { belowFold: "the rest\n```", id: "offer-12", label: "reply to Ari", made: "12", text: "  Head `x`  " };

describe("relayOfferOf", () => {
  it("keeps every byte of the five fields, and drops anything else the file carried", () => {
    expect(unwrap(relayOfferOf({ value: { ...WIRE, extra: "not carried" } }))).toStrictEqual(WIRE);
  });

  it("reads an absent fold and label as none", () => {
    expect(unwrap(relayOfferOf({ value: { id: "offer-0", made: "0", text: "Merged" } }))).toEqual({
      belowFold: undefined,
      id: "offer-0",
      label: undefined,
      made: "0",
      text: "Merged",
    });
  });

  it("refuses an id that is not the page's offer-<made> for the same made", () => {
    expect(unwrapErr(relayOfferOf({ value: { ...WIRE, id: "offer-13" } }))).toEqual(
      TalkErrors.offeredInvalid({ why: "names id offer-13, but the page's id for made 12 is offer-12" }),
    );
  });

  it("refuses what the call file would refuse, naming the field", () => {
    const failures = [
      relayOfferOf({ value: "Merged" }),
      relayOfferOf({ value: { ...WIRE, text: "   " } }),
      relayOfferOf({ value: { ...WIRE, made: "012", id: "offer-012" } }),
      relayOfferOf({ value: { ...WIRE, label: "x".repeat(81) } }),
      relayOfferOf({ value: { ...WIRE, belowFold: "y".repeat(8192) } }),
    ].map((result) => unwrapErr(result));
    expect(failures.map((failure) => failure.code)).toEqual(Array.from({ length: 5 }, () => "OFFERED_INVALID"));
    expect(failures[1]!.message).toContain("text: blank");
    expect(failures[3]!.message).toContain("label: label too long");
    expect(failures[4]!.message).toContain("the message is over the list's bound");
  });
});

describe("relayOfferDigestLine", () => {
  it("is the sha256 of the five fields as one JSON object, in a fixed key order", () => {
    const offered = unwrap(relayOfferOf({ value: WIRE }));
    const json = JSON.stringify({
      belowFold: WIRE.belowFold,
      id: WIRE.id,
      label: WIRE.label,
      made: WIRE.made,
      text: WIRE.text,
    });
    expect(relayOfferDigestLine({ offered })).toBe(
      `\noffered:${createHash("sha256").update(json, "utf8").digest("hex")}`,
    );
  });

  it("differs when a fold is absent rather than empty-looking", () => {
    const folded = unwrap(relayOfferOf({ value: { ...WIRE, belowFold: "x", text: "Head" } }));
    const joined = unwrap(relayOfferOf({ value: { ...WIRE, belowFold: undefined, text: "Head\nx" } }));
    expect(relayOfferDigestLine({ offered: folded })).not.toBe(relayOfferDigestLine({ offered: joined }));
  });

  it("is empty for a relay carrying no offer, so its digest is what it was before offers rode a relay", () => {
    expect(relayOfferDigestLine({ offered: undefined })).toBe("");
  });
});
