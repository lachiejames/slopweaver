import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { slackAtlasPaths } from "../../../../atlas/slackApi/atlasStore.js";
import type { DrivenSession } from "../../../../atlas/slackApi/drivenSession.js";
import { AtlasCommandErrors } from "../../../../cli/commands/atlas/errors.js";
import {
  type AtlasSlackDriveDeps,
  atlasSlackDriveCommand,
  runAtlasSlackDrive,
} from "../../../../cli/commands/atlas/slackDriveRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { err, ok } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

import { capturedCall, walkedPage } from "./slackAtlasFixtures.js";

const homes: string[] = [];

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-slack-drive-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** Two SDK methods declared as declaration text, so the real extractor does the real work. */
const METHODS_TEXT = `
export declare abstract class Methods {
  public readonly conversations: {
    /** Fetches a conversation's history. */
    history: Method<ConversationsHistoryArguments, ConversationsHistoryResponse>;
  };
}
`;

/** One recorded walk. */
function session(over: Partial<DrivenSession> = {}): DrivenSession {
  return { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH", ...over };
}

/** Deps with every edge a plain function; no mock, no browser, no `node_modules` read. */
function deps({
  out,
  diagnostics,
  document = ok(JSON.stringify(session())),
}: {
  out: string[];
  diagnostics: string[];
  document?: ReturnType<AtlasSlackDriveDeps["readSession"]>;
}): AtlasSlackDriveDeps {
  return {
    nowIso: () => "2026-08-31T09:00:00.000Z",
    readSession: () => document,
    readTypings: () => ok({ methodsText: METHODS_TEXT, requestText: "", responseTexts: new Map(), version: "7.9.3" }),
    readWorkspaceRoots: () => ({ teamId: "T0SYN1ABCDEFGH", workspaceOrigin: "https://example-workspace.slack.com" }),
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
}

describe("runAtlasSlackDrive", () => {
  it("rejects an unknown sub-verb with usage, touching nothing", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runAtlasSlackDrive({ deps: deps({ diagnostics, out }), rest: ["drive"] });
    expect(code).toBe(EXIT_USAGE);
    expect(out).toEqual([]);
  });

  it("reports an unpublished home rather than pretending it compared anything", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runAtlasSlackDrive({
      deps: deps({ diagnostics, out }),
      rest: ["report", "--home", scratchHome()],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics.at(-1)).toContain("no Slack atlas generation is published yet");
  });

  it("prints the brief on `plan`, reading no walk document and publishing nothing", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runAtlasSlackDrive({
      deps: deps({ diagnostics, out }),
      rest: ["plan", "--home", scratchHome()],
    });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain("this needs a rendered page, so it runs in YOUR Chrome");
    expect(out.join("\n")).toContain("record every /api/<method> call");
    expect(out.join("\n")).toContain("slopweaver browser act");
  });

  it("says the walk is a READ walk and that a keystroke must not be taken, and records no grant journal", async () => {
    const out: string[] = [];
    const home = scratchHome();
    const code = await runAtlasSlackDrive({
      deps: deps({ diagnostics: [], out }),
      rest: ["plan", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(out.slice(-2)).toEqual([
      "this is a READ walk — every step above is a navigation or a capture",
      "Slack is read-before-write, so a click or a keystroke on a page you have just read would be ALLOWED — do not take one",
    ]);
    expect(existsSync(join(stateHomePaths({ home }).ledgers, "browser-grants.jsonl"))).toBe(false);
  });

  it("publishes a generation and prints the comparison", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const home = scratchHome();
    const code = await runAtlasSlackDrive({
      deps: deps({ diagnostics, out }),
      rest: ["sync", "--session", "-", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(diagnostics.at(-1)).toContain(slackAtlasPaths({ home }).directory);
    expect(out.join("\n")).toContain("method(s) held across both surfaces");
  });

  it("writes nothing under --dry-run, and says so", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const home = scratchHome();
    const code = await runAtlasSlackDrive({
      deps: deps({ diagnostics, out }),
      rest: ["sync", "--session", "-", "--dry-run", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(diagnostics.at(-1)).toBe("--dry-run: nothing was written");
  });

  it("publishes nothing when the walk document will not parse", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runAtlasSlackDrive({
      deps: deps({ diagnostics, document: ok("{}"), out }),
      rest: ["sync", "--session", "-", "--home", scratchHome()],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics.at(-1)).toBe(
      "nothing was published — a surface is not filled by a document that will not parse",
    );
  });

  it("publishes nothing when the walk document cannot be read at all", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runAtlasSlackDrive({
      deps: deps({
        diagnostics,
        document: err(
          AtlasCommandErrors.walkDocumentUnreadable({ cause: new Error("ENOENT"), path: "/tmp/walk.json" }),
        ),
        out,
      }),
      rest: ["sync", "--session", "/tmp/walk.json", "--home", scratchHome()],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics.join("\n")).toContain("ENOENT");
  });

  it("publishes the API surface on `refresh` with no walk document, then prints the brief", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const home = scratchHome();
    const code = await runAtlasSlackDrive({
      deps: {
        ...deps({ diagnostics, out }),
        readSession: () =>
          err(
            AtlasCommandErrors.walkDocumentUnreadable({
              cause: new Error("refresh must not read a walk document"),
              path: "-",
            }),
          ),
      },
      rest: ["refresh", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    const paths = slackAtlasPaths({ home });
    expect(existsSync(paths.kinds.method)).toBe(true);
    expect(existsSync(paths.kinds.page)).toBe(false);
    expect(diagnostics.join("\n")).toContain(`published the API surface under ${paths.directory}`);
    const printed = out.join("\n");
    expect(printed).toContain("method(s) held across both surfaces");
    expect(printed).toContain("this is a READ walk — every step above is a navigation or a capture");
  });

  it("leaves the page kind byte-identical to what the last walk published, and moves the clock", async () => {
    const home = scratchHome();
    const paths = slackAtlasPaths({ home });
    await runAtlasSlackDrive({
      deps: deps({ diagnostics: [], out: [] }),
      rest: ["sync", "--session", "-", "--home", home],
    });
    const pagesBefore = readFileSync(paths.kinds.page, "utf8");
    const later = { ...deps({ diagnostics: [], out: [] }), nowIso: () => "2026-09-01T09:00:00.000Z" };
    const code = await runAtlasSlackDrive({ deps: later, rest: ["refresh", "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(paths.kinds.page, "utf8")).toBe(pagesBefore);
    const manifest = JSON.parse(readFileSync(paths.manifest, "utf8")) as {
      updatedAt: string;
      kinds: { method: { lastSuccessAt: string }; page: { lastSuccessAt: string } };
    };
    expect(manifest.updatedAt).toBe("2026-09-01T09:00:00.000Z");
    expect(manifest.kinds.method.lastSuccessAt).toBe("2026-09-01T09:00:00.000Z");
    expect(manifest.kinds.page.lastSuccessAt).toBe("2026-08-31T09:00:00.000Z");
  });

  it("briefs no walk when the API surface could not be published", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runAtlasSlackDrive({
      deps: {
        ...deps({ diagnostics, out }),
        readTypings: () =>
          err(AtlasCommandErrors.sdkTypingsUnreadable({ cause: new Error("@slack/web-api is not installed") })),
      },
      rest: ["refresh", "--home", scratchHome()],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics.at(-1)).toBe("the API surface could not be published, so no walk was briefed");
    expect(out).toEqual([]);
  });

  it("writes nothing on `refresh --dry-run`, and still briefs the walk", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const home = scratchHome();
    const code = await runAtlasSlackDrive({
      deps: deps({ diagnostics, out }),
      rest: ["refresh", "--dry-run", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(existsSync(slackAtlasPaths({ home }).kinds.method)).toBe(false);
    expect(diagnostics).toContain("--dry-run: nothing was written");
    expect(out.join("\n")).toContain("this is a READ walk");
  });

  it("reads back what sync published, with no walk document and no SDK read", async () => {
    const home = scratchHome();
    await runAtlasSlackDrive({
      deps: deps({ diagnostics: [], out: [] }),
      rest: ["sync", "--session", "-", "--home", home],
    });
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runAtlasSlackDrive({
      deps: {
        ...deps({ diagnostics, out }),
        readSession: () =>
          err(
            AtlasCommandErrors.walkDocumentUnreadable({
              cause: new Error("report must not read a walk document"),
              path: "-",
            }),
          ),
        readTypings: () =>
          err(AtlasCommandErrors.sdkTypingsUnreadable({ cause: new Error("report must not read the SDK") })),
      },
      rest: ["report", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(out.join("\n")).toContain("nothing above is resolved");
  });

  it("emits one machine-readable document under --json", async () => {
    const out: string[] = [];
    const code = await runAtlasSlackDrive({
      deps: deps({ diagnostics: [], out }),
      rest: ["sync", "--session", "-", "--json", "--home", scratchHome()],
    });
    expect(code).toBe(EXIT_OK);
    const parsed: unknown = JSON.parse(out[0]!);
    expect(parsed).toMatchObject({ summary: { methods: 1 } });
  });

  it("records the undocumented surface the walk found", async () => {
    const out: string[] = [];
    const code = await runAtlasSlackDrive({
      deps: deps({
        diagnostics: [],
        document: ok(
          JSON.stringify(session({ pages: [walkedPage({ calls: [capturedCall({ name: "client.counts" })] })] })),
        ),
        out,
      }),
      rest: ["sync", "--session", "-", "--json", "--home", scratchHome()],
    });
    expect(code).toBe(EXIT_OK);
    expect(out[0]!).toContain('"verdict": "browser-only"');
  });
});

describe("atlasSlackDriveCommand", () => {
  it("is the handler the manifest loads, and it rejects an unknown sub-verb through the real argv shape", async () => {
    expect(await atlasSlackDriveCommand(["node", "slopweaver", "atlas", "slack-drive", "drive"])).toBe(EXIT_USAGE);
  });
});
