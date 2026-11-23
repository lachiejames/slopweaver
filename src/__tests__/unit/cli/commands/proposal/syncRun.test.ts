/** `proposal sync` — discovery-only Notion backfill. Network is injected as a plain fake; nothing here is a mock. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ProposalSyncDeps, runProposalSync } from "../../../../../cli/commands/proposal/syncRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { NotionLiveErrors } from "../../../../../live/notion/errors.js";
import {
  appendRegisterEvent,
  listRegisterSlugs,
  loadRegisterEntry,
} from "../../../../../outbound/proposal/register/store.js";

const NOW = new Date("2026-08-22T02:00:00.000Z");

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "proposal", "sync", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-proposal-sync-"));
  fixtureDirs.push(dir);
  return dir;
}

function harness({ results }: { results: Readonly<Record<string, readonly unknown[]>> }): {
  deps: ProposalSyncDeps;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const errLines: string[] = [];
  return {
    deps: {
      err: (line) => errLines.push(line),
      now: () => NOW,
      out: (line) => out.push(line),
      readSourceBlocks: ({ address }) => {
        const blocks = results[address];
        return Promise.resolve(
          blocks === undefined
            ? err(NotionLiveErrors.readFailed({ message: `no fixture for ${address}` }))
            : ok({ hasMore: false, nextCursor: undefined, results: blocks }),
        );
      },
    },
    err: errLines,
    out,
  };
}

const CHILD_PAGE_A = { child_page: { title: "Proposal A" }, id: "page-a", type: "child_page" };
const CHILD_PAGE_B = { child_page: { title: "Proposal B" }, id: "page-b", type: "child_page" };

describe("runProposalSync", () => {
  it("refuses without --source", async () => {
    const h = harness({ results: {} });
    expect(await runProposalSync({ argv: argv({ rest: ["--home", tempHome()] }), deps: h.deps })).toBe(EXIT_USAGE);
  });

  it("registers every discovered child page not already tracked", async () => {
    const home = tempHome();
    const h = harness({ results: { "source-1": [CHILD_PAGE_A, CHILD_PAGE_B] } });
    const code = await runProposalSync({
      argv: argv({ rest: ["--source", "source-1", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    const slugs = listRegisterSlugs({ home });
    expect(slugs.length).toBe(2);
    const entries = slugs.map((slug) => unwrap(loadRegisterEntry({ home, slug }))!);
    const registered = entries.find((entry) => entry.title === "Proposal A")!;
    expect(registered.address).toEqual({ id: "page-a", provider: "notion", url: "https://www.notion.so/pagea" });
    expect(registered.source).toBe("sync");
    expect(registered.status).toBe("strawman");
  });

  it("does not re-register a page already tracked under its Notion address", async () => {
    const home = tempHome();
    unwrap(
      appendRegisterEvent({
        event: {
          address: { id: "page-a", provider: "notion", url: "https://x" },
          atIso: "2026-08-01T00:00:00.000Z",
          kind: "created",
          source: "publish",
          title: "Already here",
        },
        home,
        slug: "already-tracked",
      }),
    );
    const h = harness({ results: { "source-1": [CHILD_PAGE_A] } });
    await runProposalSync({ argv: argv({ rest: ["--source", "source-1", "--home", home] }), deps: h.deps });
    expect(listRegisterSlugs({ home })).toEqual(["already-tracked"]);
    expect(h.out.some((line) => line.includes("already registered"))).toBe(true);
  });

  it("recognises a tracked Notion page whose id was recorded in the other UUID spelling", async () => {
    const home = tempHome();
    unwrap(
      appendRegisterEvent({
        event: {
          address: { id: "0123456789ABCDEF0123456789abcdef", provider: "notion" },
          atIso: "2026-08-01T00:00:00.000Z",
          kind: "created",
          source: "publish",
          title: "Already here",
        },
        home,
        slug: "compact-spelling",
      }),
    );
    const dashed = { ...CHILD_PAGE_A, id: "01234567-89ab-cdef-0123-456789abcdef" };
    const h = harness({ results: { "source-1": [dashed] } });
    await runProposalSync({ argv: argv({ rest: ["--source", "source-1", "--home", home] }), deps: h.deps });
    expect(listRegisterSlugs({ home })).toEqual(["compact-spelling"]);
  });

  it("registers a page listed twice in one response once, whichever UUID spelling comes second", async () => {
    const home = tempHome();
    const dashed = { child_page: { title: "First" }, id: "01234567-89ab-cdef-0123-456789abcdef", type: "child_page" };
    const compact = { child_page: { title: "Second" }, id: "0123456789abcdef0123456789abcdef", type: "child_page" };
    const h = harness({ results: { "source-1": [dashed, compact] } });
    await runProposalSync({ argv: argv({ rest: ["--source", "source-1", "--home", home] }), deps: h.deps });
    expect(listRegisterSlugs({ home }).length).toBe(1);
    expect(h.out.filter((line) => line.includes("already registered")).length).toBe(1);
  });

  it("registers a Notion page even when another provider's entry carries the same id", async () => {
    const home = tempHome();
    unwrap(
      appendRegisterEvent({
        event: {
          address: { id: "page-a", provider: "linear" },
          atIso: "2026-08-01T00:00:00.000Z",
          kind: "created",
          source: "publish",
          title: "A Linear document",
        },
        home,
        slug: "linear-doc",
      }),
    );
    const h = harness({ results: { "source-1": [CHILD_PAGE_A] } });
    await runProposalSync({ argv: argv({ rest: ["--source", "source-1", "--home", home] }), deps: h.deps });
    expect(listRegisterSlugs({ home }).toSorted()).toEqual(["linear-doc", "proposal-a-pagea"]);
  });

  it("reports a read failure for one source and still exits ERROR", async () => {
    const h = harness({ results: {} });
    const code = await runProposalSync({
      argv: argv({ rest: ["--source", "missing-source", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.err.some((line) => line.includes("no fixture for missing-source"))).toBe(true);
  });

  it("continues to the next source after one source fails", async () => {
    const home = tempHome();
    const h = harness({ results: { "source-ok": [CHILD_PAGE_A] } });
    const code = await runProposalSync({
      argv: argv({ rest: ["--source", "source-missing,source-ok", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(listRegisterSlugs({ home }).length).toBe(1);
  });

  it("always states discovery-only, so classification is never mistaken for automatic", async () => {
    const h = harness({ results: { "source-1": [] } });
    await runProposalSync({ argv: argv({ rest: ["--source", "source-1", "--home", tempHome()] }), deps: h.deps });
    expect(h.err.some((line) => line.includes("discovery only"))).toBe(true);
  });

  it("rejects a --limit outside 1..100", async () => {
    const h = harness({ results: {} });
    const code = await runProposalSync({
      argv: argv({ rest: ["--source", "x", "--limit", "0", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
  });
});
