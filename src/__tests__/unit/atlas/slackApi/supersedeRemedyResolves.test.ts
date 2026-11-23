/**
 * The command the Slack atlas prints when it refuses a generation is one the CLI really answers.
 *
 * `SLACK_ATLAS_SUPERSEDE_REMEDY` is printed at the exact moment a publish or a read is refused — an
 * `@slack/web-api` major crossed, or a generation written under another schema version. It used to name
 * `atlas slack-drive reset --confirm archive`, which `slack-drive` answers with `unknown flag: --confirm`: the
 * only next step on offer at the point of failure could not run, a confident lie at the
 * exact moment of failure.
 *
 * Narrow on purpose: this pins THIS remedy against the real manifest, the real registry and the real reset
 * parser, three hops a printed command has to survive. Every case reads the remedy constant itself, so a later
 * rewording that names a verb or flag the CLI does not answer fails here rather than in front of the operator.
 *
 * Why not the canon resolver (`canon/staleReferences.ts`): it resolves a noun and ONE verb, so it checks
 * `atlas slack reset --confirm` against the `atlas slack` row's usage — the Slack MAP's, whose flags
 * `helpTruth.test.ts` holds to the map's own parser. The platform's kit verbs sit a word deeper than it reads,
 * so the flags are checked here against the usage of the verb the registry really dispatches to.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AtlasResetOutcome } from "../../../../atlas/kit/reset.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../../atlas/registry.js";
import { SLACK_ATLAS_SUPERSEDE_REMEDY } from "../../../../atlas/slackApi/atlasStore.js";
import { atlasPlatformDispatch } from "../../../../cli/commands/atlas/platformVerb.js";
import { runAtlasResetCommand } from "../../../../cli/commands/atlas/resetRun.js";
import { atlasResetUsage, runAtlasReset } from "../../../../cli/commands/atlas/resetRunCore.js";
import { EXIT_OK } from "../../../../cli/exitCodes.js";
import { MANIFEST_MODULES } from "../../../../cli/manifests/index.js";
import { ok, type Result } from "../../../../lib/result.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The `slopweaver …` command the remedy tells the operator to run, cut from the printed sentence. */
function remedyCommand(): string {
  const match = /^run: (slopweaver [^—]+?) — /.exec(SLACK_ATLAS_SUPERSEDE_REMEDY);
  return match![1]!;
}

/** The remedy as the process would receive it: the runtime and the script, then its words. */
function remedyArgv(): readonly string[] {
  return ["node", "slopweaver", ...remedyCommand().split(" ").slice(1)];
}

describe("the Slack atlas's supersede remedy", () => {
  it("names the reset the Slack atlas registry row answers", () => {
    expect(remedyCommand()).toBe("slopweaver atlas slack reset --confirm archive");
  });

  it("routes its noun and platform to a row of the live CLI manifest", () => {
    const argv = remedyArgv();
    const noun = MANIFEST_MODULES.find((module) => module.noun === argv[2])!;
    expect(Object.keys(noun.verbs)).toContain(argv[3]);
  });

  it("dispatches to the kit's reset through the registry, not to the Slack map", () => {
    const argv = remedyArgv();
    expect(atlasPlatforms()).toContain(argv[3]);
    const registration = findAtlasPlatform({ platform: argv[3]! })!;
    expect(atlasPlatformDispatch({ argv, registration })).toEqual({ kind: "kit", verb: "reset" });
  });

  it("names only flags the reset verb it dispatches to advertises", () => {
    const argv = remedyArgv();
    const advertised = atlasResetUsage({ platform: argv[3]! });
    const flags = argv.filter((token) => token.startsWith("--"));
    expect(flags).toEqual(["--confirm"]);
    expect(flags.filter((flag) => !advertised.includes(`${flag} `))).toEqual([]);
  });

  it("passes the real reset parser, confirmation word included, and reaches the platform's reset", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-slack-remedy-"));
    homes.push(home);
    const errors: string[] = [];
    const reached: string[] = [];
    const reset = ({ home: given }: { home: string; at: string }): Result<AtlasResetOutcome> => {
      reached.push(given);
      return ok({ archiveId: "2026-10-18T00-00-00.000Z", archivedTo: join(home, "archived") });
    };
    const code = await runAtlasResetCommand({
      argv: [...remedyArgv(), "--home", home],
      deps: {
        error: ({ msg }) => {
          errors.push(msg);
        },
        // The real registry decides whether the platform answers `reset` at all; only the act is a fake.
        find: ({ platform }) => {
          const registration = findAtlasPlatform({ platform });
          if (registration?.readReset === undefined) {
            return registration;
          }
          return { readReset: () => Promise.resolve(reset) };
        },
        platforms: atlasPlatforms,
        runReset: runAtlasReset,
      },
    });
    expect(errors).toEqual([]);
    expect(code).toBe(EXIT_OK);
    expect(reached).toEqual([home]);
  });
});
