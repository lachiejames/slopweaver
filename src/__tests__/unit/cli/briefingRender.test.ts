/**
 * `briefing render` end to end through its injected seams: argv in, exit code and written page out.
 *
 * No mocks and no disk — every seam is a plain function the test supplies, which is what lets the whole
 * verb be exercised rather than only its parser.
 */
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AutonomyAction } from "../../../autonomy/types.js";
import { plainText } from "../../../briefing/text.js";
import { parseBriefingRenderArgs } from "../../../cli/commands/briefing/core.js";
import { briefingCommandErrorLines } from "../../../cli/commands/briefing/errors.js";
import { refusedPagePath } from "../../../cli/commands/briefing/refusedPage.js";
import { productionBriefingRenderDeps } from "../../../cli/commands/briefing/renderRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { err, unwrap, unwrapErr } from "../../../lib/result.js";
import { readExactVoiceRules } from "../../../profileStore.js";
import { PublishedPagesReadErrors } from "../../../store/publishedPages/readErrors.js";
import type { SupervisorTickWindow } from "../../../supervisor/tickStore.js";
import { TICK_SOURCE_KINDS } from "../../../supervisor/tickTypes.js";
import { FORM, FORM_ON_A_PULL_REQUEST, run, SESSION_START, storeDownFor } from "../../briefingRenderHarness.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/**
 * A throwaway state home holding no proposal queue and none of the owner's speech — never the ambient one.
 *
 * `--owner-beliefs` reads durable state rather than a document a seam could supply, so this is the one flag
 * whose test needs a real directory. An EMPTY one is the state under test: a queue with nothing open is the
 * state the whole correction mechanism is trying to reach, and it must render no block at all.
 */
function emptyHome(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-briefing-render-"));
  homes.push(root);
  return root;
}

describe("briefing render", () => {
  it("parses --form, --out and --home", async () => {
    const args = unwrap(parseBriefingRenderArgs({ rest: ["--form", "-", "--out", "p.html", "--home", "/h"] }));

    expect(args.formSource).toBe("-");
    expect(args.out).toBe("p.html");
    expect(args.home).toBe("/h");
  });

  it("parses --nothing-stale as asking for the section, and its absence as not", async () => {
    expect(unwrap(parseBriefingRenderArgs({ rest: ["--form", "-", "--nothing-stale"] })).nothingStale).toBe(true);
    expect(unwrap(parseBriefingRenderArgs({ rest: ["--form", "-"] })).nothingStale).toBe(false);
  });

  it("refuses an invocation with no --form, and prints the usage line", async () => {
    const result = await run({ rest: [] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.refusalCode).toBe("FORM_FLAG_MISSING");
    expect(result.diagnostics).toEqual([
      "--form <json|-> is required (use `-` to read the form from stdin)",
      "usage: slopweaver briefing render --form <json|-> [--your-list <path|->] [--open-prs] [--open-artifacts <path|->] [--open-page-cards] [--freshness] [--nothing-stale] [--autonomy-ledger] [--owner-beliefs] [--hand-steps] [--knowledge-quiz --sweep <tick-id>] [--ticks <path|-> [--ticks-days <n>]] [--top <n>] [--out <html>] [--home <path>]",
    ]);
  });

  it("refuses a form that is not JSON, naming the parse failure rather than the usage", async () => {
    const result = await run({ raw: "{oops", rest: ["--form", "-"] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toContain("the form is not valid JSON:");
    expect(result.written).toEqual([]);
  });

  it("writes the page to --out and reports what the gate measured", async () => {
    const result = await run({ rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.refusalCode).toBe(undefined);
    expect(result.written.length).toBe(1);
    expect(result.written[0]!.path).toBe("/tmp/page.html");
    expect(result.written[0]!.html).toContain('<h2 id="react-now">react now</h2>');
    expect(result.diagnostics).toEqual([
      "briefing render: no list of yours, 1 react-now card(s) (1 team-facing, 0 yours), 0 artifact(s) directing you elsewhere, 0 recent block(s), 0 folded section(s)",
      "refreshed 2026-09-02T01:40:00.000Z · ready 2026-09-02T01:40:00.000Z",
      "the page passes `briefing check`; written to /tmp/page.html",
    ]);
    expect(result.out).toEqual([]);
  });

  it("refuses a CORRUPT profile.json before any projection or premise read, writing no page", async () => {
    const home = emptyHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const result = await run({
      rest: ["--form", "-", "--out", "/tmp/page.html", "--home", home],
      voiceRules: ({ home: at }) => readExactVoiceRules({ home: at }),
    });

    expect(result.exit).toBe(EXIT_ERROR);
    expect(result.written).toEqual([]);
    expect(result.out).toEqual([]);
    expect(result.premiseReads).toBe(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain(
      `the profile at ${join(home, "profile.json")} is there but cannot be trusted`,
    );
    expect(result.diagnostics[0]).toContain("nothing was rendered.");
  });

  it("renders against no rules for a home with no profile at all, as an install that configured none", async () => {
    const result = await run({
      rest: ["--form", "-", "--out", "/tmp/page.html", "--home", emptyHome()],
      voiceRules: ({ home: at }) => readExactVoiceRules({ home: at }),
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written).toHaveLength(1);
  });

  it("writes the page to stdout when no --out is given, keeping the summary on the diagnostic stream", async () => {
    const result = await run({ rest: ["--form", "-"] });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written).toEqual([]);
    expect(result.out.length).toBe(1);
    expect(result.out[0]!).toContain("<title>Fleet Briefing</title>");
    expect(result.diagnostics[2]!).toBe("the page passes `briefing check`; written to stdout");
  });

  it("refuses a card whose `what` is a wall, before any bytes exist", async () => {
    const wall = Array.from({ length: 61 }, () => "alpha").join(" ");
    const broken = {
      ...FORM,
      reactNow: {
        meFacing: [],
        teamFacing: [{ ...FORM.reactNow.teamFacing[0]!, what: [{ kind: "text", text: `${wall}. And one more.` }] }],
      },
    };
    const result = await run({ raw: JSON.stringify(broken), rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written).toEqual([]);
    expect(result.diagnostics).toEqual([
      "reactNow.teamFacing.0.what: what runs over the cap of 60 words above the fold. Cut it, or move the rest into the " +
        "card's `detail` fold.",
    ]);
  });

  it("refuses an option naming a label the card never defines, which only the gate over the page can see", async () => {
    const broken = {
      ...FORM,
      reactNow: {
        meFacing: [],
        teamFacing: [
          {
            ...FORM.reactNow.teamFacing[0]!,
            options: [{ letter: "A", text: "Adopt the Parallel Worker lane." }],
          },
        ],
      },
    };
    const result = await run({ raw: JSON.stringify(broken), rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.refusalCode).toBe("RENDER_CHECK_FAILED");
    expect(result.written.map((one) => one.path)).toEqual(["/tmp/page.refused.html"]);
    expect(result.written[0]!.html).toContain("Adopt the Parallel Worker lane.");
    expect(result.diagnostics[0]!).toBe("the rendered page does not pass `briefing check`, so it was not written:");
    expect(result.diagnostics[1]!).toContain('option A uses an undefined label: "Parallel Worker"');
    expect(result.diagnostics.at(-1)!).toBe(
      "the refused page is written to /tmp/page.refused.html — read it to see what was counted; nothing was " +
        "written to /tmp/page.html",
    );
  });

  it("writes the page a whole-page form rule refused beside --out, so the refusal can be read", async () => {
    const broken = {
      ...FORM,
      header: {
        ...FORM.header,
        lede: [...FORM.header.lede, { kind: "anchor", target: "nowhere-at-all", text: " see the rest" }],
      },
    };
    const result = await run({ raw: JSON.stringify(broken), rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.refusalCode).toBe("FORM_REJECTED");
    expect(result.written.map((one) => one.path)).toEqual(["/tmp/page.refused.html"]);
    expect(result.written[0]!.html).toContain('href="#nowhere-at-all"');
    expect(result.diagnostics).toEqual([
      "form: an anchor run points at a section this page does not carry, so it would render as a link that " +
        "scrolls nowhere. Give the section an `id`, or point the anchor at one that renders.",
      "the refused page is written to /tmp/page.refused.html — read it to see what was counted; nothing was " +
        "written to /tmp/page.html",
    ]);
  });

  it("writes no refused page to stdout, where a caller expects a publishable one, and says how to get it", async () => {
    const broken = {
      ...FORM,
      header: {
        ...FORM.header,
        lede: [...FORM.header.lede, { kind: "anchor", target: "nowhere-at-all", text: " see the rest" }],
      },
    };
    const result = await run({ raw: JSON.stringify(broken), rest: ["--form", "-"] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.out).toEqual([]);
    expect(result.written).toEqual([]);
    expect(result.diagnostics.at(-1)!).toBe(
      "re-run with --out <path> to have the refused page written beside it, to read what was counted",
    );
  });

  it("puts the refused page beside --out, never over it", () => {
    expect(refusedPagePath({ out: "/s/briefing-t670.html" })).toBe("/s/briefing-t670.refused.html");
    expect(refusedPagePath({ out: "/s/page" })).toBe("/s/page.refused.html");
    // An --out already named like a refused page still gets a DIFFERENT path, so the refusal never lands on it.
    expect(refusedPagePath({ out: "/s/page.refused.html" })).toBe("/s/page.refused.refused.html");
  });

  it("never reaches --out through a refused path hard-linked or symlinked to it", () => {
    const dir = emptyHome();
    const out = join(dir, "page.html");
    const linked = join(dir, "linked.html");
    writeFileSync(out, "<main>published</main>");
    linkSync(out, refusedPagePath({ out }));
    symlinkSync(out, refusedPagePath({ out: linked }));
    const { writePage } = productionBriefingRenderDeps();

    writePage({ html: "<main>refused</main>", path: refusedPagePath({ out }) });
    writePage({ html: "<main>refused twice</main>", path: refusedPagePath({ out: linked }) });

    expect(readFileSync(out, "utf8")).toBe("<main>published</main>");
    expect(readFileSync(refusedPagePath({ out }), "utf8")).toBe("<main>refused</main>");
    expect(readFileSync(refusedPagePath({ out: linked }), "utf8")).toBe("<main>refused twice</main>");
  });

  it("parses --your-list and --top", async () => {
    const args = unwrap(parseBriefingRenderArgs({ rest: ["--form", "-", "--your-list", "s.json", "--top", "5"] }));

    expect(args.yourListSource).toBe("s.json");
    expect(args.top).toBe(5);
  });

  it("refuses a --top past the cap on how many of the owner's rows the page may carry", async () => {
    const args = parseBriefingRenderArgs({ rest: ["--form", "-", "--top", "11"] });

    expect(briefingCommandErrorLines({ error: unwrapErr(args) })).toEqual([
      "--top takes a whole number between 1 and 10",
    ]);
  });

  it("projects the owner's list into the page from a session-start document", async () => {
    const result = await run({
      rest: ["--form", "-", "--your-list", "list.json", "--out", "/tmp/page.html", "--top", "1"],
      yourListDocument: JSON.stringify(SESSION_START),
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).toContain('<h2 id="your-list">your list</h2>');
    expect(result.written[0]!.html).toContain('<div class="q">1. Land the render verb yourself.</div>');
    expect(result.written[0]!.html).toContain('<p class="sub">1 more ranked rows are not shown here.</p>');
    expect(result.diagnostics[0]).toContain("1 row(s) of yours");
  });

  it("refuses the owner's list whole when no organisation is written, and reads none for a page without it", async () => {
    const absent = err(["no organisation is configured in the store — write it once with `slopweaver org set`"]);
    const withList = await run({
      organisation: absent,
      rest: ["--form", "-", "--your-list", "list.json", "--out", "/tmp/page.html"],
      yourListDocument: JSON.stringify(SESSION_START),
    });
    const withoutList = await run({ organisation: absent, rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect([withList.exit, withList.written, withList.diagnostics]).toEqual([
      EXIT_ERROR,
      [],
      [
        "refused: no organisation is configured in the store — write it once with `slopweaver org set`. nothing was rendered.",
      ],
    ]);
    expect([withoutList.exit, withoutList.written.length]).toEqual([EXIT_OK, 1]);
  });

  it("refuses a form that writes `yourList` itself, naming the flag that fills it", async () => {
    const result = await run({
      raw: JSON.stringify({ ...FORM, yourList: { notShown: 0, rows: [], source: "s" } }),
      rest: ["--form", "-"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics).toEqual([
      "the form writes `yourList` itself. That section is a projection of `slopweaver session-start`, never " +
        "composed — drop it from the form and pass `--your-list <path|->` instead.",
    ]);
    expect(result.written).toEqual([]);
  });

  it("refuses a form that writes `ownerBeliefs` itself, naming the flag that fills it", async () => {
    const result = await run({
      raw: JSON.stringify({ ...FORM, ownerBeliefs: { notShown: 0, rows: [] } }),
      rest: ["--form", "-"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics).toEqual([
      "the form writes `ownerBeliefs` itself. That block is a projection of the proposal queue, never " +
        "composed — a claim a form can retype is one the owner could be asked to mark without the fleet ever " +
        "having proposed it. Drop it from the form and pass `--owner-beliefs` instead.",
    ]);
    expect(result.written).toEqual([]);
  });

  it("renders no correction block against a home whose queue is empty, and still passes the gate", async () => {
    const result = await run({
      rest: ["--form", "-", "--home", emptyHome(), "--owner-beliefs", "--out", "page.html"],
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).not.toContain('id="owner-beliefs"');
    expect(result.diagnostics.join("\n")).toContain("the page passes `briefing check`");
  });

  it("refuses a --your-list document that is not a session-start run", async () => {
    const result = await run({
      rest: ["--form", "-", "--your-list", "list.json"],
      yourListDocument: JSON.stringify({ ranking: {} }),
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toBe("the document is not a `slopweaver session-start --json` run:");
    expect(result.written).toEqual([]);
  });

  it("refuses a --your-list document that is not JSON at all", async () => {
    const result = await run({ rest: ["--form", "-", "--your-list", "list.json"], yourListDocument: "{oops" });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toContain("the --your-list document is not valid JSON:");
  });

  it("writes nothing to --out when a card's pull request has already merged", async () => {
    const result = await run({
      premises: [{ identity: "acme/acme-admin#11141", queue: undefined, state: "MERGED" }],
      raw: JSON.stringify(FORM_ON_A_PULL_REQUEST),
      rest: ["--form", "-", "--out", "/page.html"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written.map((one) => one.path)).toEqual(["/page.refused.html"]);
    expect(result.diagnostics[1]).toBe(
      'card 1 ("Are you happy with the draft?"): stale premise — acme/acme-admin#11141 is MERGED on ' +
        "GitHub, so this card asks about work that is already settled. Drop the card, or re-render the page " +
        "from a fresh sweep.",
    );
  });

  it("writes the page when the same card's pull request is still open", async () => {
    const result = await run({
      premises: [{ identity: "acme/acme-admin#11141", queue: undefined, state: "OPEN" }],
      raw: JSON.stringify(FORM_ON_A_PULL_REQUEST),
      rest: ["--form", "-", "--out", "/page.html"],
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written.length).toBe(1);
  });

  it("writes nothing, and names the break-glass, when the live read fails", async () => {
    const result = await run({
      premiseReadFails: true,
      raw: JSON.stringify(FORM_ON_A_PULL_REQUEST),
      rest: ["--form", "-", "--out", "/page.html"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written).toEqual([]);
    expect(result.diagnostics).toEqual([
      "the rendered page's cards could not be checked against GitHub: the credential could not reach GitHub",
      "For one deliberate exception run slopweaver hatch open stale-cards " +
        '--reason "<why this one is a legitimate exception>", then re-run; the grant skips the live ' +
        "pull-request read entirely.",
    ]);
  });
});

describe("briefing render --open-prs", () => {
  const pullRequest = ({ number, standing }: { number: number; standing: Record<string, unknown> }): unknown => ({
    item: {
      doneWhen: `Ask a named reviewer in Slack to review acme/acme-admin#${String(number)} — nobody has been asked yet`,
      nativeId: `acme/acme-admin#${String(number)}`,
      source: "github",
      state: "send-ask",
      title: "A change",
      whenIso: "2026-09-01T06:54:51.000Z",
      where: `https://github.com/acme/acme-admin/pull/${String(number)}`,
      who: "your own pull request",
    },
    ...(standing["kind"] === "in-flight" ? { reason: "in flight, session pr-16366 — it opened on this branch" } : {}),
    score: 6,
    standing,
    trace: { verdict: "rank" },
    why: "one reply finishes it",
  });
  const document = JSON.stringify({
    nowIso: "2026-09-02T01:06:56.791Z",
    ranking: {
      dropped: [pullRequest({ number: 16366, standing: { joinedBy: "branch", kind: "in-flight", slug: "pr-16366" } })],
      ranked: [
        pullRequest({
          number: 16358,
          standing: { atIso: "2026-09-01T12:10:00.000Z", kind: "ruled", outcome: "rejected" },
        }),
        pullRequest({ number: 16384, standing: { kind: "untouched" } }),
      ],
    },
  });

  it("cards only the untouched pull request and names each one it held back in the diagnostics", async () => {
    const result = await run({
      // The carded pull request needs a live premise like any other; a projected card is checked by the
      // same gate as a composed one.
      premises: [{ identity: "acme/acme-admin#16384", queue: undefined, state: "OPEN" }],
      rest: ["--form", "-", "--your-list", "list.json", "--open-prs", "--out", "/tmp/page.html"],
      yourListDocument: document,
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.diagnostics).toContain(
      "--open-prs held back 2 pull request(s) the run says are already settled or not the owner's move:",
    );
    expect(result.diagnostics).toContain("  acme/acme-admin#16358: ruled 2026-09-01 (rejected)");
    expect(result.diagnostics).toContain(
      "  acme/acme-admin#16366: in flight, session pr-16366 — it opened on this branch",
    );
    // A card spells its pull request plainly (`acme-admin 16384`); the list section above the cards still shows
    // the ruled row, demoted, so the reference itself is legitimately on the page — only the CARD must not be.
    expect(result.written[0]!.html).toContain("acme-admin 16384?");
    expect(result.written[0]!.html).not.toContain("acme-admin 16358?");
    expect(result.written[0]!.html).not.toContain("acme-admin 16366?");
  });
});

describe("briefing render --open-artifacts", () => {
  const PAGE_A = "https://claude.ai/code/artifact/aaaaaaaa-0000-0000-0000-000000000000";
  const PAGE_B = "https://claude.ai/code/artifact/bbbbbbbb-0000-0000-0000-000000000000";

  /** The sweep's document: two pages open on the owner. */
  const OPEN_PAGES = JSON.stringify([
    { ask: "Pick A or B on the scope split.", label: "Scope split", landedIso: "2026-09-06T04:00:00Z", url: PAGE_A },
    { ask: "Confirm the reviewer list.", label: "Reviewer list", landedIso: "2026-09-06T05:00:00Z", url: PAGE_B },
  ]);

  /** One lock-in row, as `session-start lock-in --item <url>` writes it. */
  function lockIn({ identity, outcome, note }: { identity: string; outcome: string; note?: string }): string {
    return JSON.stringify({
      againstWhenIso: "2026-09-06T05:30:00Z",
      identity,
      outcome,
      proposed: "react to it",
      schemaVersion: 1,
      tsIso: "2026-09-06T05:20:00Z",
      verb: "note",
      ...(note === undefined ? {} : { note }),
    });
  }

  it("ranks and marks every open page from the document and the ledger", async () => {
    const result = await run({
      lockInLedger: lockIn({ identity: PAGE_B, outcome: "edited" }),
      openArtifactsDocument: OPEN_PAGES,
      rest: ["--form", "-", "--open-artifacts", "open-pages.json", "--out", "/tmp/page.html"],
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).toContain('<h3 id="react-now-artifacts">every open page, best first</h3>');
    expect(result.written[0]!.html).toContain(`1. <a href="${PAGE_A}">Scope split</a>`);
    expect(result.written[0]!.html).toContain(`2. <a href="${PAGE_B}">Reviewer list</a>`);
    expect(result.written[0]!.html).toContain('<span class="bg">partly ruled 2026-09-06 (edited)</span>');
  });

  it("marks a page superseded when a closing ruling's note names the page that replaced it", async () => {
    const result = await run({
      lockInLedger: lockIn({ identity: PAGE_A, note: `replaced by ${PAGE_B}`, outcome: "rejected" }),
      openArtifactsDocument: OPEN_PAGES,
      rest: ["--form", "-", "--open-artifacts", "open-pages.json", "--out", "/tmp/page.html"],
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).toContain(`superseded by <a href="${PAGE_B}">Reviewer list</a>`);
  });

  it("marks every page valid when the ledger is empty, rather than refusing a home the owner has never walked", async () => {
    const result = await run({
      openArtifactsDocument: OPEN_PAGES,
      rest: ["--form", "-", "--open-artifacts", "open-pages.json", "--out", "/tmp/page.html"],
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html.match(/still valid/g)!.length).toBe(2);
  });

  it("refuses a form that writes `reactNow.openArtifacts` itself, naming the flag that fills it", async () => {
    const composed = { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts: [] } };
    const result = await run({ raw: JSON.stringify(composed), rest: ["--form", "-"] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toContain("the form writes `reactNow.openArtifacts` itself");
    expect(result.diagnostics[0]).toContain("--open-artifacts <path|->");
  });

  it("refuses an open-artifact document that is not JSON at all", async () => {
    const result = await run({
      openArtifactsDocument: "not json",
      rest: ["--form", "-", "--open-artifacts", "open-pages.json"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toContain("the --open-artifacts document is not valid JSON");
  });

  it("refuses an entry missing a fact only the sweep holds, naming which entry", async () => {
    const result = await run({
      openArtifactsDocument: JSON.stringify([{ label: "Scope split", url: PAGE_A }]),
      rest: ["--form", "-", "--open-artifacts", "open-pages.json"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toBe("--open-artifacts entry 0 needs a label, url, ask and landedIso, all strings");
  });

  it("reports the index BY MARK, which is the arithmetic the owner asked about", async () => {
    const result = await run({
      lockInLedger: [
        lockIn({ identity: PAGE_B, outcome: "edited" }),
        lockIn({ identity: PAGE_A, note: `replaced by ${PAGE_B}`, outcome: "rejected" }),
      ].join("\n"),
      openArtifactsDocument: OPEN_PAGES,
      rest: ["--form", "-", "--open-artifacts", "open-pages.json", "--out", "/tmp/page.html"],
    });

    expect(result.diagnostics).toContain("2 open page(s) indexed: 0 still valid, 1 partly ruled, 1 superseded");
  });

  it("says nothing about an index the page does not carry", async () => {
    const result = await run({ rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect(result.diagnostics.some((line) => line.includes("open page(s) indexed"))).toBe(false);
  });

  it("renders no index at all when the run names no document", async () => {
    const result = await run({ rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).not.toContain("react-now-artifacts");
  });
});

describe("briefing render --autonomy-ledger", () => {
  /** One folded act, in the shape `../../../autonomy/query.ts` hands the edge. */
  const ACT: AutonomyAction = {
    action: {
      actionId: "16644-enqueue",
      bySession: "workspace:123 act-on-open-acme-admin-prs (fd64a339)",
      doneIso: "2026-09-12T02:06:09Z",
      kind: "press-merge-when-ready",
      subject: "https://github.com/acme/acme-admin/pull/16644",
      why: "CI green, mergeable, and no code-owner request outstanding",
      witness: "slopweaver github enqueue --pr 16644 -> queued at position 1",
    },
    classSteer: undefined,
    latestSteer: undefined,
    patternSteer: undefined,
  };

  // The case refusing `--autonomy-ledger` beside `--autonomy-ledger-file` went with the second flag: the ledger is
  // the store's, so there is no second register for the page to be about.
  it("refuses two inputs both reading stdin, before anything is read", () => {
    const errors = briefingCommandErrorLines({
      error: unwrapErr(parseBriefingRenderArgs({ rest: ["--form", "x", "--your-list", "-", "--open-artifacts", "-"] })),
    });
    expect(errors[0]).toContain("there is only one stdin");
  });

  it("renders the section from the store's ledger", async () => {
    const result = await run({
      autonomyActions: [ACT],
      rest: ["--form", "-", "--autonomy-ledger", "--out", "/tmp/page.html"],
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).toContain('id="autonomy-ledger"');
    expect(result.written[0]!.html).toContain("acme/acme-admin#16644");
  });

  it("renders no section at all when the run asks for no register", async () => {
    const result = await run({ rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).not.toContain('id="autonomy-ledger"');
  });

  it("renders an empty section rather than a false one when the ledger holds nothing", async () => {
    const result = await run({
      autonomyActions: [],
      rest: ["--form", "-", "--autonomy-ledger", "--out", "/tmp/page.html"],
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).not.toContain('id="autonomy-ledger"');
  });

  it("REFUSES rather than rendering a page that would claim the fleet did nothing", async () => {
    const result = await run({ rest: ["--form", "-", "--autonomy-ledger", "--out", "/tmp/page.html"] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written.length).toBe(0);
  });

  it("refuses a form that writes the section itself", async () => {
    const composed = { ...FORM, autonomy: { notShown: 0, rows: [] } };
    const result = await run({ raw: JSON.stringify(composed), rest: ["--form", "-", "--out", "/tmp/page.html"] });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toContain("the form writes `autonomy` itself");
    expect(result.written.length).toBe(0);
  });
});

describe("briefing render --ticks", () => {
  /** Every source `unavailable`, so a fixture row carries only what its case is about. */
  function allUnavailable({ observedAtIso }: { observedAtIso: string }): Record<string, unknown> {
    const sources: Record<string, unknown> = {};
    for (const kind of TICK_SOURCE_KINDS) {
      sources[kind] = {
        diagnostic: `the ${kind} step did not run`,
        observedAtIso,
        status: "unavailable",
        witness: { command: `slopweaver ${kind}`, exitCode: null },
      };
    }
    return sources;
  }

  /**
   * The same form with all three narrative fields dropped, which is what a `--ticks` run passes.
   *
   * A form under `--ticks` OMITS them rather than sending empty ones: they are the run's to fill, and an
   * empty array is still the form having written the field. The refusal one test below is the mechanism.
   */
  function formWithoutNarrative(): string {
    const { recent: _recent, history: _history, ...rest } = FORM;
    return JSON.stringify(rest);
  }

  /** A one-row window whose single recorded turn says exactly `said`. */
  function windowSaying({ said }: { said: string }): SupervisorTickWindow {
    const finalisedIso = "2026-09-01T02:00:00.000Z";
    const row = {
      actions: [],
      finalisedIso,
      handoff: "handoff-9012",
      judgements: [],
      ownerTurns: {
        coverage: { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
        sinceIso: null,
        status: "read",
        turns: [
          {
            inGrace: false,
            instantIso: "2026-09-01T01:00:00.000Z",
            lockIn: null,
            lockInLink: "none",
            pointer: "transcript:s1#9",
            sessionId: "s1",
            source: "transcript",
            text: said,
            transcriptLineNumber: 9,
            turnUuid: "uuid-1",
            witness: null,
          },
        ],
      },
      schemaVersion: 1,
      sources: allUnavailable({ observedAtIso: finalisedIso }),
      startedIso: "2026-09-01T01:40:00.000Z",
      stats: { judgementCount: 0, judgementUtf8Bytes: 0, structuredUtf8Bytes: 0 },
      tickId: "t-1",
      workspace: "ws:598",
    } as unknown as SupervisorTickWindow["newest"];
    return { currentDay: [row], newest: row, olderDaysOmitted: 0, priorDays: [], ticksInLedger: 1 };
  }

  it("parses --ticks and --ticks-days", async () => {
    const args = unwrap(
      parseBriefingRenderArgs({ rest: ["--form", "{}", "--ticks", "ledger.jsonl", "--ticks-days", "2"] }),
    );

    expect(args.ticksSource).toBe("ledger.jsonl");
    expect(args.ticksPriorDays).toBe(2);
  });

  it("refuses --ticks-days without --ticks, since it bounds nothing on its own", () => {
    expect(
      briefingCommandErrorLines({
        error: unwrapErr(parseBriefingRenderArgs({ rest: ["--form", "{}", "--ticks-days", "2"] })),
      }),
    ).toEqual([
      "--ticks-days bounds how far back the projected narrative reaches, so it means nothing without --ticks <path|->",
    ]);
  });

  it("refuses a --ticks-days outside what the ledger reader will keep", () => {
    expect(
      briefingCommandErrorLines({
        error: unwrapErr(
          parseBriefingRenderArgs({ rest: ["--form", "{}", "--ticks", "l.jsonl", "--ticks-days", "9"] }),
        ),
      })[0],
    ).toContain("--ticks-days takes a whole number between 0 and 4");
  });

  it("refuses two inputs both given `-`, naming every one of them", () => {
    expect(
      briefingCommandErrorLines({
        error: unwrapErr(parseBriefingRenderArgs({ rest: ["--form", "-", "--ticks", "-"] })),
      }),
    ).toEqual([
      "2 inputs were given `-` (--form, --ticks), and there is only one stdin — whichever read runs second " +
        "would see an empty document and the page would silently omit that section. Pass a path, or the " +
        "form's JSON itself, for all but one.",
    ]);
  });

  it("catches the collision the old pairwise check could not see", async () => {
    const refusal = briefingCommandErrorLines({
      error: unwrapErr(
        parseBriefingRenderArgs({
          rest: ["--form", "-", "--your-list", "-", "--open-artifacts", "-", "--ticks", "-"],
        }),
      ),
    });

    expect(refusal[0]).toContain("4 inputs were given `-` (--form, --your-list, --open-artifacts, --ticks)");
  });

  it("leaves the authored path exactly as it was when no --ticks is passed", async () => {
    const authored = { ...FORM, earlierToday: { notes: [{ headline: [{ kind: "text", text: "a" }] }], summary: "b" } };
    const recorded = await run({ raw: JSON.stringify(authored), rest: ["--form", "-", "--out", "p.html"] });

    expect(recorded.exit).toBe(EXIT_OK);
    expect(recorded.written[0]!.html).toContain("<summary>b</summary>");
  });

  it("refuses a form that authored a section --ticks projects, naming all three", async () => {
    const authored = {
      ...FORM,
      earlierToday: { notes: [{ headline: [{ kind: "text", text: "a" }] }], summary: "b" },
      history: [{ notes: [{ headline: [{ kind: "text", text: "c" }] }], summary: "d" }],
    };
    const recorded = await run({
      raw: JSON.stringify(authored),
      rest: ["--form", "-", "--ticks", "l.jsonl", "--out", "p.html"],
      tickWindow: windowSaying({ said: "anything" }),
    });

    expect(recorded.written).toEqual([]);
    expect(recorded.diagnostics[0]).toContain("the form writes `recent`, `earlierToday`, `history` itself.");
  });

  it("writes nothing at all when the ledger could not be read", async () => {
    const recorded = await run({ rest: ["--form", "-", "--ticks", "gone.jsonl", "--out", "p.html"] });

    expect(recorded.written).toEqual([]);
    expect(recorded.diagnostics[0]).toBe("gone.jsonl: no tick ledger in this test");
  });

  it("puts the owner's words on the page byte for byte, escaped rather than rewritten", async () => {
    const said = "leave <this> & that exactly as I typed it";
    const recorded = await run({
      raw: formWithoutNarrative(),
      rest: ["--form", "-", "--ticks", "l.jsonl", "--out", "p.html"],
      tickWindow: windowSaying({ said }),
    });

    expect(recorded.exit).toBe(EXIT_OK);
    expect(recorded.written.length).toBe(1);
    expect(recorded.written[0]!.html).toContain("leave &lt;this&gt; &amp; that exactly as I typed it");
    expect(plainText({ html: recorded.written[0]!.html })).toContain(said);
  });

  it("says what it accounted for, so a silent success cannot hide a dropped turn", async () => {
    const recorded = await run({
      raw: formWithoutNarrative(),
      rest: ["--form", "-", "--ticks", "l.jsonl", "--out", "p.html"],
      tickWindow: windowSaying({ said: "anything" }),
    });

    expect(recorded.diagnostics).toContain(
      "briefing render --ticks: projected 1 of 1 recorded pass(es); 0 older row(s) and 0 older day(s) are outside the window",
    );
    expect(recorded.diagnostics).toContain(
      "1 recorded thing(s) accounted for: 1 on the page, 0 repeat observation(s) pointing at one that is",
    );
  });

  it("dates the page from the recorded pass rather than from its own clock", async () => {
    const recorded = await run({
      raw: formWithoutNarrative(),
      rest: ["--form", "-", "--ticks", "l.jsonl", "--out", "p.html"],
      tickWindow: windowSaying({ said: "anything" }),
    });

    expect(recorded.diagnostics).toContain("refreshed 2026-09-01T02:00:00.000Z · ready 2026-09-02T01:40:00.000Z");
  });
});

describe("the quoted lane is the projection's, not a composer's", () => {
  it("refuses a form that marked its own note quoted when nothing was projected", async () => {
    const authored = {
      ...FORM,
      earlierToday: {
        notes: [
          {
            detail: {
              blocks: [
                { content: [{ kind: "text", text: "they wrote 1. this 2. that 3. and the other" }], kind: "para" },
              ],
              summary: "the rest",
            },
            headline: [{ kind: "text", text: "what happened" }],
            lane: "quoted",
          },
        ],
        summary: "earlier today",
      },
    };

    const recorded = await run({ raw: JSON.stringify(authored), rest: ["--form", "-", "--out", "p.html"] });

    expect(recorded.written).toEqual([]);
    expect(recorded.diagnostics[0]).toContain("the form writes `earlierToday` itself.");
    expect(recorded.diagnostics[0]).toContain('One of its notes is marked `lane: "quoted"`');
  });

  it("still renders an ordinary authored section, so the refusal is about the lane and not the section", async () => {
    const authored = {
      ...FORM,
      earlierToday: { notes: [{ headline: [{ kind: "text", text: "what happened" }] }], summary: "earlier today" },
    };

    const recorded = await run({ raw: JSON.stringify(authored), rest: ["--form", "-", "--out", "p.html"] });

    expect(recorded.exit).toBe(EXIT_OK);
    expect(recorded.written.length).toBe(1);
  });
});

describe("briefing render refuses a snapshot past the ceiling", () => {
  /**
   * The harness clock is fixed by this file, so this document was taken fifteen hours and three
   * minutes before the render — the incident's own age, moved onto this file's clock.
   */
  const FIFTEEN_HOURS_STALE = JSON.stringify({ ...SESSION_START, nowIso: "2026-09-01T10:37:00.000Z" });

  /** One open page, with the four fields the ranked band decodes. */
  const OPEN_PAGE = JSON.stringify([
    {
      ask: "Your word on this one.",
      label: "Vanta reconnect",
      landedIso: "2026-09-01T04:00:00Z",
      url: "file:///no/such/home/pages/vanta-reconnect/index.html",
    },
  ]);

  it("refuses a --your-list document fifteen hours old, and writes no page", async () => {
    const result = await run({
      rest: ["--form", "-", "--your-list", "run.json", "--out", "/tmp/page.html"],
      yourListDocument: FIFTEEN_HOURS_STALE,
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written).toEqual([]);
    expect(result.diagnostics[0]).toContain("--your-list run.json was taken 2026-09-01T10:37:00.000Z");
    expect(result.diagnostics[0]).toContain("your list 15h 3m old");
    expect(result.diagnostics[2]).toBe(
      "To override use the designated escape hatch slopweaver hatch open stale-snapshot " +
        '--reason "<why this one is a legitimate exception>", then re-run slopweaver briefing render.',
    );
  });

  it("refuses an --open-artifacts file nobody has written for a day, naming that half instead", async () => {
    const result = await run({
      openArtifactsDocument: OPEN_PAGE,
      openArtifactsWrittenIso: "2026-09-01T01:40:00.000Z",
      rest: ["--form", "-", "--open-artifacts", "open-pages.json", "--out", "/tmp/page.html"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written).toEqual([]);
    expect(result.diagnostics[0]).toContain("--open-artifacts open-pages.json was taken 2026-09-01T01:40:00.000Z");
    expect(result.diagnostics[0]).toContain("open pages 24h 0m old");
  });

  it("names BOTH halves in one refusal when both are past the ceiling", async () => {
    const result = await run({
      openArtifactsDocument: OPEN_PAGE,
      openArtifactsWrittenIso: "2026-09-01T01:40:00.000Z",
      rest: ["--form", "-", "--your-list", "run.json", "--open-artifacts", "open-pages.json"],
      yourListDocument: FIFTEEN_HOURS_STALE,
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toContain("your list 15h 3m old");
    expect(result.diagnostics[0]).toContain("open pages 24h 0m old");
  });

  it("publishes an --open-artifacts document read off stdin, which carries no instant to judge", async () => {
    const result = await run({
      openArtifactsDocument: OPEN_PAGE,
      openArtifactsWrittenIso: undefined,
      // The form goes in as inline JSON: the verb refuses two inputs spelled `-`, and there is one stdin.
      rest: ["--form", JSON.stringify(FORM), "--open-artifacts", "-", "--out", "/tmp/page.html"],
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written.length).toBe(1);
  });

  it("publishes a fresh snapshot with no age clause on the page at all", async () => {
    const result = await run({
      rest: ["--form", "-", "--your-list", "run.json", "--out", "/tmp/page.html"],
      yourListDocument: JSON.stringify(SESSION_START),
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).not.toContain('<span class="stale">');
  });

  it("publishes under the hatch and STAMPS the age above the fold, in the eyebrow, in red", async () => {
    const result = await run({
      snapshotHatchOpen: true,
      rest: ["--form", "-", "--your-list", "run.json", "--out", "/tmp/page.html"],
      yourListDocument: FIFTEEN_HOURS_STALE,
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).toContain('<span class="stale"> · your list 15h 3m old</span>');
    // The red is the stylesheet's, and the clause is the only thing that wears it.
    expect(result.written[0]!.html).toContain(".eyebrow .stale { color: var(--bad); font-weight: 700; }");
    // The clause sits AFTER the freshness half, never between the two instants the shape gate reads back.
    expect(result.diagnostics.join("\n")).toContain("the page passes `briefing check`");
  });

  it("under the hatch, dates the page and its cards from the render rather than from the day-old list", async () => {
    // Read ten minutes before the harness clock, and fifteen hours AFTER the list's run: the card of the
    // incident, refused as dated in the future while the eyebrow took the list's instant as its own.
    const card = {
      ...FORM.reactNow.teamFacing[0]!,
      premise: { kind: "composed", readIso: "2026-09-02T01:30:00.000Z" },
    };
    const result = await run({
      raw: JSON.stringify({ ...FORM, reactNow: { ...FORM.reactNow, teamFacing: [card] } }),
      snapshotHatchOpen: true,
      rest: ["--form", "-", "--your-list", "run.json", "--out", "/tmp/page.html"],
      yourListDocument: FIFTEEN_HOURS_STALE,
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.diagnostics).toContain("refreshed 2026-09-02T01:40:00.000Z · ready 2026-09-02T01:40:00.000Z");
    expect(result.written[0]!.html).toContain("read 15 hours 3 minutes before this page was rendered");
    expect(result.written[0]!.html).toContain('<span class="stale"> · your list 15h 3m old</span>');
  });

  it("still refuses a card whose premise is after the render itself", async () => {
    const card = {
      ...FORM.reactNow.teamFacing[0]!,
      premise: { kind: "composed", readIso: "2026-09-02T01:50:00.000Z" },
    };
    const result = await run({
      raw: JSON.stringify({ ...FORM, reactNow: { ...FORM.reactNow, teamFacing: [card] } }),
      rest: ["--form", "-", "--your-list", "run.json", "--out", "/tmp/page.html"],
      yourListDocument: JSON.stringify(SESSION_START),
    });

    expect(result.exit).not.toBe(EXIT_OK);
    expect(result.written.map((one) => one.path)).toEqual(["/tmp/page.refused.html"]);
    expect(result.diagnostics.join("\n")).toContain('"2026-09-02T01:50:00.000Z" is in the future');
  });

  it("refuses a form that writes `staleSnapshots` itself, so no composer can hide a stale half", async () => {
    const result = await run({
      raw: JSON.stringify({ ...FORM, header: { ...FORM.header, staleSnapshots: [] } }),
      rest: ["--form", "-"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toContain("the form writes staleSnapshots itself.");
    expect(result.written).toEqual([]);
  });
});

describe("briefing render --open-page-cards", () => {
  // The default home this harness injects, so the local-copy rule (`briefing/localCopySubject.ts`) accepts
  // these addresses. That rule is a SHAPE test and stats nothing, so no page has to exist on disk.
  const VANTA = "file:///no/such/home/pages/vanta-reconnect/index.html";
  const CALENDAR = "file:///no/such/home/pages/calendar-login/index.html";

  /** One `--open-artifacts` entry carrying the six fields a card is projected from. */
  function entry({ url, label }: { url: string; label: string }): Record<string, unknown> {
    return {
      ask: "Your word on this one.",
      ifSilent: "The page stands and asks you again tomorrow.",
      label,
      landedIso: "2026-09-01T04:00:00Z",
      lean: "A, because the tab is already open.",
      options: [
        { letter: "A", text: "Do it on Monday, with the tabs opened for you." },
        { letter: "B", text: "Leave it until the audit asks again." },
      ],
      question: "Does this one go to your Monday queue?",
      url,
      what: "The connection lapsed on Friday. Nothing has read it since. One sign-in restores it.",
      whyYou: "Only you hold the account the sign-in runs under.",
    };
  }

  /** A composed me-facing card whose subject is the page the document also carries. */
  function composedCard({ url }: { url: string }): Record<string, unknown> {
    return {
      ifSilent: [{ kind: "text", text: "The connection stays lapsed." }],
      lean: [{ kind: "text", text: "A." }],
      options: [
        { letter: "A", text: "Do it on Monday, with the tabs opened for you." },
        { letter: "B", text: "Leave it until the audit asks again." },
      ],
      premise: { kind: "composed", readIso: "2026-08-30T00:00:00.000Z" },
      question: "Does the reconnect go to your Monday queue?",
      subject: { text: "the reconnect page", url },
      what: [{ kind: "text", text: "The connection lapsed on Friday. One sign-in restores it." }],
      whyYou: [{ kind: "text", text: "Only you hold the account it runs under." }],
    };
  }

  /** The same form with a composed me-facing card on the page named. */
  function formCarding({ url }: { url: string }): string {
    return JSON.stringify({ ...FORM, reactNow: { ...FORM.reactNow, meFacing: [composedCard({ url })] } });
  }

  const REST = ["--form", "-", "--open-artifacts", "open-pages.json", "--open-page-cards", "--out", "/tmp/page.html"];

  it("asks once about a page the form already cards, and says which page it folded", async () => {
    const result = await run({
      openArtifactsDocument: JSON.stringify([entry({ label: "Vanta reconnect", url: VANTA })]),
      raw: formCarding({ url: VANTA }),
      rest: REST,
    });

    expect(result.exit).toBe(EXIT_OK);
    // The composed card's question survives; the projected card's does not, so the page asks once.
    expect(result.written[0]!.html).toContain("Does the reconnect go to your Monday queue?");
    expect(result.written[0]!.html).not.toContain("Does this one go to your Monday queue?");
    expect(result.diagnostics).toContain(
      "--open-page-cards folded 1 page(s) the react-now block already cards, so each reaches the owner once:",
    );
    expect(result.diagnostics).toContain(`  Vanta reconnect: ${VANTA}`);
    // The BAND keeps the row: only the second card went, never the page's place in the ranked index.
    expect(result.written[0]!.html).toContain(`<a href="${VANTA}">Vanta reconnect</a>`);
  });

  it("still cards a page nothing on the block names, so the fold is not a blanket drop", async () => {
    const result = await run({
      openArtifactsDocument: JSON.stringify([
        entry({ label: "Vanta reconnect", url: VANTA }),
        entry({ label: "Calendar login", url: CALENDAR }),
      ]),
      raw: formCarding({ url: VANTA }),
      rest: REST,
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.written[0]!.html).toContain("Does this one go to your Monday queue?");
    expect(result.diagnostics).toContain(`  Vanta reconnect: ${VANTA}`);
    // The one line naming the calendar page is its typed-pair notice, never a fold line. The folded Vanta page
    // gets its fold line AND its typed notice: with no marks, nothing checks the composed card that won, so the
    // notice is the one place the unmarked page still shows.
    expect(result.diagnostics.filter((line) => line.includes(CALENDAR))).toEqual([
      `  Calendar login: its published bytes could not be read (${PublishedPagesReadErrors.neverFrozen({ pageKey: CALENDAR }).message}) (${CALENDAR})`,
    ]);
    expect(result.diagnostics.filter((line) => line.startsWith("  Vanta reconnect:"))).toEqual([
      `  Vanta reconnect: ${VANTA}`,
      `  Vanta reconnect: its published bytes could not be read (${PublishedPagesReadErrors.neverFrozen({ pageKey: VANTA }).message}) (${VANTA})`,
    ]);
  });

  it("refuses a composed card that wins the fold while typing a lean its page's marks do not say", async () => {
    const { question: _question, lean: _lean, ...untyped } = entry({ label: "Vanta reconnect", url: VANTA });
    const marked =
      '<p data-card="question">Does the reconnect go to your Monday queue?</p><p data-card="lean">B, it can wait.</p>';
    const result = await run({
      frozenPages: { [VANTA]: marked },
      openArtifactsDocument: JSON.stringify([untyped]),
      raw: formCarding({ url: VANTA }),
      rest: REST,
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written).toEqual([]);
    expect(result.diagnostics).toContain(
      'the react-now card for "the reconnect page" types a lean its page does not say; the page marks question ' +
        '"Does the reconnect go to your Monday queue?" and lean "B, it can wait.". Make the card say what the page ' +
        `marks, or drop it and card the page with an open-pages entry, which reads both from the page. (${VANTA})`,
    );
  });

  it("refuses the same drift on a page NO document lists, with no --open-artifacts at all", async () => {
    const marked =
      '<p data-card="question">Does the reconnect go to your Monday queue?</p><p data-card="lean">B, it can wait.</p>';
    const result = await run({
      frozenPages: { [VANTA]: marked },
      raw: formCarding({ url: VANTA }),
      rest: ["--form", "-", "--out", "/tmp/page.html"],
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written).toEqual([]);
    expect(result.diagnostics.filter((line) => line.startsWith("the react-now card for"))).toEqual([
      'the react-now card for "the reconnect page" types a lean its page does not say; the page marks question ' +
        '"Does the reconnect go to your Monday queue?" and lean "B, it can wait.". Make the card say what the page ' +
        `marks, or drop it and card the page with an open-pages entry, which reads both from the page. (${VANTA})`,
    ]);
  });

  it("lets a composed card win the fold when it says what its page's marks say", async () => {
    const { question: _question, lean: _lean, ...untyped } = entry({ label: "Vanta reconnect", url: VANTA });
    const marked = '<p data-card="question">Does the reconnect go to your Monday queue?</p><p data-card="lean">A.</p>';
    const result = await run({
      frozenPages: { [VANTA]: marked },
      openArtifactsDocument: JSON.stringify([untyped]),
      raw: formCarding({ url: VANTA }),
      rest: REST,
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.diagnostics).toContain(`  Vanta reconnect: ${VANTA}`);
  });

  it("says nothing about a fold on a sweep where every page is carded once", async () => {
    const result = await run({
      openArtifactsDocument: JSON.stringify([entry({ label: "Calendar login", url: CALENDAR })]),
      raw: formCarding({ url: VANTA }),
      rest: REST,
    });

    expect(result.exit).toBe(EXIT_OK);
    expect(result.diagnostics.some((line) => line.startsWith("--open-page-cards folded"))).toBe(false);
  });

  it("refuses to card open pages when the store cannot give one, naming it, rather than typing every page", async () => {
    const result = await run({
      openArtifactsDocument: JSON.stringify([entry({ label: "Calendar login", url: CALENDAR })]),
      rest: REST,
      storeDown: true,
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written).toEqual([]);
    expect(result.diagnostics).toContain(storeDownFor({ url: CALENDAR }).message);
  });

  it("refuses a composed card on a page when the store cannot give it, rather than passing it unchecked", async () => {
    const result = await run({
      raw: formCarding({ url: VANTA }),
      rest: ["--form", "-", "--out", "/tmp/page.html"],
      storeDown: true,
    });

    expect(result.exit).toBe(EXIT_USAGE);
    expect(result.written).toEqual([]);
    expect(result.diagnostics).toContain(storeDownFor({ url: VANTA }).message);
  });
});
