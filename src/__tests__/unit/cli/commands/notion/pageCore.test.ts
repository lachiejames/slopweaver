/**
 * The pure core of `notion page` — parsing, preflight and the operator-facing report.
 *
 * The parse cases are mostly about REQUIRED arguments, and one of them encodes a measured provider
 * constraint rather than a preference: `--parent` cannot be optional, because Notion refuses workspace-
 * parented page creation from an internal integration. A `--private` flag that quietly did nothing was the
 * alternative.
 */
import { describe, expect, it } from "vitest";

import { NotionCommandErrors } from "../../../../../cli/commands/notion/errors.js";
import {
  checkedPageId,
  NOTION_PAGE_FLAG_NAMES,
  notionPageDoorRequest,
  notionPageOutcomeLines,
  parseNotionPageArgs,
  parseNotionPageBody,
  sameNotionId,
} from "../../../../../cli/commands/notion/pageCore.js";
import { notionMoveDryRunLines, notionPageDryRunLines } from "../../../../../cli/commands/notion/pagePreview.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";
const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";

/**
 * The lines a rejected parse reports, without a conditional in the assertion: each listed reason when the
 * refusal carries a list, otherwise its one message.
 */
function parseErrors({ argv }: { argv: readonly string[] }): readonly string[] {
  const parsed = parseNotionPageArgs({ argv });
  if (parsed.isOk()) {
    return [];
  }
  const error = parsed.error;
  return error.code === "ARGS_REFUSED" || error.code === "FLAGS_INVALID" ? error.reasons : [error.message];
}

describe("parseNotionPageArgs", () => {
  it("parses a complete create", () => {
    const parsed = parseNotionPageArgs({
      argv: ["create", "--parent", PAGE, "--title", "T", "--body", "b.md", "--icon", "🧭"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.verb : "").toBe("create");
    expect(parsed.isOk() ? parsed.value.icon : "").toBe("🧭");
    expect(parsed.isOk() ? parsed.value.adopt : true).toBe(false);
  });

  it("rejects a missing sub-command", () => {
    expect(parseErrors({ argv: ["--body", "b.md"] })[0]).toContain("create|update");
  });

  it("rejects an unknown sub-command rather than guessing", () => {
    expect(parseErrors({ argv: ["delete", "--body", "b.md"] }).length).toBe(1);
    expect(unwrapErr(parseNotionPageArgs({ argv: ["delete", "--body", "b.md"] })).code).toBe("UNKNOWN_SUBCOMMAND");
  });

  it("requires --body on both sub-commands", () => {
    expect(parseErrors({ argv: ["create", "--parent", PAGE, "--title", "T"] })[0]).toContain(
      "--body <md-path|-> is required",
    );
    expect(parseErrors({ argv: ["update", "--page", PAGE] }).length).toBe(1);
  });

  it("requires --parent on create, and says why it cannot be optional", () => {
    const errors = parseErrors({ argv: ["create", "--title", "T", "--body", "b.md"] });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("internal integration");
  });

  it("requires --title on create, because the title is a page property", () => {
    expect(parseErrors({ argv: ["create", "--parent", PAGE, "--body", "b.md"] })[0]).toContain("--title");
  });

  it("requires --page on update", () => {
    expect(parseErrors({ argv: ["update", "--body", "b.md"] })[0]).toContain("--page");
  });

  it("reports every missing argument in one pass rather than one per run", () => {
    expect(parseErrors({ argv: ["create"] }).length).toBe(3);
  });

  it("rejects an unknown flag", () => {
    expect(
      parseErrors({ argv: ["create", "--parent", PAGE, "--title", "T", "--body", "b.md", "--private"] }).length,
    ).toBe(1);
  });

  it("advertises exactly the flags it accepts", () => {
    expect([...NOTION_PAGE_FLAG_NAMES].toSorted()).toEqual([
      "--adopt",
      "--body",
      "--dry-run",
      "--home",
      "--icon",
      "--json",
      "--media-base",
      "--overwrite-external-edit",
      "--page",
      "--parent",
      "--title",
      "--to",
    ]);
  });

  it("requires a non-empty reason for --overwrite-external-edit", () => {
    const errors = parseErrors({
      argv: ["update", "--page", PAGE, "--body", "b.md", "--overwrite-external-edit", ""],
    });
    expect(errors.some((line) => line.includes("--overwrite-external-edit"))).toBe(true);
  });

  it("carries the reason through when --overwrite-external-edit is given", () => {
    const parsed = parseNotionPageArgs({
      argv: ["update", "--page", PAGE, "--body", "b.md", "--overwrite-external-edit", "syncing on their behalf"],
    });
    expect(parsed.isOk() ? parsed.value.overwriteExternalEdit : undefined).toBe("syncing on their behalf");
  });
});

describe("parseNotionPageBody", () => {
  it("accepts a golden body", () => {
    expect(parseNotionPageBody({ markdown: "## TL;DR\n\nIt is broken." }).isOk()).toBe(true);
  });

  it("refuses an empty body", () => {
    const checked = parseNotionPageBody({ markdown: "" });
    expect(unwrapErr(checked)).toEqual(["the body is empty; there is nothing to publish"]);
  });
});

describe("notionPageDryRunLines", () => {
  const args = {
    adopt: false,
    bodySource: "b.md",
    dryRun: true,
    home: undefined,
    icon: "🧭",
    mediaBase: undefined,
    json: false,
    overwriteExternalEdit: undefined,
    page: undefined,
    parent: PAGE,
    title: "T",
    to: undefined,
    verb: "create",
  } as const;

  it("names the destination, the intent and the exact byte count", () => {
    const lines = notionPageDryRunLines({ args, body: "## A\n\nbody", parentPageId: PAGE });
    expect(lines[0]).toBe("action:    create");
    expect(lines[1]).toBe(`parent:    ${PAGE}`);
    expect(lines.some((line) => line.includes("10 bytes"))).toBe(true);
  });

  it("shows the markdown itself, since that is what Notion converts", () => {
    const lines = notionPageDryRunLines({ args, body: "## A\n\nbody", parentPageId: PAGE });
    expect(lines).toContain("--- markdown ---");
    expect(lines).toContain("## A");
  });

  it("tells an update that the whole content is replaced in place", () => {
    const lines = notionPageDryRunLines({
      args: { ...args, page: PAGE, verb: "update" },
      body: "x",
      parentPageId: undefined,
    });
    expect(lines.some((line) => line.includes("REPLACES the page's whole content"))).toBe(true);
  });
});

describe("notionPageOutcomeLines", () => {
  it("never tells the operator to retry a create whose response was lost", () => {
    const lines = notionPageOutcomeLines({ outcome: { kind: "indeterminate", reason: "socket hang up" } });
    expect(lines.some((line) => line.includes("Do NOT re-run this"))).toBe(true);
  });

  it("says a re-publish kept the URL, which is the whole point of update", () => {
    const lines = notionPageOutcomeLines({ outcome: { kind: "updated", pageId: PAGE, url: "u" } });
    expect(lines.some((line) => line.includes("URL are unchanged"))).toBe(true);
  });

  it("reports an unchanged re-publish as a no-op rather than as a write", () => {
    const lines = notionPageOutcomeLines({ outcome: { kind: "unchanged", pageId: PAGE, url: "u" } });
    expect(lines[0]).toContain("changed nothing");
  });

  it("names the reserved page's URL on a duplicate so the operator can go and look", () => {
    const lines = notionPageOutcomeLines({
      outcome: { kind: "duplicate", reservedIso: "2026-08-22T00:00:00.000Z", url: "u" },
    });
    expect(lines.some((line) => line.includes("It published to u"))).toBe(true);
  });

  it("says to reconcile when a duplicate reservation confirmed no page at all", () => {
    const lines = notionPageOutcomeLines({
      outcome: { kind: "duplicate", reservedIso: "2026-08-22T00:00:00.000Z", url: undefined },
    });
    expect(lines.some((line) => line.includes("reconcile in Notion"))).toBe(true);
  });

  it("warns that a retry after an unconfirmed create publishes a SECOND page", () => {
    const lines = notionPageOutcomeLines({ outcome: { kind: "unconfirmed", pageId: PAGE, reason: "r", url: "u" } });
    expect(lines.some((line) => line.includes("a retry publishes a SECOND page"))).toBe(true);
  });

  it("says an unconfirmed write's URL never came back when the read-back that carries it failed", () => {
    const lines = notionPageOutcomeLines({
      outcome: { kind: "unconfirmed", pageId: PAGE, reason: "r", url: undefined },
    });
    expect(lines[1]).toBe("(its URL was never returned)");
  });

  it("says an adopt wrote nothing", () => {
    expect(notionPageOutcomeLines({ outcome: { kind: "adopted", pageId: PAGE, url: "u" } })[0]).toContain(
      "nothing was written",
    );
  });
});

describe("notionPageDoorRequest", () => {
  it("marks a create as creating a work item and an update as not", () => {
    expect(
      notionPageDoorRequest({ destination: PAGE, home: "/h", intent: "i", verb: "create" }).meta.createsWorkItem,
    ).toBe(true);
    expect(
      notionPageDoorRequest({ destination: PAGE, home: "/h", intent: "i", verb: "update" }).meta.createsWorkItem,
    ).toBe(false);
  });

  it("declares an external write, which is what the door-coverage gate requires", () => {
    expect(notionPageDoorRequest({ destination: PAGE, home: "/h", intent: "i", verb: "create" }).meta.effect).toBe(
      "external-write",
    );
  });
});

describe("checkedPageId", () => {
  it("passes a canonical UUID", () => {
    const checked = checkedPageId({ id: PAGE });
    expect(checked.isOk()).toBe(true);
  });

  it("refuses anything that could reach a ledger filename", () => {
    const checked = checkedPageId({ id: "../../x" });
    expect(unwrapErr(checked)).toEqual(NotionCommandErrors.pageIdNotCanonical({ id: "../../x" }));
    expect(unwrapErr(checked).message).toBe(
      '"../../x" is not a canonical Notion UUID, and it would reach a ledger filename',
    );
  });
});

describe("parseNotionPageArgs — move", () => {
  it("needs both the page being moved and the parent it moves under", () => {
    const errors = parseErrors({ argv: ["move"] });
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain("--page <page-id-or-url> is required for move");
    expect(errors[1]).toContain("--to <page-id-or-url> is required for move");
  });

  it("does not ask a move for a body, because a move sends none", () => {
    const errors = parseErrors({ argv: ["move", "--page", PAGE, "--to", PARENT] });
    expect(errors).toStrictEqual([]);
  });

  it("records a bodyless move's body source as stdin, and keeps a --body that was given", () => {
    expect(unwrap(parseNotionPageArgs({ argv: ["move", "--page", PAGE, "--to", PARENT] })).bodySource).toBe("-");
    expect(
      unwrap(parseNotionPageArgs({ argv: ["move", "--page", PAGE, "--to", PARENT, "--body", "b.md"] })).bodySource,
    ).toBe("b.md");
  });

  it("keeps the two addresses apart, so neither can stand in for the other", () => {
    const parsed = parseNotionPageArgs({ argv: ["move", "--page", PAGE, "--to", PARENT] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).page).toBe(PAGE);
    expect(unwrap(parsed).to).toBe(PARENT);
    expect(unwrap(parsed).verb).toBe("move");
  });

  it("still refuses an unknown sub-command, naming every one it does take", () => {
    expect(parseErrors({ argv: ["relocate", "--page", PAGE] })[0]).toBe(
      "usage: slopweaver notion page <create|update|archive|move> --body <md-path|-> [...]",
    );
    expect(unwrapErr(parseNotionPageArgs({ argv: ["relocate", "--page", PAGE] }))).toEqual(
      NotionCommandErrors.pageUsage({ got: "relocate", verbs: ["create", "update", "archive", "move"] }),
    );
  });
});

describe("notionMoveDryRunLines", () => {
  const args = {
    adopt: false,
    bodySource: "-",
    dryRun: true,
    home: undefined,
    icon: undefined,
    mediaBase: undefined,
    json: false,
    overwriteExternalEdit: undefined,
    page: PAGE,
    parent: undefined,
    title: undefined,
    to: PARENT,
    verb: "move",
  } as const;

  it("names both addresses, so a reader sees what moves and where before it happens", () => {
    const lines = notionMoveDryRunLines({ args, pageId: PAGE, parentPageId: PARENT });
    expect(lines[0]).toBe("action:    move");
    expect(lines[1]).toBe(`page:      ${PAGE}`);
    expect(lines[2]).toBe(`to:        ${PARENT}`);
  });

  it("states the permission consequence, which is the only thing a move actually changes for a reader", () => {
    const lines = notionMoveDryRunLines({ args, pageId: PAGE, parentPageId: PARENT });
    expect(lines.some((line) => line.includes("inherits page permissions from the parent"))).toBe(true);
  });

  it("says an address is unresolved rather than printing a blank destination", () => {
    const lines = notionMoveDryRunLines({ args, pageId: undefined, parentPageId: undefined });
    expect(lines[1]).toBe(`page:      ${PAGE}`);
    expect(lines[2]).toBe(`to:        ${PARENT}`);
  });
});

describe("notionPageOutcomeLines — move", () => {
  it("names where the page came from as well as where it went", () => {
    const lines = notionPageOutcomeLines({
      outcome: { fromParentId: PAGE, kind: "moved", pageId: PAGE, parentPageId: PARENT, url: "u" },
    });
    expect(lines[0]).toBe(`moved page ${PAGE} under ${PARENT}, out from under ${PAGE}.`);
  });

  it("omits the origin when the provider reported no previous page parent", () => {
    const lines = notionPageOutcomeLines({
      outcome: { fromParentId: undefined, kind: "moved", pageId: PAGE, parentPageId: PARENT, url: "u" },
    });
    expect(lines[0]).toBe(`moved page ${PAGE} under ${PARENT}.`);
  });

  it("says the permissions are now the destination's, because that is what changed", () => {
    const lines = notionPageOutcomeLines({
      outcome: { fromParentId: undefined, kind: "moved", pageId: PAGE, parentPageId: PARENT, url: "u" },
    });
    expect(lines[3]).toBe("its permissions are now the destination's: whoever can see that parent can see this page.");
  });

  it("does not report a page that was already there as having moved", () => {
    const lines = notionPageOutcomeLines({
      outcome: { kind: "unmoved", pageId: PAGE, parentPageId: PARENT, url: "u" },
    });
    expect(lines[0]).toBe(`page ${PAGE} is already under ${PARENT}, so nothing was sent.`);
  });
});

describe("notionPageDoorRequest — move", () => {
  it("marks a move as creating a work item, since the page appears somewhere colleagues watch", () => {
    expect(
      notionPageDoorRequest({ destination: PAGE, home: "/h", intent: "i", verb: "move" }).meta.createsWorkItem,
    ).toBe(true);
  });

  it("marks an archive as not creating one", () => {
    expect(
      notionPageDoorRequest({ destination: PAGE, home: "/h", intent: "i", verb: "archive" }).meta.createsWorkItem,
    ).toBe(false);
  });
});

describe("sameNotionId", () => {
  it("matches the same id spelled dashed and compact, which is how the provider and a URL differ", () => {
    expect(sameNotionId({ left: PAGE, right: PAGE.replaceAll("-", "") })).toBe(true);
  });

  it("matches across case, since a URL may carry either", () => {
    expect(sameNotionId({ left: PAGE, right: PAGE.toUpperCase() })).toBe(true);
  });

  it("does not match two different pages", () => {
    expect(sameNotionId({ left: PAGE, right: PARENT })).toBe(false);
  });

  it("is false when the provider reported no parent at all, rather than matching nothing to nothing", () => {
    expect(sameNotionId({ left: undefined, right: undefined })).toBe(false);
    expect(sameNotionId({ left: undefined, right: PARENT })).toBe(false);
  });
});
