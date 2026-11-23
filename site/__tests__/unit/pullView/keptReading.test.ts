/*
 * A pull request's earlier reading, kept and marked stale over a re-read that failed.
 */

import { describe, expect, it } from "vitest";

import type { PullState } from "../../../components/console/usePull";
import { keptOverFailure } from "../../../lib/keptReading";
import { PR, VIEW } from "./harness";

describe("a pull request's kept reading", () => {
  type ReadyPull = Extract<PullState, { readonly phase: "ready" }>;
  const READ: ReadyPull = {
    observedAtIso: "2026-10-11T01:00:00.000Z",
    people: { ok: false, why: "roster unread" },
    phase: "ready",
    url: PR,
    view: VIEW,
  };
  const FAILED = { phase: "not-measured", why: "github read timed out" } as const;

  it("draws the earlier reading, marked stale, when the page is opened again and the re-read fails", () => {
    const kept = new Map<string, ReadyPull>();
    keptOverFailure({ id: PR, kept, next: READ });
    expect(keptOverFailure({ id: PR, kept, next: FAILED })).toEqual({
      ...READ,
      stale: { why: "github read timed out" },
    });
  });

  it("never keeps another pull request's reading over a failed read", () => {
    const kept = new Map<string, ReadyPull>();
    keptOverFailure({ id: PR, kept, next: READ });
    const other = "https://github.com/lachiejames/slopweaver/pull/10";
    expect(keptOverFailure({ id: other, kept, next: FAILED })).toEqual(FAILED);
  });

  it("draws a fresh reading after a stale one without the mark", () => {
    const kept = new Map<string, ReadyPull>();
    keptOverFailure({ id: PR, kept, next: READ });
    keptOverFailure({ id: PR, kept, next: FAILED });
    const fresh: ReadyPull = { ...READ, observedAtIso: "2026-10-11T01:05:00.000Z" };
    expect(keptOverFailure({ id: PR, kept, next: fresh })).toEqual(fresh);
  });
});
