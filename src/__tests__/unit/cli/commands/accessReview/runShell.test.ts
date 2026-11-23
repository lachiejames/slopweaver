import { describe, expect, it } from "vitest";

import { ROSTER_SPINE } from "../../../../../accessReview/levels.js";
import { AtlasReadErrors } from "../../../../../atlas/kit/read.js";
import type { AtlasPlatformRegistration } from "../../../../../atlas/kit/registration.js";
import { runAccessReviewFormer } from "../../../../../cli/commands/accessReview/formerRun.js";
import { gatherPlatform, gatherSources } from "../../../../../cli/commands/accessReview/gather.js";
import { runAccessReviewPlatform } from "../../../../../cli/commands/accessReview/platformRun.js";
import { runAccessReviewPrivileged } from "../../../../../cli/commands/accessReview/privilegedRun.js";
import type { AccessReviewDeps } from "../../../../../cli/commands/accessReview/runShell.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { entity, kindView, personDetail, snapshot } from "../../../accessReview/fixtures.js";

const READ_STAMP = "2026-09-06T00:00:00.000Z";

/** What one fake atlas answers. */
interface FakeAtlas {
  readonly platform: string;
  readonly snapshot: ReturnType<typeof snapshot> | null;
}

/** A registration whose read answers the fake's snapshot, or refuses. */
function registrationFor({ atlas }: { atlas: FakeAtlas }): AtlasPlatformRegistration {
  return {
    catalogue: { doorRouted: false, example: "", summary: null },
    platform: atlas.platform,
    readDescriptor: async () => {
      throw new Error("a fake atlas declares no descriptor");
    },
    readSnapshot: async () => {
      if (atlas.snapshot === null) {
        return err(AtlasReadErrors.generationUnpublished({ platform: atlas.platform }));
      }
      return ok(atlas.snapshot);
    },
    verbs: [],
  };
}

/** Injected edges collecting every line, over a fixed set of fake atlases. */
function depsOver({ atlases }: { atlases: readonly FakeAtlas[] }): {
  readonly deps: AccessReviewDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly read: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const read: string[] = [];
  return {
    deps: {
      gather: {
        find: ({ platform }) => {
          const found = atlases.find((atlas) => atlas.platform === platform);
          if (found === undefined) {
            return null;
          }
          read.push(platform);
          return registrationFor({ atlas: found });
        },
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    read,
  };
}

/** A jumpcloud atlas holding one person. */
function jumpcloudAtlas({ email, role = null }: { email: string; role?: string | null }): FakeAtlas {
  return {
    platform: "jumpcloud",
    snapshot: snapshot({
      kinds: [
        kindView({
          entities: [
            entity({
              detail: {
                displayname: "A Person",
                email,
                state: "ACTIVATED",
                ...(role === null ? {} : { admin: { roleName: role } }),
              },
              providerId: "v1-systemusers-get:1",
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

/** A spine atlas holding one spell per entry. */
function spineAtlas({
  spells,
}: {
  spells: readonly { readonly email: string; readonly status: string; readonly endDate: string | null }[];
}): FakeAtlas {
  return {
    platform: "vanta",
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

/** The cloudflare and 1password atlases, empty but readable, so `former` can gather all four. */
const EMPTY_ATLASES: readonly FakeAtlas[] = [
  {
    platform: "cloudflare",
    snapshot: snapshot({
      kinds: [kindView({ entities: [], kind: "access-user", lastSuccessAt: READ_STAMP })],
      platform: "cloudflare",
    }),
  },
  {
    platform: "onepassword",
    snapshot: snapshot({
      kinds: [kindView({ entities: [], kind: "user", lastSuccessAt: READ_STAMP })],
      platform: "onepassword",
    }),
  },
];

describe("gatherPlatform", () => {
  it("carries a refusal as a source rather than throwing it", async () => {
    const { deps } = depsOver({ atlases: [{ platform: "jumpcloud", snapshot: null }] });
    const source = await gatherPlatform({ deps: deps.gather, home: undefined, platform: "jumpcloud" });
    expect(source.snapshot).toBe(null);
    expect(source.refusal).toContain("no jumpcloud generation has been published");
  });

  it("names a platform this build has no atlas for", async () => {
    const { deps } = depsOver({ atlases: [] });
    const source = await gatherPlatform({ deps: deps.gather, home: undefined, platform: "nope" });
    expect(source.refusal).toBe("this build has no nope atlas");
  });

  it("answers the snapshot when the atlas reads", async () => {
    const { deps } = depsOver({ atlases: [jumpcloudAtlas({ email: "a@x.test" })] });
    const source = await gatherPlatform({ deps: deps.gather, home: undefined, platform: "jumpcloud" });
    expect(source.refusal).toBe(null);
    expect(source.snapshot!.kinds.map((view) => view.kind)).toEqual(["systemusers"]);
  });
});

describe("gatherSources", () => {
  it("reads every platform asked for, in order", async () => {
    const { deps, read } = depsOver({
      atlases: [jumpcloudAtlas({ email: "a@x.test" }), spineAtlas({ spells: [] })],
    });
    const sources = await gatherSources({
      deps: deps.gather,
      home: undefined,
      platforms: ["jumpcloud", "vanta"],
    });
    expect(sources.map((source) => source.platform)).toEqual(["jumpcloud", "vanta"]);
    expect(read).toEqual(["jumpcloud", "vanta"]);
  });
});

describe("runAccessReviewPlatform", () => {
  it("prints the named platform's section and exits 0", async () => {
    const { deps, out } = depsOver({
      atlases: [jumpcloudAtlas({ email: "a@x.test" }), spineAtlas({ spells: [] })],
    });
    const code = await runAccessReviewPlatform({
      argv: ["node", "slopweaver", "access-review", "platform", "jumpcloud"],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain("JumpCloud (jumpcloud/systemusers)");
  });

  it("refuses an invocation naming no platform, printing the known ones", async () => {
    const { deps, diagnostics } = depsOver({ atlases: [] });
    const code = await runAccessReviewPlatform({ argv: ["node", "slopweaver", "access-review", "platform"], deps });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("name the platform to report on — one of: jumpcloud, cloudflare, onepassword");
  });

  it("refuses a platform this report declares no level for", async () => {
    const { deps, diagnostics } = depsOver({ atlases: [] });
    const code = await runAccessReviewPlatform({
      argv: ["node", "slopweaver", "access-review", "platform", "datadog"],
      deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe(
      "no per-user access level is declared for datadog — this report covers: jumpcloud, cloudflare, onepassword",
    );
  });

  it("reads only the named platform, never the spine its section does not use", async () => {
    const { deps, read } = depsOver({
      atlases: [jumpcloudAtlas({ email: "a@x.test" }), spineAtlas({ spells: [] }), ...EMPTY_ATLASES],
    });
    await runAccessReviewPlatform({ argv: ["node", "slopweaver", "access-review", "platform", "jumpcloud"], deps });
    expect(read).toEqual(["jumpcloud"]);
  });

  it("prints usage on --help without reading any atlas", async () => {
    const { deps, out, read } = depsOver({ atlases: [] });
    const code = await runAccessReviewPlatform({
      argv: ["node", "slopweaver", "access-review", "platform", "--help"],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(read).toEqual([]);
    expect(out[0]).toContain("access-review platform");
  });

  it("prints a JSON document under --json", async () => {
    const { deps, out } = depsOver({
      atlases: [jumpcloudAtlas({ email: "a@x.test" }), spineAtlas({ spells: [] })],
    });
    await runAccessReviewPlatform({
      argv: ["node", "slopweaver", "access-review", "platform", "jumpcloud", "--json"],
      deps,
    });
    const parsed = JSON.parse(out.join("\n")) as { readonly platform: string; readonly rows: readonly unknown[] };
    expect(parsed.platform).toBe("jumpcloud");
    expect(parsed.rows.length).toBe(1);
  });
});

describe("runAccessReviewFormer", () => {
  it("exits non-zero when anything is confirmed, and still prints the whole report", async () => {
    const { deps, out } = depsOver({
      atlases: [
        jumpcloudAtlas({ email: "gone@x.test" }),
        spineAtlas({ spells: [{ email: "gone@x.test", endDate: "2026-09-01T00:00:00.000Z", status: "FORMER" }] }),
        ...EMPTY_ATLASES,
      ],
    });
    const code = await runAccessReviewFormer({ argv: ["node", "slopweaver", "access-review", "former"], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(out[0]).toBe("CONFIRMED · 1 former staff still holding a live account at that platform's own read");
  });

  it("exits 0 when nothing is confirmed", async () => {
    const { deps } = depsOver({
      atlases: [
        jumpcloudAtlas({ email: "live@x.test" }),
        spineAtlas({ spells: [{ email: "live@x.test", endDate: null, status: "CURRENT" }] }),
        ...EMPTY_ATLASES,
      ],
    });
    const code = await runAccessReviewFormer({ argv: ["node", "slopweaver", "access-review", "former"], deps });
    expect(code).toBe(EXIT_OK);
  });

  it("exits non-zero when the spine would not read, so a failed join never looks clean", async () => {
    const { deps, out } = depsOver({
      atlases: [jumpcloudAtlas({ email: "a@x.test" }), { platform: "vanta", snapshot: null }, ...EMPTY_ATLASES],
    });
    const code = await runAccessReviewFormer({ argv: ["node", "slopweaver", "access-review", "former"], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(out[0]).toBe(
      "access-review former · REFUSED — the Vanta roster spine would not read, so nothing can be joined",
    );
  });

  it("gathers all four atlases", async () => {
    const { deps, read } = depsOver({
      atlases: [jumpcloudAtlas({ email: "a@x.test" }), spineAtlas({ spells: [] }), ...EMPTY_ATLASES],
    });
    await runAccessReviewFormer({ argv: ["node", "slopweaver", "access-review", "former"], deps });
    expect(read).toEqual(["jumpcloud", "cloudflare", "onepassword", "vanta"]);
  });

  it("refuses a positional argument", async () => {
    const { deps, diagnostics } = depsOver({ atlases: [] });
    const code = await runAccessReviewFormer({
      argv: ["node", "slopweaver", "access-review", "former", "jumpcloud"],
      deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("this verb takes no positional argument — got jumpcloud");
  });
});

describe("runAccessReviewPrivileged", () => {
  it("never reads a platform that declares no console role", async () => {
    const { deps, read } = depsOver({
      atlases: [jumpcloudAtlas({ email: "a@x.test" }), spineAtlas({ spells: [] }), ...EMPTY_ATLASES],
    });
    const code = await runAccessReviewPrivileged({
      argv: ["node", "slopweaver", "access-review", "privileged"],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(read).toEqual(["jumpcloud", "vanta"]);
  });

  it("prints the administrator table", async () => {
    const { deps, out } = depsOver({
      atlases: [
        jumpcloudAtlas({ email: "admin@x.test", role: "administrator" }),
        spineAtlas({ spells: [{ email: "admin@x.test", endDate: null, status: "CURRENT" }] }),
      ],
    });
    await runAccessReviewPrivileged({ argv: ["node", "slopweaver", "access-review", "privileged"], deps });
    expect(out[0]).toBe(
      "jumpcloud/systemusers · 1 administrator(s) out of 1 people examined · read 2026-09-06T00:00:00.000Z",
    );
    expect(out[1]).toContain("administrator  ·  A Person  ·  admin@x.test  ·  CURRENT");
  });

  it("never prints a platform it deliberately skipped as refused", async () => {
    const { deps, out } = depsOver({
      atlases: [jumpcloudAtlas({ email: "a@x.test" }), spineAtlas({ spells: [] })],
    });
    await runAccessReviewPrivileged({ argv: ["node", "slopweaver", "access-review", "privileged"], deps });
    expect(out.filter((line) => line.includes("cloudflare"))).toEqual([]);
  });
});
