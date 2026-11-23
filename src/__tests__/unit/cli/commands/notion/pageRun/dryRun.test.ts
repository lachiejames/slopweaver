/**
 * The `notion page` command's dry run: it performs no effect at all and prints the exact markdown that would be
 * sent. The shared fixtures are in `./harness.ts`.
 */
import { describe, expect, it } from "vitest";
import { runNotionPage } from "../../../../../../cli/commands/notion/pageRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { readPageRecord } from "../../../../../../outbound/notion/pageLedger.js";
import { argv, harness, PAGE, PARENT, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runNotionPage — dry run", () => {
  it("performs NO effect at all: no token, no client, no reservation", async () => {
    const h = harness();
    const home = tempHome();
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual([]);
    expect(readPageRecord({ home, pageId: PAGE })).toBe(undefined);
  });

  it("prints the exact markdown that would be sent", async () => {
    const h = harness();
    await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--dry-run"] }),
      deps: h.deps,
    });
    expect(h.out).toContain("## TL;DR");
  });
});
