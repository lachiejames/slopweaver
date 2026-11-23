/*
 * The `privilegedCore.ts` render surface of `access-review privileged`: how one administrator's employment prints,
 * the per-platform administrator tables as text and as JSON, and the refusals and lower bounds when the roster
 * spine or an access platform would not read.
 */
import { describe, expect, it } from "vitest";

import { buildAccessReview } from "../../../../../../accessReview/report.js";
import {
  employmentOf,
  privilegedJson,
  renderPrivileged,
} from "../../../../../../cli/commands/accessReview/privilegedCore.js";

import { jumpcloudSource, reportOf, spineSource } from "./harness.js";

describe("employmentOf", () => {
  it("says NO ROSTER ROW rather than reading as current", () => {
    expect(
      employmentOf({
        row: {
          display: null,
          email: "a@x.test",
          employmentEndIso: null,
          employmentStatuses: [],
          levels: [],
          role: "administrator",
          stillEmployed: null,
        },
      }),
    ).toBe("NO ROSTER ROW");
  });

  it("prints a live status with no end date", () => {
    expect(
      employmentOf({
        row: {
          display: null,
          email: "a@x.test",
          employmentEndIso: null,
          employmentStatuses: ["CURRENT"],
          levels: [],
          role: "administrator",
          stillEmployed: true,
        },
      }),
    ).toBe("CURRENT");
  });

  it("prints a departure with its end date exactly as the roster stored it", () => {
    expect(
      employmentOf({
        row: {
          display: null,
          email: "a@x.test",
          employmentEndIso: "2026-09-11T12:34:56.789Z",
          employmentStatuses: ["FORMER"],
          levels: [],
          role: "administrator",
          stillEmployed: false,
        },
      }),
    ).toBe("FORMER (ended 2026-09-11T12:34:56.789Z)");
  });

  it("marks a rehire, so an earlier end date never reads as a departure", () => {
    expect(
      employmentOf({
        row: {
          display: null,
          email: "a@x.test",
          employmentEndIso: "2026-04-28T00:00:00.000Z",
          employmentStatuses: ["FORMER", "CURRENT"],
          levels: [],
          role: "administrator",
          stillEmployed: true,
        },
      }),
    ).toBe("FORMER+CURRENT (REHIRED — an earlier spell ended 2026-04-28T00:00:00.000Z)");
  });
});

describe("renderPrivileged", () => {
  it("heads the table with its subject, so a zero is readable", () => {
    const report = reportOf({ people: [{ email: "plain@x.test", role: null, state: "ACTIVATED" }], spells: [] });
    expect(renderPrivileged({ report })[0]).toBe(
      "jumpcloud/systemusers · 0 administrator(s) out of 1 people examined · read 2026-09-06T00:00:00.000Z",
    );
  });

  it("prints one line per administrator, with their employment", () => {
    const report = reportOf({
      people: [{ email: "admin@x.test", role: "administrator", state: "ACTIVATED" }],
      spells: [{ email: "admin@x.test", endDate: "2026-09-11T00:00:00.000Z", status: "FORMER" }],
    });
    const lines = renderPrivileged({ report });
    expect(lines[1]).toContain("administrator  ·  A Person  ·  admin@x.test");
    expect(lines[1]).toContain("FORMER (ended 2026-09-11T00:00:00.000Z)");
  });

  it("says no platform contributed rather than printing an empty table", () => {
    const report = buildAccessReview({ sources: [spineSource({ spells: [] })] });
    expect(renderPrivileged({ report })[0]).toBe(
      "access-review privileged · no platform in this report both read and declares a console role",
    );
  });

  it("says the spine refused rather than reading as an empty table", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ people: [{ email: "admin@x.test", role: "administrator", state: "ACTIVATED" }] }),
        { platform: "vanta", refusal: "store unreadable", snapshot: null },
      ],
    });
    expect(renderPrivileged({ report })[0]).toBe(
      "access-review privileged · REFUSED — the Vanta roster spine would not read, so no administrator can be joined",
    );
  });

  it("marks every table a lower bound beside the refused platform when only some platforms read", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ people: [{ email: "admin@x.test", role: "administrator", state: "ACTIVATED" }] }),
        { platform: "onepassword", refusal: "store unreadable", snapshot: null },
        spineSource({ spells: [] }),
      ],
    });
    const lines = renderPrivileged({ report });
    expect(lines[0]).toBe("REFUSED · onepassword would not read, so its administrators are not listed here");
    expect(lines[1]).toBe(
      "jumpcloud/systemusers · 1 administrator(s) out of 1 people examined · read 2026-09-06T00:00:00.000Z — a LOWER BOUND: onepassword REFUSED its read",
    );
    expect(privilegedJson({ report }).lowerBound).toBe(true);
  });
});

describe("privilegedJson", () => {
  it("carries the whole table and the boundary", () => {
    const report = reportOf({
      people: [{ email: "admin@x.test", role: "administrator", state: "ACTIVATED" }],
      spells: [],
    });
    const json = privilegedJson({ report });
    expect(json.refusal).toBe(null);
    expect(json.tables!.map((table) => table.platform)).toEqual(["jumpcloud"]);
    expect(json.tables![0]!.rows.map((row) => row.role)).toEqual(["administrator"]);
    expect(json.boundary.length).toBeGreaterThan(0);
  });

  it("emits null tables and names the platform when the only access platform would not read", () => {
    const report = buildAccessReview({
      sources: [{ platform: "jumpcloud", refusal: "store unreadable", snapshot: null }, spineSource({ spells: [] })],
    });
    const json = privilegedJson({ report });
    expect(json.tables).toBe(null);
    expect(json.refusal).toBe("no access platform would read, so no administrator can be listed");
    expect(json.refusedPlatforms).toEqual(["jumpcloud"]);
    expect(renderPrivileged({ report })[0]).toBe(
      "access-review privileged · REFUSED — no access platform would read, so no administrator can be listed",
    );
  });

  it("emits null tables and a refusal when the spine would not read", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ people: [{ email: "admin@x.test", role: "administrator", state: "ACTIVATED" }] }),
        { platform: "vanta", refusal: "store unreadable", snapshot: null },
      ],
    });
    const json = privilegedJson({ report });
    expect(json.tables).toBe(null);
    expect(json.refusal).toBe("the Vanta roster spine would not read, so no administrator can be joined");
  });
});
