import { describe, expect, it } from "vitest";

import type { JumpcloudEntity } from "../../../../atlas/jumpcloud/entities.js";
import { mergeJumpcloudKind, provenCompleteRead } from "../../../../atlas/jumpcloud/merge.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-04T10:00:00.000Z";
const EARLIER = "2026-09-01T10:00:00.000Z";

/** One entity carrying a Directory API observation and nothing else. */
function apiEntity({ id, detail = { a: 1 } }: { id: string; detail?: unknown }): JumpcloudEntity {
  return {
    channels: {
      "admin-console": null,
      "directory-api": { detail, firstSeenAt: AT, lastSeenAt: AT, source: null, state: "observed" },
    },
    id,
    kind: "systems",
    providerId: id,
  };
}

describe("provenCompleteRead", () => {
  it("refuses when an admitted operation did not complete, so nothing behind it is staled", () => {
    const proof = provenCompleteRead({
      declaredTotal: null,
      kind: "systems",
      observed: 5,
      operationsRefused: 1,
      pagesExhausted: true,
    });
    expect(proof.isOk()).toBe(false);
    expect(unwrapErr(proof)[0]).toContain("never looked for");
  });

  it("refuses when paging stopped before the provider ran out", () => {
    const proof = provenCompleteRead({
      declaredTotal: null,
      kind: "systems",
      observed: 5,
      operationsRefused: 0,
      pagesExhausted: false,
    });
    expect(unwrapErr(proof)[0]).toContain("must not be staled");
  });

  it("refuses when the walk came up short of the provider's own declared total", () => {
    const proof = provenCompleteRead({
      declaredTotal: 240,
      kind: "systems",
      observed: 200,
      operationsRefused: 0,
      pagesExhausted: true,
    });
    expect(unwrapErr(proof)[0]).toContain("200 of the 240");
  });

  it("carries the evidence forward as a sentence a coverage reason can quote", () => {
    const proof = provenCompleteRead({
      declaredTotal: 240,
      kind: "systems",
      observed: 240,
      operationsRefused: 0,
      pagesExhausted: true,
    });
    expect(unwrap(proof).proof).toContain("matching the 240");
    expect(unwrap(proof).provenBy).toBe("provenCompleteRead");
  });

  it("accepts a read past the declared total, and says exceeding rather than matching", () => {
    const proof = provenCompleteRead({
      declaredTotal: 240,
      kind: "systems",
      observed: 241,
      operationsRefused: 0,
      pagesExhausted: true,
    });
    expect(unwrap(proof).proof).toBe(
      "read 241 systems record(s) to the end of paging, exceeding the 240 the provider declared, consistent with a record created mid-read",
    );
  });
});

describe("mergeJumpcloudKind", () => {
  it("keeps the first-seen instant across a re-sync", () => {
    const stored: JumpcloudEntity = {
      ...apiEntity({ id: "a" }),
      channels: {
        "admin-console": null,
        "directory-api": { detail: null, firstSeenAt: EARLIER, lastSeenAt: EARLIER, source: null, state: "observed" },
      },
    };
    const merged = unwrap(
      mergeJumpcloudKind({
        at: AT,
        channel: "directory-api",
        complete: null,
        observed: [apiEntity({ id: "a" })],
        stored: [stored],
      }),
    );
    expect(merged[0]!.channels["directory-api"]!.firstSeenAt).toBe(EARLIER);
  });

  it("leaves the other surface's knowledge exactly as it was", () => {
    const consoleKnown = {
      detail: { seen: "in the browser" },
      firstSeenAt: EARLIER,
      lastSeenAt: EARLIER,
      source: null,
      state: "observed",
    } as const;
    const stored: JumpcloudEntity = {
      ...apiEntity({ id: "a" }),
      channels: { "admin-console": consoleKnown, "directory-api": null },
    };
    const merged = unwrap(
      mergeJumpcloudKind({
        at: AT,
        channel: "directory-api",
        complete: null,
        observed: [apiEntity({ id: "a" })],
        stored: [stored],
      }),
    );
    expect(merged[0]!.channels["admin-console"]).toEqual(consoleKnown);
  });

  it("stales an absent entity only when the read was PROVEN complete", () => {
    const proof = unwrap(
      provenCompleteRead({
        declaredTotal: null,
        kind: "systems",
        observed: 1,
        operationsRefused: 0,
        pagesExhausted: true,
      }),
    );
    const merged = unwrap(
      mergeJumpcloudKind({
        at: AT,
        channel: "directory-api",
        complete: proof,
        observed: [apiEntity({ id: "a" })],
        stored: [apiEntity({ id: "a" }), apiEntity({ id: "gone" })],
      }),
    );
    expect(merged.find((entity) => entity.id === "gone")!.channels["directory-api"]!.state).toBe("stale");
  });

  it("leaves an absent entity untouched when the read was not complete", () => {
    const merged = unwrap(
      mergeJumpcloudKind({
        at: AT,
        channel: "directory-api",
        complete: null,
        observed: [apiEntity({ id: "a" })],
        stored: [apiEntity({ id: "gone" })],
      }),
    );
    expect(merged.find((entity) => entity.id === "gone")!.channels["directory-api"]!.state).toBe("observed");
  });

  it("refuses a run that produced one id twice, rather than double-counting it", () => {
    const merged = mergeJumpcloudKind({
      at: AT,
      channel: "directory-api",
      complete: null,
      observed: [apiEntity({ id: "a" }), apiEntity({ id: "a" })],
      stored: [],
    });
    expect(unwrapErr(merged)[0]).toContain("the same entity id twice");
  });

  it("prints the wrong-channel refusal as its whole line", () => {
    const merged = mergeJumpcloudKind({
      at: AT,
      channel: "admin-console",
      complete: null,
      observed: [apiEntity({ id: "a" })],
      stored: [],
    });
    expect(unwrapErr(merged)).toEqual([
      "a systems observation was folded onto the admin-console channel while carrying nothing for it — the sync built the entity for the wrong surface",
    ]);
  });

  it("refuses an observation folded onto a channel it carries nothing for", () => {
    const merged = mergeJumpcloudKind({
      at: AT,
      channel: "admin-console",
      complete: null,
      observed: [apiEntity({ id: "a" })],
      stored: [],
    });
    expect(unwrapErr(merged)[0]).toContain("built the entity for the wrong surface");
  });
});
