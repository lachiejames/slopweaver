/**
 * `slopweaver page publish <slug> --page <html> --review <id,...> [--assets-from <dir>]` — write one page into the
 * store, freeze its bytes, print its address. Its images are read from `--assets-from`, never from a page folder.
 *
 * Make it impossible to publish a Claude artifact again. Every session that
 * used to end in one artifact they react to ends HERE instead, and this verb is what makes that a real
 * substitution rather than a removal — `../../../pages/shell.ts` supplies the document the platform used to
 * add, and the house design a page with none of its own reads in; `../../../pages/publish.ts` keeps every version, and the line this prints is what a card, a board row
 * or a Slack reply links.
 *
 * The one effectful edge: it reads the fragment, resolves the home and owns the clock. Everything it decides
 * is decided in the two pure modules above it, and what it SAYS is decided by {@link publishedLines}.
 *
 * Before anything is written (`./publishFragment.ts`), every bare reference the install's atlas and the page's own
 * links resolve is wrapped in a link (`../../../pages/identifiers.ts` — the Slack door's rule, on a page), each
 * printed as `linked <id> → <url>`; then `../../../pages/lint.ts` reads the LINKED fragment for an image the
 * console cannot load, a machine timestamp in prose, an identifier still unlinked and a raw machine id, and a
 * finding refuses the publish. The linked bytes are what is published and frozen, into the store
 * alone. This verb is the hand-authored path; `supervisor tick` and `proposal publish` inject the same
 * publisher directly and
 * their renderers own their own shape, so the lint sits here rather than inside it — and so does the review gate
 * (`./publishReview.ts`), which refuses a page citing no review and appends the review fold.
 */
import { resolve } from "node:path";

import { pageDesktopLink } from "../../../desktop/deepLink.js";
import { heldRunSlug } from "../../../handover/registerProvenance.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import type { PagePublisher, PublishedPage } from "../../../pages/publish.js";
import type { PageReviewRecord } from "../../../pages/review.js";
import { renderPageReviewFold } from "../../../pages/reviewFold.js";
import { writePageReviewRecord } from "../../../pages/reviewRepo.js";
import type { PageReviewReads } from "../../../pages/reviewResolve.js";
import { SHELL_BYTES } from "../../../pages/shell.js";
import { pageIdentity } from "../../../pages/url.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { pagePublishOptions, VERB_ARG_OFFSET } from "./core.js";
import { publishableFragment } from "./publishFragment.js";
import { type HeldRunReader, lockHeldRun, recordArtifact } from "./publishHeldRun.js";
import { pagePublishReview, productionPageReviewReads } from "./publishReview.js";
import { PAGE_PUBLISH_USAGE } from "./usage.js";

/**
 * What one publish prints on the data channel: the address first, then the two facts a caller needs.
 *
 * The ADDRESS is line one and alone on it, so `slopweaver page publish … | head -1` is the address and
 * nothing else — the shape a card composer actually pipes. The two lines under it answer the questions the
 * platform used to answer for free: how much of the page is the shell, and what identity a ruling about it
 * is recorded under.
 *
 * @param page what the publish produced
 * @param slug the page's slug, which is also its ledger identity
 * @param json whether the caller asked for the same facts as one object instead
 * @param review the review record the page carries and where it was written, when the publish decided one
 * @returns the lines to write, in order
 */
export function publishedLines({
  page,
  slug,
  json,
  review,
}: {
  page: PublishedPage;
  slug: string;
  json: boolean;
  review?: { readonly path: string; readonly record: PageReviewRecord };
}): readonly string[] {
  if (json) {
    return [
      JSON.stringify({
        bytes: page.bytes,
        identity: pageIdentity({ slug }),
        path: page.path,
        sha256: page.frozen.sha256,
        shellBytes: SHELL_BYTES,
        desktopLink: pageDesktopLink({ slug }),
        slug,
        url: page.url,
        ...(review === undefined ? {} : { review: review.record.status, reviewPath: review.path }),
      }),
    ];
  }
  const lines = [
    page.url,
    `  open it as a new tab in their desktop app: ${pageDesktopLink({ slug })}`,
    `  ${String(page.bytes)} bytes (${String(SHELL_BYTES)} of them the document shell), frozen as ${page.frozen.sha256}`,
    `  a ruling about this page is recorded against \`${pageIdentity({ slug })}\``,
  ];
  if (review !== undefined) {
    const said =
      review.record.status === "waived"
        ? "published UNREVIEWED under the unreviewed-page hatch, and its fold tells them so"
        : `carries ${String(review.record.reviews.length)} review(s) in its fold`;
    lines.push(`  ${said}; the record is ${review.path}`);
  }
  return lines;
}

/**
 * Print a refusal's lines and hand back its exit code, so each early return in {@link runPagePublish} is one line.
 *
 * @param lines what the refusal prints, in order
 * @param code the exit code the refusal ends on
 * @returns `code`, unchanged
 */
function refuse({
  lines,
  code,
  writeDiagnostic,
}: {
  lines: readonly string[];
  code: number;
  writeDiagnostic: (line: string) => void;
}): number {
  for (const line of lines) {
    writeDiagnostic(line);
  }
  return code;
}

/**
 * Run `page publish` against injected sinks, clock and review reads.
 *
 * @param rest the argv tail after `page publish`
 * @param nowIso the instant the freeze is stamped with, unless `--now` overrides it
 * @param writeOut where the address and its two facts are printed
 * @param writeDiagnostic where a usage, lint, review or publish refusal is printed
 * @param lintWaived whether `SLOPWEAVER_ALLOW_PAGE_LINT=1` lets a page with lint findings publish anyway
 * @param heldRun which run the current session holds, whose journal records the page as its artifact
 * @param reviewWaived whether `SLOPWEAVER_ALLOW_UNREVIEWED_PAGE=1` lets a page with no `--review` publish, waived
 * @param reviewReads how a cited review is resolved back to the page it judged
 * @param publish writes the page, its freeze and its images into the store
 * @returns the process exit code — `--assets-from` is resolved against the working directory once, so the lint and
 *   the read see the same directory, and the review compares the linked bytes `page review-prepare` committed
 */
export async function runPagePublish({
  rest,
  nowIso,
  writeOut,
  writeDiagnostic,
  lintWaived,
  heldRun,
  reviewWaived,
  reviewReads,
  publish,
}: {
  rest: readonly string[];
  nowIso: string;
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
  lintWaived: boolean;
  heldRun: HeldRunReader;
  reviewWaived: boolean;
  reviewReads: PageReviewReads;
  publish: PagePublisher;
}): Promise<number> {
  const options = pagePublishOptions({ rest });
  if (options.isErr()) {
    return refuse({ code: EXIT_USAGE, lines: [...options.error, PAGE_PUBLISH_USAGE], writeDiagnostic });
  }
  const { assetsFrom, home, json, pagePath: fragmentPath, slug } = options.value;
  const resolvedHome = resolveHome({ named: home });
  const assetsRoot = assetsFrom === undefined ? undefined : resolve(assetsFrom);
  const linked = publishableFragment({ assetsRoot, fragmentPath, home: resolvedHome, lintWaived, writeDiagnostic });
  if (linked === undefined) {
    return EXIT_ERROR;
  }
  // Compares the bytes written, before the closing lock: a refused review holds nothing.
  const record = await pagePublishReview({
    fragment: linked,
    home: resolvedHome,
    publishedAtIso: options.value.now.from === "flag" ? options.value.now.iso : nowIso,
    reads: reviewReads,
    reviewChanged: options.value.reviewChanged,
    reviewIds: options.value.reviewIds,
    reviewWaived,
    slug,
  });
  if (record.isErr()) {
    return refuse({ code: EXIT_ERROR, lines: record.error, writeDiagnostic });
  }
  return publishUnderHeldRun({
    assetsRoot,
    fragment: linked,
    heldRun,
    home: resolvedHome,
    json,
    nowIso,
    publish,
    record: record.value,
    slug,
    writeDiagnostic,
    writeOut,
  });
}

/**
 * Publish an already-reviewed page under the held run's closing lock, record it as that run's artifact, and print
 * the address. The lock is taken BEFORE the page is written, so a settle, finish or close can never end the run on a
 * journal the page is about to join (`../handover/closingLock.ts`).
 *
 * @param assetsRoot the directory the page's images are read from, when one was named
 * @param fragment the linked fragment, the bytes the review judged and the bytes published
 * @param record the review record the fold renders and the publish writes beside the page
 * @returns the process exit code
 */
async function publishUnderHeldRun({
  assetsRoot,
  fragment,
  heldRun,
  home,
  json,
  nowIso,
  publish,
  record,
  slug,
  writeDiagnostic,
  writeOut,
}: {
  assetsRoot: string | undefined;
  fragment: string;
  heldRun: HeldRunReader;
  home: string;
  json: boolean;
  nowIso: string;
  publish: PagePublisher;
  record: PageReviewRecord;
  slug: string;
  writeDiagnostic: (line: string) => void;
  writeOut: (line: string) => void;
}): Promise<number> {
  const held = lockHeldRun({ heldRun, home, nowIso, writeDiagnostic });
  if (held === "refused") {
    return EXIT_ERROR;
  }
  try {
    const published = await publishWithRecord({ assetsRoot, fragment, home, publish, record, slug });
    if (published.isErr()) {
      return refuse({ code: EXIT_ERROR, lines: published.error, writeDiagnostic });
    }
    if (
      held !== undefined &&
      !recordArtifact({ home, nowIso, run: held.run, url: published.value.page.url, writeDiagnostic })
    ) {
      return EXIT_ERROR;
    }
    const review = { path: published.value.recordPath, record };
    for (const line of publishedLines({ json, page: published.value.page, review, slug })) {
      writeOut(line);
    }
    return EXIT_OK;
  } finally {
    held?.release();
  }
}

/** Publish the linked fragment with its review fold, then — only once the store holds it — write the review record. */
async function publishWithRecord({
  assetsRoot,
  fragment,
  home,
  publish,
  record,
  slug,
}: {
  assetsRoot: string | undefined;
  fragment: string;
  home: string;
  publish: PagePublisher;
  record: PageReviewRecord;
  slug: string;
}): Promise<Result<{ readonly page: PublishedPage; readonly recordPath: string }>> {
  const appendix = renderPageReviewFold({ record });
  const assets = assetsRoot === undefined ? {} : { assetSource: { kind: "directory", root: assetsRoot } as const };
  const published = await publish({ ...assets, appendix, fragment, home, nowIso: record.publishedAtIso, slug });
  if (published.isErr()) {
    return err(published.error);
  }
  const written = writePageReviewRecord({ home, record });
  if (written.isErr()) {
    return err([written.error.message]);
  }
  return ok({ page: published.value, recordPath: written.value });
}

/** `slopweaver page publish`. */
export const pagePublishCommand = defineCommand({
  run: (argv) =>
    runPagePublish({
      heldRun: ({ home }) => heldRunSlug({ cwd: process.cwd(), env: process.env, home }),
      lintWaived: process.env["SLOPWEAVER_ALLOW_PAGE_LINT"] === "1",
      nowIso: new Date().toISOString(),
      publish: productionPublishPage,
      rest: argv.slice(VERB_ARG_OFFSET),
      reviewReads: productionPageReviewReads(),
      reviewWaived: process.env["SLOPWEAVER_ALLOW_UNREVIEWED_PAGE"] === "1",
      writeDiagnostic: (line) => {
        logger.error({ msg: line });
      },
      writeOut: (line) => {
        logger.out({ line });
      },
    }),
});
