/**
 * The `notion page` command's parse and preflight: a bad sub-command or a body Notion would mangle is refused
 * before anything is called. The shared fixtures are in `./harness.ts`.
 */
import { describe, expect, it } from "vitest";
import { runNotionPage } from "../../../../../../cli/commands/notion/pageRun.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { argv, harness, PARENT } from "./harness.js";

describe("runNotionPage — parse and preflight", () => {
  it("exits usage on a bad sub-command, touching nothing", async () => {
    const h = harness();
    expect(await runNotionPage({ argv: argv({ rest: ["delete", "--body", "-"] }), deps: h.deps })).toBe(EXIT_USAGE);
    expect(h.calls).toEqual([]);
  });

  it("refuses a body Notion would mangle, BEFORE any page exists", async () => {
    const h = harness({ body: "# A title\n\nbody" });
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-"] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.calls).toEqual([]);
    expect(h.err.join("\n")).toContain("--title");
  });
});
