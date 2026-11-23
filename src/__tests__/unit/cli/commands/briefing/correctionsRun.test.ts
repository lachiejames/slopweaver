/**
 * The `briefing corrections` shell: the parse, the injected reads and writes, and the exit code that IS the
 * contract for `--verify`.
 *
 * The compare itself belongs to `../../../../../outbound/briefing/corrections.ts` and is tested there. What
 * is under test here is dispatch: which version the run compares against, where it writes, and that a page
 * whose marks do not match the diff exits non-zero rather than reporting clean.
 *
 * The `briefing freeze` shell sits below it, in `../../../../../cli/commands/briefing/freezeRun.ts`: a freeze
 * reaches the store, its only copy, or fails and prints no success.
 */
import { describe, expect, it } from "vitest";

import { correctionsWritePath, parseBriefingCorrectionsArgs } from "../../../../../cli/commands/briefing/core.js";
import { runBriefingCorrections } from "../../../../../cli/commands/briefing/correctionsRun.js";
import { type FreezeWriter, runBriefingFreeze } from "../../../../../cli/commands/briefing/freezeRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { sha256Text } from "../../../../../lib/hash.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import { stampCorrections } from "../../../../../outbound/briefing/corrections.js";
import { FreezeStoreErrors, type FreezeWriteError } from "../../../../../outbound/briefing/errors.js";
import { driftDetail } from "../../../../../outbound/briefing/freezeStore.js";
import { PublishedPagesReadErrors } from "../../../../../store/publishedPages/readErrors.js";

/** One page, built the way the renderer builds one: an eyebrow, then blocks. */
function page({ body }: { body: string }): string {
  return `<main><div class="eyebrow">last refreshed X · ready for review Y</div>${body}</main>`;
}

const PREVIOUS = page({ body: "<p>one</p><p>two</p>" });
const NEXT = page({ body: "<p>one</p><p>two changed</p>" });

/** What one run of either shell produced. */
interface Ran {
  readonly code: number;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
  readonly written: ReadonlyMap<string, string>;
}

/** Run `corrections` against a fake filesystem and a fake freeze, capturing both output lanes. */
async function runCorrections({
  rest,
  files,
  frozen,
}: {
  rest: readonly string[];
  files: Readonly<Record<string, string>>;
  frozen: Result<string>;
}): Promise<Ran> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const written = new Map<string, string>();
  const code = await runBriefingCorrections({
    exists: (path) => path in files,
    readFile: (path) => files[path]!,
    readFrozen: () => Promise.resolve(frozen),
    rest,
    writeFile: ({ contents, path }) => {
      written.set(path, contents);
    },
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  });
  return { code, diagnostics, out, written };
}

describe("briefing corrections", () => {
  it("stamps the page in place when no --out is given", async () => {
    const ran = await runCorrections({
      files: { "/next.html": NEXT, "/prev.html": PREVIOUS },
      frozen: err(["unused"]),
      rest: ["--previous", "/prev.html", "--page", "/next.html"],
    });

    expect(ran.code).toBe(EXIT_OK);
    expect([...ran.written.keys()]).toEqual(["/next.html"]);
    expect(ran.written.get("/next.html")).toContain('data-corr-marked="1"');
    expect(ran.out[0]).toBe("1 marked spot(s) across 2 on the page: 1 changed, 0 new, 0 gone");
  });

  it("writes to --out and leaves the page it read alone", async () => {
    const ran = await runCorrections({
      files: { "/next.html": NEXT, "/prev.html": PREVIOUS },
      frozen: err(["unused"]),
      rest: ["--previous", "/prev.html", "--page", "/next.html", "--out", "/marked.html"],
    });

    expect([...ran.written.keys()]).toEqual(["/marked.html"]);
    expect(ran.out.at(-1)).toBe("wrote /marked.html");
  });

  it("names the page itself as written when it was stamped in place", async () => {
    const ran = await runCorrections({
      files: { "/next.html": NEXT, "/prev.html": PREVIOUS },
      frozen: err(["unused"]),
      rest: ["--previous", "/prev.html", "--page", "/next.html"],
    });

    expect(ran.out.at(-1)).toBe("wrote /next.html");
  });

  it("takes the version the owner read from the freeze when only --artifact is given", async () => {
    const ran = await runCorrections({
      files: { "/next.html": NEXT },
      frozen: ok(PREVIOUS),
      rest: ["--artifact", "0dc1a3db", "--page", "/next.html", "--out", "/marked.html"],
    });

    expect(ran.code).toBe(EXIT_OK);
    expect(ran.written.get("/marked.html")).toContain('data-corr-marked="1"');
  });

  it("reports the freeze's own refusal rather than stamping an unmarked page", async () => {
    const ran = await runCorrections({
      files: { "/next.html": NEXT },
      frozen: err([PublishedPagesReadErrors.neverFrozen({ pageKey: "0dc1a3db" }).message]),
      rest: ["--artifact", "0dc1a3db", "--page", "/next.html"],
    });

    expect(ran.code).toBe(EXIT_ERROR);
    expect(ran.written.size).toBe(0);
    expect(ran.diagnostics).toEqual([PublishedPagesReadErrors.neverFrozen({ pageKey: "0dc1a3db" }).message]);
    expect(ran.diagnostics[0]).toContain("no frozen version of 0dc1a3db");
  });

  it("refuses a run that names neither the freeze nor a previous file", async () => {
    const ran = await runCorrections({
      files: { "/next.html": NEXT },
      frozen: err(["unused"]),
      rest: ["--page", "/next.html"],
    });

    expect(ran.code).toBe(EXIT_ERROR);
    expect(ran.diagnostics[0]).toContain("needs the version the owner already read");
  });

  it("refuses a run with no --page at all", async () => {
    const ran = await runCorrections({ files: {}, frozen: err(["unused"]), rest: [] });

    expect(ran.code).toBe(EXIT_USAGE);
    expect(ran.diagnostics[0]).toBe("briefing corrections needs --page <html>");
  });

  it("refuses a --page that is not there", async () => {
    const ran = await runCorrections({ files: {}, frozen: err(["unused"]), rest: ["--page", "/gone.html"] });

    expect(ran.code).toBe(EXIT_ERROR);
    expect(ran.diagnostics).toEqual(["briefing corrections: no such file: /gone.html"]);
  });
});

describe("correctionsWritePath", () => {
  it("writes to --out when it is given", () => {
    const parsed = unwrap(parseBriefingCorrectionsArgs({ rest: ["--page", "/next.html", "--out", "/marked.html"] }));

    expect(correctionsWritePath({ pagePath: "/next.html", parsed })).toBe("/marked.html");
  });

  it("writes over the page itself when --out is absent", () => {
    const parsed = unwrap(parseBriefingCorrectionsArgs({ rest: ["--page", "/next.html"] }));

    expect(correctionsWritePath({ pagePath: "/next.html", parsed })).toBe("/next.html");
  });

  it("writes over the page itself for an empty --out, as main's flag reader did", () => {
    const parsed = unwrap(parseBriefingCorrectionsArgs({ rest: ["--page", "/next.html", "--out", ""] }));

    expect(correctionsWritePath({ pagePath: "/next.html", parsed })).toBe("/next.html");
  });
});

describe("briefing corrections --verify", () => {
  it("passes a page it stamped itself, and writes nothing", async () => {
    const marked = stampCorrections({ next: NEXT, previous: PREVIOUS }).html;
    const ran = await runCorrections({
      files: { "/marked.html": marked, "/prev.html": PREVIOUS },
      frozen: err(["unused"]),
      rest: ["--previous", "/prev.html", "--page", "/marked.html", "--verify"],
    });

    expect(ran.code).toBe(EXIT_OK);
    expect(ran.written.size).toBe(0);
    expect(ran.out.at(-1)).toBe("the page's marks match the diff");
  });

  it("refuses a page whose mark an author deleted after the stamp", async () => {
    const marked = stampCorrections({ next: NEXT, previous: PREVIOUS }).html;
    const ran = await runCorrections({
      files: { "/handedited.html": marked.replace(' data-corr="changed"', ""), "/prev.html": PREVIOUS },
      frozen: err(["unused"]),
      rest: ["--previous", "/prev.html", "--page", "/handedited.html", "--verify"],
    });

    expect(ran.code).toBe(EXIT_ERROR);
    expect(ran.diagnostics.map((line) => line.split(":")[0])).toEqual([
      "corrections (count-mismatch)",
      "corrections (recompute-mismatch)",
    ]);
  });
});

/** The page a run reads off disk. */
const PAGE = '<main><div class="eyebrow">last refreshed X · ready for review Y</div><p>two changed</p></main>';

/** What one `freeze` run asked the store for, and what it printed. */
interface Froze {
  readonly code: number;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
  readonly written: readonly Parameters<FreezeWriter>[0][];
}

/** Run `freeze` over a fake store write, capturing both output lanes. */
async function runFreeze({
  rest,
  writing = ok(undefined),
}: {
  rest: readonly string[];
  writing?: Result<void, FreezeWriteError>;
}): Promise<Froze> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const written: Parameters<FreezeWriter>[0][] = [];
  const code = await runBriefingFreeze({
    exists: (path) => path === "/page.html",
    nowIso: "2026-09-07T00:00:00Z",
    readFile: () => PAGE,
    rest,
    write: (request) => {
      written.push(request);
      return Promise.resolve(writing);
    },
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  });
  return { code, diagnostics, out, written };
}

/** The digest the page above freezes at: the bytes the run read, never the address it was given. */
const PAGE_SHA256 = sha256Text({ text: PAGE });

describe("briefing freeze", () => {
  it("writes the page's bytes into the store under its key, and prints the version it kept", async () => {
    const ran = await runFreeze({ rest: ["--artifact", "abc", "--page", "/page.html", "--home", "/home/acme"] });

    expect(ran.code).toBe(EXIT_OK);
    expect(ran.written).toEqual([
      { frozenAt: new Date("2026-09-07T00:00:00Z"), home: "/home/acme", html: PAGE, key: "abc", opensHistory: false },
    ]);
    expect(ran.out).toEqual([`froze abc at ${PAGE_SHA256}`, "kept in the store under abc"]);
  });

  it("prints the kept version as JSON, naming no path, since nothing is written on disk", async () => {
    const ran = await runFreeze({ rest: ["--artifact", "abc", "--page", "/page.html", "--json"] });

    expect(ran.out.map((line) => JSON.parse(line) as unknown)).toEqual([
      { frozenIso: "2026-09-07T00:00:00Z", key: "abc", sha256: PAGE_SHA256 },
    ]);
  });

  it("fails a freeze the store refuses, naming the re-run, and prints no success", async () => {
    const failure = FreezeStoreErrors.writeFailed({
      key: "abc",
      lines: ["the store connection did not connect: connection refused"],
    });
    const ran = await runFreeze({ rest: ["--artifact", "abc", "--page", "/page.html"], writing: err(failure) });

    expect(ran.code).toBe(EXIT_ERROR);
    expect(ran.out).toEqual([]);
    expect(ran.diagnostics).toEqual([
      "writing the freeze of abc into the store failed or could not be confirmed, so `briefing corrections` cannot " +
        "diff against it yet. Re-run the same freeze to complete it: the store connection did not connect: " +
        "connection refused",
    ]);
  });

  it("refuses a run missing either half of its argument pair, writing nothing", async () => {
    const ran = await runFreeze({ rest: ["--artifact", "abc"] });

    expect(ran.code).toBe(EXIT_USAGE);
    expect(ran.diagnostics[0]).toBe("briefing freeze needs --artifact <url|id> and --page <html>");
    expect(ran.written).toEqual([]);
  });

  it("refuses an address that names no key before the store is asked", async () => {
    const ran = await runFreeze({ rest: ["--artifact", "file:///tmp/elsewhere/index.html", "--page", "/page.html"] });

    expect(ran.code).toBe(EXIT_ERROR);
    expect(ran.diagnostics[0]).toContain("is a file address that does not name a local page");
    expect(ran.written).toEqual([]);
  });

  it("carries --new through to the store, which is the only thing that decides the refusal", async () => {
    const plain = await runFreeze({ rest: ["--artifact", "abc", "--page", "/page.html"] });
    const opened = await runFreeze({ rest: ["--artifact", "abc", "--page", "/page.html", "--new"] });

    expect([...plain.written, ...opened.written].map((asked) => asked.opensHistory)).toEqual([false, true]);
  });

  it("prints the store's new-history refusal on the diagnostic lane", async () => {
    const refusal = FreezeStoreErrors.newHistoryRefused({
      detail: driftDetail({ key: "af415a0a-drifted", neighbours: [] }),
      key: "af415a0a-drifted",
    });
    const ran = await runFreeze({
      rest: ["--artifact", "af415a0a-drifted", "--page", "/page.html"],
      writing: err(refusal),
    });

    expect(ran.code).toBe(EXIT_ERROR);
    expect(ran.out).toEqual([]);
    expect(ran.diagnostics).toEqual([refusal.message]);
    expect(ran.diagnostics[0]).toContain("which the store holds no version of");
  });
});
