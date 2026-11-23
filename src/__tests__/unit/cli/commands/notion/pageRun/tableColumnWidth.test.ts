/**
 * The table column-width blind spot on a `notion page update`: the note is printed only when a table was waved
 * through on a human's byte-identical edit. The shared fixtures are in `./harness.ts`.
 */
import { describe, expect, it } from "vitest";
import { runNotionPage } from "../../../../../../cli/commands/notion/pageRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { argv, BODY, harness, PAGE, PARENT, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runNotionPage — the table column-width blind spot", () => {
  async function seed({ home, body }: { home: string; body: string }): Promise<void> {
    await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", home] }),
      deps: harness({ body, canonical: body }).deps,
    });
  }

  it("says what the byte-identical check could not see when the page carries a table", async () => {
    const home = tempHome();
    const body = "## TL;DR\n\n<table><tr><td>a</td></tr></table>";
    await seed({ body, home });
    const h = harness({ body, canonical: body, lastEditedBy: "a-human-user-id" });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toContain("replaceMarkdown");
    expect(h.out.join("\n")).toContain("COLUMN WIDTHS never appear in Notion's markdown");
  });

  it("stays quiet on a page with no table, so the note is earned rather than boilerplate", async () => {
    const home = tempHome();
    await seed({ body: BODY, home });
    const h = harness({ body: BODY, canonical: BODY, lastEditedBy: "a-human-user-id" });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.out.join("\n")).not.toContain("COLUMN WIDTHS");
  });

  it("stays quiet when the bot itself is the last editor, since nothing was waved through", async () => {
    const home = tempHome();
    const body = "## TL;DR\n\n<table><tr><td>a</td></tr></table>";
    await seed({ body, home });
    const h = harness({ body, canonical: body });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.out.join("\n")).not.toContain("COLUMN WIDTHS");
  });
});
