/**
 * The image pass folded into a `notion page` publish: markers sent in place of `file:` placeholders, the attach
 * order between create and read-back, `--media-base`, and a partial publish. The shared fixtures are in
 * `./harness.ts`.
 */
import { describe, expect, it } from "vitest";
import { runNotionPage } from "../../../../../../cli/commands/notion/pageRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { PageBlock } from "../../../../../../corpus/notion/mediaApi.js";
import { placeholderMarker, withMediaMarkers } from "../../../../../../outbound/notion/mediaPlaceholder.js";
import { readPageRecord } from "../../../../../../outbound/notion/pageLedger.js";
import { argv, harness, PAGE, PARENT, tempHome, URL, useTempHomes } from "./harness.js";

useTempHomes();

describe("runNotionPage — the image pass folded into a publish", () => {
  const IMAGE_BODY = "## TL;DR\n\n![The hero shot](file:./hero.png)\n\nprose\n";

  /** The marker blocks a page carries once `IMAGE_BODY` has been published. */
  function markers(): readonly PageBlock[] {
    return withMediaMarkers({ markdown: IMAGE_BODY }).placeholders.map((placeholder, at): PageBlock => ({
      hasChildren: false,
      id: `marker-${String(at)}`,
      parentId: PAGE,
      text: placeholderMarker({ id: placeholder.id }),
      type: "paragraph",
    }));
  }

  it("sends Notion the MARKER, never the `file:` placeholder it would build a broken block from", async () => {
    const h = harness({
      body: IMAGE_BODY,
      images: { "/draft/hero.png": new Uint8Array([1, 2, 3]) },
      pageBlocks: markers(),
    });
    await runNotionPage({
      argv: argv({
        rest: ["create", "--parent", PARENT, "--title", "T", "--body", "/draft/d.md", "--home", tempHome()],
      }),
      deps: h.deps,
    });
    expect(h.sent()).not.toContain("file:./hero.png");
    expect(h.sent()).toContain("[slopweaver-image:");
  });

  it("attaches AFTER the create and BEFORE the read-back, so the recorded digest describes the finished page", async () => {
    const home = tempHome();
    const h = harness({
      body: IMAGE_BODY,
      images: { "/draft/hero.png": new Uint8Array([1, 2, 3]) },
      pageBlocks: markers(),
    });
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "/draft/d.md", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual([
      "resolveToken",
      "makeApis",
      "createPage",
      "readMedia:/draft/hero.png",
      "listChildren",
      "uploadFile:hero.png:3",
      "insertMediaAfter:marker-0:The hero shot",
      "deleteBlock:marker-0",
      "retrieveMarkdown",
    ]);
    expect(readPageRecord({ home, pageId: PAGE })!.images!.length).toBe(1);
  });

  it("resolves a relative placeholder against --media-base when the body came from stdin", async () => {
    const h = harness({
      body: IMAGE_BODY,
      images: { "/shots/hero.png": new Uint8Array([1]) },
      pageBlocks: markers(),
    });
    const code = await runNotionPage({
      argv: argv({
        rest: [
          "create",
          "--parent",
          PARENT,
          "--title",
          "T",
          "--body",
          "-",
          "--media-base",
          "/shots",
          "--home",
          tempHome(),
        ],
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toContain("readMedia:/shots/hero.png");
  });

  it("reports a partial publish rather than success when an image cannot be read", async () => {
    const home = tempHome();
    const h = harness({ body: IMAGE_BODY, images: {}, pageBlocks: markers() });
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "/draft/d.md", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.join("\n")).toContain(`partial page ${PAGE}`);
    // The page still lands in the ledger: forgetting it would make the next publish create a SECOND page.
    expect(readPageRecord({ home, pageId: PAGE })!.url).toBe(URL);
  });

  it("does not read an image, list blocks or upload for a body with no placeholders", async () => {
    const h = harness();
    await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(h.calls.some((call) => call.startsWith("readMedia") || call === "listChildren")).toBe(false);
  });
});
