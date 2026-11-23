import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mapPageReader } from "../../../../../briefing/publishedPageRead.js";
import { projectRun } from "../../../../../cli/commands/briefing/briefingRenderList.js";
import {
  buildForm,
  gatherProjections,
  readPremises,
} from "../../../../../cli/commands/briefing/briefingRenderProjections.js";
import {
  freshnessSection,
  nothingStaleSection,
  ownerBeliefsBlock,
  quizBlock,
} from "../../../../../cli/commands/briefing/briefingRenderSections.js";
import {
  type BriefingRenderDeps,
  refreshedStamp,
  refuse,
  resolvedHome,
} from "../../../../../cli/commands/briefing/briefingRenderTypes.js";
import { parseBriefingRenderArgs } from "../../../../../cli/commands/briefing/core.js";
import { briefingCommandErrorLines } from "../../../../../cli/commands/briefing/errors.js";
import { productionBriefingRenderDeps } from "../../../../../cli/commands/briefing/renderRun.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import { PROFILE_SCHEMA_VERSION } from "../../../../../profile.js";

/**
 * The five files `briefing render` is, in the order the import graph allows: the vocabulary and the
 * direct-home sections stand alone, the projections stand on both, the owner's list on the projections, and the shell
 * stands on the rest.
 */
const FAMILY = [
  "briefingRenderTypes.ts",
  "briefingRenderSections.ts",
  "briefingRenderProjections.ts",
  "briefingRenderList.ts",
  "renderRun.ts",
] as const;

const sourceOf = ({ file }: { file: string }): string =>
  readFileSync(new URL(`../../../../../cli/commands/briefing/${file}`, import.meta.url), "utf8");

/** Every `./briefingRender*` or `./renderRun` module one family file imports from. */
const familyImportsOf = ({ file }: { file: string }): readonly string[] =>
  [...sourceOf({ file }).matchAll(/^import[^;]*? from "\.\/(briefingRender\w+|renderRun)\.js";$/gmu)].map(
    (match) => `${match[1]!}.ts`,
  );

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh throwaway state home, with no profile and no ledger in it unless a case writes one. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-brief-"));
  fixtureDirs.push(home);
  return home;
}

/** Every diagnostic and data line one run wrote, in the order it wrote them. */
interface Recorded {
  readonly diagnostics: string[];
  readonly out: string[];
  readonly defaultHomeCalls: string[];
}

/**
 * A dependency set whose every read refuses and whose every write is recorded.
 *
 * Nothing here is a mock: the reads are plain functions returning a failure, which is what makes a case
 * that reaches one fail loudly instead of silently taking a different branch.
 */
function refusingDeps({ recorded, home = "/no/such/home" }: { recorded: Recorded; home?: string }): BriefingRenderDeps {
  return {
    applyBareRefs: () => false,
    applyFraming: false,
    applyPrPremise: () => false,
    snapshotAgeRefusal: () => [],
    applyVoice: () => false,
    defaultHome: () => {
      recorded.defaultHomeCalls.push(home);
      return home;
    },
    now: () => "2026-09-21T00:00:00.000Z",
    readAutonomy: ({ home: autonomyHome }) =>
      Promise.resolve(err([`${autonomyHome}: no autonomy ledger in this test`])),
    readForm: () => "{}",
    readImageDataUri: ({ path }) => err([`${path}: no image seam in this test`]),
    readLockIns: () => "",
    readOpenArtifacts: ({ source }) => err([`${source}: no open-artifact document in this test`]),
    readPrPremises: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "no credential in this test" }))),
    prefetchPublishedPages: () => Promise.resolve(ok(mapPageReader({ pages: new Map() }))),
    pagesOpened: () => [],
    readOrganisation: () => Promise.resolve(err(["no organisation in this test"])),
    readTicks: ({ source }) => Promise.resolve(err([`${source}: no tick ledger in this test`])),
    readYourList: ({ source }) => err([`${source}: no session-start document in this test`]),
    voiceRules: () => ok([]),
    writeDiagnostic: (line) => recorded.diagnostics.push(line),
    writeOut: (line) => recorded.out.push(line),
    writePage: () => undefined,
  };
}

const freshRecorded = (): Recorded => ({ defaultHomeCalls: [], diagnostics: [], out: [] });

describe("the briefing render family's import graph", () => {
  it("is the five files this test reasons about, so no assertion below is vacuous", () => {
    expect(FAMILY.length).toBe(5);
  });

  it("gives the vocabulary no edge to anything else the verb owns", () => {
    expect(familyImportsOf({ file: "briefingRenderTypes.ts" })).toEqual([]);
  });

  it("gives the direct-home sections no edge either, so they sit beside the vocabulary", () => {
    expect(familyImportsOf({ file: "briefingRenderSections.ts" })).toEqual([]);
  });

  it("stands the projections on the vocabulary and the sections, and on nothing above them", () => {
    expect(familyImportsOf({ file: "briefingRenderProjections.ts" }).toSorted()).toEqual([
      "briefingRenderSections.ts",
      "briefingRenderTypes.ts",
    ]);
  });

  it("stands the owner's list on the vocabulary and the projections, and never reaches a section or the shell", () => {
    expect(familyImportsOf({ file: "briefingRenderList.ts" }).toSorted()).toEqual([
      "briefingRenderProjections.ts",
      "briefingRenderTypes.ts",
    ]);
  });

  it("stands the shell on the vocabulary, the projections and the owner's list, and never reaches a section directly", () => {
    expect(familyImportsOf({ file: "renderRun.ts" }).toSorted()).toEqual([
      "briefingRenderList.ts",
      "briefingRenderProjections.ts",
      "briefingRenderTypes.ts",
    ]);
  });

  it("puts the injected seam out of the direct-home readers' scope rather than asking them to avoid it", () => {
    const bodyOf = ({ file }: { file: string }): string =>
      sourceOf({ file })
        .split("\n")
        .filter((line) => !/^\s*(\/\*|\*|\/\/)/u.test(line))
        .join("\n");
    expect(bodyOf({ file: "briefingRenderProjections.ts" })).toContain("BriefingRenderDeps");
    expect(bodyOf({ file: "briefingRenderSections.ts" }).includes("BriefingRenderDeps")).toBe(false);
  });

  // The second substitution, the named register path falling back to the home's, went with the `--autonomy-ledger-file`
  // flag: the ledger is the store's, so there is no path left to coalesce.
  it("names the substitution the projections used to coalesce", () => {
    expect(sourceOf({ file: "briefingRenderList.ts" })).toContain("const top = topRows({ top: args.top });");
  });
});

describe("resolvedHome", () => {
  it("takes the home the invocation named", () => {
    const recorded = freshRecorded();
    expect(resolvedHome({ deps: refusingDeps({ recorded }), named: "/named/home" })).toBe("/named/home");
  });

  it("falls through to the seam when the invocation named none", () => {
    const recorded = freshRecorded();
    expect(resolvedHome({ deps: refusingDeps({ home: "/seam/home", recorded }), named: undefined })).toBe("/seam/home");
  });

  it("never asks the seam at all once a home is named, which a coalesce could not have promised", () => {
    const recorded = freshRecorded();
    resolvedHome({ deps: refusingDeps({ recorded }), named: "/named/home" });
    expect(recorded.defaultHomeCalls).toEqual([]);
  });
});

describe("the production voiceRules seam", () => {
  const profileVoiceRules = ({ home }: { home: string }) => unwrap(productionBriefingRenderDeps().voiceRules({ home }));

  it("answers no bans at all for a home that carries no profile", () => {
    expect(profileVoiceRules({ home: freshHome() })).toEqual([]);
  });

  it("FAILS for a profile that is there but corrupt, rather than answering no bans", () => {
    const home = freshHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const error = unwrapErr(productionBriefingRenderDeps().voiceRules({ home }));
    expect(error.code).toBe("PROFILE_UNREADABLE");
    expect(error.path).toBe(join(home, "profile.json"));
  });

  it("answers the profile's own exact rules when one is there", () => {
    const home = freshHome();
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: PROFILE_SCHEMA_VERSION,
        slackMe: { voice: { exact: [{ kind: "literal", value: "—" }] } },
        sources: ["github"],
      }),
      "utf8",
    );
    expect(profileVoiceRules({ home })).toEqual([{ kind: "literal", value: "—" }]);
  });

  it("answers the empty list for a profile whose voice block names no rule, not a crash", () => {
    const home = freshHome();
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: PROFILE_SCHEMA_VERSION,
        sources: ["github"],
      }),
      "utf8",
    );
    expect(profileVoiceRules({ home })).toEqual([]);
  });
});

describe("the vocabulary's two helpers", () => {
  it("stamps the page with the newest recorded pass behind it", () => {
    expect(refreshedStamp({ narrativeIso: "2026-09-19T12:00:00.000Z", readyIso: "2026-09-21T00:00:00.000Z" })).toBe(
      "2026-09-19T12:00:00.000Z",
    );
  });

  it("falls back to this render's own clock when there is no recorded pass", () => {
    expect(refreshedStamp({ narrativeIso: undefined, readyIso: "2026-09-21T00:00:00.000Z" })).toBe(
      "2026-09-21T00:00:00.000Z",
    );
  });

  it("falls back to this render's own clock when the recorded pass carries no parseable instant", () => {
    expect(refreshedStamp({ narrativeIso: "not a time", readyIso: "2026-09-21T00:00:00.000Z" })).toBe(
      "2026-09-21T00:00:00.000Z",
    );
  });

  it("prints every refusal line, and the usage line only when the refusal was about the invocation", () => {
    const withUsage = freshRecorded();
    refuse({ deps: refusingDeps({ recorded: withUsage }), lines: ["--form is required"], usage: true });
    const withoutUsage = freshRecorded();
    refuse({ deps: refusingDeps({ recorded: withoutUsage }), lines: ["the ledger could not be read"], usage: false });
    expect(withUsage.diagnostics[0]).toBe("--form is required");
    expect(withUsage.diagnostics.length).toBe(2);
    expect(withoutUsage.diagnostics).toEqual(["the ledger could not be read"]);
  });
});

describe("the direct-home sections", () => {
  it("project nothing at all when the invocation asked for none of them", async () => {
    const home = freshHome();
    expect(await freshnessSection({ home, nowIso: "2026-09-21T00:00:00.000Z", wanted: false })).toBe(undefined);
    expect(unwrap(ownerBeliefsBlock({ home, wanted: false }))).toBe(undefined);
    expect(unwrap(quizBlock({ home, sweep: undefined }))).toBe(undefined);
    expect(unwrap(nothingStaleSection({ home, nowIso: "2026-09-21T00:00:00.000Z", wanted: false }))).toBe(undefined);
  });

  it("render a Nothing stale section naming every surface unseen over a home with no documents, never refusing", () => {
    const section = unwrap(
      nothingStaleSection({ home: freshHome(), nowIso: "2026-09-21T00:00:00.000Z", wanted: true }),
    )!;
    expect(section.id).toBe("nothing-stale");
    expect(section.summary).toBe(
      "0 known stale; not an all-clear — could not see pull requests, tickets, projects, threads, board, unproven count",
    );
  });

  it("keeps the Nothing stale reader below the render family: it imports no family file at all", () => {
    expect(familyImportsOf({ file: "nothingStaleProjection.ts" })).toEqual([]);
    expect(familyImportsOf({ file: "briefingRenderSections.ts" })).toEqual([]);
  });
});

describe("the projection pipeline", () => {
  const argsOf = ({ rest }: { rest: readonly string[] }) => unwrap(parseBriefingRenderArgs({ rest }));

  it("reads no session-start document at all when the invocation named no list", () => {
    const recorded = freshRecorded();
    const projected = unwrap(
      projectRun({
        args: argsOf({ rest: ["--form", "-"] }),
        deps: refusingDeps({ recorded }),
        nowIso: "2026-09-21T00:00:00.000Z",
        organisation: undefined,
      }),
    );
    expect(projected).toEqual({
      heldBack: [],
      openPrs: undefined,
      refreshedIso: undefined,
      stale: undefined,
      yourList: undefined,
    });
  });

  it("gathers nothing but empty blocks when the invocation asked for nothing", async () => {
    const recorded = freshRecorded();
    const gathered = unwrap(
      await gatherProjections({
        args: argsOf({ rest: ["--form", "-"] }),
        deps: refusingDeps({ recorded }),
        home: freshHome(),
        readyIso: "2026-09-21T00:00:00.000Z",
      }),
    );
    expect(gathered.autonomy).toBe(undefined);
    expect(gathered.beliefs).toBe(undefined);
    expect(gathered.narrative).toBe(undefined);
    expect(gathered.quiz).toBe(undefined);
    expect(gathered.openArtifacts).toEqual({});
  });

  it("reads no pull request at all when the break-glass switched that leg off", async () => {
    const recorded = freshRecorded();
    const premises = await readPremises({
      deps: refusingDeps({ recorded }),
      home: freshHome(),
      html: "<p>no cards at all</p>",
    });
    expect(unwrap(premises)).toBe(undefined);
  });

  it("refuses a form that is valid JSON and not a briefing, before any page exists", async () => {
    const recorded = freshRecorded();
    const args = argsOf({ rest: ["--form", "-"] });
    const deps = refusingDeps({ recorded });
    const built = await buildForm({
      args,
      deps,
      gathered: {
        autonomy: undefined,
        beliefs: undefined,
        handSteps: undefined,
        narrative: undefined,
        openArtifacts: {},
        quiz: undefined,
      },
      home: freshHome(),
      projected: { heldBack: [], openPrs: undefined, stale: undefined, yourList: undefined },
      readyIso: "2026-09-21T00:00:00.000Z",
      stale: [],
    });
    expect(briefingCommandErrorLines({ error: unwrapErr(built) }).length).toBeGreaterThan(0);
    expect(recorded.out).toEqual([]);
  });
});
