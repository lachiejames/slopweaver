import { describe, expect, it } from "vitest";

import { ACCESS_LEVEL_TABLE, ROSTER_SPINE } from "../../../accessReview/levels.js";
import {
  buildAccessReview,
  type PlatformSource,
  platformSectionOf,
  reportBoundaryLines,
} from "../../../accessReview/report.js";

import { entity, kindView, personDetail, snapshot } from "./fixtures.js";

const JUMPCLOUD = ACCESS_LEVEL_TABLE.find((spec) => spec.platform === "jumpcloud")!;
const READ_STAMP = "2026-09-06T00:00:00.000Z";

/** A jumpcloud source holding one person at the given state. */
function jumpcloudSource({
  email,
  state = "ACTIVATED",
  role = null,
  observation = "observed",
}: {
  email: string;
  state?: string;
  role?: string | null;
  observation?: "observed" | "stale";
}): PlatformSource {
  return {
    platform: "jumpcloud",
    refusal: null,
    snapshot: snapshot({
      kinds: [
        kindView({
          entities: [
            entity({
              detail: { email, state, ...(role === null ? {} : { admin: { roleName: role } }) },
              providerId: "v1-systemusers-get:1",
              state: observation,
            }),
          ],
          kind: "systemusers",
          lastSuccessAt: READ_STAMP,
        }),
      ],
      platform: "jumpcloud",
    }),
  };
}

/** A Vanta spine source holding one employment spell per entry. */
function spineSource({
  spells,
}: {
  spells: readonly { readonly email: string; readonly status: string; readonly endDate: string | null }[];
}): PlatformSource {
  return {
    platform: "vanta",
    refusal: null,
    snapshot: snapshot({
      kinds: [
        kindView({
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
          kind: ROSTER_SPINE.kind,
          lastSuccessAt: READ_STAMP,
        }),
      ],
      platform: "vanta",
    }),
  };
}

describe("platformSectionOf", () => {
  it("builds rows and a boundary from a snapshot that read", () => {
    const section = platformSectionOf({ source: jumpcloudSource({ email: "a@x.test" }), spec: JUMPCLOUD });
    expect(section.refusal).toBe(null);
    expect(section.rows!.rows.map((row) => row.email)).toEqual(["a@x.test"]);
    expect(section.boundary!.readStampIso).toBe(READ_STAMP);
    expect(section.display).toBe("JumpCloud");
  });

  it("carries the atlas's own refusal message when the snapshot would not read", () => {
    const section = platformSectionOf({
      source: { platform: "jumpcloud", refusal: "generation unpublished", snapshot: null },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe("generation unpublished");
    expect(section.rows).toBe(null);
    expect(section.boundary).toBe(null);
  });

  it("says so rather than inventing a reason when a refusal names none", () => {
    const section = platformSectionOf({
      source: { platform: "jumpcloud", refusal: null, snapshot: null },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe("the atlas would not read and gave no reason");
  });

  it("refuses a snapshot that holds no such kind, naming the kind", () => {
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: snapshot({
          kinds: [kindView({ entities: [], kind: "systems", lastSuccessAt: READ_STAMP })],
          platform: "jumpcloud",
        }),
      },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe("this build's jumpcloud atlas declares no `systemusers` kind");
  });

  it("refuses a kind that has never read successfully, rather than reporting its empty rows", () => {
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: snapshot({
          kinds: [kindView({ entities: [], kind: "systemusers", lastSuccessAt: null })],
          platform: "jumpcloud",
        }),
      },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe("jumpcloud/systemusers has never read successfully, so it measured nothing");
    expect(section.rows).toBe(null);
    expect(section.boundary).toBe(null);
  });

  it("refuses a permission-blocked kind even when an earlier read succeeded", () => {
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: snapshot({
          kinds: [
            {
              ...kindView({ entities: [], kind: "systemusers", lastSuccessAt: READ_STAMP }),
              permissionBlocked: { at: READ_STAMP, detail: "403 forbidden", unblockedBy: "restore read scope" },
            },
          ],
          platform: "jumpcloud",
        }),
      },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe(
      "jumpcloud/systemusers is permission-blocked — 403 forbidden (unblocked by restore read scope)",
    );
    expect(section.rows).toBe(null);
  });

  it("refuses a kind whose file the manifest vouches for but the generation reports missing", () => {
    const base = snapshot({
      kinds: [kindView({ entities: [], kind: "systemusers", lastSuccessAt: READ_STAMP, publishedCount: 0 })],
      platform: "jumpcloud",
    });
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: { ...base, generation: { ...base.generation, missing: ["systemusers"] } },
      },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe(
      "jumpcloud/systemusers's file is missing though the manifest vouches for it, so it measured nothing",
    );
    expect(section.rows).toBe(null);
  });

  it("refuses a kind the generation reports superseded or mismatched", () => {
    const base = snapshot({
      kinds: [kindView({ entities: [], kind: "systemusers", lastSuccessAt: READ_STAMP })],
      platform: "jumpcloud",
    });
    const refusalFor = ({ generation }: { generation: typeof base.generation }): string | null =>
      platformSectionOf({
        source: { platform: "jumpcloud", refusal: null, snapshot: { ...base, generation } },
        spec: JUMPCLOUD,
      }).refusal;
    expect(refusalFor({ generation: { ...base.generation, superseded: ["systemusers"] } })).toBe(
      "jumpcloud/systemusers's records are on disk in a previous format this build does not read — re-sync it",
    );
    expect(refusalFor({ generation: { ...base.generation, mismatched: ["systemusers"] } })).toBe(
      "jumpcloud/systemusers's file is not the one the manifest published, so its rows are not the surface it vouches for",
    );
  });

  it("refuses a read kind holding records only from a family other than the one carrying the level", () => {
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: snapshot({
          kinds: [
            kindView({
              entities: [entity({ detail: { email: "a@x.test" }, providerId: "v1-systemusers-list:1" })],
              kind: "systemusers",
              lastSuccessAt: READ_STAMP,
            }),
          ],
          platform: "jumpcloud",
        }),
      },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe(
      "jumpcloud/systemusers holds 1 records and none from v1-systemusers-get, the family carrying its access level, so that surface measured nothing",
    );
    expect(section.rows).toBe(null);
  });

  it("refuses a kind with a fresh stamp whose attempted coverage cell failed and never read", () => {
    const view = kindView({
      entities: [entity({ detail: { email: "a@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" })],
      kind: "systemusers",
      lastSuccessAt: READ_STAMP,
    });
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: snapshot({
          kinds: [
            {
              ...view,
              coverage: [
                {
                  lastSuccessAt: null,
                  latestAttemptFailed: true,
                  reason: "a projection hit the depth limit",
                  scope: "systemusers",
                  state: "unreadable",
                  surface: "directory-api",
                  unblockedBy: null,
                },
              ],
            },
          ],
          platform: "jumpcloud",
        }),
      },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe(
      "jumpcloud/systemusers's directory-api/systemusers coverage is unreadable and has never read successfully — a projection hit the depth limit",
    );
    expect(section.rows).toBe(null);
  });

  it("reads a kind holding the level-carrying family beside another one", () => {
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: snapshot({
          kinds: [
            kindView({
              entities: [
                entity({ detail: { email: "a@x.test" }, providerId: "v1-systemusers-list:1" }),
                entity({ detail: { email: "a@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" }),
              ],
              kind: "systemusers",
              lastSuccessAt: READ_STAMP,
            }),
          ],
          platform: "jumpcloud",
        }),
      },
      spec: JUMPCLOUD,
    });
    expect(section.refusal).toBe(null);
    expect(section.rows!.rows.map((row) => row.email)).toEqual(["a@x.test"]);
    expect(section.rows!.otherFamily).toBe(1);
  });
});

describe("buildAccessReview over a never-read kind", () => {
  it("refuses the join when the roster spine has never read successfully", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ email: "a@x.test" }),
        {
          platform: "vanta",
          refusal: null,
          snapshot: snapshot({
            kinds: [kindView({ entities: [], kind: ROSTER_SPINE.kind, lastSuccessAt: null })],
            platform: "vanta",
          }),
        },
      ],
    });
    expect(report.join).toBe(null);
    expect(report.privileged).toBe(null);
  });
});

describe("buildAccessReview", () => {
  it("sections only the platforms the invocation gathered", () => {
    const report = buildAccessReview({
      sources: [jumpcloudSource({ email: "a@x.test" }), spineSource({ spells: [] })],
    });
    expect(report.sections.map((section) => section.platform)).toEqual(["jumpcloud"]);
  });

  it("never prints a deliberate non-gather as a refusal", () => {
    const report = buildAccessReview({
      sources: [jumpcloudSource({ email: "a@x.test" }), spineSource({ spells: [] })],
    });
    expect(reportBoundaryLines({ report }).filter((line) => line.includes("cloudflare"))).toEqual([]);
  });

  it("joins the spine against every gathered platform", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ email: "gone@x.test" }),
        spineSource({ spells: [{ email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" }] }),
      ],
    });
    expect(report.join!.confirmed.map((row) => row.email)).toEqual(["gone@x.test"]);
    expect(report.roster!.people.length).toBe(1);
  });

  it("builds a privileged table only for a platform naming a console role", () => {
    const report = buildAccessReview({
      sources: [jumpcloudSource({ email: "admin@x.test", role: "administrator" }), spineSource({ spells: [] })],
    });
    expect(report.privileged!.map((table) => table.platform)).toEqual(["jumpcloud"]);
    expect(report.privileged![0]!.rows.map((row) => row.role)).toEqual(["administrator"]);
  });

  it("refuses the join and the table when the spine would not read, and still builds the sections", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ email: "a@x.test" }),
        { platform: "vanta", refusal: "store unreadable", snapshot: null },
      ],
    });
    expect(report.join).toBe(null);
    expect(report.roster).toBe(null);
    expect(report.privileged).toBe(null);
    expect(report.sections[0]!.rows!.rows.length).toBe(1);
    expect(report.spine.refusal).toBe("store unreadable");
  });

  it("names a platform asked for but never gathered as refused in the boundary", () => {
    const report = buildAccessReview({ sources: [spineSource({ spells: [] })] });
    expect(reportBoundaryLines({ report })).toEqual([
      "read stamp · vanta/person last successful read 2026-09-06T00:00:00.000Z",
      "records · 0 read back, 0 vouched for by the manifest",
      "declared boundary · no permission block declared and no coverage reason recorded for this kind",
    ]);
  });
});

describe("reportBoundaryLines", () => {
  it("prints one refusal line per section that could not read", () => {
    const report = buildAccessReview({
      sources: [
        { platform: "jumpcloud", refusal: "generation unpublished", snapshot: null },
        spineSource({ spells: [] }),
      ],
    });
    expect(reportBoundaryLines({ report })[0]).toBe("read stamp · jumpcloud REFUSED — generation unpublished");
  });

  it("reads a leaver whose only live record is stale as clean, and prints the stale record it skipped", () => {
    const report = buildAccessReview({
      sources: [
        jumpcloudSource({ email: "gone@x.test", observation: "stale" }),
        spineSource({ spells: [{ email: "gone@x.test", endDate: "2026-08-01T00:00:00.000Z", status: "FORMER" }] }),
      ],
    });
    expect(report.join!.confirmed).toEqual([]);
    expect(report.join!.clean).toBe(1);
    expect(reportBoundaryLines({ report }).filter((line) => line.startsWith("stale · "))).toEqual([
      "stale · 1 jumpcloud/systemusers record(s) the last complete read no longer returned — deleted at the provider, so read as no account",
    ]);
  });
});
