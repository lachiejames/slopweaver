/**
 * The board sweep's daily Queue card — what `sweep board --write --queue` registers when the pass found something
 * only the owner can turn into an act. Pure: the pass's candidates and the day in, one `handover register` argv out.
 *
 * ## Why a card, and why only `UNCARDED`
 *
 * Without it the sweep's result reaches nothing the owner reads: the hygiene documents feed the Fleet Briefing's
 * "Nothing stale" count, and the owner does not visit boards. One verdict carries a decision the owner owns:
 * `UNCARDED`, a page the owner asked for that never reached their Queue (`./uncarded.ts`). `SHIPPED` is NOT carded:
 * a row whose own witness already says the work is in asks the owner about landing something they already ruled on,
 * a card with nothing to decide. The same pass's `--close-shipped` closes it (`../cli/commands/sweep/shippedClose.ts`).
 * `PR_ENDED` asks nothing either: GitHub answered it and `--settle-ended` settles it. `CONTRADICTED` and `OVERTAKEN`
 * are a session's to investigate, and `UNWITNESSED` is a count, never hundreds of cards.
 *
 * ## The card says what it is about
 *
 * A card whose question reads "found 1 board row(s) whose own witness says shipped — act on them?" names nothing the
 * owner can act on without opening the board, so the question NAMES each page and the row that delivered it, and only
 * falls back to a count past the first two.
 *
 * ## One per UTC day, and none on a clean pass
 *
 * The slug is `sweep-board-YYYY-MM-DD`, so a second pass the same day finds its row already on the board and
 * registers nothing — the caller checks that against the docs it already scanned. A clean pass registers nothing at
 * all: a card that says "nothing to do" is the informational card the Queue refuses. Retiring the pass's EARLIER
 * cards is the caller's (`../cli/commands/sweep/boardQueue.ts`), since that is a write rather than a plan.
 */
import { QUESTION_MAX_WORDS } from "../briefing/caps.js";
import { sentenceCount } from "../briefing/sentences.js";
import { wordCount } from "../briefing/text.js";
import { askExampleProblems } from "../handover/askExamples.js";
import { askHtmlProblems } from "../handover/cardHtml.js";
import { askImageProblems } from "../handover/cardImage.js";
import { fleetSignInProviders } from "../handover/fleetSignInGate.js";
import { pageSlugsNamedIn } from "../handover/pageReference.js";
import { workspaceRegisterArgv } from "../handover/workspace.js";
import { consolePageUrl } from "../pages/url.js";

import type { SweepCandidate } from "./classify.js";

/** The console origin a card cites a page under — a card refuses a `file:` citation. */
const CONSOLE_BASE = "http://localhost:3000";

/** The daily card's slug prefix; the UTC date follows it. */
const SWEEP_QUEUE_SLUG_PREFIX = "sweep-board-";

/** How many pages the question names by slug before it counts the rest. */
const NAMED_PAGES = 2;

/** One daily card, ready to register. */
export interface SweepQueuePlan {
  /** The row's slug, `sweep-board-YYYY-MM-DD`. */
  readonly slug: string;
  /** The full `handover register` argv, parsed exactly as the verb parses it. */
  readonly argv: readonly string[];
  /** How many distinct pages never reached the owner's Queue — two rows delivering one page count once. */
  readonly uncarded: number;
}

/** One page that never reached the owner's Queue, and the first closed row that delivered it. */
interface UncardedPage {
  readonly page: string;
  readonly row: string;
}

/**
 * The daily card's slug for one instant's UTC day.
 *
 * @param nowIso the pass's instant
 * @returns `sweep-board-YYYY-MM-DD`
 */
export function sweepQueueSlug({ nowIso }: { nowIso: string }): string {
  return `${SWEEP_QUEUE_SLUG_PREFIX}${nowIso.slice(0, "YYYY-MM-DD".length)}`;
}

/**
 * Whether a slug is one of the sweep's own daily cards.
 *
 * @param slug a board row's slug
 * @returns true for `sweep-board-YYYY-MM-DD`
 */
export function isSweepQueueSlug({ slug }: { slug: string }): boolean {
  return /^sweep-board-\d{4}-\d{2}-\d{2}$/u.test(slug);
}

/**
 * Every distinct page the UNCARDED rows name, each with the first row that delivered it.
 * MEASURED (`slopweaver sweep board --verdict UNCARDED`): three closed talk rows carried the one
 * `page:briefing-review-cycle`, and a row count would have told the owner 12 for 10 pages.
 */
function uncardedPages({ home, rows }: { home: string; rows: readonly SweepCandidate[] }): readonly UncardedPage[] {
  const seen = new Map<string, string>();
  rows.forEach((row) => {
    pageSlugsNamedIn({ home, text: row.witness }).forEach((page) => {
      if (!seen.has(page)) {
        seen.set(page, row.slug);
      }
    });
  });
  return [...seen.entries()].map(([page, row]) => ({ page, row }));
}

/**
 * The question, naming the first pages and the rows that delivered them. A row with no page it names still counts as
 * one, so a witness the page reader cannot parse never makes the card vanish.
 */
function askLine({ pages, fallbackRow }: { pages: readonly UncardedPage[]; fallbackRow: string }): string {
  if (pages.length === 0) {
    return admittedText({
      named: `The page you asked for on ${fallbackRow} was published and that row closed, but it never reached your Queue — card it now?`,
      unnamed: "A page you asked for was published and its row closed, but it never reached your Queue — card it now?",
    });
  }
  if (pages.length === 1) {
    const only = pages[0]!;
    return admittedText({
      named: `The page ${only.page}, which you asked for on ${only.row}, was published and that row closed, but it never reached your Queue — card it now?`,
      unnamed: "A page you asked for was published and its row closed, but it never reached your Queue — card it now?",
    });
  }
  const named = pages.slice(0, NAMED_PAGES).map((entry) => `${entry.page} (from ${entry.row})`);
  const rest = pages.length - named.length;
  const list = rest > 0 ? `${named.join(", ")} and ${String(rest)} more` : named.join(" and ");
  return admittedText({
    named: `${String(pages.length)} pages you asked for were published and their rows closed, but never reached your Queue: ${list} — card them now?`,
    unnamed: `${String(pages.length)} pages you asked for were published and their rows closed, but never reached your Queue — card them now?`,
  });
}

/** The options: card, or leave, worded for one page or several. */
function optionsFor({ count }: { count: number }): readonly string[] {
  if (count <= 1) {
    return [
      "Card the page :: one Queue card asking what you make of it",
      "Leave it :: tomorrow's sweep names the same page again",
    ];
  }
  return [
    "Card each page :: one Queue card per page, each asking what you make of it",
    "Leave them :: tomorrow's sweep names the same pages again",
  ];
}

/**
 * The scene: the first uncarded page — a scene sentence, then the question, because `handover register` refuses an
 * example that does not close on one (`askExampleProblems`). MEASURED: a `sweep-board-daily` firing exited 1 on
 * "example 1 is only a question" while the scene ended on the row's witness with no question at all (repro: the
 * recipe's slot ledger, `slopweaver automation repair sweep-board-daily`; held by
 * `src/__tests__/unit/sweep/dailyQueue.test.ts`). The witness itself is never quoted: register gates an example on
 * more than its shape — an image or bare `.html` name, a provider sign-in phrase.
 */
function exampleScene({ pages, fallbackRow }: { pages: readonly UncardedPage[]; fallbackRow: string }): string {
  const first = pages[0];
  const row = first === undefined ? fallbackRow : first.row;
  const where = first === undefined ? row : consolePageUrl({ consoleBase: CONSOLE_BASE, slug: first.page });
  return admittedScene({
    named:
      `You open your Queue and the page you asked ${row} for, ${where}, is not on it, though it was ` +
      "published and the row closed. Should it reach your Queue now?",
    unnamed:
      "You open your Queue and a page you asked for is not on it, though it was published and its row closed. " +
      "Should it reach your Queue now?",
  });
}

/**
 * The scene naming the row when register would admit it, else the same scene naming none. A `SAFE_SLUG`
 * (`../handover/runStore.ts`) may carry a dot, so a slug such as `proof.png` alone trips the picture gate.
 * The checks are every text-only rule `handover register` applies to an example.
 */
function admittedScene({ named, unnamed }: { named: string; unnamed: string }): string {
  return admitted({ named, problems: sceneAdmissionProblems, unnamed });
}

/**
 * {@link admittedScene} for the question: the picture, HTML and sign-in gates, plus the card's own question shape —
 * one sentence ending `?`, at most `QUESTION_MAX_WORDS` words — since a `SAFE_SLUG` may carry a dot that ends a
 * sentence early.
 */
function admittedText({ named, unnamed }: { named: string; unnamed: string }): string {
  return admitted({ named, problems: questionAdmissionProblems, unnamed });
}

/** Every refusal the question would meet: {@link textAdmissionProblems}, then its sentence and word caps. */
function questionAdmissionProblems({ text }: { text: string }): readonly string[] {
  const shape: string[] = [];
  if (sentenceCount({ text }) !== 1 || !text.endsWith("?")) {
    shape.push("the question is not one sentence ending in ?");
  }
  const words = wordCount({ text });
  if (words > QUESTION_MAX_WORDS) {
    shape.push(`the question runs ${String(words)} words against a cap of ${String(QUESTION_MAX_WORDS)}`);
  }
  return [...textAdmissionProblems({ text }), ...shape];
}

/** The named text when `problems` admits it, else the unnamed one, which must be admitted. */
function admitted({
  named,
  unnamed,
  problems,
}: {
  named: string;
  unnamed: string;
  problems: (args: { text: string }) => readonly string[];
}): string {
  const text = problems({ text: named }).length === 0 ? named : unnamed;
  const left = problems({ text });
  // The unnamed texts are fixed, so a refusal here is this file's defect, never a row's: fail loudly rather than
  // hand register an argv it will refuse, which is the recipe failure this function exists to end.
  if (left.length > 0) {
    throw new Error(`sweep daily card: the fixed text is no longer admitted — ${left.join("; ")}`);
  }
  return text;
}

/** Every text-only refusal `handover register` would raise on one field, a sign-in phrase named by its provider. */
function textAdmissionProblems({ text }: { text: string }): readonly string[] {
  const fields = [{ label: "field", text }];
  return [
    ...askImageProblems({ fields }),
    ...askHtmlProblems({ fields }),
    ...fleetSignInProviders({ text }).map((provider) => `it asks for a ${provider} sign-in`),
  ];
}

/** Every text-only refusal `handover register` would raise on one example. */
function sceneAdmissionProblems({ text }: { text: string }): readonly string[] {
  return [...askExampleProblems({ examples: [text], gap: undefined }), ...textAdmissionProblems({ text })];
}

/**
 * The daily card for one pass, or undefined when the pass found nothing the owner decides.
 *
 * @param candidates every row the pass classified, terminal UNCARDED ones included
 * @param nowIso the pass's instant, whose UTC day names the card
 * @param home the state home the card registers into, and that a `file:` page lives under
 * @returns the plan, or undefined on a pass with no UNCARDED row
 */
export function sweepQueuePlan({
  candidates,
  nowIso,
  home,
}: {
  candidates: readonly SweepCandidate[];
  nowIso: string;
  home: string;
}): SweepQueuePlan | undefined {
  const uncardedRows = candidates.filter((candidate) => candidate.verdict === "UNCARDED");
  const fallback = uncardedRows[0];
  if (fallback === undefined) {
    return undefined;
  }
  const slug = sweepQueueSlug({ nowIso });
  const pages = uncardedPages({ home, rows: uncardedRows });
  const count = Math.max(pages.length, 1);
  const argv = [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    askLine({ fallbackRow: fallback.slug, pages }),
    "--slug",
    slug,
    "--problem",
    "Each was published for you and its row closed, but no card, ruling or hand step ever put it in front of you.",
    "--options",
    optionsFor({ count }).join("\n"),
    "--lean",
    "Card them — each is a page you asked for, and none has reached you yet.",
    "--risk",
    "A page another card already carries under a different address would reach you twice.",
    "--blast-radius",
    "Your Queue and the local board only; nothing leaves this machine.",
    "--still-real",
    "slopweaver sweep board --verdict UNCARDED still names the page",
    "--example",
    exampleScene({ fallbackRow: fallback.slug, pages }),
    ...workspaceRegisterArgv({
      stated: { because: "the board sweep is the fleet's own hygiene, on the owner's machine", workspace: "self" },
    }),
    "--home",
    home,
  ];
  return { argv, slug, uncarded: pages.length };
}
