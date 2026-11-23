/**
 * The PURE core of `notion attach`: what argv it accepts, and what a dry run promises.
 */
import { describe, expect, it } from "vitest";
import { NotionCommandErrors } from "../../../../../cli/commands/notion/errors.js";
import {
  NOTION_ATTACH_FLAG_NAMES,
  notionAttachDryRunLines,
  notionImageDoorRequest,
  parseNotionAttachArgs,
} from "../../../../../cli/commands/notion/mediaCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";

describe("parseNotionAttachArgs", () => {
  it("parses a complete invocation", () => {
    const parsed = parseNotionAttachArgs({
      argv: ["attach", "--page", PAGE, "--from", "draft.md", "--media-base", "/shots", "--dry-run", "--json"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({
      dryRun: true,
      from: "draft.md",
      home: undefined,
      mediaBase: "/shots",
      json: true,
      page: PAGE,
    });
  });

  it("refuses a sub-command that is not `attach`", () => {
    const parsed = parseNotionAttachArgs({ argv: ["detach", "--page", PAGE, "--from", "d.md"] });
    expect(unwrapErr(parsed)).toEqual(NotionCommandErrors.attachUsage({ got: "detach" }));
    expect(unwrapErr(parsed).message).toBe("usage: slopweaver notion attach --page <page> --from <md-path> [...]");
  });

  it("refuses a bare noun with no sub-command", () => {
    const parsed = parseNotionAttachArgs({ argv: [] });
    expect(unwrapErr(parsed)).toEqual(NotionCommandErrors.attachUsage({ got: undefined }));
    expect(unwrapErr(parsed).message).toBe("usage: slopweaver notion attach --page <page> --from <md-path> [...]");
  });

  it("requires --page, saying what it is for", () => {
    const parsed = parseNotionAttachArgs({ argv: ["attach", "--from", "d.md"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(
      NotionCommandErrors.argsRefused({
        reasons: ["--page <page-id-or-url> is required; it is the page the markers were published to"],
      }),
    );
  });

  it("requires --from, and says WHY the published page cannot supply it", () => {
    const parsed = parseNotionAttachArgs({ argv: ["attach", "--page", PAGE] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("ARGS_REFUSED");
    expect(unwrapErr(parsed).message).toContain("no longer knows");
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    const parsed = parseNotionAttachArgs({ argv: ["attach", "--page", PAGE, "--from", "d.md", "--force"] });
    expect(unwrapErr(parsed)).toEqual(NotionCommandErrors.flagsInvalid({ reasons: ["unknown flag: --force"] }));
    expect(unwrapErr(parsed).message).toBe("unknown flag: --force");
  });

  it("advertises exactly the flags it accepts", () => {
    expect([...NOTION_ATTACH_FLAG_NAMES].toSorted()).toEqual([
      "--dry-run",
      "--from",
      "--home",
      "--json",
      "--media-base",
      "--overwrite-external-edit",
      "--page",
    ]);
  });

  it("requires a non-empty reason for --overwrite-external-edit", () => {
    const parsed = parseNotionAttachArgs({
      argv: ["attach", "--page", PAGE, "--from", "d.md", "--overwrite-external-edit", ""],
    });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(
      NotionCommandErrors.argsRefused({
        reasons: [
          "--overwrite-external-edit requires a non-empty reason, journaled alongside who last edited the page",
        ],
      }),
    );
  });
});

describe("notionAttachDryRunLines", () => {
  it("lists every placeholder with its line, its source and the marker it will look for", () => {
    const lines = notionAttachDryRunLines({
      baseDir: "/draft",
      markdown: "## A\n\n![hero](file:./shots/hero.png)\n\nprose\n",
      pageId: PAGE,
    });
    expect(lines[1]).toBe(`page:      ${PAGE}`);
    expect(lines[2]).toBe("base dir:  /draft");
    expect(lines[3]).toBe("files:     1 placeholder(s)");
    expect(lines[4]).toContain("line 3: ./shots/hero.png → image block at marker [slopweaver-image:");
    expect(lines.at(-1)).toBe("nothing was uploaded, inserted or deleted.");
  });

  it("names the BLOCK each placeholder becomes, so a wrong sigil is visible before anything uploads", () => {
    const lines = notionAttachDryRunLines({
      baseDir: "/draft",
      markdown: "![hero](file:./hero.png)\n\n[the DPA](file:./dpa.pdf)\n",
      pageId: PAGE,
    });
    expect(lines[3]).toBe("files:     2 placeholder(s)");
    expect(lines[4]).toContain("./hero.png → image block at marker");
    expect(lines[5]).toContain("./dpa.pdf → pdf block at marker");
  });

  it("says the address did not resolve rather than printing a plausible id", () => {
    const lines = notionAttachDryRunLines({ baseDir: "/draft", markdown: "prose", pageId: undefined });
    expect(lines[1]).toBe("page:      (unresolved)");
  });

  it("reports zero placeholders for a body that carries none", () => {
    expect(notionAttachDryRunLines({ baseDir: "/d", markdown: "prose", pageId: PAGE })[3]).toBe(
      "files:     0 placeholder(s)",
    );
  });
});

describe("notionImageDoorRequest", () => {
  it("declares an external write that creates no work item — it finishes a page that already exists", () => {
    const request = notionImageDoorRequest({ home: "/home", pageId: PAGE });
    expect(request.meta.effect).toBe("external-write");
    expect(request.meta.createsWorkItem).toBe(false);
    expect(request.artifact).toEqual({ destination: PAGE, id: `image-attach:${PAGE}` });
    expect(request.action).toEqual({ kind: "verb", noun: "notion", verb: "image attach" });
  });
});
