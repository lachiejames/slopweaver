import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireClosingLock } from "../../../../../cli/commands/handover/closingLock.js";
import { type HeldRunReader, NO_HELD_RUN } from "../../../../../cli/commands/page/publishHeldRun.js";
import { publishedLines, runPagePublish } from "../../../../../cli/commands/page/publishRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { FallbackStoreErrors } from "../../../../../codex/fallbackStoreErrors.js";
import type { CodexArtifactRecord } from "../../../../../codex/types.js";
import { appendRunEvent, readRunJournal } from "../../../../../handover/runStore.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import type { PagePublisher } from "../../../../../pages/publish.js";
import { renderPageReviewFold } from "../../../../../pages/reviewFold.js";
import { preparedCommitFacts, preparePageReview, readPreparationAt } from "../../../../../pages/reviewRepo.js";
import type { PageReviewReads } from "../../../../../pages/reviewResolve.js";
import { SHELL_BYTES, wrapPageFragment } from "../../../../../pages/shell.js";
import {
  localPagePublisher,
  publisherWith,
  recordingWriter,
  refusingWriter,
  type WrittenPage,
} from "../../../../pagePublisherFake.js";
import { FIXTURE_REVIEW_SCOPE, fixtureCodexRecord } from "../../../../pageReviewFixture.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const NOW = "2026-09-13T06:00:00.000Z";

/** The fold every page published with the review gate waived carries. */
const WAIVED_FOLD = renderPageReviewFold({
  record: {
    hatch: "unreviewed-page",
    publishedAtIso: NOW,
    publishedFragmentSha256: "",
    schemaVersion: 1,
    slug: "queue",
    status: "waived",
  },
});

/** Reads that resolve the given Codex passes against the real preparations under the test's home. */
function reviewReads({ passes = {} }: { passes?: Record<string, CodexArtifactRecord> } = {}): PageReviewReads {
  return {
    commitFacts: preparedCommitFacts,
    readPass: ({ artifactId }) => ok(passes[artifactId]),
    readPreparation: readPreparationAt,
    scanFallback: async () =>
      err(FallbackStoreErrors.storeUnavailable({ doing: "scan receipts", reason: "no store in this test" })),
  };
}

/** The real publisher over a recording store write, so a test reads what the store was handed — never a folder. */
function recording(): { readonly publish: PagePublisher; readonly written: WrittenPage[] } {
  const { writer, written } = recordingWriter();
  return { publish: publisherWith({ writer }), written };
}

/** One run against collected sinks, so a test reads exactly what a caller would have seen. */
async function run({
  rest,
  lintWaived = false,
  heldRun = NO_HELD_RUN,
  reviewWaived = true,
  reads = reviewReads(),
  publish = localPagePublisher,
}: {
  rest: readonly string[];
  lintWaived?: boolean;
  heldRun?: HeldRunReader;
  reviewWaived?: boolean;
  reads?: PageReviewReads;
  publish?: PagePublisher;
}): Promise<{ code: number; out: string[]; diagnostics: string[] }> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const code = await runPagePublish({
    heldRun,
    lintWaived,
    nowIso: NOW,
    publish,
    rest,
    reviewReads: reads,
    reviewWaived,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  });
  return { code, diagnostics, out };
}

describe("publishedLines", () => {
  const page = {
    bytes: 411,
    frozen: { frozenIso: NOW, key: "queue", sha256: "sha256:ab" },
    path: "/h/pages/queue/index.html",
    url: "file:///h/pages/queue/index.html",
  };

  it("puts the address alone on line one, so `| head -1` is the address", () => {
    const lines = publishedLines({ json: false, page, slug: "queue" });
    expect(lines[0]).toBe("file:///h/pages/queue/index.html");
    expect(lines[1]).toBe(
      "  open it as a new tab in their desktop app: slopweaver://open?path=%2Fapi%2Fpage%2Fqueue%2Findex.html",
    );
    expect(lines[2]).toBe(`  411 bytes (${String(SHELL_BYTES)} of them the document shell), frozen as sha256:ab`);
    expect(lines[3]).toBe("  a ruling about this page is recorded against `page:queue`");
  });

  it("gives the same facts as one object under --json", () => {
    const lines = publishedLines({ json: true, page, slug: "queue" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toStrictEqual({
      bytes: 411,
      desktopLink: "slopweaver://open?path=%2Fapi%2Fpage%2Fqueue%2Findex.html",
      identity: "page:queue",
      path: "/h/pages/queue/index.html",
      sha256: "sha256:ab",
      shellBytes: SHELL_BYTES,
      slug: "queue",
      url: "file:///h/pages/queue/index.html",
    });
  });

  it("says where the review record is, and that a waived page says so in its fold", () => {
    const record = {
      hatch: "unreviewed-page",
      publishedAtIso: NOW,
      publishedFragmentSha256: "",
      schemaVersion: 1,
      slug: "queue",
      status: "waived",
    } as const;
    const review = { path: "/h/page-reviews/queue/published.json", record };
    expect(publishedLines({ json: false, page, review, slug: "queue" })[4]).toBe(
      "  published UNREVIEWED under the unreviewed-page hatch, and its fold tells them so; the record is /h/page-reviews/queue/published.json",
    );
    expect(JSON.parse(publishedLines({ json: true, page, review, slug: "queue" })[0]!)).toMatchObject({
      review: "waived",
      reviewPath: "/h/page-reviews/queue/published.json",
    });
  });
});

describe("runPagePublish", () => {
  let home = "";
  let fragmentPath = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-pub-"));
    fragmentPath = join(home, "fragment.html");
    writeFileSync(fragmentPath, "<title>Queue</title><p>hi</p>");
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("writes the page into the store alone, nothing on disk, and prints its address", async () => {
    const { publish, written } = recording();
    const { code, out } = await run({ publish, rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(written.map((page) => [page.slug, page.document, page.assets])).toStrictEqual([
      ["queue", wrapPageFragment({ fragment: `<title>Queue</title><p>hi</p>${WAIVED_FOLD}` }), []],
    ]);
    expect([existsSync(join(home, "pages")), existsSync(join(home, "published-pages"))]).toStrictEqual([false, false]);
    expect(out[0]!.endsWith("/pages/queue/index.html")).toBe(true);
  });

  it("reads the page's images from --assets-from and hands them to the store with the page", async () => {
    const assets = join(home, "drafts");
    mkdirSync(join(assets, "charts"), { recursive: true });
    writeFileSync(join(assets, "charts", "jul.png"), "png");
    writeFileSync(fragmentPath, '<img src="charts/jul.png" alt="jul">');
    const { publish, written } = recording();
    const { code } = await run({
      publish,
      rest: ["queue", "--page", fragmentPath, "--home", home, "--assets-from", assets],
    });
    expect(code).toBe(EXIT_OK);
    expect(written[0]!.assets.map((asset) => [asset.relativePath, asset.bytes.toString("utf8")])).toStrictEqual([
      ["charts/jul.png", "png"],
    ]);
  });

  it("refuses a relative image when no --assets-from is named, and writes nothing", async () => {
    writeFileSync(fragmentPath, '<img src="charts/jul.png" alt="jul">');
    const { publish, written } = recording();
    const { code, diagnostics } = await run({ publish, rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain(
      '<img src="charts/jul.png"> names a file the page\'s assets do not hold, so it shows as a broken image',
    );
    expect(written).toStrictEqual([]);
  });

  it("refuses a blank --assets-from rather than reading images from nowhere", async () => {
    const { code, diagnostics } = await run({
      rest: ["queue", "--page", fragmentPath, "--home", home, "--assets-from", ""],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("--assets-from was passed with no value");
  });

  it("records the page as the held run's artifact, and journals nothing with no held run", async () => {
    const held = await run({ heldRun: () => "plan-usage", rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(held.code).toBe(EXIT_OK);
    const events = unwrap(readRunJournal({ runsDir: join(home, "runs"), slug: "plan-usage" })).events;
    expect(events).toStrictEqual([{ atIso: NOW, kind: "artifact", url: held.out[0] }]);
    expect(held.diagnostics.at(-1)).toContain("recorded as run plan-usage's artifact");

    const loose = await run({ rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(loose.code).toBe(EXIT_OK);
    expect(unwrap(readRunJournal({ runsDir: join(home, "runs"), slug: "plan-usage" })).events).toHaveLength(1);
  });

  it("writes nothing while the run is being closed, and publishes and records once the close lets go", async () => {
    // A publish landing between a close's page-gate read and its write would close an uncarded
    // row, so the lock is taken before the page is written.
    const closing = unwrap(acquireClosingLock({ home, nowIso: NOW, slug: "plan-usage" }));
    const { publish, written } = recording();
    const blocked = await run({
      heldRun: () => "plan-usage",
      publish,
      rest: ["queue", "--page", fragmentPath, "--home", home],
    });
    expect(blocked.code).toBe(EXIT_ERROR);
    expect(blocked.diagnostics[0]).toContain(
      "run plan-usage is being settled, finished or closed, so nothing was written",
    );
    expect(existsSync(join(home, "runs", "plan-usage.jsonl"))).toBe(false);
    expect(written).toStrictEqual([]);
    closing.release();
    const after = await run({ heldRun: () => "plan-usage", rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(after.code).toBe(EXIT_OK);
    const events = unwrap(readRunJournal({ runsDir: join(home, "runs"), slug: "plan-usage" })).events;
    expect(events).toStrictEqual([{ atIso: NOW, kind: "artifact", url: after.out[0] }]);
  });

  it("refuses a page for a run already closed, writing neither the page nor an artifact", async () => {
    // An artifact appended after `finished` would never meet the page gate, and a page published
    // unrecorded is the run's deliverable left off the owner's Queue.
    const runsDir = join(home, "runs");
    const started = { atIso: NOW, branch: "plan-usage", docHash: "h", kind: "started" } as const;
    unwrap(appendRunEvent({ event: started, runsDir, slug: "plan-usage" }));
    unwrap(appendRunEvent({ event: { atIso: NOW, kind: "finished", residue: [] }, runsDir, slug: "plan-usage" }));
    const { publish, written } = recording();
    const late = await run({
      heldRun: () => "plan-usage",
      publish,
      rest: ["queue", "--page", fragmentPath, "--home", home],
    });
    expect(late.code).toBe(EXIT_ERROR);
    expect(late.diagnostics[0]).toContain("run plan-usage is already closed");
    expect(written).toStrictEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "plan-usage" })).events.map((event) => event.kind)).toStrictEqual([
      "started",
      "finished",
    ]);
  });

  it("fails when the store write fails, printing no address and recording neither the review nor an artifact", async () => {
    const publish = publisherWith({ writer: refusingWriter({ line: "the store is down" }) });
    const failed = await run({
      heldRun: () => "plan-usage",
      publish,
      rest: ["queue", "--page", fragmentPath, "--home", home],
    });
    expect(failed.code).toBe(EXIT_ERROR);
    expect(failed.out).toEqual([]);
    expect(failed.diagnostics.slice(-2)).toEqual([
      "writing queue into the store failed or could not be confirmed, so the publish did not complete and the page " +
        "has no address yet. Re-run the same publish to complete it.",
      "the store is down",
    ]);
    expect(existsSync(join(home, "pages"))).toBe(false);
    expect(existsSync(join(home, "page-reviews", "queue", "published.json"))).toBe(false);
    expect(existsSync(join(home, "runs", "plan-usage.jsonl"))).toBe(false);
  });

  it("refuses a missing slug and a missing --page, and names both", async () => {
    const noSlug = await run({ rest: ["--page", fragmentPath, "--home", home] });
    expect(noSlug.code).toBe(EXIT_USAGE);
    expect(noSlug.diagnostics[0]).toContain("needs a slug");
    const noPage = await run({ rest: ["queue", "--home", home] });
    expect(noPage.code).toBe(EXIT_USAGE);
    expect(noPage.diagnostics[0]).toContain("--page is required");
  });

  it("refuses a second positional rather than publishing under the wrong name", async () => {
    const { code, diagnostics } = await run({ rest: ["queue", fragmentPath, "--home", home] });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("takes one slug");
  });

  it("reports a fragment it cannot read, and writes no page", async () => {
    const { code, diagnostics, out } = await run({
      rest: ["queue", "--page", join(home, "absent.html"), "--home", home],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("could not read the page at");
    expect(out).toStrictEqual([]);
  });

  it("takes its freeze instant from --now", async () => {
    const { publish, written } = recording();
    const { code, out } = await run({
      publish,
      rest: ["queue", "--page", fragmentPath, "--home", home, "--json", "--now", "2026-01-01T00:00:00.000Z"],
    });
    expect(code).toBe(EXIT_OK);
    expect(written.map((page) => page.frozenAt.toISOString())).toStrictEqual(["2026-01-01T00:00:00.000Z"]);
    expect(JSON.parse(out[0]!)).toMatchObject({ slug: "queue" });
  });

  it("refuses a page whose image the console cannot load, names it, and writes nothing", async () => {
    writeFileSync(fragmentPath, '<p>chart</p><img src="file:///Users/x/charts/jul.png" alt="jul">');
    const { publish, written } = recording();
    const { code, diagnostics, out } = await run({ publish, rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain('<img src="file:///Users/x/charts/jul.png"> cannot load from the console');
    expect(diagnostics[1]).toContain("slopweaver page publish blocked because");
    expect(diagnostics[1]).toContain("SLOPWEAVER_ALLOW_PAGE_LINT=1");
    expect(written).toStrictEqual([]);
    expect(out).toStrictEqual([]);
  });

  it("refuses a src naming a directory under --assets-from, which is not an image", async () => {
    const assets = join(home, "drafts");
    mkdirSync(join(assets, "charts"), { recursive: true });
    writeFileSync(fragmentPath, '<img src="charts" alt="jul">');
    const { code, diagnostics } = await run({
      rest: ["queue", "--page", fragmentPath, "--home", home, "--assets-from", assets],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain('<img src="charts"> names a file the page\'s assets do not hold');
  });

  it("refuses a raw timestamp in prose unless the hatch is open", async () => {
    writeFileSync(fragmentPath, "<p>The block hit at 2026-09-23T03:35Z.</p>");
    const refused = await run({ rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(refused.code).toBe(EXIT_ERROR);
    expect(refused.diagnostics[0]).toContain('"2026-09-23T03:35Z" is a machine timestamp in prose');
    const waived = await run({ lintWaived: true, rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(waived.code).toBe(EXIT_OK);
  });

  it("links a bare reference its own links resolve, says so, and publishes the linked bytes", async () => {
    const pull = '<a href="https://github.com/acme/acme-admin/pull/18158">the PR</a>';
    writeFileSync(fragmentPath, `<p>${pull}, then #18160.</p>`);
    const { publish, written } = recording();
    const { code, diagnostics } = await run({ publish, rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(diagnostics).toStrictEqual(["linked #18160 → https://github.com/acme/acme-admin/issues/18160"]);
    expect(written[0]!.document).toBe(
      wrapPageFragment({
        fragment: `<p>${pull}, then <a href="https://github.com/acme/acme-admin/issues/18160">#18160</a>.</p>${WAIVED_FOLD}`,
      }),
    );
  });

  it("refuses a session id in prose, names it, and writes nothing", async () => {
    writeFileSync(fragmentPath, "<p>Session a0000021-0000-4000-8000-000000000024 put this here.</p>");
    const { publish, written } = recording();
    const { code, diagnostics } = await run({ publish, rest: ["queue", "--page", fragmentPath, "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain('"a0000021-0000-4000-8000-000000000024" is a machine id in text the owner reads');
    expect(written).toStrictEqual([]);
  });

  it("refuses a page with no --review while the hatch is closed, and writes nothing", async () => {
    const { publish, written } = recording();
    const { code, diagnostics, out } = await run({
      publish,
      rest: ["queue", "--page", fragmentPath, "--home", home],
      reviewWaived: false,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("slopweaver page publish blocked because the page cites no review");
    expect(diagnostics[0]).toContain('("queue" was passed no --review)');
    expect(diagnostics.join("\n")).toContain("SLOPWEAVER_ALLOW_UNREVIEWED_PAGE=1");
    expect(written).toStrictEqual([]);
    expect(existsSync(join(home, "page-reviews", "queue", "published.json"))).toBe(false);
    expect(out).toStrictEqual([]);
  });

  it("refuses a cited review that names nothing, even with the hatch open", async () => {
    const { publish, written } = recording();
    const { code, diagnostics } = await run({
      publish,
      rest: ["queue", "--page", fragmentPath, "--home", home, "--review", "pass-404"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("pass-404");
    expect(written).toStrictEqual([]);
  });

  /** Prepare the fragment for review for real, and the Codex pass that read exactly those commits. */
  function preparedPass({ verdict = "CLEAN" }: { verdict?: "CLEAN" | "BROKEN" } = {}): CodexArtifactRecord {
    const { preparation, repoRoot } = unwrap(
      preparePageReview({
        createdAtIso: NOW,
        fragment: readFileSync(fragmentPath, "utf8"),
        home,
        inputs: [{ contents: "three things need the owner\n", name: "owner-words.md" }],
        preparationId: "prep-1",
        slug: "queue",
      }),
    );
    const facts = unwrap(preparedCommitFacts({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot }));
    const record = fixtureCodexRecord({
      artifactId: "pass-1",
      scope: {
        ...FIXTURE_REVIEW_SCOPE,
        baseRef: preparation.baseSha,
        baseSha: preparation.baseSha,
        diffSha256: facts.diffSha256,
        headSha: preparation.headSha,
      },
      verdict,
    });
    return { ...record, repoRoot };
  }

  it(
    "publishes a page whose cited review read exactly these bytes, folds it in, and writes its record",
    async () => {
      const passes = { "pass-1": preparedPass() };
      const { publish, written } = recording();
      const { code, out } = await run({
        publish,
        reads: reviewReads({ passes }),
        rest: ["queue", "--page", fragmentPath, "--home", home, "--review", "pass-1"],
        reviewWaived: false,
      });
      expect(code).toBe(EXIT_OK);
      const html = written[0]!.document;
      expect(html).toContain("How this page was reviewed before you saw it — 1 check(s), all held");
      expect(html).toContain("Nothing changed after the review: you are reading the exact cut it checked.");
      const record = JSON.parse(readFileSync(join(home, "page-reviews", "queue", "published.json"), "utf8")) as {
        status: string;
        reviews: { id: string; reviewer: string }[];
      };
      expect(record.status).toBe("reviewed");
      expect(record.reviews.map((one) => [one.id, one.reviewer])).toStrictEqual([["pass-1", "codex"]]);
      expect(out[4]).toContain("carries 1 review(s) in its fold");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "compares the review with the LINKED bytes it writes, so a review of the unlinked page is not the exact cut",
    async () => {
      const pull = '<a href="https://github.com/acme/acme-admin/pull/18158">the PR</a>';
      writeFileSync(fragmentPath, `<p>${pull}, then #18160.</p>`);
      const passes = { "pass-1": preparedPass() };
      const { publish, written } = recording();
      const { code, diagnostics } = await run({
        publish,
        reads: reviewReads({ passes }),
        rest: ["queue", "--page", fragmentPath, "--home", home, "--review", "pass-1"],
        reviewWaived: false,
      });
      expect(code).toBe(EXIT_ERROR);
      expect(diagnostics[1]).toContain("differs from the cut 1 cited review(s) read");
      expect(written).toStrictEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a page edited after its review until the author says what changed, then says so in the fold",
    async () => {
      const passes = { "pass-1": preparedPass() };
      writeFileSync(fragmentPath, "<title>Queue</title><p>hi, edited</p>");
      const rest = ["queue", "--page", fragmentPath, "--home", home, "--review", "pass-1"];
      const refused = await run({ reads: reviewReads({ passes }), rest, reviewWaived: false });
      expect(refused.code).toBe(EXIT_ERROR);
      expect(refused.diagnostics[0]).toContain("differs from the cut 1 cited review(s) read");
      const { publish, written } = recording();
      const published = await run({
        publish,
        reads: reviewReads({ passes }),
        rest: [...rest, "--review-changed", "added a word"],
        reviewWaived: false,
      });
      expect(published.code).toBe(EXIT_OK);
      expect(written[0]!.document).toContain(
        "This page is not the exact cut that was reviewed, and those edits were not re-reviewed.",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
