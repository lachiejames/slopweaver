/** The schema-version-2 document `workstreams list --json` prints: authored fields as stored, `derived` beside them. */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { snapshotBaseline } from "../../../../workstreams/store/baseline.js";
import { memberIds, projectRegister } from "../../../../workstreams/store/projection.js";
import { inMemoryWorkstreamStore } from "../../../workstreamStoreFake.js";
import { ACME_META, acmeLocal, acmeOutcome, OWN_DETAIL } from "../../../workstreamStoreFixtures.js";

const NOW = "2026-11-09T12:00:00.000Z";
const HOME = "/acme/home";

describe("projectRegister", () => {
  it("derives progress against the workstream's own milestones and dates off its entries", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.put({ aggregate: acmeOutcome(), expectedRevision: null, home: HOME }));
    const snapshot = unwrap(await store.read({ home: HOME }));
    const [only] = projectRegister({ snapshot }).workstreams;
    expect(only!.derived.progressLine).toBe("1 of 3 done, next: Pilot live");
    expect(only!.derived.startedOn).toBe("2026-11-02");
    expect(only!.derived.lastMovedOn).toBe("2026-11-03");
    expect(only!.derived.lane).toBe("moving");
    expect(only!.derived.gauge).toBe(null);
  });

  it("carries the read's baseline and its register document", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
    const snapshot = unwrap(await store.read({ home: HOME }));
    const document = projectRegister({ snapshot });
    expect(document.schemaVersion).toBe(2);
    expect(document.baseline).toBe(snapshotBaseline({ snapshot }));
    expect(document.meta).toEqual(ACME_META);
    expect(document.workstreams).toEqual([]);
  });

  it("lists a workstream held on the owner before one that is moving", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const held = acmeOutcome({
      detail: { ...OWN_DETAIL, waitingOn: { on: "you", what: "pick the pilot team" } },
      id: "acme-z-held",
    });
    unwrap(
      await store.applyBatch({
        deletes: [],
        home: HOME,
        writes: [
          { aggregate: acmeOutcome(), expectedRevision: null },
          { aggregate: held, expectedRevision: null },
          { aggregate: acmeLocal({ id: "acme-a-local" }), expectedRevision: null },
        ],
      }),
    );
    const document = projectRegister({ snapshot: unwrap(await store.read({ home: HOME })) });
    expect(document.workstreams.map((one) => [one.id, one.derived.lane])).toEqual([
      ["acme-z-held", "your-call"],
      ["acme-onboarding", "moving"],
      ["acme-a-local", "kept-here"],
    ]);
    expect(document.workstreams[2]!.derived.progress).toBe(null);
  });
});

describe("memberIds", () => {
  it("names each person once, and nobody from a local workstream", () => {
    const people = [{ part: "pilot lead", slack: "U0FIXTURE1" }];
    expect(
      memberIds({
        workstreams: [
          acmeOutcome({ detail: { ...OWN_DETAIL, people } }),
          acmeOutcome({ detail: { ...OWN_DETAIL, people }, id: "acme-two" }),
          acmeLocal({ id: "acme-local" }),
        ],
      }),
    ).toEqual(["U0FIXTURE1"]);
  });
});
