import { describe, expect, it } from "vitest";

import { bucketFor, type JoinSubject, joinFormerStaff, overallBucket } from "../../../accessReview/join.js";
import { ACCESS_LEVEL_TABLE, ROSTER_SPINE } from "../../../accessReview/levels.js";
import { rosterOf } from "../../../accessReview/roster.js";
import { accessRowsOf } from "../../../accessReview/rows.js";

import { entity, personDetail } from "./fixtures.js";

const JUMPCLOUD = ACCESS_LEVEL_TABLE.find((spec) => spec.platform === "jumpcloud")!;

/** A roster built from one spell per address. */
function rosterFrom({
  spells,
}: {
  spells: readonly { readonly email: string; readonly status: string; readonly endDate: string | null }[];
}): ReturnType<typeof rosterOf> {
  return rosterOf({
    entities: spells.map((spell, index) =>
      entity({
        detail: personDetail({
          display: "A Person",
          email: spell.email,
          endDate: spell.endDate,
          status: spell.status,
        }),
        providerId: `person:${String(index)}`,
      }),
    ),
    spec: ROSTER_SPINE,
  });
}

/** One jumpcloud subject read at the given stamp. */
function jumpcloudSubject({
  addresses,
  readStampIso,
  state = "ACTIVATED",
}: {
  addresses: readonly string[];
  readStampIso: string | null;
  state?: string;
}): JoinSubject {
  return {
    readStampIso,
    rows: accessRowsOf({
      entities: addresses.map((email, index) =>
        entity({ detail: { email, state }, providerId: `v1-systemusers-get:${String(index)}` }),
      ),
      spec: JUMPCLOUD,
    }),
  };
}

describe("bucketFor", () => {
  it("confirms a departure at or before the read stamp", () => {
    expect(bucketFor({ endDateIso: "2026-09-01T00:00:00.000Z", readStampIso: "2026-09-06T00:00:00.000Z" })).toBe(
      "confirmed",
    );
  });

  it("confirms a departure on the read stamp itself", () => {
    expect(bucketFor({ endDateIso: "2026-09-06T00:00:00.000Z", readStampIso: "2026-09-06T00:00:00.000Z" })).toBe(
      "confirmed",
    );
  });

  it("leaves a departure after the read stamp unmeasured", () => {
    expect(bucketFor({ endDateIso: "2026-09-11T00:00:00.000Z", readStampIso: "2026-09-06T00:00:00.000Z" })).toBe(
      "unmeasured",
    );
  });

  it("leaves a kind that has never read successfully unmeasured", () => {
    expect(bucketFor({ endDateIso: "2026-09-01T00:00:00.000Z", readStampIso: null })).toBe("unmeasured");
  });

  it("leaves a missing end date unmeasured", () => {
    expect(bucketFor({ endDateIso: null, readStampIso: "2026-09-06T00:00:00.000Z" })).toBe("unmeasured");
  });

  it("leaves an unparseable instant unmeasured rather than guessing", () => {
    expect(bucketFor({ endDateIso: "last tuesday", readStampIso: "2026-09-06T00:00:00.000Z" })).toBe("unmeasured");
    expect(bucketFor({ endDateIso: "2026-09-01T00:00:00.000Z", readStampIso: "soon" })).toBe("unmeasured");
  });

  it("leaves a string Date.parse would guess at unmeasured, never confirmed", () => {
    expect(bucketFor({ endDateIso: "0", readStampIso: "2001-01-01T00:00:00.000Z" })).toBe("unmeasured");
    expect(bucketFor({ endDateIso: "2000-01-01", readStampIso: "2001-01-01T00:00:00.000Z" })).toBe("unmeasured");
  });
});

describe("overallBucket", () => {
  it("takes confirmed when any one platform confirms", () => {
    expect(
      overallBucket({
        findings: [
          { bucket: "unmeasured", levels: [], platform: "a", readStampIso: null },
          { bucket: "confirmed", levels: [], platform: "b", readStampIso: "2026-09-06T00:00:00.000Z" },
        ],
      }),
    ).toBe("confirmed");
  });

  it("takes unmeasured when a live account exists but nothing confirms it", () => {
    expect(overallBucket({ findings: [{ bucket: "unmeasured", levels: [], platform: "a", readStampIso: null }] })).toBe(
      "unmeasured",
    );
  });

  it("takes clean when no platform holds an account", () => {
    expect(overallBucket({ findings: [] })).toBe("clean");
  });
});

describe("joinFormerStaff", () => {
  it("confirms a departed person whose account was live at the read", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({ spells: [{ email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" }] }),
      subjects: [jumpcloudSubject({ addresses: ["gone@x.test"], readStampIso: "2026-09-06T00:00:00.000Z" })],
    });
    expect(join.confirmed.map((row) => row.email)).toEqual(["gone@x.test"]);
    expect(join.confirmed[0]!.findings.map((finding) => finding.platform)).toEqual(["jumpcloud"]);
    expect(join.confirmed[0]!.findings[0]!.levels).toEqual(["state=ACTIVATED"]);
    expect(join.clean).toBe(0);
  });

  it("leaves a person who left after the read unmeasured", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({ spells: [{ email: "gone@x.test", endDate: "2026-09-11T00:00:00.000Z", status: "FORMER" }] }),
      subjects: [jumpcloudSubject({ addresses: ["gone@x.test"], readStampIso: "2026-09-06T00:00:00.000Z" })],
    });
    expect(join.unmeasured.map((row) => row.email)).toEqual(["gone@x.test"]);
    expect(join.confirmed).toEqual([]);
  });

  it("counts a departed person holding no live account as clean", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({ spells: [{ email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" }] }),
      subjects: [
        jumpcloudSubject({ addresses: ["gone@x.test"], readStampIso: "2026-09-06T00:00:00.000Z", state: "SUSPENDED" }),
      ],
    });
    expect(join.clean).toBe(1);
    expect(join.confirmed).toEqual([]);
    expect(join.unmeasured).toEqual([]);
  });

  it("never calls a person clean off a read taken before they left, account or not", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({ spells: [{ email: "gone@x.test", endDate: "2026-09-11T00:00:00.000Z", status: "FORMER" }] }),
      subjects: [
        jumpcloudSubject({ addresses: [], readStampIso: "2026-09-06T00:00:00.000Z" }),
        jumpcloudSubject({ addresses: ["gone@x.test"], readStampIso: "2026-09-12T00:00:00.000Z", state: "SUSPENDED" }),
      ],
    });
    expect(join.clean).toBe(0);
    expect(join.unmeasured.map((row) => row.email)).toEqual(["gone@x.test"]);
    expect(join.unmeasured[0]!.findings).toEqual([]);
  });

  it("buckets a departure whose end date is not an instant as unmeasured, never dropping it", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({ spells: [{ email: "gone@x.test", endDate: "2026-09-11", status: "FORMER" }] }),
      subjects: [jumpcloudSubject({ addresses: [], readStampIso: "2026-09-06T00:00:00.000Z" })],
    });
    expect(join.unmeasured.map((row) => row.email)).toEqual(["gone@x.test"]);
    expect(join.unmeasured[0]!.endDateIso).toBe("2026-09-11");
    expect(join.clean).toBe(0);
    expect(join.unbucketable).toEqual([]);
  });

  it("never counts a rehire as a finding, and publishes the count instead", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({
        spells: [
          { email: "back@x.test", endDate: "2026-04-28T00:00:00.000Z", status: "FORMER" },
          { email: "back@x.test", endDate: null, status: "CURRENT" },
        ],
      }),
      subjects: [jumpcloudSubject({ addresses: ["back@x.test"], readStampIso: "2026-09-06T00:00:00.000Z" })],
    });
    expect(join.confirmed).toEqual([]);
    expect(join.unmeasured).toEqual([]);
    expect(join.clean).toBe(0);
    expect(join.rehired).toEqual(["back@x.test"]);
  });

  it("keeps the old address CONFIRMED when the rehire is under a new one, since no live spell covers it", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({
        spells: [
          { email: "old@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" },
          { email: "new@x.test", endDate: null, status: "CURRENT" },
        ],
      }),
      subjects: [jumpcloudSubject({ addresses: ["old@x.test"], readStampIso: "2026-09-06T00:00:00.000Z" })],
    });
    expect(join.confirmed.map((row) => row.email)).toEqual(["old@x.test"]);
    expect(join.rehired).toEqual([]);
  });

  it("reports a platform address the roster does not carry as unjoinable", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({ spells: [{ email: "known@x.test", endDate: null, status: "CURRENT" }] }),
      subjects: [
        jumpcloudSubject({ addresses: ["known@x.test", "stranger@x.test"], readStampIso: "2026-09-06T00:00:00.000Z" }),
      ],
    });
    expect(join.unjoinable).toEqual([{ addresses: ["stranger@x.test"], platform: "jumpcloud" }]);
  });

  it("carries the residues the three buckets cannot hold", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({
        spells: [
          { email: "nodate@x.test", endDate: null, status: "FORMER" },
          { email: "away@x.test", endDate: null, status: "ON_LEAVE" },
        ],
      }),
      subjects: [],
    });
    expect(join.unbucketable).toEqual(["nodate@x.test"]);
    expect(join.nonDepartureStatuses).toEqual([{ addresses: 1, status: "ON_LEAVE" }]);
    expect(join.confirmed).toEqual([]);
    expect(join.clean).toBe(0);
  });

  it("drops only the levels a record does not carry from a finding", () => {
    const join = joinFormerStaff({
      roster: rosterFrom({ spells: [{ email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" }] }),
      subjects: [
        {
          readStampIso: "2026-09-06T00:00:00.000Z",
          rows: accessRowsOf({
            entities: [
              entity({
                detail: { admin: { roleName: "administrator" }, email: "gone@x.test", state: "ACTIVATED" },
                providerId: "v1-systemusers-get:1",
              }),
            ],
            spec: JUMPCLOUD,
          }),
        },
      ],
    });
    expect(join.confirmed[0]!.findings[0]!.levels).toEqual(["state=ACTIVATED", "console role=administrator"]);
  });

  it("answers empty buckets for an empty roster and no subjects", () => {
    const join = joinFormerStaff({ roster: rosterFrom({ spells: [] }), subjects: [] });
    expect(join.confirmed).toEqual([]);
    expect(join.unmeasured).toEqual([]);
    expect(join.clean).toBe(0);
    expect(join.unjoinable).toEqual([]);
  });
});
