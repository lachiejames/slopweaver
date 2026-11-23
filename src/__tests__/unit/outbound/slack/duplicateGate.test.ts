import { describe, expect, it } from "vitest";

import type { DoorRequest } from "../../../../admit/types.js";
import {
  DUPLICATE_SEND_CODE,
  DUPLICATE_SEND_OVERRIDE,
  destinationLabel,
  duplicateSendGate,
  OVERRIDE_REMEDY,
  type PriorSend,
  priorSendFrom,
  RESEND_UNCONFIRMED_REMEDY,
} from "../../../../outbound/slack/duplicateGate.js";

const FIRST_SENT = "2026-09-02T03:25:38.035Z";

/** A door request carrying a duplicate key. */
function requestWith({ duplicateKey }: { duplicateKey: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "post" },
    artifact: { duplicateKey },
    meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
  };
}

/** A prior send of `k1` into a named thread, CONFIRMED unless the caller drops `sentTs`. */
function prior(over: Partial<PriorSend> = {}): PriorSend {
  return {
    destination: "C0BT (thread 1788300842.366979)",
    duplicateKey: "k1",
    firstSentIso: FIRST_SENT,
    sentTs: "1788322310.030659",
    ...over,
  };
}

describe("destinationLabel", () => {
  it("is the bare channel when the send is not a thread reply", () => {
    expect(destinationLabel({ channel: "C0BT" })).toBe("C0BT");
  });

  it("names the thread when there is one", () => {
    expect(destinationLabel({ channel: "C0BT", threadTs: "1788300842.366979" })).toBe(
      "C0BT (thread 1788300842.366979)",
    );
  });
});

describe("duplicateSendGate", () => {
  it("WARNS, naming the destination, when a confirmed send of the same key is in the window", () => {
    const gate = duplicateSendGate({ prior: prior(), unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY, windowHours: 24 });
    expect(gate(requestWith({ duplicateKey: "k1" }))).toEqual([
      {
        code: DUPLICATE_SEND_CODE,
        correction:
          "an identical message landed in C0BT (thread 1788300842.366979) at 2026-09-02T03:25:38.035Z " +
          "(ts 1788322310.030659), inside the last 24h. Change the message, or — if the repeat is deliberate " +
          `— re-run with SLOPWEAVER_DOOR_OVERRIDE=${DUPLICATE_SEND_OVERRIDE}`,
        override: DUPLICATE_SEND_OVERRIDE,
        severity: "warn",
        summary: "this exact message has already gone out to C0BT (thread 1788300842.366979) under this identity",
      },
    ]);
  });

  it("does NOT claim a delivery it cannot prove when the prior send was never confirmed", () => {
    const gate = duplicateSendGate({
      prior: { ...prior(), sentTs: undefined },
      unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY,
      windowHours: 24,
    });
    expect(gate(requestWith({ duplicateKey: "k1" }))).toEqual([
      {
        code: DUPLICATE_SEND_CODE,
        correction:
          "an identical message was reserved for C0BT (thread 1788300842.366979) at 2026-09-02T03:25:38.035Z, " +
          "inside the last 24h, and never confirmed — read C0BT (thread 1788300842.366979) before retrying. " +
          "If nothing landed there, re-run with --resend-unconfirmed",
        override: DUPLICATE_SEND_OVERRIDE,
        severity: "warn",
        summary:
          "an identical message to C0BT (thread 1788300842.366979) was reserved but never confirmed — " +
          "it may never have been sent",
      },
    ]);
  });

  it("names the LANE's remedy for an unconfirmed prior — a poll has only the override", () => {
    // Measured: the card lane's warning sent the operator to the override, which means "repeat it
    // regardless" and was then refused by the reservation itself. The flag that exists for exactly this case
    // is what the card lane names; a lane without the flag says what it actually has.
    const gate = duplicateSendGate({
      prior: { ...prior(), sentTs: undefined },
      unconfirmedRemedy: OVERRIDE_REMEDY,
      windowHours: 24,
    });
    expect(gate(requestWith({ duplicateKey: "k1" }))[0]!.correction).toContain(
      `If nothing landed there, re-run with SLOPWEAVER_DOOR_OVERRIDE=${DUPLICATE_SEND_OVERRIDE}`,
    );
    expect(RESEND_UNCONFIRMED_REMEDY).toBe("re-run with --resend-unconfirmed");
  });

  it("is a WARN, never a hold — a deliberate repeat must remain possible", () => {
    const gate = duplicateSendGate({ prior: prior(), unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY, windowHours: 24 });
    expect(gate(requestWith({ duplicateKey: "k1" }))[0]!.severity).toBe("warn");
  });

  it("PASSES a send whose content differs", () => {
    const gate = duplicateSendGate({ prior: prior(), unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY, windowHours: 24 });
    expect(gate(requestWith({ duplicateKey: "k2" }))).toEqual([]);
  });

  it("PASSES when nothing has been sent yet", () => {
    const gate = duplicateSendGate({ prior: null, unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY, windowHours: 24 });
    expect(gate(requestWith({ duplicateKey: "k1" }))).toEqual([]);
  });

  it("PASSES a request that carries no duplicate key at all", () => {
    const gate = duplicateSendGate({ prior: prior(), unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY, windowHours: 24 });
    const request: DoorRequest = {
      action: { kind: "verb", noun: "slack", verb: "post" },
      artifact: {},
      meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
    };
    expect(gate(request)).toEqual([]);
  });

  it("quotes the window it was built with", () => {
    const gate = duplicateSendGate({ prior: prior(), unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY, windowHours: 6 });
    expect(gate(requestWith({ duplicateKey: "k1" }))[0]!.correction).toContain("inside the last 6h");
  });
});

describe("priorSendFrom", () => {
  it("is null when nothing is reserved for the key", () => {
    expect(priorSendFrom({ destination: "C0BT", duplicateKey: "k1", reservation: { kind: "fresh" } })).toBe(null);
  });

  it("carries the confirmed timestamp through, so the gate may say the message landed", () => {
    expect(
      priorSendFrom({
        destination: "C0BT",
        duplicateKey: "k1",
        reservation: { firstSentIso: FIRST_SENT, kind: "duplicate", sentTs: "1788322310.030659" },
      }),
    ).toEqual({
      destination: "C0BT",
      duplicateKey: "k1",
      firstSentIso: FIRST_SENT,
      sentTs: "1788322310.030659",
    });
  });

  it("OMITS sentTs for a reservation nothing confirmed, so no delivery can be claimed", () => {
    expect(
      priorSendFrom({
        destination: "C0BT",
        duplicateKey: "k1",
        reservation: { firstSentIso: FIRST_SENT, kind: "duplicate" },
      }),
    ).toEqual({ destination: "C0BT", duplicateKey: "k1", firstSentIso: FIRST_SENT });
  });
});
