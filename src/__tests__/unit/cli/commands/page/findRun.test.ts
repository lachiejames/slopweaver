/**
 * `page find`: the run's output and refusals over a plain fake store list. The store read itself is proven against
 * the real stack in `src/__tests__/integration/publishedPagesRead.test.ts`; nothing here opens a store or a folder.
 */
import { describe, expect, it } from "vitest";

import { pageFindOptions } from "../../../../../cli/commands/page/core.js";
import { runPageFind } from "../../../../../cli/commands/page/findRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { PublishedPageForFind } from "../../../../../pages/find.js";

const PAGES: readonly PublishedPageForFind[] = [
  {
    publishedMs: Date.parse("2026-10-05T01:16:47.000Z"),
    slug: "slopweaver-icon-directions",
    title: "Slopweaver, now — twenty icon and tagline directions",
  },
  { publishedMs: Date.parse("2026-10-05T06:51:35.000Z"), slug: "fleet-briefing", title: "Fleet Briefing" },
  { publishedMs: Date.parse("2026-10-04T09:00:00.000Z"), slug: "linked", title: "Kept elsewhere" },
];

/**
 * Run `page find` over a fake store list, collecting what it printed and which home the list was asked for.
 *
 * @param args the verb's own arguments, before `--home`
 * @param listed what the fake store answers
 * @returns the exit code, both channels' lines and the homes the store was read for
 */
async function run({
  args,
  listed = ok(PAGES),
}: {
  args: readonly string[];
  listed?: Result<readonly PublishedPageForFind[]>;
}): Promise<{ code: number; out: string[]; diagnostics: string[]; homes: string[] }> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const homes: string[] = [];
  const code = await runPageFind({
    deps: {
      listPublishedPages: async ({ home }) => {
        homes.push(home);
        return listed;
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    rest: [...args, "--home", "/acme/home"],
  });
  return { code, diagnostics, homes, out };
}

describe("runPageFind", () => {
  it("prints the page the owner's words describe, with the command that opens it", async () => {
    const { code, out, homes } = await run({ args: ["twenty", "potential", "icons"] });

    expect(code).toBe(EXIT_OK);
    expect(homes).toEqual(["/acme/home"]);
    expect(out).toEqual([
      "1 published page(s) matching twenty, potential, icon, best first — showing 1",
      "  slopweaver-icon-directions  Slopweaver, now — twenty icon and tagline directions  (2026-10-05T01:16:47.000Z)",
      "  open one as a new tab in their desktop app with: slopweaver browser present --page <slug>",
    ]);
  });

  it("answers one JSON document the voice can read the slug from, dated by publication", async () => {
    const { code, out } = await run({ args: ["--json", "--limit", "1"] });

    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({
      matching: 3,
      pages: [
        { matched: [], modifiedIso: "2026-10-05T06:51:35.000Z", slug: "fleet-briefing", title: "Fleet Briefing" },
      ],
      searched: [],
      shown: 1,
      closeAtTop: 0,
      unsearchable: [],
    });
  });

  it("fails on a store it cannot read, printing why and offering no page", async () => {
    const { code, out, diagnostics } = await run({
      args: ["fleet"],
      listed: err(["page find: the store connection did not be opened: connection refused"]),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual(["page find: the store connection did not be opened: connection refused"]);
  });

  it("answers no pages from an empty store as a success", async () => {
    const { code, out } = await run({ args: [], listed: ok([]) });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual(["0 published page(s), newest first — showing 0"]);
  });

  it("says the owner's words name nothing to search on, offering no page, rather than listing the newest", async () => {
    const { code, out } = await run({ args: ["open", "the page"] });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      'no page searched: "open the page" names nothing to search on — give a word its title carries',
    ]);
  });

  it("says nothing matched without offering a command to open nothing", async () => {
    const { code, out } = await run({ args: ["zebra"] });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual(["0 published page(s) matching zebra, best first — showing 0"]);
  });

  it("refuses a limit that is not a positive whole number, with the usage, before reading the store", async () => {
    const { code, diagnostics, out, homes } = await run({ args: ["--limit", "0"] });

    expect(code).toBe(EXIT_USAGE);
    expect(out).toEqual([]);
    expect(homes).toEqual([]);
    expect(diagnostics[0]).toBe("--limit must be a positive whole number");
  });
});

describe("pageFindOptions", () => {
  it("takes every positional as a word and defaults the limit to a handful", () => {
    expect(unwrap(pageFindOptions({ rest: ["the", "icons page"] }))).toEqual({
      home: undefined,
      json: false,
      limit: 15,
      words: ["the", "icons page"],
    });
  });

  it("refuses a limit past fifty", () => {
    expect(unwrapErr(pageFindOptions({ rest: ["--limit", "51"] }))).toEqual(["--limit is at most 50"]);
  });
});
