import { describe, expect, it } from "vitest";

import type { AtlasPlatformRegistration } from "../../../../../atlas/kit/registration.js";
import { ATLAS_KIT_VERBS, atlasPlatformVerbNames } from "../../../../../atlas/kit/verbs.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../../../atlas/registry.js";
import { ATLAS_COVERAGE_FLAG_NAMES, ATLAS_COVERAGE_USAGE } from "../../../../../cli/commands/atlas/coverageCore.js";
import type { AtlasPlatformDeps } from "../../../../../cli/commands/atlas/platformRun.js";
import { atlasPlatformCommand, runAtlasPlatform } from "../../../../../cli/commands/atlas/platformRun.js";
import {
  atlasPlatformDispatch,
  atlasPlatformUsage,
  atlasPlatformWantsHelp,
} from "../../../../../cli/commands/atlas/platformVerb.js";
import { ATLAS_READ_FLAG_NAMES, ATLAS_READ_USAGE } from "../../../../../cli/commands/atlas/readArgs.js";
import type { CommandRun } from "../../../../../cli/defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** argv as the CLI receives it: runtime, script, noun, platform, then the platform's own tail. */
function argvOf({ platform, tail }: { platform: string; tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", platform, ...tail];
}

function platformDeps(): AtlasPlatformDeps & { readonly out: string[]; readonly diag: string[] } {
  const out: string[] = [];
  const diag: string[] = [];
  return {
    diag,
    out,
    writeDiagnostic: (line) => diag.push(line),
    writeOut: (line) => out.push(line),
  };
}

/**
 * A registration built by hand rather than read from the registry, so a dispatch decision is tested
 * against a row whose every field this file controls — including the one FALLBACK shape only Slack has.
 */
function fakeRegistration({
  platform,
  verbs,
  fallback,
}: {
  platform: string;
  verbs: readonly string[];
  fallback?: (argv: readonly string[]) => number;
}): AtlasPlatformRegistration {
  return {
    catalogue: { doorRouted: false, example: `slopweaver atlas ${platform} read --json`, summary: null },
    ...(fallback === undefined ? {} : { fallback: () => Promise.resolve(fallback) }),
    platform,
    readDescriptor: () => Promise.reject(new Error("not read by a dispatch test")),
    readSnapshot: () => Promise.reject(new Error("not read by a dispatch test")),
    verbs: verbs.map((verb) => ({
      describe: `does ${verb}`,
      load: () => {
        const command: CommandRun = (argv) => 100 + argv.length;
        return Promise.resolve(command);
      },
      usage: [`${verb} [--json]`],
      verb,
    })),
  };
}

const vanta = findAtlasPlatform({ platform: "vanta" })!;

describe("atlasPlatformDispatch", () => {
  it("reads a kit verb from the word after the platform", () => {
    expect(
      atlasPlatformDispatch({
        argv: argvOf({ platform: "vanta", tail: ["read", "--kind", "policy"] }),
        registration: vanta,
      }),
    ).toEqual({
      kind: "kit",
      verb: "read",
    });
    expect(
      atlasPlatformDispatch({ argv: argvOf({ platform: "vanta", tail: ["coverage"] }), registration: vanta }),
    ).toEqual({
      kind: "kit",
      verb: "coverage",
    });
  });

  it("reads one of the platform's own verbs from its registration, carrying the row", () => {
    const dispatch = atlasPlatformDispatch({
      argv: argvOf({ platform: "vanta", tail: ["sync"] }),
      registration: vanta,
    });
    expect(dispatch).toMatchObject({ kind: "own", verb: { verb: "sync" } });
  });

  it("names a verb the platform does not have rather than guessing", () => {
    const registration = fakeRegistration({ platform: "p", verbs: ["sync"] });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "p", tail: ["walk"] }), registration })).toEqual({
      given: "walk",
      kind: "unknown-verb",
    });
  });

  it("says a verb is needed when none was given", () => {
    const registration = fakeRegistration({ platform: "p", verbs: ["sync"] });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "p", tail: [] }), registration })).toEqual({
      kind: "needs-verb",
    });
  });

  // The platform is the third word, so what used to be its flag is now just a word in the verb slot.
  it("treats the flag the platform used to be as an unknown verb", () => {
    const registration = fakeRegistration({ platform: "p", verbs: [] });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "p", tail: ["--platform", "p"] }), registration })).toEqual(
      {
        given: "--platform",
        kind: "unknown-verb",
      },
    );
  });

  it("answers help for --help or -h in a tail naming no verb the platform answers", () => {
    const registration = fakeRegistration({ platform: "p", verbs: ["sync"] });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "p", tail: ["--help"] }), registration })).toEqual({
      kind: "help",
    });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "p", tail: ["-h"] }), registration })).toEqual({
      kind: "help",
    });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "p", tail: ["bogus", "--help"] }), registration })).toEqual(
      {
        kind: "help",
      },
    );
  });

  it("leaves --help on a real verb to that verb", () => {
    const registration = fakeRegistration({ platform: "p", verbs: ["sync"] });
    const dispatch = atlasPlatformDispatch({ argv: argvOf({ platform: "p", tail: ["sync", "--help"] }), registration });
    expect(dispatch.kind).toBe("own");
  });

  // Slack keeps its own map alongside the kit verbs: a tail that is not a kit verb runs the platform's
  // fallback untouched, which is what makes `atlas slack` still the map it always was.
  it("sends any tail that is not a verb to the fallback when the row has one", () => {
    const registration = fakeRegistration({ fallback: () => 7, platform: "slack", verbs: [] });
    expect(
      atlasPlatformDispatch({ argv: argvOf({ platform: "slack", tail: ["--never-read"] }), registration }),
    ).toEqual({
      kind: "fallback",
    });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "slack", tail: [] }), registration })).toEqual({
      kind: "fallback",
    });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "slack", tail: ["--help"] }), registration })).toEqual({
      kind: "fallback",
    });
  });

  it("prefers a kit verb over the fallback when both could apply", () => {
    const registration = fakeRegistration({ fallback: () => 7, platform: "slack", verbs: [] });
    expect(
      atlasPlatformDispatch({ argv: argvOf({ platform: "slack", tail: ["coverage", "--help"] }), registration }),
    ).toEqual({
      kind: "kit",
      verb: "coverage",
    });
  });

  it("prefers a kit verb over an own verb of the same name, so a row cannot shadow read", () => {
    const registration = fakeRegistration({ platform: "p", verbs: ["read"] });
    expect(atlasPlatformDispatch({ argv: argvOf({ platform: "p", tail: ["read"] }), registration })).toEqual({
      kind: "kit",
      verb: "read",
    });
  });
});

describe("atlasPlatformWantsHelp", () => {
  it("sees help in the platform's own tail", () => {
    expect(atlasPlatformWantsHelp({ argv: argvOf({ platform: "vanta", tail: ["--help"] }) })).toBe(true);
    expect(atlasPlatformWantsHelp({ argv: argvOf({ platform: "vanta", tail: ["-h"] }) })).toBe(true);
    expect(atlasPlatformWantsHelp({ argv: argvOf({ platform: "vanta", tail: ["read"] }) })).toBe(false);
  });
});

describe("atlasPlatformVerbNames and atlasPlatformUsage", () => {
  it("offers exactly the kit's four to a platform with no verbs of its own", () => {
    const registration = fakeRegistration({ platform: "p", verbs: [] });
    expect([
      ...atlasPlatformVerbNames({ hasReset: registration.readReset !== undefined, ownVerbs: registration.verbs }),
    ]).toEqual(["coverage", "read", "render", "restore"]);
    expect([...ATLAS_KIT_VERBS]).toEqual(["coverage", "read", "render", "restore"]);
  });

  it("sorts the platform's own verbs in among the kit's, so the usage header is stable", () => {
    const registration = fakeRegistration({ platform: "p", verbs: ["walk", "families", "sync"] });
    expect([
      ...atlasPlatformVerbNames({ hasReset: registration.readReset !== undefined, ownVerbs: registration.verbs }),
    ]).toEqual(["coverage", "families", "read", "render", "restore", "sync", "walk"]);
  });

  it("prints one described line per verb, kit first then own in declared order, sized to the longest", () => {
    const registration = fakeRegistration({ platform: "p", verbs: ["walk", "sync"] });
    expect(atlasPlatformUsage({ registration })).toBe(
      [
        "usage: slopweaver atlas p <coverage | read | render | restore | sync | walk>",
        "  coverage  what this atlas knows it does NOT know",
        "  read      the stored entities, filtered by kind, surface, id or query",
        "  render    one self-contained HTML page: everything held, and what exists that was never hit",
        "  restore   list the generations `reset` archived, and install one back as the live generation",
        "  walk      does walk",
        "  sync      does sync",
      ].join("\n"),
    );
  });

  it("indents a description's second line under its first", () => {
    const registration: AtlasPlatformRegistration = {
      ...fakeRegistration({ platform: "p", verbs: [] }),
      verbs: [
        {
          describe: "first line;\nsecond line",
          load: () => Promise.resolve(() => 0),
          usage: ["sync"],
          verb: "sync",
        },
      ],
    };
    expect(atlasPlatformUsage({ registration }).split("\n").slice(-2)).toEqual([
      "  sync      first line;",
      "            second line",
    ]);
  });

  it("lets a platform keep its own words for a kit verb, and only that verb", () => {
    const registration: AtlasPlatformRegistration = {
      ...fakeRegistration({ platform: "p", verbs: [] }),
      catalogue: {
        doorRouted: false,
        example: "x",
        kitDescriptions: { read: "the stored operations, filtered by kind, surface, id or query" },
        summary: null,
      },
    };
    const lines = atlasPlatformUsage({ registration }).split("\n");
    expect(lines[2]).toBe("  read      the stored operations, filtered by kind, surface, id or query");
    expect(lines[1]).toBe("  coverage  what this atlas knows it does NOT know");
  });
});

describe("atlasPlatformCommand", () => {
  it("refuses through the same usage path the manifest dispatches into", async () => {
    expect(
      await atlasPlatformCommand({ platform: "cloudflare" })(argvOf({ platform: "cloudflare", tail: ["sync"] })),
    ).toBe(EXIT_USAGE);
  });

  it("throws for a platform the registry does not know, because no manifest row can name one", () => {
    expect(() => atlasPlatformCommand({ platform: "nope" })(argvOf({ platform: "nope", tail: [] }))).toThrow(
      'atlas platform "nope" has a manifest row but no registry row',
    );
  });
});

describe("runAtlasPlatform", () => {
  it("runs one of the platform's own verbs with the whole argv", async () => {
    const deps = platformDeps();
    const registration = fakeRegistration({ platform: "p", verbs: ["sync"] });
    expect(
      await runAtlasPlatform({ argv: argvOf({ platform: "p", tail: ["sync", "--json"] }), deps, registration }),
    ).toBe(106);
    expect(deps.out).toEqual([]);
    expect(deps.diag).toEqual([]);
  });

  it("refuses a verb the platform does not have, naming it on the diagnostic channel", async () => {
    const deps = platformDeps();
    const registration = fakeRegistration({ platform: "p", verbs: ["sync"] });
    expect(await runAtlasPlatform({ argv: argvOf({ platform: "p", tail: ["walk"] }), deps, registration })).toBe(
      EXIT_USAGE,
    );
    expect(deps.diag[0]).toBe('slopweaver atlas p has no verb "walk"');
    expect(deps.diag[1]).toBe(atlasPlatformUsage({ registration }));
    expect(deps.out).toEqual([]);
  });

  it("refuses with no verb at all, saying one is needed", async () => {
    const deps = platformDeps();
    const registration = fakeRegistration({ platform: "p", verbs: [] });
    expect(await runAtlasPlatform({ argv: argvOf({ platform: "p", tail: [] }), deps, registration })).toBe(EXIT_USAGE);
    expect(deps.diag[0]).toBe("slopweaver atlas p needs a verb");
    expect(deps.out).toEqual([]);
  });

  it("prints usage to stdout for help, because the caller asked for it", async () => {
    const deps = platformDeps();
    const registration = fakeRegistration({ platform: "p", verbs: ["sync"] });
    expect(await runAtlasPlatform({ argv: argvOf({ platform: "p", tail: ["--help"] }), deps, registration })).toBe(
      EXIT_OK,
    );
    expect(deps.out).toEqual([atlasPlatformUsage({ registration })]);
    expect(deps.diag).toEqual([]);
  });

  it("runs the fallback for a tail that is not a verb, passing argv untouched", async () => {
    const deps = platformDeps();
    const seen: string[][] = [];
    const registration = fakeRegistration({
      fallback: (argv) => {
        seen.push([...argv]);
        return 7;
      },
      platform: "slack",
      verbs: [],
    });
    expect(
      await runAtlasPlatform({ argv: argvOf({ platform: "slack", tail: ["--never-read"] }), deps, registration }),
    ).toBe(7);
    expect(seen).toEqual([["node", "slopweaver", "atlas", "slack", "--never-read"]]);
    expect(deps.diag).toEqual([]);
  });
});

// Every platform this build has answers the same three explanations the same way, because they come from
// one dispatcher rather than 31 copies of it. Falsifiable per platform: a row that lost its usage block, or a
// dispatcher that started printing usage on stdout, fails here by name.
describe("every registered platform, through the one dispatcher", () => {
  const platforms = atlasPlatforms().filter((platform) => findAtlasPlatform({ platform })!.fallback === undefined);

  it.each(platforms)(
    "%s refuses a verb it does not have, naming it, with --json output kept pristine",
    async (platform) => {
      const deps = platformDeps();
      const registration = findAtlasPlatform({ platform })!;
      const code = await runAtlasPlatform({ argv: argvOf({ platform, tail: ["not-a-verb"] }), deps, registration });
      expect(code).toBe(EXIT_USAGE);
      expect(deps.diag[0]).toBe(`slopweaver atlas ${platform} has no verb "not-a-verb"`);
      expect(deps.diag[1]).toBe(atlasPlatformUsage({ registration }));
      expect(deps.out).toEqual([]);
    },
  );

  it.each(platforms)("%s says a bare invocation needs a verb", async (platform) => {
    const deps = platformDeps();
    const registration = findAtlasPlatform({ platform })!;
    expect(await runAtlasPlatform({ argv: argvOf({ platform, tail: [] }), deps, registration })).toBe(EXIT_USAGE);
    expect(deps.diag[0]).toBe(`slopweaver atlas ${platform} needs a verb`);
  });

  it.each(platforms)("%s prints its usage to stdout for --help and exits zero", async (platform) => {
    const deps = platformDeps();
    const registration = findAtlasPlatform({ platform })!;
    expect(await runAtlasPlatform({ argv: argvOf({ platform, tail: ["--help"] }), deps, registration })).toBe(EXIT_OK);
    expect(deps.out).toEqual([atlasPlatformUsage({ registration })]);
    expect(deps.diag).toEqual([]);
  });
});

// `read` and `coverage` are reached THROUGH a platform, so they have no manifest row of their own and the
// help/flag ratchet in helpTruth.test.ts cannot see them. It was that ratchet that stopped a real, shipped
// flag being invisible for a month, so the same property is asserted here instead of quietly lost.
describe("the verbs a platform dispatches advertise every flag they parse", () => {
  it("read's usage names each of its flags", () => {
    expect(ATLAS_READ_FLAG_NAMES.filter((flag) => !ATLAS_READ_USAGE.includes(flag))).toEqual([]);
  });

  it("coverage's usage names each of its flags", () => {
    expect(ATLAS_COVERAGE_FLAG_NAMES.filter((flag) => !ATLAS_COVERAGE_USAGE.includes(flag))).toEqual([]);
  });

  it("neither still advertises the platform as a flag", () => {
    expect(ATLAS_READ_FLAG_NAMES.includes("--platform")).toBe(false);
    expect(ATLAS_COVERAGE_FLAG_NAMES.includes("--platform")).toBe(false);
    expect(ATLAS_READ_USAGE.includes("--platform")).toBe(false);
    expect(ATLAS_COVERAGE_USAGE.includes("--platform")).toBe(false);
  });
});
