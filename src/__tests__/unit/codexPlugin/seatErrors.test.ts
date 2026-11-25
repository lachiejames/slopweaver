/**
 * The two refusals a Codex seat's plugin preflight can return, each built by its factory and pinned to a literal
 * copy of its sentence, so a wording drift in `seatErrors.ts` fails here rather than reaching a spawn's stderr.
 */
import { describe, expect, it } from "vitest";

import { CodexPluginSeatErrors } from "../../../codexPlugin/seatErrors.js";

describe("the Codex seat refusals", () => {
  it("names the home, the stamp path it looked for and the repair when no install is there", () => {
    expect(
      CodexPluginSeatErrors.installMissing({
        codexHome: "/x/codex-two",
        stampPath: "/x/codex-two/plugins/cache/*/slopweaver/local/.codex-plugin/source.json",
      }),
    ).toEqual({
      code: "PLUGIN_INSTALL_MISSING",
      codexHome: "/x/codex-two",
      message:
        "the Codex home /x/codex-two has no Slopweaver plugin installed (no " +
        "/x/codex-two/plugins/cache/*/slopweaver/local/.codex-plugin/source.json), so a seat there would boot " +
        "without Slopweaver's skills and hooks — run `slopweaver codex plugin-sync` from the main checkout, then " +
        "spawn again",
      stampPath: "/x/codex-two/plugins/cache/*/slopweaver/local/.codex-plugin/source.json",
    });
  });

  it("names the home, the cache root and why it could not be listed when the cache is unreadable", () => {
    expect(
      CodexPluginSeatErrors.cacheUnreadable({
        cacheRoot: "/x/codex-two/plugins/cache",
        codexHome: "/x/codex-two",
        why: "EACCES: permission denied",
      }),
    ).toEqual({
      cacheRoot: "/x/codex-two/plugins/cache",
      code: "PLUGIN_CACHE_UNREADABLE",
      codexHome: "/x/codex-two",
      message:
        "the Codex home /x/codex-two cannot be checked for the Slopweaver plugin (/x/codex-two/plugins/cache could " +
        "not be listed: EACCES: permission denied), so a seat there would boot without Slopweaver's skills and " +
        "hooks — make it readable, run `slopweaver codex plugin-sync` from the main checkout, then spawn again",
    });
  });
});
