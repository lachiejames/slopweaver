/*
 * Movement after the ask is concurrent with the send: growth a later derive already observed settles, while an
 * earlier observation, a shrunk source or an unparseable ask stays stale, and fresh and absent verdicts pass through.
 */
import { describe, expect, it } from "vitest";
import {
  deriveFreshness,
  EMPTY_WITNESS,
  emptyObservation,
  type FreshnessObservation,
  settledForAsk,
} from "../../../../../silver/derive/freshness.js";
import { stampOf } from "./harness.js";

describe("settledForAsk — movement after the ask is concurrent with the send", () => {
  // The measured shape: notion bronze grew while a Notion refresh ran in another workspace.
  const notionWith = ({ bronzeBytes, bronzeFiles = 4 }: { bronzeBytes: number; bronzeFiles?: number }) => {
    const base = emptyObservation();
    return {
      ...base,
      sources: { ...base.sources, notion: { ...EMPTY_WITNESS, bronzeBytes, bronzeFiles } },
    } satisfies FreshnessObservation;
  };
  const stamped = notionWith({ bronzeBytes: 862893708 });
  const grown = notionWith({ bronzeBytes: 862914329 });
  const settle = ({
    observed,
    observedAtIso,
    askedAtIso,
  }: {
    observed: FreshnessObservation;
    observedAtIso: string | null;
    askedAtIso: string;
  }) => {
    const stamp = stampOf({ observation: stamped, observedAtIso });
    return settledForAsk({
      askedAtIso,
      freshness: deriveFreshness({ artefactPresent: true, observed, stamp }),
      observed,
      stamp,
    });
  };

  it("settles growth after a derive that observed its sources after the ask", () => {
    expect(
      settle({ askedAtIso: "2026-09-29T03:26:00.000Z", observed: grown, observedAtIso: "2026-09-29T03:26:30.000Z" }),
    ).toEqual({ kind: "fresh" });
  });

  it("settles when the observation and the ask are the same instant", () => {
    expect(
      settle({ askedAtIso: "2026-09-29T03:26:00.000Z", observed: grown, observedAtIso: "2026-09-29T03:26:00.000Z" }),
    ).toEqual({ kind: "fresh" });
  });

  it("stays stale when the derive observed its sources BEFORE the ask", () => {
    expect(
      settle({ askedAtIso: "2026-09-29T03:26:00.000Z", observed: grown, observedAtIso: "2026-09-29T03:15:00.000Z" }),
    ).toEqual({
      changed: [{ reasons: ["bronze 4 file(s)/862893708B → 4 file(s)/862914329B"], source: "notion" }],
      derivedAtIso: "2026-08-20T18:48:58.000Z",
      kind: "stale",
    });
  });

  it("stays stale on a stamp written before the observation instant existed", () => {
    expect(settle({ askedAtIso: "2026-09-29T03:26:00.000Z", observed: grown, observedAtIso: null }).kind).toBe("stale");
  });

  it("stays stale when a roster source's bronze SHRANK, because it was rewritten under the derive", () => {
    const shrunkBytes = notionWith({ bronzeBytes: 1000 });
    const shrunkFiles = notionWith({ bronzeBytes: 862914329, bronzeFiles: 3 });
    expect(
      settle({
        askedAtIso: "2026-09-29T03:26:00.000Z",
        observed: shrunkBytes,
        observedAtIso: "2026-09-29T03:26:30.000Z",
      }).kind,
    ).toBe("stale");
    expect(
      settle({
        askedAtIso: "2026-09-29T03:26:00.000Z",
        observed: shrunkFiles,
        observedAtIso: "2026-09-29T03:26:30.000Z",
      }).kind,
    ).toBe("stale");
  });

  it("stays stale when the ask instant does not parse", () => {
    expect(settle({ askedAtIso: "not a time", observed: grown, observedAtIso: "2026-09-29T03:26:30.000Z" }).kind).toBe(
      "stale",
    );
  });

  it("passes fresh and absent verdicts through untouched", () => {
    const stamp = stampOf({ observation: stamped, observedAtIso: "2026-09-29T03:26:30.000Z" });
    const absent = { kind: "absent", why: "it has never been derived" } as const;
    expect(
      settledForAsk({ askedAtIso: "2026-09-29T03:26:00.000Z", freshness: absent, observed: grown, stamp }),
    ).toEqual(absent);
    expect(
      settledForAsk({
        askedAtIso: "2026-09-29T03:26:00.000Z",
        freshness: { kind: "fresh" },
        observed: stamped,
        stamp,
      }),
    ).toEqual({ kind: "fresh" });
  });
});
