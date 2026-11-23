/*
 * The `formerCore.ts` render surface of `access-review former`: the confirmed, unmeasured and clean buckets as text
 * and as JSON, the residues, and the refusals when the roster spine or every access platform would not read —
 * with `formerExitCode` where a refused platform makes the result a lower bound.
 */
import { describe, expect, it } from "vitest";

import { buildAccessReview, type PlatformSource } from "../../../../../../accessReview/report.js";
import { formerStaffJson, renderFormerStaff } from "../../../../../../cli/commands/accessReview/formerCore.js";
import { formerExitCode } from "../../../../../../cli/commands/accessReview/formerRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { entity, kindView, snapshot } from "../../../../accessReview/fixtures.js";

import { jumpcloudSource, reportOf, spineSource } from "./harness.js";

describe("renderFormerStaff", () => {
  it("prints all three buckets, with the confirmed one first", () => {
    const report = reportOf({
      people: [{ email: "gone@x.test", role: null, state: "ACTIVATED" }],
      spells: [
        { email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" },
        { email: "clean@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" },
      ],
    });
    const lines = renderFormerStaff({ report });
    expect(lines[0]).toBe("CONFIRMED · 1 former staff still holding a live account at that platform's own read");
    expect(lines[1]).toContain("gone@x.test");
    expect(lines[1]).toContain("2026-09-01T00:00:00.000Z");
    expect(lines).toContain(
      "UNMEASURED · 0 who left AFTER the platform was read — a resync resolves each into confirmed or clean",
    );
    expect(lines).toContain("CLEAN · 1 former staff hold no live account on any platform read");
  });

  it("marks a platform read before the person left, even on a row another platform confirms", () => {
    const cloudflare: PlatformSource = {
      platform: "cloudflare",
      refusal: null,
      snapshot: snapshot({
        kinds: [
          kindView({
            entities: [
              entity({
                detail: { accessSeat: true, email: "gone@x.test", gatewaySeat: false, name: "A Person" },
                providerId: "access-user:0",
              }),
            ],
            kind: "access-user",
            lastSuccessAt: "2026-09-09T00:00:00.000Z",
          }),
        ],
        platform: "cloudflare",
      }),
    };
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ people: [{ email: "gone@x.test", role: null, state: "ACTIVATED" }] }),
        cloudflare,
        spineSource({ spells: [{ email: "gone@x.test", endDate: "2026-09-05T00:00:00.000Z", status: "FORMER" }] }),
      ],
    });
    const spineLater = buildAccessReview({
      sources: [
        jumpcloudSource({ people: [{ email: "gone@x.test", role: null, state: "ACTIVATED" }] }),
        cloudflare,
        spineSource({ spells: [{ email: "gone@x.test", endDate: "2026-09-07T00:00:00.000Z", status: "FORMER" }] }),
      ],
    });
    expect(renderFormerStaff({ report })[1]).not.toContain("read before they left");
    const mixed = renderFormerStaff({ report: spineLater });
    expect(mixed[0]).toBe("CONFIRMED · 1 former staff still holding a live account at that platform's own read");
    expect(mixed[1]).toContain("jumpcloud[state=ACTIVATED] (UNMEASURED — read before they left)");
    expect(mixed[1]!.endsWith("cloudflare[access seat=true gateway seat=false]")).toBe(true);
  });

  it("prints a rehire as a residue rather than as a finding", () => {
    const report = reportOf({
      people: [{ email: "back@x.test", role: null, state: "ACTIVATED" }],
      spells: [
        { email: "back@x.test", endDate: "2026-04-28T00:00:00.000Z", status: "FORMER" },
        { email: "back@x.test", endDate: null, status: "CURRENT" },
      ],
    });
    const lines = renderFormerStaff({ report });
    expect(lines[0]).toBe("CONFIRMED · 0 former staff still holding a live account at that platform's own read");
    expect(lines).toContain(
      "  RESIDUE · 1 addresses carry a departed spell AND a live one — REHIRES, which this report does not count as findings",
    );
  });

  it("refuses the whole join when the spine would not read", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ people: [{ email: "a@x.test", role: null, state: "ACTIVATED" }] }),
        { platform: "vanta", refusal: "store unreadable", snapshot: null },
      ],
    });
    expect(renderFormerStaff({ report })[0]).toBe(
      "access-review former · REFUSED — the Vanta roster spine would not read, so nothing can be joined",
    );
  });

  it("names an unjoinable platform address as a residue", () => {
    const report = reportOf({
      people: [{ email: "stranger@x.test", role: null, state: "ACTIVATED" }],
      spells: [],
    });
    expect(renderFormerStaff({ report })).toContain(
      "  RESIDUE · jumpcloud holds 1 addresses the roster spine does not — neither confirmed, unmeasured nor clean",
    );
  });
});

describe("formerStaffJson", () => {
  it("carries the buckets and the residues", () => {
    const report = reportOf({
      people: [{ email: "gone@x.test", role: null, state: "ACTIVATED" }],
      spells: [{ email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" }],
    });
    const json = formerStaffJson({ report });
    expect(json.refusal).toBe(null);
    expect(json.refusedPlatforms).toEqual([]);
    expect(json.lowerBound).toBe(false);
    expect(json.unmeasuredProvisional).toBe(false);
    expect(json.confirmed!.map((row) => row.email)).toEqual(["gone@x.test"]);
    expect(json.clean).toBe(0);
    expect(json.rehired).toEqual([]);
  });

  it("leaves CLEAN uncomputed when one access platform refused, keeping the findings that did read", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({
          people: [
            { email: "gone@x.test", role: null, state: "ACTIVATED" },
            { email: "orphan@x.test", role: null, state: "ACTIVATED" },
          ],
        }),
        { platform: "cloudflare", refusal: "store unreadable", snapshot: null },
        spineSource({
          spells: [
            { email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" },
            { email: "other@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" },
          ],
        }),
      ],
    });
    expect(renderFormerStaff({ report }).filter((line) => line.startsWith("  RESIDUE"))).toEqual([
      "  RESIDUE · jumpcloud holds 1 addresses the roster spine does not — neither confirmed, unmeasured nor clean — a LOWER BOUND: cloudflare REFUSED its read",
      "  RESIDUE · not computed for cloudflare — REFUSED its read, so the addresses it holds that the roster spine does not are not counted",
    ]);
    const json = formerStaffJson({ report });
    expect(json.refusal).toBe(null);
    expect(json.refusedPlatforms).toEqual(["cloudflare"]);
    expect(json.lowerBound).toBe(true);
    expect(json.clean).toBe(null);
    expect(json.confirmed!.map((row) => row.email)).toEqual(["gone@x.test"]);
    const lines = renderFormerStaff({ report });
    expect(lines).toContain("CLEAN · not computed — cloudflare REFUSED its read, so nobody can be called clean");
    expect(lines[0]).toBe(
      "CONFIRMED · 1 former staff still holding a live account at that platform's own read — a LOWER BOUND: cloudflare REFUSED its read",
    );
    expect(lines).toContain(
      "UNMEASURED · 0 who left AFTER the platform was read — a resync resolves each into confirmed or clean — PROVISIONAL either way: cloudflare REFUSED its read, which could confirm anyone here or add more",
    );
    expect(json.unmeasuredProvisional).toBe(true);
    expect(formerExitCode({ report })).toBe(EXIT_ERROR);
  });

  it("answers a refusal document when no access platform would read", () => {
    const report = buildAccessReview({
      sources: [
        { platform: "jumpcloud", refusal: "store unreadable", snapshot: null },
        spineSource({ spells: [{ email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" }] }),
      ],
    });
    const json = formerStaffJson({ report });
    expect(json.refusal).toBe("no access platform would read, so nothing can be joined");
    expect(json.confirmed).toBe(null);
    expect(json.clean).toBe(null);
    expect(renderFormerStaff({ report })[0]).toBe(
      "access-review former · REFUSED — no access platform would read, so nothing can be joined",
    );
  });

  it("answers a refusal document, never empty buckets, when the spine would not read", () => {
    const report = buildAccessReview({
      sources: [jumpcloudSource({ people: [] }), { platform: "vanta", refusal: "store unreadable", snapshot: null }],
    });
    const json = formerStaffJson({ report });
    expect(json.refusal).toBe("the Vanta roster spine would not read, so nothing can be joined");
    expect(json.confirmed).toBe(null);
    expect(json.unmeasured).toBe(null);
    expect(json.clean).toBe(null);
    expect(json.rehired).toBe(null);
  });
});
