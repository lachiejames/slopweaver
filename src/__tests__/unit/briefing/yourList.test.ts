/**
 * The projection from `session-start --json` into the owner's list.
 *
 * Every fixture is one session-start document held as a value, because the projection is pure — the CLI edge
 * reads the file and this maps it. What is asserted is the mapping ITSELF, field by field, since the whole
 * claim of the section is that nothing here composes: a row on the page says what the verb said.
 */
import { describe, expect, it } from "vitest";

import { checkBareRefs } from "../../../briefing/bareRef.js";
import { briefingErrorLines } from "../../../briefing/errors.js";
import { checkPageBudget } from "../../../briefing/pageBudget.js";
import { linkifyRowText, projectYourList, recordedTextBlocks, rowRefContext } from "../../../briefing/yourList.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { Organisation } from "../../../organisation/core.js";
import { renderYourRow } from "../../../outbound/briefing/render.js";
import type { BriefingInline } from "../../../outbound/briefing/types.js";
import { quotedFoldSchema } from "../../../outbound/briefing/vocabulary.js";
import { repoSlugFor } from "../../../sessionStart/staleRefs.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY, GLOBEX_ORGANISATION } from "../../organisationFixture.js";

/** One ranked entry, with whatever a test needs to vary. */
function entry({
  background,
  doneWhen = "Land the render verb yourself.",
  nativeId = "a-run",
  repo,
  source = "handover",
  title,
  verdict = "rank",
  where = "slopweaver handover resume a-run",
}: {
  background?: string;
  doneWhen?: string;
  nativeId?: string;
  repo?: string;
  source?: string;
  title?: string;
  verdict?: string;
  where?: string;
}): unknown {
  return {
    item: {
      ...(background === undefined ? {} : { background }),
      doneWhen,
      nativeId,
      ...(repo === undefined ? {} : { repo }),
      source,
      ...(title === undefined ? {} : { title }),
      whenIso: "2026-08-31T02:26:50.911Z",
      where,
      who: "the session holding it",
    },
    score: 12,
    trace: { verdict },
    why: "somebody is stopped waiting on you",
  };
}

/** A whole session-start document holding `ranked`. */
function document({ ranked }: { ranked: readonly unknown[] }): unknown {
  return { nowIso: "2026-09-01T04:09:30.684Z", ranking: { ranked } };
}

describe("projecting the owner's list out of a session-start run", () => {
  it("maps one row's every field straight from the verb", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({})] }),
        invocation: "slopweaver session-start --json",
        top: 10,
      }),
    );
    const row = list.rows[0]!;

    expect(row.rank).toBe(1);
    expect(row.identity).toBe("handover:a-run");
    expect(row.who).toBe("the session holding it");
    expect(row.where).toBe("slopweaver handover resume a-run");
    expect(row.link).toBe(false);
    expect(row.whenIso).toBe("2026-08-31T02:26:50.911Z");
    expect(row.why).toBe("somebody is stopped waiting on you");
    expect(row.score).toBe(12);
    expect(row.closing).toBe(false);
    expect(row.headline).toEqual([{ kind: "text", text: "Land the render verb yourself." }]);
  });

  it("states how the list was produced, naming the verb and the run's own instant", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({})] }),
        invocation: "slopweaver session-start --json, top 10",
        top: 10,
      }),
    );

    expect(list.source).toBe("slopweaver session-start --json, top 10, read at 2026-09-01T04:09:30.684Z");
  });

  it("counts the rows it is not showing rather than dropping them silently", () => {
    const ranked = Array.from({ length: 66 }, (_, index) => entry({ nativeId: `run-${String(index)}` }));

    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked }),
        invocation: "session-start",
        top: 10,
      }),
    );

    expect(list.rows.length).toBe(10);
    expect(list.notShown).toBe(56);
    expect(list.rows[9]!.rank).toBe(10);
  });

  it("reports nothing unshown when the list fits", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({})] }),
        invocation: "s",
        top: 10,
      }),
    );

    expect(list.notShown).toBe(0);
  });

  it("marks a propose-close row as a close, because the action on it is a different kind", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({ verdict: "propose-close" })] }),
        invocation: "s",
        top: 10,
      }),
    );

    expect(list.rows[0]!.closing).toBe(true);
  });

  it("carries a permalink as a link and a command as one it will not follow", () => {
    const ranked = [
      entry({ where: "https://github.com/owner/repo/pull/12" }),
      entry({ where: "slopweaver handover resume a" }),
    ];

    const list = unwrap(
      projectYourList({ organisation: ACME_ORGANISATION, document: document({ ranked }), invocation: "s", top: 10 }),
    );

    expect(list.rows[0]!.link).toBe(true);
    expect(list.rows[1]!.link).toBe(false);
  });

  it("shortens the headline at a word boundary and keeps the whole question in the row's fold", () => {
    const doneWhen = `Reply to the thread about ${"alpha ".repeat(60)}end.`;

    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({ doneWhen })] }),
        invocation: "s",
        top: 10,
      }),
    );
    const row = list.rows[0]!;
    const headline = row.headline.map((run) => run.text).join("");

    expect(headline.endsWith("...")).toBe(false);
    expect(headline.length).toBeLessThan(doneWhen.length);
    expect(
      row.detail!.blocks.some(
        (block) => block.kind === "para" && block.content.some((run) => run.text.includes("end.")),
      ),
    ).toBe(true);
  });

  it("folds the exact lock-in command a one-word answer is recorded with", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({})] }),
        invocation: "s",
        top: 10,
      }),
    );
    const commands = list.rows[0]!.detail!.blocks.flatMap((block) =>
      block.kind === "para" ? block.content.filter((run) => run.kind === "code").map((run) => run.text) : [],
    );

    expect(commands).toEqual([
      "slopweaver handover resume a-run",
      "slopweaver session-start lock-in --item handover:a-run --against 2026-08-31T02:26:50.911Z " +
        '--reply <do | hand-off | defer | skip | note> --proposed "…"',
    ]);
  });

  it("carries the subject's own title beside the row rather than folding it away", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({ title: "fix(security): bump the lock trees" })] }),
        invocation: "s",
        top: 10,
      }),
    );

    expect(list.rows[0]!.title).toBe("fix(security): bump the lock trees");
  });

  it("refuses a document that is not a session-start run, naming what it could not read", () => {
    const result = projectYourList({
      organisation: ACME_ORGANISATION,
      document: { ranking: {} },
      invocation: "s",
      top: 10,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("SESSION_START_DOCUMENT_INVALID");
    expect(briefingErrorLines({ error: unwrapErr(result) })[0]).toBe(
      "the document is not a `slopweaver session-start --json` run:",
    );
  });
});

describe("resolving a row's own references", () => {
  it("links an explicit owner/repo reference with no context at all", () => {
    const runs = linkifyRowText({
      context: { linearTeamKeys: [], repos: [] },
      text: "Bump them about owner/repo#16318, which they have not answered",
    });

    expect(runs).toEqual([
      { kind: "text", text: "Bump them about " },
      { kind: "link", text: "owner/repo#16318", url: "https://github.com/owner/repo/issues/16318" },
      { kind: "text", text: ", which they have not answered" },
    ]);
  });

  it("links a bare reference against the repository the row's own permalink names", () => {
    const context = rowRefContext({ repoSlug: undefined, where: "https://github.com/owner/repo/pull/12" });

    expect(linkifyRowText({ context, text: "Unblock #12 today" })).toEqual([
      { kind: "text", text: "Unblock " },
      { kind: "link", text: "#12", url: "https://github.com/owner/repo/issues/12" },
      { kind: "text", text: " today" },
    ]);
  });

  it("leaves a bare reference alone when the row names no repository, rather than guessing one", () => {
    const repoSlug = repoSlugFor({ organisation: ACME_ORGANISATION, repoPath: "/srv/checkouts/repo" });
    const context = rowRefContext({ repoSlug, where: "slopweaver handover resume a-run" });

    expect(context.repos).toEqual([]);
    expect(linkifyRowText({ context, text: "PR #16497 is draft" })).toEqual([
      { kind: "text", text: "PR #16497 is draft" },
    ]);
  });

  it("resolves a board row's checkout PATH to its own repository, so two repos' rows never share one guess", () => {
    const slopweaverRow = rowRefContext({
      repoSlug: repoSlugFor({ organisation: ACME_ORGANISATION, repoPath: "/Users/someone/dev/personal/slopweaver" }),
      where: "slopweaver handover resume a",
    });
    const acmeAdminRow = rowRefContext({
      repoSlug: repoSlugFor({ organisation: ACME_ORGANISATION, repoPath: "/Users/someone/dev/acme-admin" }),
      where: "slopweaver handover resume b",
    });

    expect(linkifyRowText({ context: slopweaverRow, text: "#581 is green" })).toEqual([
      { kind: "link", text: "#581", url: `https://github.com/${FIXTURE_SELF_REPOSITORY}/issues/581` },
      { kind: "text", text: " is green" },
    ]);
    expect(linkifyRowText({ context: acmeAdminRow, text: "#581 is green" })).toEqual([
      { kind: "link", text: "#581", url: "https://github.com/acme/acme-admin/issues/581" },
      { kind: "text", text: " is green" },
    ]);
  });

  it("names a row's checkout against the organisation the list was projected with, never a constant", () => {
    const ranked = [entry({ doneWhen: "#581 is green", repo: "/Users/someone/dev/web" })];
    const project = ({ organisation }: { organisation: Organisation }): BriefingInline[] => [
      ...unwrap(projectYourList({ document: document({ ranked }), invocation: "s", organisation, top: 10 })).rows[0]!
        .headline,
    ];

    expect(project({ organisation: GLOBEX_ORGANISATION })).toEqual([
      { kind: "link", text: "#581", url: "https://github.com/globex/web/issues/581" },
      { kind: "text", text: " is green" },
    ]);
    expect(project({ organisation: ACME_ORGANISATION })).toEqual([{ kind: "text", text: "#581 is green" }]);
  });

  it("reads a row's `repo` only when it is an owner/repo slug", () => {
    expect(rowRefContext({ repoSlug: "owner/repo", where: "slopweaver handover resume a" }).repos).toEqual([
      { owner: "owner", repo: "repo" },
    ]);
  });

  it("takes the workspace and team key from a Linear permalink", () => {
    const context = rowRefContext({
      repoSlug: undefined,
      where: "https://linear.app/acme/issue/SUP-9507/bump-minimatch",
    });

    expect(context.linearWorkspaceSlug).toBe("acme");
    expect(context.linearTeamKeys).toEqual(["SUP"]);
    expect(linkifyRowText({ context, text: "Close SUP-9507" })).toEqual([
      { kind: "text", text: "Close " },
      { kind: "link", text: "SUP-9507", url: "https://linear.app/acme/issue/SUP-9507" },
    ]);
  });

  it("leaves text with no reference in it byte-identical", () => {
    expect(linkifyRowText({ context: { linearTeamKeys: [], repos: [] }, text: "Land the render verb." })).toEqual([
      { kind: "text", text: "Land the render verb." },
    ]);
  });
});

describe("a recorded question keeps the shape it was written in", () => {
  const none = { linearTeamKeys: [], repos: [] };

  it("folds each prose line as a paragraph and numbered steps as a real ordered list", () => {
    const text =
      "Should the fleet mail each receipt on? That is the only path to zero.\n\n" +
      "Your one-time steps, if you say yes\n" +
      "1. Personal Gmail, Settings, Add a forwarding address.\n" +
      "2. Filters, Create a new filter.\n" +
      "3. Repeat 1 and 2 in that account.";

    expect(recordedTextBlocks({ context: none, text })).toEqual([
      {
        content: [{ kind: "text", text: "Should the fleet mail each receipt on? That is the only path to zero." }],
        kind: "para",
      },
      { content: [{ kind: "text", text: "Your one-time steps, if you say yes" }], kind: "para" },
      {
        items: [
          [{ kind: "text", text: "Personal Gmail, Settings, Add a forwarding address." }],
          [{ kind: "text", text: "Filters, Create a new filter." }],
          [{ kind: "text", text: "Repeat 1 and 2 in that account." }],
        ],
        kind: "list",
        ordered: true,
      },
    ]);
  });

  it("folds dash lines as an unordered list, and a date opening a line stays prose", () => {
    const text = "Set up and proven\n- Inbound works.\n- 3 Oct Anthropic 340 AUD is attached.\n3 Oct was the last one.";

    expect(recordedTextBlocks({ context: none, text })).toEqual([
      { content: [{ kind: "text", text: "Set up and proven" }], kind: "para" },
      {
        items: [
          [{ kind: "text", text: "Inbound works." }],
          [{ kind: "text", text: "3 Oct Anthropic 340 AUD is attached." }],
        ],
        kind: "list",
        ordered: false,
      },
      { content: [{ kind: "text", text: "3 Oct was the last one." }], kind: "para" },
    ]);
  });

  it("never joins two lines, so one number on each of two prose lines stays one number per paragraph", () => {
    // Counterexample: joined, this was one paragraph carrying two inline numbers.
    expect(recordedTextBlocks({ context: none, text: "Do 1. alpha\nThen 2. beta" })).toEqual([
      { content: [{ kind: "text", text: "Do 1. alpha" }], kind: "para" },
      { content: [{ kind: "text", text: "Then 2. beta" }], kind: "para" },
    ]);
  });

  it("splits at a Unicode line or paragraph separator too, and at a carriage return", () => {
    // Counterexample: U+2028 was collapsed to a space rather than split.
    // And a vertical tab, the same weld.
    const [lineSeparator, paragraphSeparator] = [String.fromCodePoint(0x2028), String.fromCodePoint(0x2029)];
    const text = `Do 1. alpha${lineSeparator}Then 2. beta${paragraphSeparator}Next\vAfter\r\nLast`;

    expect(recordedTextBlocks({ context: none, text })).toEqual([
      { content: [{ kind: "text", text: "Do 1. alpha" }], kind: "para" },
      { content: [{ kind: "text", text: "Then 2. beta" }], kind: "para" },
      { content: [{ kind: "text", text: "Next" }], kind: "para" },
      { content: [{ kind: "text", text: "After" }], kind: "para" },
      { content: [{ kind: "text", text: "Last" }], kind: "para" },
    ]);
    expect(recordedTextBlocks({ context: none, text: "- a\r\n- b" })).toEqual([
      { items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]], kind: "list", ordered: false },
    ]);
  });

  it("closes a list at a prose line, indented or not, rather than welding it onto the last item", () => {
    expect(recordedTextBlocks({ context: none, text: "- Create a new filter.\n  Leave Skip the Inbox off." })).toEqual([
      { items: [[{ kind: "text", text: "Create a new filter." }]], kind: "list", ordered: false },
      { content: [{ kind: "text", text: "Leave Skip the Inbox off." }], kind: "para" },
    ]);
  });

  it("closes a list at a blank line, so two runs either side of one are two lists", () => {
    expect(recordedTextBlocks({ context: none, text: "- a\n\n- b" })).toEqual([
      { items: [[{ kind: "text", text: "a" }]], kind: "list", ordered: false },
      { items: [[{ kind: "text", text: "b" }]], kind: "list", ordered: false },
    ]);
  });

  it("reads `*` with `-` as one unordered run and `2)` with `1.` as one ordered run", () => {
    expect(recordedTextBlocks({ context: none, text: "- a\n* b" })).toEqual([
      { items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]], kind: "list", ordered: false },
    ]);
    expect(recordedTextBlocks({ context: none, text: "1. a\n2) b" })).toEqual([
      { items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]], kind: "list", ordered: true },
    ]);
  });

  it("keeps a numbered line verbatim wherever an ordered list would print a different number", () => {
    // Counterexample: `42.` became an `<ol>` item rendered as `1.`.
    // And `01.` read as 1 and rendered as `1.`.
    expect(recordedTextBlocks({ context: none, text: "42. Alpha\n01. Zero\n1. a\n3. c\n1. again" })).toEqual([
      { content: [{ kind: "text", text: "42. Alpha" }], kind: "para" },
      { content: [{ kind: "text", text: "01. Zero" }], kind: "para" },
      { items: [[{ kind: "text", text: "a" }]], kind: "list", ordered: true },
      { content: [{ kind: "text", text: "3. c" }], kind: "para" },
      { items: [[{ kind: "text", text: "again" }]], kind: "list", ordered: true },
    ]);
  });

  it("reads an indented marker as an item of its own kind", () => {
    expect(recordedTextBlocks({ context: none, text: "- a\n  1. b" })).toEqual([
      { items: [[{ kind: "text", text: "a" }]], kind: "list", ordered: false },
      { items: [[{ kind: "text", text: "b" }]], kind: "list", ordered: true },
    ]);
  });

  it("starts a new list where dash items give way to numbered ones", () => {
    const blocks = recordedTextBlocks({ context: none, text: "- a\n1. b" });

    expect(blocks.map((block) => (block.kind === "list" ? block.ordered : block.kind))).toEqual([false, true]);
  });

  it("links a reference inside a list item against the row's own repository", () => {
    const context = rowRefContext({ repoSlug: undefined, where: "https://github.com/owner/repo/pull/12" });

    expect(recordedTextBlocks({ context, text: "- Land #12 first" })).toEqual([
      {
        items: [
          [
            { kind: "text", text: "Land " },
            { kind: "link", text: "#12", url: "https://github.com/owner/repo/issues/12" },
            { kind: "text", text: " first" },
          ],
        ],
        kind: "list",
        ordered: false,
      },
    ]);
  });

  it("puts the whole question into the row's fold as those blocks, not one welded paragraph", () => {
    const doneWhen = "Should the fleet send these? It is the only path.\n\nSteps\n1. one\n2. two\n3. three";
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({ doneWhen })] }),
        invocation: "s",
        top: 10,
      }),
    );
    const blocks = list.rows[0]!.detail!.blocks;

    expect(blocks.map((block) => block.kind)).toEqual(["para", "para", "para", "para", "list", "para"]);
    expect(blocks[4]).toEqual({
      items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }], [{ kind: "text", text: "three" }]],
      kind: "list",
      ordered: true,
    });
  });

  it("renders a row the page check passes, where the welded paragraph it replaced is refused", () => {
    // The Airwallex receipts question's own step list: welded into one paragraph it carried three
    // inline numbers, and `briefing check` refused the whole page as a packed enumeration.
    const doneWhen =
      "Should the fleet mail each receipt to Airwallex without asking each time? It is the only path to zero.\n\n" +
      "Your one-time steps, if you say yes\n" +
      "1. Personal Gmail, Settings, Forwarding and POP/IMAP, Add a forwarding address.\n" +
      "2. Filters, Create a new filter, then Forward it to your work address.\n" +
      "3. If plan-three's receipts still land in its own Gmail, repeat 1 and 2 in that account.";
    const row = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({ doneWhen })] }),
        invocation: "s",
        top: 10,
      }),
    ).rows[0]!;
    const welded = {
      ...row,
      detail: {
        ...row.detail!,
        blocks: [{ content: [{ kind: "text" as const, text: doneWhen.replace(/\s+/g, " ") }], kind: "para" as const }],
      },
    };

    const html = renderYourRow({ row });

    expect(quotedFoldSchema.safeParse(row.detail).success).toBe(true);
    expect(html.match(/<ol\b/g)!.length).toBe(1);
    expect(html.match(/<li\b/g)!.length).toBe(3);
    expect(checkPageBudget({ html }).defects).toEqual([]);
    expect(checkPageBudget({ html: renderYourRow({ row: welded }) }).defects.map((one) => one.budget)).toEqual([
      "packed-enumeration",
    ]);
  });

  it("returns nothing for blank text", () => {
    expect(recordedTextBlocks({ context: none, text: " \n\n " })).toEqual([]);
  });
});

describe("what a row's fold opens with", () => {
  it("opens the fold with what the thing IS, when the run carries it", () => {
    const background = "The render verb turns a typed form into the page. It exists so a wall cannot be authored.";
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({ background })] }),
        invocation: "s",
        top: 10,
      }),
    );
    const first = list.rows[0]!.detail!.blocks[0]!;

    expect(first.kind).toBe("para");
    expect(list.rows[0]!.detail!.blocks.length).toBe(4);
    expect(first.kind === "para" ? first.content.map((run) => run.text).join("") : "").toBe(background);
  });

  it("projects a run written before that field existed, with the fold one block shorter", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({})] }),
        invocation: "s",
        top: 10,
      }),
    );

    expect(list.rows[0]!.detail!.blocks.length).toBe(3);
  });

  it("keeps the background out of the words the row puts above the fold", () => {
    const background = `The subject is ${"alpha ".repeat(60)}end.`;
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({ background })] }),
        invocation: "s",
        top: 10,
      }),
    );

    expect(list.rows[0]!.headline.map((run) => run.text).join("")).toBe("Land the render verb yourself.");
  });
});

describe("the owner's code-owner slice on a review ask", () => {
  const SLICE = {
    additions: 1,
    deletions: 1,
    omittedPaths: 0,
    ownedFiles: 1,
    shownPaths: ["apps/ops/datadog/notificationChannels.ts"],
    totalFiles: 30,
  };
  const sliced = ({ slice }: { slice: typeof SLICE }): unknown => {
    const one = entry({ source: "slack" }) as { item: Record<string, unknown> };
    return { ...one, item: { ...one.item, codeOwnerSlice: slice } };
  };

  it("carries the slice from the session-start row onto the owner's list, field for field", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [sliced({ slice: SLICE })] }),
        invocation: "s",
        top: 10,
      }),
    );
    expect(list.rows[0]!.codeOwnerSlice).toStrictEqual(SLICE);
  });

  it("leaves a row with no slice without one", () => {
    const list = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [entry({})] }),
        invocation: "s",
        top: 10,
      }),
    );
    expect(list.rows[0]!.codeOwnerSlice).toBe(undefined);
  });

  it("renders the slice directly under the headline, each path as code", () => {
    const row = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [sliced({ slice: SLICE })] }),
        invocation: "s",
        top: 10,
      }),
    ).rows[0]!;
    const html = renderYourRow({ row });
    expect(html).toContain(
      '</div><div class="bg">Yours as code owner, by login: 1 of 30 files, +1 -1 lines, in <code>apps/ops/datadog/notificationChannels.ts</code></div>',
    );
  });

  it("never reads a path with a hash-number segment as a bare pull-request reference", () => {
    const slice = { ...SLICE, shownPaths: ["docs/#123.md"] };
    const row = unwrap(
      projectYourList({
        organisation: ACME_ORGANISATION,
        document: document({ ranked: [sliced({ slice })] }),
        invocation: "s",
        top: 10,
      }),
    ).rows[0]!;
    const html = renderYourRow({ row });
    expect(html).toContain("<code>docs/#123.md</code>");
    expect(checkBareRefs({ html }).defects).toEqual([]);
  });
});
