/*
 * A monitor's hand step is confirmed only by its monitor's own pass, never by the hands register holding it — so the
 * Queue row's fallback confirmation, the one a card reads with no currency reading, is absent for it (Codex
 * r1-monitor), while any other hand step keeps the register's read.
 */

import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const OBSERVED = "2026-10-02T12:00:00.000Z";

function ready<T>({ value }: { value: T }): LiveState<T> {
  return { fixture: undefined, observedAtIso: OBSERVED, phase: "ready", stampedByRoute: false, value };
}

function stepNamed({ id }: { id: string }): Record<string, unknown> {
  return {
    id,
    postedBy: "workspace:93",
    postedIso: "2026-10-02T11:00:00.000Z",
    unblocks: "the deploy",
    url: "https://console.cloud.google.com/",
    what: "Sign in to Google Cloud",
    witness: `slopweaver hand done ${id}`,
  };
}

describe("a hand row's fallback confirmation", () => {
  it("is the register's read for a plain step and absent for a monitor's", () => {
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: ready({ value: readHandSteps([stepNamed({ id: "gcloud" }), stepNamed({ id: "mon-legacy-alert" })])! }),
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      reviews: LOADING,
      imports: LOADING,
      standing: LOADING,
    });

    expect(rows.find((row) => row.key === "hand:gcloud")!.verifiedIso).toBe(OBSERVED);
    expect(rows.find((row) => row.key === "hand:mon-legacy-alert")!.verifiedIso).toBeUndefined();
  });
});
