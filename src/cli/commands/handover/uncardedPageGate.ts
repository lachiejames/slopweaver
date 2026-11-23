/**
 * The uncarded-page gate: a run whose deliverable is a page cannot close until that page reached the owner's Queue.
 *
 * Asked by `handover settle` when its `--witness` or the row's effective artifact is a page, and by `handover finish`
 * when that artifact is one — the moment a session is about to walk away. The rule, the evidence and the measured defect
 * (nine briefings the owner asked for settled `answered` with a page witness and never carded) are in
 * `../../../handover/pageDelivery.ts`; this file is the effectful shell around it: read the journal, the lock-in
 * ledger and the hand register, decide, print the four-line refusal.
 *
 * ## Failure direction
 *
 * No page candidate means no auxiliary read at all, so every non-page settle (`github landing --register`'s pull
 * request witness, `sweep apply`'s decline) is untouched. A register that exists and will not read REFUSES rather
 * than passing: an outage that answers "nothing reached the owner" would be wrong in the safe direction, and one that
 * answers "it reached the owner" is the defect itself. The hatch, `SLOPWEAVER_ALLOW_UNCARDED_PAGE=1`, is for a page
 * nobody reacts to — a regenerated proof page, an internal artifact.
 */
import type { HandStep } from "../../../hand/step.js";
import { handRegisterPath, readHandRows } from "../../../hand/store.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { artifactPageSlug, handPageStepsOf, uncardedPageSlugs } from "../../../handover/pageDelivery.js";
import { pageSlugFromReference } from "../../../handover/pageReference.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { hatchEnvVar } from "../../../hatch/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { consolePageUrl, pageIdentity } from "../../../pages/url.js";
import { parseLockInRows, readLockInLedgerExact } from "../../../sessionStart/lockIn.js";

/** This gate's hatch, resolved once — `SLOPWEAVER_ALLOW_UNCARDED_PAGE`, the row naming this file as its reader. */
const UNCARDED_PAGE_HATCH = hatchFor({ id: "uncarded-page" });

/** The console origin a card cites a page under — `cardHtml.ts` refuses a `file:` citation. */
const CONSOLE_BASE = "http://localhost:3000";

/** The two registers the gate reads, as plain functions so a test passes fakes rather than a mock. */
export interface PageReachReaders {
  /** Every lock-in identity the owner has ruled on, or why the ledger would not read. */
  readonly ruledIdentities: ({ home }: { home: string }) => Result<ReadonlySet<string>>;
  /** Every hand step ever posted, settled ones included, or why the register would not read. */
  readonly handSteps: ({ home }: { home: string }) => Result<readonly HandStep[]>;
}

/** The install's own registers. */
export const HOME_PAGE_REACH_READERS: PageReachReaders = {
  handSteps: ({ home }) => {
    const read = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
    if (read.isErr()) {
      return err([read.error.message]);
    }
    return ok(read.value.rows.flatMap((row) => (row.kind === "posted" ? [row.step] : [])));
  },
  ruledIdentities: ({ home }) =>
    readLockInLedgerExact({ home }).map((text) => new Set(parseLockInRows({ text }).map((row) => row.identity))),
};

/**
 * Which pages a closing verb is about to treat as delivered: `finish` the row's own artifact, `settle` that artifact
 * AND its witness. A settle that checked only its witness closed a run whose published page was the deliverable
 * behind a non-page witness.
 */
export type PageCandidate = { readonly kind: "settlement"; readonly witness: string } | { readonly kind: "artifact" };

/** The pages a candidate names, given the row's journal, each once. */
function candidateSlugs({
  candidate,
  doc,
  events,
  home,
}: {
  candidate: PageCandidate;
  doc: HandoverDoc;
  events: readonly RunEvent[];
  home: string;
}): readonly string[] {
  const artifact = artifactPageSlug({ doc, events, home });
  const witness =
    candidate.kind === "settlement" ? pageSlugFromReference({ home, reference: candidate.witness }) : undefined;
  return [...new Set([witness, artifact].filter((slug): slug is string => slug !== undefined))];
}

/**
 * The refusal's body: each page that never reached the owner, and the command that puts it on their Queue.
 *
 * @param rowSlug the row being closed
 * @param pages the pages with no reach evidence
 * @param verb the closing verb, as typed
 * @returns the lines before the four-line hatch refusal
 */
export function uncardedPageLines({
  rowSlug,
  pages,
  verb,
}: {
  rowSlug: string;
  pages: readonly string[];
  verb: string;
}): readonly string[] {
  return [
    `handover ${verb}: ${rowSlug} delivered ${String(pages.length)} page(s) that never reached the owner's Queue — no question naming it, no ruling, no hand step:`,
    ...pages.flatMap((page) => [
      `  ${pageIdentity({ slug: page })}`,
      `    slopweaver handover ask ${rowSlug} --question "<the decision> — ${consolePageUrl({ consoleBase: CONSOLE_BASE, slug: page })}" --problem … --options … --lean … --risk … --blast-radius … --still-real … --example …`,
    ]),
    "  the ask keeps the row on the owner's Queue until they answer; settle or finish after that",
  ];
}

/**
 * Ask whether the page a closing verb is about to treat as delivered reached the owner, and say whether to refuse.
 *
 * @param verb the verb being gated, interpolated into every line
 * @param doc the row being closed
 * @param candidate a settle's witness beside the row's effective artifact, or that artifact alone for `finish`
 * @param home the state home whose registers are read, and that a `file:` page must live under
 * @param runsDir where the row's journal lives
 * @param writeDiagnostic where the refusal or the hatch receipt is printed
 * @param readers how the lock-in ledger and hand register are read; the install's own when absent
 * @returns true when the caller must stop
 */
export function uncardedPageGateRefuses({
  verb,
  doc,
  candidate,
  home,
  runsDir,
  writeDiagnostic,
  readers = HOME_PAGE_REACH_READERS,
}: {
  verb: string;
  doc: HandoverDoc;
  candidate: PageCandidate;
  home: string;
  runsDir: string;
  writeDiagnostic: (line: string) => void;
  readers?: PageReachReaders | undefined;
}): boolean {
  const journal = readRunJournal({ runsDir, slug: doc.slug });
  if (journal.isErr()) {
    writeDiagnostic(`handover ${verb}: ${journal.error.message}`);
    return refuseUnlessForced({ lines: [], verb: `handover ${verb}`, writeDiagnostic });
  }
  const events = journal.value.events;
  const slugs = candidateSlugs({ candidate, doc, events, home });
  if (slugs.length === 0) {
    return false;
  }
  const ruled = readers.ruledIdentities({ home });
  const steps = readers.handSteps({ home });
  if (ruled.isErr() || steps.isErr()) {
    const unread = [...(ruled.isErr() ? ruled.error : []), ...(steps.isErr() ? steps.error : [])];
    return refuseUnlessForced({
      lines: unread.map((line) => `handover ${verb}: could not tell whether the page reached the owner — ${line}`),
      verb: `handover ${verb}`,
      writeDiagnostic,
    });
  }
  const missing = uncardedPageSlugs({
    facts: {
      doc,
      events,
      handPageSteps: handPageStepsOf({ home, steps: steps.value }),
      ruledIdentities: ruled.value,
    },
    home,
    slugs,
  });
  if (missing.length === 0) {
    return false;
  }
  return refuseUnlessForced({
    lines: uncardedPageLines({ pages: missing, rowSlug: doc.slug, verb }),
    verb: `handover ${verb}`,
    writeDiagnostic,
  });
}

/**
 * Ask whether `page publish` must refuse a page for a run the session holds that is already CLOSED: recorded there,
 * the page would never meet a gate, and published unrecorded it is the run's deliverable left off the owner's Queue.
 * Nothing is written on a refusal; the same hatch lets a page nobody reacts to through.
 *
 * @param run the closed run the publishing session holds
 * @param writeDiagnostic where the refusal or the hatch receipt is printed
 * @returns true when the publish must stop before writing
 */
export function closedRunPageRefuses({
  run,
  writeDiagnostic,
}: {
  run: string;
  writeDiagnostic: (line: string) => void;
}): boolean {
  return refuseUnlessForced({
    lines: [
      `page publish: run ${run} is already closed, so a page published as its deliverable would never be gated onto the owner's Queue — nothing was written`,
      `  re-open it (SLOPWEAVER_ALLOW_RERUN=1 slopweaver handover start ${run}), publish there, and ask the owner with \`slopweaver handover ask ${run}\``,
    ],
    verb: "page publish",
    writeDiagnostic,
  });
}

/** Print the refusal and return true, or — with the hatch open — say loudly it was forced and return false. */
function refuseUnlessForced({
  lines,
  verb,
  writeDiagnostic,
}: {
  lines: readonly string[];
  verb: string;
  writeDiagnostic: (line: string) => void;
}): boolean {
  const variable = hatchEnvVar({ suffix: "UNCARDED_PAGE" });
  if (process.env[variable] === "1") {
    writeDiagnostic(
      `${verb}: FORCED past the uncarded-page gate by ${variable}=1 — the page is not on the owner's Queue`,
    );
    return false;
  }
  for (const line of [...lines, ...hatchRefusalLines({ hatch: UNCARDED_PAGE_HATCH })]) {
    writeDiagnostic(line);
  }
  return true;
}
