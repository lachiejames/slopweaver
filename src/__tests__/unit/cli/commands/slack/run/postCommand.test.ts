import { describe, expect, it } from "vitest";
import { slackPostCommand } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { slackManifest } from "../../../../../../cli/manifests/slack.js";
import { FORM } from "./harness.js";

describe("slackPostCommand — the argv contract the ROUTER actually uses", () => {
  it("slices its own flag tail out of a full process.argv", async () => {
    // The router hands every handler the FULL argv: [node, script, noun, verb, ...flags]. A test that
    // passes a hand-made tail cannot see an off-by-one here — which is precisely how the previous
    // attempt at this PR shipped a broken binary past a green suite. This asserts the real shape.
    const code = await slackPostCommand([
      "/path/to/node",
      "/path/to/cli.js",
      "slack",
      "post",
      "--channel",
      "C1",
      "--form",
      FORM,
      "--dry-run",
    ]);

    // No --as, so this must be a USAGE rejection. If the offset were wrong the parser would instead
    // choke on "node"/"slack"/"post" as unexpected arguments — still non-zero, but for the wrong reason.
    expect(code).toBe(EXIT_USAGE);
  });

  it("is declared an external write routed through the door, in the manifest that actually owns that", () => {
    // Asserted against the MANIFEST, not the command module. The command module used to carry a second copy
    // of this metadata that nothing read and nothing compared — so a test reading it proved only that the
    // dead copy said the right thing, while `--help` and the door-coverage gate read the live one.
    const meta = slackManifest["post"]!.meta;
    expect(meta.effect).toBe("external-write");
    expect(meta.doorRouted).toBe(true);
  });
});
