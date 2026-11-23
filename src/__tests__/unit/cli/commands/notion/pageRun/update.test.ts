/**
 * The `notion page update` orchestration: the ledger and authorship checks before a replace, the
 * `--overwrite-external-edit` override and its journal, `--adopt`, and a replace or header the write transport refused
 * before the wire. The shared fixtures are in `./harness.ts`.
 */
import { describe, expect, it } from "vitest";
import { runNotionPage } from "../../../../../../cli/commands/notion/pageRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { readExternalEditOverrides, readPageRecord } from "../../../../../../outbound/notion/pageLedger.js";
import { argv, harness, PAGE, PARENT, REFUSED_TEXT, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runNotionPage — update", () => {
  /** Create a page into `home` first, so the update has something it legitimately owns. */
  async function seed({ home }: { home: string }): Promise<void> {
    await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", home] }),
      deps: harness().deps,
    });
  }

  it("refuses a page absent from the ledger, and points at --adopt", async () => {
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).not.toContain("replaceMarkdown");
    expect(h.err.join("\n")).toContain("--adopt");
  });

  it("refuses a genuine external edit, naming what would be destroyed and the override flag", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ canonical: "## TL;DR\nSomebody rewrote this.", lastEditedBy: "a-human-user-id" });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).not.toContain("replaceMarkdown");
    expect(h.err.join("\n")).toContain("a-human-user-id");
    expect(h.err.join("\n")).toContain("--overwrite-external-edit");
  });

  it("treats a byte-identical external edit — a display toggle — as no edit, and proceeds without the flag", async () => {
    const home = tempHome();
    await seed({ home });
    // Default canonical matches exactly what `seed` wrote, so the human touch changed nothing a diff can see.
    const h = harness({ lastEditedBy: "a-human-user-id" });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toContain("replaceMarkdown");
  });

  it("overwrites a genuine external edit when given the flag, and journals who last edited it and why", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ canonical: "## TL;DR\nSomebody rewrote this.", lastEditedBy: "a-human-user-id" });
    const code = await runNotionPage({
      argv: argv({
        rest: [
          "update",
          "--page",
          PAGE,
          "--body",
          "-",
          "--overwrite-external-edit",
          "syncing gold on their behalf",
          "--home",
          home,
        ],
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toContain("replaceMarkdown");
    const overrides = readExternalEditOverrides({ home });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.reason).toBe("syncing gold on their behalf");
    expect(overrides[0]!.lastEditedBy).toBe("a-human-user-id");
  });

  it("refuses when the page changed since slopweaver last wrote it", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ canonical: "## TL;DR\nSomebody rewrote this." });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).not.toContain("replaceMarkdown");
    expect(h.err.join("\n")).toContain("changed since slopweaver last wrote it");
  });

  it("replaces the content in place on a clean page, keeping the id", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ body: "## TL;DR\n\nIt is fixed.", canonical: "## TL;DR\nIt is broken." });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toContain("replaceMarkdown");
    expect(h.sent()).toBe("## TL;DR\n\nIt is fixed.");
  });

  it("reports a re-publish that came back byte-identical as changing nothing", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness();
    await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(h.out.join("\n")).toContain("changed nothing");
  });

  it("reports a replace the privacy check refused as failed, since nothing was sent", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ replace: "refused" });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.out.at(-1)).toBe(`the write failed: ${REFUSED_TEXT}`);
    expect(h.calls).not.toContain("updatePageHeader");
  });

  it("reports a replace whose response was lost as indeterminate, never as failed", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ replace: "fail" });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.join("\n")).not.toContain("the write failed");
  });

  it("reports a refused title change after the body landed as unconfirmed, naming the refusal", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ header: "refused" });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--title", "New", "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).toContain("replaceMarkdown");
    expect(h.out.join("\n")).toContain(`the title/icon update failed: ${REFUSED_TEXT}`);
  });

  it("adopts a page the integration still owns, and writes nothing that run", async () => {
    const home = tempHome();
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--adopt", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).not.toContain("replaceMarkdown");
    expect(readPageRecord({ home, pageId: PAGE })!.intent).toBe(`adopted:${PAGE}`);
  });

  it("will not adopt a page a human last edited", async () => {
    const home = tempHome();
    const h = harness({ lastEditedBy: "a-human-user-id" });
    const code = await runNotionPage({
      argv: argv({ rest: ["update", "--page", PAGE, "--body", "-", "--adopt", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(readPageRecord({ home, pageId: PAGE })).toBe(undefined);
  });
});
