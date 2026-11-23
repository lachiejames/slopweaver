/*
 * A call-thread entry as stored: inline binary replaced by its digest, secrets masked by label, an oversized capture
 * cut on UTF-8 boundaries with the cut stated, and a capture that cannot be kept safely withheld whole — never a silent
 * drop and never a secret on disk.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type CallThreadWireEntry, callThreadWireEntryOf } from "../../../talk/callThreadEntry.js";
import { fitCapture, type MeasureLine, utf8Prefix } from "../../../talk/callThreadFit.js";
import { binaryStandIn, sanitiseCallThreadEntry, storedLine } from "../../../talk/callThreadSanitise.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const WRITE = "a0000080-0000-4000-8000-000000000087";

/** A GitHub token shape, built at run time so this file never carries one. */
const TOKEN = "ghp_" + "Z".repeat(30);

const entry = (capture: CallThreadWireEntry["capture"]): CallThreadWireEntry => ({
  callId: CALL,
  capture,
  receivedAtIso: "2026-11-02T05:00:00.000Z",
  version: 1,
  writeId: WRITE,
});

const toolAnswer = ({ text }: { text: string }): CallThreadWireEntry["capture"] => ({
  arguments: "{}",
  contentItems: [{ text, type: "inputText" }],
  kind: "tool-answer",
  success: true,
  threadId: "thr-1",
  tool: "read_slack_thread",
  toolCallId: "call-1",
  turnId: "turn-1",
});

describe("callThreadWireEntryOf", () => {
  it("keeps an item field nobody here has named, and refuses a foreign envelope field", () => {
    const params = { item: { future: { x: 1 }, id: "i-1", type: "somethingNew" }, threadId: "thr-1", turnId: "t-1" };
    const wire = { ...entry({ kind: "notification", method: "item/completed", params }) };
    expect(callThreadWireEntryOf({ value: wire })!.capture).toEqual({
      kind: "notification",
      method: "item/completed",
      params,
    });
    expect(callThreadWireEntryOf({ value: { ...wire, extra: 1 } })).toBe(undefined);
    expect(callThreadWireEntryOf({ value: { ...wire, callId: "../x" } })).toBe(undefined);
  });

  it("refuses a delta, which the journal never keeps", () => {
    const value = entry({ kind: "notification", method: "item/completed", params: {} });
    expect(
      callThreadWireEntryOf({ value: { ...value, capture: { ...value.capture, method: "item/agentMessage/delta" } } }),
    ).toBe(undefined);
  });
});

describe("binaryStandIn", () => {
  it("replaces a base64 data URL by media type, decoded length and digest", () => {
    const bytes = Buffer.from("not really a png");
    const text = `data:image/png;base64,${bytes.toString("base64")}`;
    expect(binaryStandIn({ text })).toEqual({
      byteLength: bytes.length,
      mediaType: "image/png",
      omitted: "inline-binary",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("keeps no byte of a payload that is not base64", () => {
    expect(binaryStandIn({ text: "data:audio/wav;base64,@@@@" })).toEqual({
      encodedLength: 4,
      mediaType: "audio/wav",
      omitted: "inline-binary-invalid",
    });
  });

  it("leaves ordinary text alone", () => {
    expect(binaryStandIn({ text: "the data: field was empty" })).toBe(undefined);
  });
});

describe("sanitiseCallThreadEntry", () => {
  it("keeps a clean capture exactly", () => {
    const stored = sanitiseCallThreadEntry({
      denylist: [],
      entry: entry(toolAnswer({ text: "the pool hit 100 connections" })),
    });
    expect(stored.capture).toEqual(toolAnswer({ text: "the pool hit 100 connections" }));
    expect(stored.redactions).toEqual([]);
    expect(stored.truncation).toBe(null);
    expect(stored.withheld).toBe(null);
    expect(stored.kind).toBe("tool-answer");
  });

  it("masks a credential and a denylist word, counting each by label, and keeps an identifier", () => {
    const text = `token ${TOKEN} again ${TOKEN}, from AcmeSecretWord in C0SYN000001`;
    const stored = sanitiseCallThreadEntry({ denylist: ["acmesecretword"], entry: entry(toolAnswer({ text })) });
    const line = storedLine({ entry: stored });
    expect(line).not.toContain(TOKEN);
    expect(line.toLowerCase()).not.toContain("acmesecretword");
    expect(line).toContain("[REDACTED:github-oauth-token] again [REDACTED:github-oauth-token]");
    expect(line).toContain("C0SYN000001");
    expect(stored.redactions).toEqual([
      { count: 2, label: "github-oauth-token" },
      { count: 1, label: "denylist" },
    ]);
  });

  it("counts an inline image and keeps no byte of it", () => {
    const image = `data:image/jpeg;base64,${Buffer.from("frame").toString("base64")}`;
    const capture = { ...toolAnswer({ text: "x" }), contentItems: [{ imageUrl: image, type: "inputImage" }] };
    const stored = sanitiseCallThreadEntry({ denylist: [], entry: entry(capture) });
    expect(stored.binaryStandIns).toBe(1);
    expect(storedLine({ entry: stored })).not.toContain(Buffer.from("frame").toString("base64"));
  });

  it("cuts an oversized capture to fit, stating the bytes cut", () => {
    const stored = sanitiseCallThreadEntry({
      denylist: [],
      entry: entry(toolAnswer({ text: "é".repeat(4000) })),
      maxBytes: 2000,
    });
    const bytes = Buffer.byteLength(storedLine({ entry: stored }), "utf8");
    expect(bytes).toBeLessThanOrEqual(2000);
    expect(stored.truncation!.originalBytes).toBeGreaterThan(8000);
    expect(stored.truncation!.truncatedBytes).toBeGreaterThan(6000);
    expect(storedLine({ entry: stored })).toContain("…[truncated ");
    expect(stored.withheld).toBe(null);
  });

  it("withholds a capture of so many keys that even empty leaves will not fit", () => {
    const params = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`key-${String(i)}`, "v"]));
    const stored = sanitiseCallThreadEntry({
      denylist: [],
      entry: entry({ kind: "notification", method: "item/completed", params }),
      maxBytes: 1000,
    });
    expect(stored.withheld).toEqual({ labels: [], reason: "unfittable" });
    expect(stored.capture).toEqual({ kind: "notification" });
  });

  it("withholds a capture whose secret sits in an object key, which masking never rewrites", () => {
    const params = { [TOKEN]: "value" };
    const stored = sanitiseCallThreadEntry({
      denylist: [],
      entry: entry({ kind: "notification", method: "item/completed", params }),
    });
    expect(stored.withheld).toEqual({ labels: ["github-oauth-token"], reason: "secret-survived-masking" });
    expect(storedLine({ entry: stored })).not.toContain(TOKEN);
  });

  it("withholds a denylist word in an object key that the serialised line escapes past the scan", () => {
    const word = 'api"key';
    const stored = sanitiseCallThreadEntry({
      denylist: [word],
      entry: entry({ kind: "notification", method: "item/completed", params: { [word]: "value" } }),
    });
    expect(stored.withheld).toEqual({ labels: ["denylist"], reason: "secret-survived-masking" });
    expect(storedLine({ entry: stored })).not.toContain("api");
  });

  it("withholds a secret that outlasts every masking pass even when the cut would have dropped it", () => {
    const tokens = Array.from({ length: 9 }, (_, i) => "ghp_" + "Q".repeat(29) + String(i));
    const text = `${tokens.slice(0, 8).join(" ")} ${"A".repeat(3000)} ${tokens[8]!}`;
    const stored = sanitiseCallThreadEntry({ denylist: [], entry: entry(toolAnswer({ text })), maxBytes: 2000 });
    expect([stored.withheld, stored.truncation]).toEqual([
      { labels: ["github-oauth-token"], reason: "secret-survived-masking" },
      null,
    ]);
    expect(storedLine({ entry: stored })).not.toContain("ghp_");
  });
});

describe("utf8Prefix and fitCapture", () => {
  it("never splits a character", () => {
    expect(utf8Prefix({ maxBytes: 3, text: "ééé" })).toEqual({ cutBytes: 4, kept: "é" });
    expect(utf8Prefix({ maxBytes: 10, text: "abc" })).toEqual({ cutBytes: 0, kept: "abc" });
  });

  it("leaves a capture that fits untouched", () => {
    const measure: MeasureLine = ({ capture }) => JSON.stringify(capture).length;
    expect(fitCapture({ capture: { a: "b" }, maxBytes: 100, measure })).toEqual({
      capture: { a: "b" },
      truncation: null,
    });
  });
});
