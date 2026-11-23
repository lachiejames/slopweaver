/**
 * The shell, against injected edges — plus one assertion against the REAL installed typings.
 *
 * That last one is the point of this file. Every other test here parses declaration text written by hand,
 * so all of them stay green if a dependency bump changes the shape the SDK emits and the parser starts
 * returning half the methods. A smaller method count is not an error and raises nothing; it just quietly
 * makes the atlas wrong. The floor below is what turns that into a failing test.
 */
import { describe, expect, it } from "vitest";

import type { CapturedCall } from "../../../../atlas/slackApi/harObservations.js";
import { AtlasCommandErrors } from "../../../../cli/commands/atlas/errors.js";
import {
  type AtlasSlackApiDeps,
  assembleAtlas,
  readInstalledTypings,
  regenerateBrowserTable,
  runAtlasSlackApi,
  type SdkTypingsSource,
} from "../../../../cli/commands/atlas/slackApiRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const SOURCE: SdkTypingsSource = {
  methodsText: `
        /**
         * @description Fetches a conversation's history.
         * @see {@link https://docs.slack.dev/reference/methods/conversations.history \`conversations.history\` API reference}.
         */
        history: MethodWithRequiredArgument<ConversationsHistoryArguments, ConversationsHistoryResponse>;
  `,
  requestText: "export interface ConversationsHistoryArguments { channel: string; limit?: number; }",
  responseTexts: new Map([
    ["ConversationsHistoryResponse", "export interface ConversationsHistoryResponse { messages?: Msg[]; }"],
  ]),
  version: "9.9.9",
};

/** A dependency bag that records everything written, so assertions are on real output rather than on a spy. */
function recordingDeps({
  typings,
  har = () => ok([]),
}: {
  typings: AtlasSlackApiDeps["readTypings"];
  har?: AtlasSlackApiDeps["readHar"];
}): {
  deps: AtlasSlackApiDeps;
  out: string[];
  diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      nowIso: () => "2026-08-23T00:00:00.000Z",
      readHar: har,
      readTypings: typings,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("runAtlasSlackApi", () => {
  it("prints the summary and exits OK", () => {
    const { deps, out } = recordingDeps({ typings: () => ok(SOURCE) });
    expect(runAtlasSlackApi({ deps, rest: [] })).toBe(EXIT_OK);
    expect(out[0]).toContain("slack api atlas: @slack/web-api 9.9.9");
  });

  it("emits one JSON document on --json, with nothing else on stdout", () => {
    const { deps, out } = recordingDeps({ typings: () => ok(SOURCE) });
    expect(runAtlasSlackApi({ deps, rest: ["--json"] })).toBe(EXIT_OK);
    expect(out).toHaveLength(1);
    const parsed: unknown = JSON.parse(out[0]!);
    expect((parsed as { atlas: { sdkVersion: string } }).atlas.sdkVersion).toBe("9.9.9");
  });

  it("exits USAGE and prints the usage line on a bad flag", () => {
    const { deps, diagnostics, out } = recordingDeps({ typings: () => ok(SOURCE) });
    expect(runAtlasSlackApi({ deps, rest: ["--nope"] })).toBe(EXIT_USAGE);
    expect(out).toEqual([]);
    expect(diagnostics.join("\n")).toContain("usage: slopweaver atlas slack-api");
  });

  it("exits ERROR with the remedy when the typings cannot be read", () => {
    const { deps, diagnostics } = recordingDeps({
      typings: () => err(AtlasCommandErrors.sdkTypingsUnreadable({ cause: new Error("no such file") })),
    });
    expect(runAtlasSlackApi({ deps, rest: [] })).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([
      "cannot read the installed @slack/web-api typings: no such file",
      "run `yarn install` — this atlas is built from the installed SDK, never from a stored list",
    ]);
  });

  it("answers --field from the built atlas", () => {
    const { deps, out } = recordingDeps({ typings: () => ok(SOURCE) });
    expect(runAtlasSlackApi({ deps, rest: ["--field", "messages"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("conversations.history  messages");
  });
});

describe("--from-har", () => {
  const calls: readonly CapturedCall[] = [
    {
      // Both leak shapes at once: an object id used as a MAP KEY, and a message timestamp used as one.
      // Values (`id`, `latest`) are never emitted at all, so only the keys need redacting.
      body: {
        channels: [{ id: "CFAKECHANNEL", latest: "1782267351.372679" }],
        latest_updates: { "1782267351.372679": 4 },
        ok: true,
        threads: { unread_count_by_channel: { CFAKECHANNEL: 3 } },
      },
      name: "client.counts",
      paramNames: ["_x_id", "token", "thread_counts_by_channel"],
    },
  ];

  it("emits a module whose only Slack-shaped strings are placeholders", () => {
    const { deps, out } = recordingDeps({ har: () => ok(calls), typings: () => ok(SOURCE) });
    expect(runAtlasSlackApi({ deps, rest: ["--from-har", "/tmp/capture.har"] })).toBe(EXIT_OK);
    expect(out[0]).toContain('name: "client.counts"');
    expect(out[0]).toContain('"threads.unread_count_by_channel.<id>"');
    expect(out[0]).toContain('"latest_updates.<ts>"');
    expect(out[0]).not.toContain("CFAKECHANNEL");
    expect(out[0]).not.toContain("1782267351");
  });

  it("drops session telemetry and the token from the parameter list", () => {
    const { deps, out } = recordingDeps({ har: () => ok(calls), typings: () => ok(SOURCE) });
    runAtlasSlackApi({ deps, rest: ["--from-har", "/tmp/capture.har"] });
    expect(out[0]).toContain('undocumentedParams: ["thread_counts_by_channel"]');
  });

  it("says how many calls it read, on STDERR so stdout stays a clean module", () => {
    const { deps, diagnostics } = recordingDeps({ har: () => ok(calls), typings: () => ok(SOURCE) });
    runAtlasSlackApi({ deps, rest: ["--from-har", "/tmp/capture.har"] });
    expect(diagnostics).toEqual(["read 1 Web API call(s) from the capture"]);
  });

  it("exits ERROR when the capture cannot be read", () => {
    const { deps, out } = recordingDeps({
      har: ({ path }) => err(AtlasCommandErrors.captureUnreadable({ cause: new Error("no such file"), path })),
      typings: () => ok(SOURCE),
    });
    expect(runAtlasSlackApi({ deps, rest: ["--from-har", "/nope.har"] })).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
  });

  it("measures publicSurface against the SDK rows it was given", () => {
    const atlas = assembleAtlas({ nowIso: "2026-08-23T00:00:00.000Z", source: SOURCE });
    const source = regenerateBrowserTable({
      calls: [{ body: { ok: true }, name: "conversations.history", paramNames: ["cached_latest_updates"] }],
      methods: atlas.methods,
    });
    expect(source).toContain("publicSurface: true");
    expect(source).toContain('undocumentedParams: ["cached_latest_updates"]');
  });
});

describe("assembleAtlas", () => {
  it("merges the committed docs and browser tables in with the parsed typings", () => {
    const atlas = assembleAtlas({ nowIso: "2026-08-23T00:00:00.000Z", source: SOURCE });
    expect(atlas.methods).toHaveLength(1);
    expect(atlas.docs.some((row) => row.name === "conversations.replies")).toBe(true);
    expect(atlas.browser.some((row) => row.name === "client.counts")).toBe(true);
  });
});

describe("the installed @slack/web-api typings", () => {
  const source = readInstalledTypings();

  it("are readable from the worktree's own dependency tree", () => {
    expect(source.isOk()).toBe(true);
  });

  it("parse to a method count no smaller than the 264 measured on 8.0.0", () => {
    // A FLOOR, not an equality: a later SDK adding methods must not fail this, but a parser that silently
    // stopped matching a JSDoc shape must.
    const atlas = assembleAtlas({ nowIso: "2026-08-23T00:00:00.000Z", source: unwrap(source) });
    expect(atlas.counts.methods).toBeGreaterThanOrEqual(264);
  });

  it("still resolve the two methods every conclusion in this work rests on", () => {
    const atlas = assembleAtlas({ nowIso: "2026-08-23T00:00:00.000Z", source: unwrap(source) });
    const history = atlas.methods.find((method) => method.name === "conversations.history")!;
    const replies = atlas.methods.find((method) => method.name === "conversations.replies")!;
    expect(history.params.map((param) => param.name)).toEqual([
      "channel",
      "cursor",
      "include_all_metadata",
      "inclusive",
      "latest",
      "limit",
      "oldest",
      "token",
    ]);
    expect(history.responseNested["messages"]).toContain("reply_count");
    expect(replies.params.map((param) => param.name)).toContain("ts");
  });

  it("declare reply_count on exactly the two conversations methods, and nowhere else in 264", () => {
    // The measured answer to "is there another call that hands me the reply count". It is a test rather
    // than a paragraph because the interesting failure is a FUTURE SDK adding a third one.
    const atlas = assembleAtlas({ nowIso: "2026-08-23T00:00:00.000Z", source: unwrap(source) });
    const carriers = atlas.methods
      .filter((method) => Object.values(method.responseNested).some((names) => names.includes("reply_count")))
      .map((method) => method.name);
    expect(carriers).toEqual(["conversations.history", "conversations.replies"]);
  });
});
