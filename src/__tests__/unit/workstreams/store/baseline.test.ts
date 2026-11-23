/**
 * The register baseline binds to authored content and nothing a store mints: two stores written
 * at different instants and revisions hash equal, nested key order does not matter, and any authored change does.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  EMPTY_REGISTER_BASELINE,
  REGISTER_BASELINE_PATTERN,
  registerBaseline,
  snapshotBaseline,
} from "../../../../workstreams/store/baseline.js";
import type { WorkstreamRegisterSnapshot } from "../../../../workstreams/store/types.js";
import { inMemoryWorkstreamStore } from "../../../workstreamStoreFake.js";
import { ACME_META, acmeLocal, acmeOutcome, OWN_DETAIL } from "../../../workstreamStoreFixtures.js";

const HOME = "/acme/home";

/**
 * A store holding the acme document and two workstreams, written at `nowIso`, the outcome rewritten `rewrites` times.
 *
 * @param nowIso the instant every write is stamped with
 * @param rewrites how many times the outcome is written again unchanged, raising its revision
 * @returns what one read of that store returns
 */
async function seededSnapshot({
  nowIso,
  rewrites,
}: {
  nowIso: string;
  rewrites: number;
}): Promise<WorkstreamRegisterSnapshot> {
  const store = inMemoryWorkstreamStore({ nowIso });
  unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
  unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-z" }), expectedRevision: null, home: HOME }));
  unwrap(await store.put({ aggregate: acmeOutcome(), expectedRevision: null, home: HOME }));
  for (let revision = 1; revision <= rewrites; revision += 1) {
    unwrap(await store.put({ aggregate: acmeOutcome(), expectedRevision: revision, home: HOME }));
  }
  return unwrap(await store.read({ home: HOME }));
}

describe("the register baseline", () => {
  it("hashes two stores equal when they hold the same authored register at different instants and revisions", async () => {
    const early = await seededSnapshot({ nowIso: "2026-11-01T00:00:00.000Z", rewrites: 0 });
    const late = await seededSnapshot({ nowIso: "2026-11-07T05:00:00.000Z", rewrites: 3 });

    expect(late.workstreams.find((one) => one.id === "acme-onboarding")!.revision).toBe(4);
    expect(late.workstreams[0]!.updatedAtIso).not.toBe(early.workstreams[0]!.updatedAtIso);
    expect(snapshotBaseline({ snapshot: late })).toBe(snapshotBaseline({ snapshot: early }));
    expect(snapshotBaseline({ snapshot: early })).toMatch(REGISTER_BASELINE_PATTERN);
  });

  it("ignores workstream order and the key order of every nested object, detail and channels included", () => {
    const scrambledDetail = Object.fromEntries(Object.entries(OWN_DETAIL).toReversed());
    const scrambledMeta = {
      initiatives: ACME_META.initiatives,
      grouping: { why: "a test needs one", label: "by initiative", builtFrom: "the fixture", anchor: "talk:fixture" },
      channels: { C0FIXTURE1: "acme platform" },
    };
    const plain = registerBaseline({ meta: ACME_META, workstreams: [acmeOutcome(), acmeLocal({ id: "acme-z" })] });

    expect(
      registerBaseline({
        meta: scrambledMeta,
        workstreams: [acmeLocal({ id: "acme-z" }), acmeOutcome({ detail: scrambledDetail })],
      }),
    ).toBe(plain);
  });

  it("changes with any authored change: a detail field, a milestone, the document, or a workstream added", () => {
    const plain = registerBaseline({ meta: ACME_META, workstreams: [acmeOutcome()] });
    const variants = [
      registerBaseline({ meta: ACME_META, workstreams: [acmeOutcome({ detail: { ...OWN_DETAIL, team: "data" } })] }),
      registerBaseline({
        meta: ACME_META,
        workstreams: [acmeOutcome({ milestones: acmeOutcome().milestones.slice(0, 2) })],
      }),
      registerBaseline({ meta: null, workstreams: [acmeOutcome()] }),
      registerBaseline({ meta: ACME_META, workstreams: [acmeOutcome(), acmeLocal({ id: "acme-z" })] }),
    ];

    expect(new Set([plain, ...variants]).size).toBe(5);
  });

  it("gives an empty store the empty-register baseline, which no document or workstream shares", async () => {
    const empty = unwrap(await inMemoryWorkstreamStore({ nowIso: "2026-11-07T05:00:00.000Z" }).read({ home: HOME }));

    expect(snapshotBaseline({ snapshot: empty })).toBe(EMPTY_REGISTER_BASELINE);
    expect(EMPTY_REGISTER_BASELINE).not.toBe(registerBaseline({ meta: ACME_META, workstreams: [] }));
    expect(EMPTY_REGISTER_BASELINE).toMatch(REGISTER_BASELINE_PATTERN);
  });
});
