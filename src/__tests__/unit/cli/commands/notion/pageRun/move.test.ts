/**
 * The `notion page move` orchestration and the bodyless dry runs: the read-before and read-after around a move,
 * the no-op when already in place, the refusals, an unconfirmed or failed move, a move the write transport refused
 * before the wire, and the move and archive previews. The shared fixtures are in `./harness.ts`.
 */
import { describe, expect, it } from "vitest";
import { runNotionPage } from "../../../../../../cli/commands/notion/pageRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { readPageRecord } from "../../../../../../outbound/notion/pageLedger.js";
import { argv, harness, PAGE, PARENT, REFUSED_TEXT, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runNotionPage — move", () => {
  /** A second real parent, so a move has somewhere to go that is not where the page already is. */
  const DESTINATION = "3a100000-0000-81aa-b0c2-7f1b0d4a9911";

  /** Create a page into `home` first, so the move has something the ledger legitimately owns. */
  async function seed({ home }: { home: string }): Promise<void> {
    await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", home] }),
      deps: harness().deps,
    });
  }

  it("re-parents the page and reports where it came from", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", DESTINATION, "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.out[0]).toBe(`moved page ${PAGE} under ${DESTINATION}, out from under ${PARENT}.`);
    // The whole sequence, not just that the move happened: a move reads the parent BEFORE and AFTER, and
    // the two read-backs are the verb's only evidence that it did what it says.
    expect(h.calls).toEqual(["resolveToken", "makeApis", "retrievePage", `movePage:${DESTINATION}`, "retrievePage"]);
  });

  it("records the new parent on the page's ledger row, leaving its content digest alone", async () => {
    const home = tempHome();
    await seed({ home });
    const before = readPageRecord({ home, pageId: PAGE })!.lastCanonicalHash;
    await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", DESTINATION, "--home", home] }),
      deps: harness().deps,
    });
    const after = readPageRecord({ home, pageId: PAGE })!;
    expect(after.lastParentId).toBe(DESTINATION);
    expect(after.movedIso).toBe("2026-08-22T00:00:00.000Z");
    expect(after.lastCanonicalHash).toBe(before);
  });

  it("sends nothing at all when the page is already under the requested parent", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", PARENT, "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).not.toContain(`movePage:${PARENT}`);
    expect(h.out[0]).toBe(`page ${PAGE} is already under ${PARENT}, so nothing was sent.`);
  });

  it("sees a compact id and a dashed one as the same parent, so a URL does not force a pointless write", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness();
    await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", PARENT.replaceAll("-", ""), "--home", home] }),
      deps: h.deps,
    });
    expect(h.calls).not.toContain(`movePage:${PARENT}`);
    expect(h.out[0]).toContain("is already under");
  });

  it("refuses to make a page its own parent", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", PAGE, "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("a page cannot be its own parent");
  });

  it("refuses a page absent from the ledger, and says it will not MOVE it rather than not rewrite it", async () => {
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", DESTINATION, "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("so it will not move it");
    expect(h.err.join("\n")).toContain("--adopt");
  });

  it("moves a page a human has edited, with no override flag, because a move destroys nothing", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ canonical: "## TL;DR\nSomebody rewrote this.", lastEditedBy: "a-human-user-id" });
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", DESTINATION, "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toContain(`movePage:${DESTINATION}`);
  });

  it("reports an accepted move that landed somewhere else as unconfirmed, not as a move", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ moveLandsAt: PARENT });
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", DESTINATION, "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.join("\n")).toContain("could NOT be read back");
    expect(readPageRecord({ home, pageId: PAGE })!.lastParentId).toBe(undefined);
  });

  it("reports a failed move as indeterminate rather than inviting a retry", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ move: "fail" });
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", DESTINATION, "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.join("\n")).toContain("it is unknown whether it landed");
  });

  it("reports a move the privacy check refused as failed, since nothing was sent", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness({ move: "refused" });
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", DESTINATION, "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.out.at(-1)).toBe(`the write failed: ${REFUSED_TEXT}`);
    expect(readPageRecord({ home, pageId: PAGE })!.lastParentId).toBe(undefined);
  });

  it("previews a move without resolving a token or touching the provider", async () => {
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["move", "--page", PAGE, "--to", DESTINATION, "--dry-run", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual([]);
    expect(h.out[0]).toBe("action:    move");
  });

  it("previews an ARCHIVE instead of performing it — the hole a bodyless dry run used to have", async () => {
    const home = tempHome();
    await seed({ home });
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["archive", "--page", PAGE, "--dry-run", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual([]);
    expect(h.out[0]).toBe("action:    archive");
  });
});
