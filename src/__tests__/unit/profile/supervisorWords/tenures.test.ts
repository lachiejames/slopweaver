/**
 * Each chair's tenures as the chain journal's links give them (A → B → A included), which chair a window reads
 * and over what span, and whether a turn's instant sits inside a chair's tenures. Pure; nothing here touches a disk.
 */
import { describe, expect, it } from "vitest";

import { insideTenures, tenureReads, wordTenures } from "../../../../profile/supervisorWords.js";
import type { SupervisorLink } from "../../../../supervisor/chain.js";
import { A, B, GONE, pin, tenure } from "./harness.js";

describe("wordTenures", () => {
  it("gives A two tenures across A → B → A, and closes a scan-opened one at the next session's link", () => {
    const scan: SupervisorLink = { ...pin({ at: "2026-09-01T00:00:00.000Z", session: GONE }), source: "scan" };
    const tenures = wordTenures({
      links: [
        pin({ at: "2026-09-05T02:00:00.000Z", session: B }),
        scan,
        pin({ at: "2026-09-04T22:00:00.000Z", session: A }),
        pin({ at: "2026-09-05T06:00:00.000Z", session: A }),
      ],
    });

    expect(tenures).toEqual([
      tenure({ from: "2026-09-01T00:00:00.000Z", id: GONE, until: "2026-09-04T22:00:00.000Z" }),
      tenure({ from: "2026-09-04T22:00:00.000Z", id: A, until: "2026-09-05T02:00:00.000Z" }),
      tenure({ from: "2026-09-05T02:00:00.000Z", id: B, until: "2026-09-05T06:00:00.000Z" }),
      tenure({ from: "2026-09-05T06:00:00.000Z", id: A, until: undefined }),
    ]);
  });

  it("keeps a pinned chair's earlier scan tenure when another chair pinned between it and the pin", () => {
    const scan: SupervisorLink = { ...pin({ at: "2026-09-04T22:00:00.000Z", session: A }), source: "scan" };

    expect(
      wordTenures({
        links: [
          scan,
          pin({ at: "2026-09-05T02:00:00.000Z", session: B }),
          pin({ at: "2026-09-05T06:00:00.000Z", session: A }),
        ],
      }),
    ).toEqual([
      tenure({ from: "2026-09-04T22:00:00.000Z", id: A, until: "2026-09-05T02:00:00.000Z" }),
      tenure({ from: "2026-09-05T02:00:00.000Z", id: B, until: "2026-09-05T06:00:00.000Z" }),
      tenure({ from: "2026-09-05T06:00:00.000Z", id: A, until: undefined }),
    ]);
  });

  it("dates a tenure by the pin, not the scan just before it", () => {
    const scan: SupervisorLink = { ...pin({ at: "2026-09-05T05:55:00.000Z", session: A }), source: "scan" };

    expect(
      wordTenures({
        links: [
          pin({ at: "2026-09-05T02:00:00.000Z", session: B }),
          scan,
          pin({ at: "2026-09-05T06:00:00.000Z", session: A }),
        ],
      }),
    ).toEqual([
      tenure({ from: "2026-09-05T02:00:00.000Z", id: B, until: "2026-09-05T06:00:00.000Z" }),
      tenure({ from: "2026-09-05T06:00:00.000Z", id: A, until: undefined }),
    ]);
  });

  it("extends a tenure when the chair holding the pin pins again", () => {
    expect(
      wordTenures({
        links: [
          pin({ at: "2026-09-04T22:00:00.000Z", session: A }),
          pin({ at: "2026-09-04T23:00:00.000Z", session: A }),
        ],
      }),
    ).toEqual([tenure({ from: "2026-09-04T22:00:00.000Z", id: A, until: undefined })]);
  });
});

describe("tenureReads", () => {
  const tenures = wordTenures({
    links: [
      pin({ at: "2026-09-01T00:00:00.000Z", session: GONE }),
      pin({ at: "2026-09-04T22:00:00.000Z", session: A }),
      pin({ at: "2026-09-05T02:00:00.000Z", session: B }),
      pin({ at: "2026-09-05T06:00:00.000Z", session: A }),
    ],
  });

  it("reads A once from the floor to the ceiling, B over its one tenure, and never the chair before the window", () => {
    const reads = tenureReads({
      sinceIso: "2026-09-05T00:00:00.000Z",
      tenures,
      untilIso: "2026-09-05T12:00:00.000Z",
    });

    expect(reads.map((read) => [read.session.id, read.fromIso, read.untilIso, read.tenures.length])).toEqual([
      [A, "2026-09-05T00:00:00.000Z", "2026-09-05T12:00:00.000Z", 2],
      [B, "2026-09-05T02:00:00.000Z", "2026-09-05T06:00:00.000Z", 1],
    ]);
  });

  it("reads nothing for a window before the first pin", () => {
    expect(
      tenureReads({ sinceIso: "2026-08-01T00:00:00.000Z", tenures, untilIso: "2026-08-02T00:00:00.000Z" }),
    ).toEqual([]);
  });
});

describe("insideTenures", () => {
  const tenures = [
    tenure({ from: "2026-09-04T22:00:00.000Z", id: A, until: "2026-09-05T02:00:00.000Z" }),
    tenure({ from: "2026-09-05T06:00:00.000Z", id: A, until: undefined }),
  ];

  it("keeps a turn in either tenure and drops one typed while another chair held the pin", () => {
    expect(
      ["2026-09-04T23:00:00.000Z", "2026-09-05T03:00:00.000Z", "2026-09-05T07:00:00.000Z"].map((timestamp) =>
        insideTenures({ tenures, timestamp }),
      ),
    ).toEqual([true, false, true]);
  });

  it("keeps a turn with no instant, so the query can say it is undated", () => {
    expect(insideTenures({ tenures, timestamp: "not a time" })).toBe(true);
  });
});
