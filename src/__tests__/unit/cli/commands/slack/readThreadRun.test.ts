import { describe, expect, it } from "vitest";

import type { SlackReadThreadDeps } from "../../../../../cli/commands/slack/readThreadRun.js";
import { runSlackReadThread, slackReadThreadCommand } from "../../../../../cli/commands/slack/readThreadRun.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err } from "../../../../../lib/result.js";
import { SlackSelectionErrors } from "../../../../../live/slack/selectionErrors.js";

/**
 * Dependencies that record diagnostics and throw on anything else — a plain fake, not a mock.
 *
 * A refusal must not reach a token, the network, or the filesystem. `read-thread` downloads attachments to
 * disk on the happy path, so "a refused invocation touches nothing" is the property worth pinning.
 */
function landmineDeps({ said }: { said: string[] }): SlackReadThreadDeps {
  // Annotated so the recorder INHERITS `writeDiagnostic`'s declared shape rather than restating it. A Proxy
  // hands back an untyped value, so this annotation is the only thing tying the fake to the real contract.
  const writeDiagnostic: SlackReadThreadDeps["writeDiagnostic"] = (line) => {
    said.push(line);
  };
  return new Proxy(
    {},
    {
      get: (_target, property) =>
        property === "writeDiagnostic"
          ? writeDiagnostic
          : () => {
              throw new Error(`refusal path touched dependency \`${String(property)}\``);
            },
    },
  ) as SlackReadThreadDeps;
}

describe("runSlackReadThread — a refusal reads nothing and downloads nothing", () => {
  it("refuses a missing permalink without touching a token or the network", async () => {
    const said: string[] = [];
    expect(await runSlackReadThread({ deps: landmineDeps({ said }), rest: [] })).toBe(EXIT_USAGE);
    expect(said.length > 0).toBe(true);
  });

  it("resolves a token BEFORE validating that the URL is a Slack permalink", async () => {
    // Recorded rather than asserted-as-correct: a non-Slack URL passes argument parsing, so the first thing
    // it reaches is the token lookup. Harmless today (a token read is local), but it means "is this even a
    // Slack link" is answered after credentials are resolved rather than before. Worth knowing; not this
    // PR's to change.
    const said: string[] = [];
    await expect(
      runSlackReadThread({ deps: landmineDeps({ said }), rest: ["https://example.com/not-slack"] }),
    ).rejects.toThrowError(/touched dependency `botToken`/);
  });

  it("refuses an unknown flag", async () => {
    const said: string[] = [];
    const code = await runSlackReadThread({
      deps: landmineDeps({ said }),
      rest: ["--definitely-not-a-real-flag"],
    });
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("runSlackReadThread — selected context wiring", () => {
  it("hands both independently parsed bounds to the live reader", async () => {
    const seen: Parameters<SlackReadThreadDeps["readThread"]>[0][] = [];
    const deps: SlackReadThreadDeps = {
      botToken: () => undefined,
      filesRoot: () => "/tmp/thread-files",
      readThread: async (options) => {
        seen.push(options);
        return err(SlackSelectionErrors.mutuallyExclusive());
      },
      userToken: () => "xoxp-test",
      writeDiagnostic: () => undefined,
      writeOut: () => undefined,
    };

    const code = await runSlackReadThread({
      deps,
      rest: ["https://example.slack.com/archives/C123/p1785114398557099", "--around", "0", "--channel-around", "3"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(seen.length).toBe(1);
    expect(seen[0]!.around).toBe(0);
    expect(seen[0]!.channelAround).toBe(3);
  });
});

describe("the manifest-selected handler", () => {
  it("carries no metadata of its own — the manifest owns that contract", () => {
    expect(Object.hasOwn(slackReadThreadCommand, "meta")).toBe(false);
  });
});
