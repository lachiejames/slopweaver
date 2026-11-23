import { describe, expect, it } from "vitest";

import type { GateVerdict } from "../../../datadog/detective/gate.js";
import { datadogLeads, leadWeight } from "../../../detective/datadogLead.js";

/** A verdict shaped the way the gate returns one. */
function verdict({ hits }: { hits: GateVerdict["hits"] }): GateVerdict {
  return { hits, services: [], skipped: [] };
}

describe("leadWeight — the hit KIND dominates, the count only breaks ties", () => {
  it("ranks one service hit above nine monitor hits, the owner's own worked example", () => {
    const service = leadWeight({ hits: 1, kinds: new Set(["service"] as const) });
    const monitors = leadWeight({ hits: 9, kinds: new Set(["monitor"] as const) });
    expect(service).toBeGreaterThan(monitors);
  });

  it("breaks a tie between two same-kind buckets on the count", () => {
    const many = leadWeight({ hits: 4, kinds: new Set(["service"] as const) });
    const few = leadWeight({ hits: 1, kinds: new Set(["service"] as const) });
    expect(many).toBeGreaterThan(few);
  });

  it("takes the STRONGEST kind when a bucket holds several", () => {
    const mixed = leadWeight({ hits: 1, kinds: new Set(["monitor", "service"] as const) });
    const monitorOnly = leadWeight({ hits: 1, kinds: new Set(["monitor"] as const) });
    expect(mixed).toBeGreaterThan(monitorOnly);
  });
});

describe("datadogLeads", () => {
  it("folds every hit on one service into ONE lead, never one per hit", () => {
    const leads = datadogLeads({
      verdict: verdict({
        hits: [
          { keyword: "partners", kind: "service", matched: "job-sync-partners", service: "job-sync-partners" },
          { keyword: "sync", kind: "shape", matched: "[sync]", service: "job-sync-partners" },
        ],
      }),
    });
    expect(leads.length).toBe(1);
    expect(leads[0]!.startShape).toBe("job-sync-partners");
  });

  it("names the service and the keywords in the why a brief prints verbatim", () => {
    const leads = datadogLeads({
      verdict: verdict({
        hits: [{ keyword: "partners", kind: "service", matched: "job-sync-partners", service: "job-sync-partners" }],
      }),
    });
    expect(leads[0]!.why).toContain("job-sync-partners");
    expect(leads[0]!.why).toContain('"partners"');
  });

  it("puts the service lead ahead of the service-less one, which is the ordering that was wrong first", () => {
    const leads = datadogLeads({
      verdict: verdict({
        hits: [
          ...Array.from({ length: 9 }, (_unused, index) => ({
            keyword: "sync",
            kind: "monitor" as const,
            matched: `monitor ${String(index)}`,
            service: null,
          })),
          { keyword: "partners", kind: "service" as const, matched: "job-sync-partners", service: "job-sync-partners" },
        ],
      }),
    });
    expect(leads[0]!.startShape).toBe("job-sync-partners");
  });

  it("makes ONE catalogue-wide lead for hits that name no service", () => {
    const leads = datadogLeads({
      verdict: verdict({
        hits: [
          { keyword: "sync", kind: "monitor", matched: "a", service: null },
          { keyword: "sync", kind: "metric-namespace", matched: "gcp", service: null },
        ],
      }),
    });
    expect(leads.length).toBe(1);
    expect(leads[0]!.startShape).toBe(null);
  });

  it("marks every lead with the datadog source, so a brief can tell it from a store lead", () => {
    const leads = datadogLeads({
      verdict: verdict({ hits: [{ keyword: "a", kind: "service", matched: "s", service: "s" }] }),
    });
    expect(leads[0]!.source).toBe("datadog");
  });

  it("makes no lead at all from an empty verdict", () => {
    expect(datadogLeads({ verdict: verdict({ hits: [] }) })).toEqual([]);
  });
});
