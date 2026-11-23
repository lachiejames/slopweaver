/**
 * `proposal drift` — the effectful shell. The destination read is a plain injected function returning a
 * synthetic last-edit time; nothing here is a mock, and nothing reaches the network.
 */
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { productionDestinationLastEdited } from "../../../../../cli/commands/proposal/driftFreshness.js";
import { type ProposalDriftDeps, runProposalDrift } from "../../../../../cli/commands/proposal/driftRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import type { ProposalProvider } from "../../../../../outbound/proposal/address.js";
import type { RegisterEvent } from "../../../../../outbound/proposal/register/events.js";
import { appendRegisterEvent, registerJournalPath } from "../../../../../outbound/proposal/register/store.js";
import type { PageClock } from "../../../../../pages/published.js";
import { PAGE_FILENAME, PAGES_DIRECTORY } from "../../../../../pages/url.js";
import {
  type PublishedPagesReadError,
  PublishedPagesReadErrors,
} from "../../../../../store/publishedPages/readErrors.js";

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "proposal", "drift", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-proposal-drift-"));
  fixtureDirs.push(dir);
  return dir;
}

/** A deps bag whose page read answers from a slug-to-timestamp table, or refuses with a stated reason. */
function harness({ pages }: { pages: Readonly<Record<string, string>> }): {
  deps: ProposalDriftDeps;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const errLines: string[] = [];
  return {
    deps: {
      err: (line) => errLines.push(line),
      out: (line) => out.push(line),
      lastEdited: ({ address }) => {
        const lastEditedIso = pages[address.id];
        return Promise.resolve(
          lastEditedIso === undefined ? { why: `${address.provider} has no page ${address.id}` } : { lastEditedIso },
        );
      },
    },
    err: errLines,
    out,
  };
}

function seed({
  home,
  slug,
  pageId,
  provider = "notion",
  url = `https://example.test/${pageId}`,
  events,
}: {
  home: string;
  slug: string;
  pageId: string;
  provider?: ProposalProvider;
  url?: string;
  events: readonly RegisterEvent[];
}): void {
  unwrap(
    appendRegisterEvent({
      event: {
        address: { id: pageId, provider, url },
        atIso: "2026-07-01T00:00:00.000Z",
        kind: "created",
        source: "sync",
        title: "A proposal",
      },
      home,
      slug,
    }),
  );
  for (const event of events) {
    unwrap(appendRegisterEvent({ event, home, slug }));
  }
}

const IMPLEMENTED: RegisterEvent = {
  atIso: "2026-08-22T00:00:00.000Z",
  kind: "status-changed",
  occurredIso: "2026-07-08T07:13:17.000Z",
  status: "implemented",
  why: "shipped",
};

describe("runProposalDrift", () => {
  it("exits OK over an empty register", async () => {
    const h = harness({ pages: {} });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", tempHome()] }), deps: h.deps });
    expect(code).toBe(EXIT_OK);
    expect(h.out).toEqual([]);
  });

  it("flags a proposal whose page has not been edited since it was implemented", async () => {
    const home = tempHome();
    seed({ events: [IMPLEMENTED], home, pageId: "page-1", slug: "a-slug" });
    const h = harness({ pages: { "page-1": "2026-07-07T05:07:00.000Z" } });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out).toEqual([
      'DRIFTED  a-slug  1d — last edited 2026-07-07T05:07:00.000Z, but "status implemented" happened ' +
        "2026-07-08T07:13:17.000Z",
    ]);
  });

  it("exits OK, and says a clean result is only the absence of evidence, when the page is newer", async () => {
    const home = tempHome();
    seed({ events: [IMPLEMENTED], home, pageId: "page-1", slug: "a-slug" });
    const h = harness({ pages: { "page-1": "2026-08-01T00:00:00.000Z" } });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_OK);
    expect(h.out).toEqual(['ok       a-slug  edited 2026-08-01T00:00:00.000Z, at or after "2026-07-08T07:13:17.000Z"']);
    expect(h.err[0]).toContain("1 proposal(s): 0 drifted, 0 unassessable");
    expect(h.err[0]).toContain("never proves the destination says the right thing");
  });

  it("reports a destination that cannot be read as unassessable, exiting non-zero rather than clean", async () => {
    const home = tempHome();
    seed({ events: [IMPLEMENTED], home, pageId: "page-gone", slug: "a-slug" });
    const h = harness({ pages: {} });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out).toEqual(["?        a-slug  notion has no page page-gone"]);
    expect(h.err[0]).toContain("0 drifted, 1 unassessable");
  });

  it.each(["linear", "local"] as const)(
    "assesses a %s address through the same reader, by its own id",
    async (provider) => {
      const home = tempHome();
      seed({ events: [IMPLEMENTED], home, pageId: "doc-1", provider, slug: "a-slug" });
      const h = harness({ pages: { "doc-1": "2026-07-07T05:07:00.000Z" } });
      const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
      expect(h.out[0]).toBe(
        'DRIFTED  a-slug  1d — last edited 2026-07-07T05:07:00.000Z, but "status implemented" happened ' +
          "2026-07-08T07:13:17.000Z",
      );
    },
  );

  it("refuses to assess a journal holding a line this build cannot decode", async () => {
    const home = tempHome();
    seed({ events: [IMPLEMENTED], home, pageId: "page-1", slug: "a-slug" });
    appendFileSync(registerJournalPath({ home, slug: "a-slug" }), '{"kind":"from-the-future","atIso":"2026-09-01"}\n');
    const h = harness({ pages: { "page-1": "2026-07-07T05:07:00.000Z" } });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out).toEqual(["?        a-slug  journal line(s) 3 cannot be decoded by this build"]);
  });

  it("says nothing material has happened when only a bare registration exists", async () => {
    const home = tempHome();
    seed({ events: [], home, pageId: "page-1", slug: "a-slug" });
    const h = harness({ pages: { "page-1": "2026-07-07T05:07:00.000Z" } });
    await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(h.out).toEqual(["ok       a-slug  nothing material recorded yet"]);
  });

  it("mixes drifted, clean and unassessable in one scan and still exits on the drift", async () => {
    const home = tempHome();
    seed({ events: [IMPLEMENTED], home, pageId: "page-a", slug: "a-slug" });
    seed({ events: [IMPLEMENTED], home, pageId: "page-b", slug: "b-slug" });
    seed({ events: [IMPLEMENTED], home, pageId: "page-c", slug: "c-slug" });
    const h = harness({ pages: { "page-a": "2026-07-01T00:00:00.000Z", "page-b": "2026-08-01T00:00:00.000Z" } });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.map((line) => line.slice(0, 7))).toEqual(["DRIFTED", "ok     ", "?      "]);
    expect(h.err[0]).toContain("3 proposal(s): 1 drifted, 1 unassessable");
  });

  it("--slug narrows to one proposal, and refuses a slug the register does not hold", async () => {
    const home = tempHome();
    seed({ events: [IMPLEMENTED], home, pageId: "page-a", slug: "a-slug" });
    seed({ events: [IMPLEMENTED], home, pageId: "page-b", slug: "b-slug" });
    const one = harness({ pages: { "page-a": "2026-07-01T00:00:00.000Z", "page-b": "2026-07-01T00:00:00.000Z" } });
    await runProposalDrift({ argv: argv({ rest: ["--slug", "b-slug", "--home", home] }), deps: one.deps });
    expect(one.out.length).toBe(1);
    expect(one.out[0]).toContain("b-slug");

    const missing = harness({ pages: {} });
    const code = await runProposalDrift({
      argv: argv({ rest: ["--slug", "nope", "--home", home] }),
      deps: missing.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(missing.err).toEqual(['no proposal registered under "nope"']);
  });

  it("--json carries every verdict, including the slug and address a report needs", async () => {
    const home = tempHome();
    seed({ events: [IMPLEMENTED], home, pageId: "page-1", slug: "a-slug" });
    const h = harness({ pages: { "page-1": "2026-07-07T05:07:00.000Z" } });
    await runProposalDrift({ argv: argv({ rest: ["--json", "--home", home] }), deps: h.deps });
    expect(JSON.parse(h.out[0]!)).toEqual([
      {
        address: { id: "page-1", provider: "notion", url: "https://example.test/page-1" },
        slug: "a-slug",
        title: "A proposal",
        verdict: {
          basis: "occurred",
          daysBehind: 1,
          kind: "drifted",
          latestMaterialIso: "2026-07-08T07:13:17.000Z",
          destinationLastEditedIso: "2026-07-07T05:07:00.000Z",
          what: "status implemented",
        },
      },
    ]);
  });

  it("refuses an unknown flag without reading anything", async () => {
    const h = harness({ pages: {} });
    const code = await runProposalDrift({ argv: argv({ rest: ["--nope"] }), deps: h.deps });
    expect(code).toBe(EXIT_USAGE);
    expect(h.out).toEqual([]);
  });

  it("names an unreadable timestamp rather than reporting a proposal clean", async () => {
    const home = tempHome();
    seed({ events: [{ ...IMPLEMENTED, occurredIso: "whenever" }], home, pageId: "page-1", slug: "a-slug" });
    const h = harness({ pages: { "page-1": "2026-07-07T05:07:00.000Z" } });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out[0]).toContain("unreadable timestamp (whenever)");
  });
});

describe("runProposalDrift over an unreadable register", () => {
  it("names a slug whose journal holds no created event instead of dropping it", async () => {
    const home = tempHome();
    seed({ events: [], home, pageId: "page-1", slug: "a-slug" });
    unwrap(
      appendRegisterEvent({
        event: { atIso: "2026-08-01T00:00:00.000Z", kind: "slack-linked", permalink: "https://slack.test/1" },
        home,
        slug: "orphan",
      }),
    );
    const h = harness({ pages: { "page-1": "2026-07-07T05:07:00.000Z" } });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out[1]).toBe("?        orphan  journal could not be read or holds no created event");
  });
});

describe("EXIT_ERROR is reserved for a broken tool, not a finding", () => {
  it("never returns it for a drifted or unassessable proposal", async () => {
    const home = tempHome();
    seed({ events: [IMPLEMENTED], home, pageId: "page-gone", slug: "a-slug" });
    const h = harness({ pages: {} });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code === EXIT_ERROR).toBe(false);
  });
});

describe("proposal drift over a local page", () => {
  /**
   * The production last-edit reader under the harness's own out/err capture, its store clock a plain fake answering
   * `reply`, so the run and the local-page branch are judged together without a store.
   */
  function storeHarness({ reply }: { reply: Result<PageClock, PublishedPagesReadError> }): {
    deps: ProposalDriftDeps;
    out: string[];
    err: string[];
  } {
    const h = harness({ pages: {} });
    const lastEdited = productionDestinationLastEdited({ readPageClock: async () => reply });
    return { ...h, deps: { ...h.deps, lastEdited } };
  }

  /** Record `doc-1`, published under `home`, as a-slug's local destination. */
  function recordLocal({ home }: { home: string }): void {
    const url = pathToFileURL(join(home, PAGES_DIRECTORY, "doc-1", PAGE_FILENAME)).href;
    seed({ events: [IMPLEMENTED], home, pageId: "doc-1", provider: "local", slug: "a-slug", url });
  }

  const frozenAt = ({ iso }: { iso: string }): Result<PageClock, PublishedPagesReadError> =>
    ok({ frozenAt: new Date(iso), published: true });

  it("flags a local page whose newest freeze predates the material event", async () => {
    const home = tempHome();
    recordLocal({ home });
    const h = storeHarness({ reply: frozenAt({ iso: "2026-07-07T05:07:00.000Z" }) });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out).toEqual([
      'DRIFTED  a-slug  1d — last edited 2026-07-07T05:07:00.000Z, but "status implemented" happened ' +
        "2026-07-08T07:13:17.000Z",
    ]);
  });

  it("passes a local page frozen after the material event", async () => {
    const home = tempHome();
    recordLocal({ home });
    const h = storeHarness({ reply: frozenAt({ iso: "2026-08-01T00:00:00.000Z" }) });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_OK);
    expect(h.out).toEqual(['ok       a-slug  edited 2026-08-01T00:00:00.000Z, at or after "2026-07-08T07:13:17.000Z"']);
  });

  it("names a local page the store cannot clock as unassessable", async () => {
    const home = tempHome();
    recordLocal({ home });
    const h = storeHarness({
      reply: err(PublishedPagesReadErrors.unavailable({ cause: new Error("no freeze"), doing: "answer a freeze" })),
    });
    const code = await runProposalDrift({ argv: argv({ rest: ["--home", home] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out).toEqual([
      "?        a-slug  local page doc-1 could not be read from the store: " +
        "the published-page store did not answer a freeze: no freeze",
    ]);
  });
});
