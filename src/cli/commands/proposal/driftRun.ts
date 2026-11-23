/**
 * `slopweaver proposal drift` — the effectful shell over `../../../outbound/proposal/register/drift.ts`.
 *
 * It reads when each tracked proposal's destination was last edited (`./driftFreshness.ts` — a Notion page, a
 * Linear document or a local page, each by its own clock) and compares that against the newest material event in
 * that proposal's own journal. It writes NOTHING — not to a provider, not under
 * `$SLOPWEAVER_HOME` — which is why its manifest effect is `external-read` rather than the `local-state`
 * `proposal sync` carries for a network read that persists what it found.
 *
 * It is a DIAGNOSTIC: finding drift is the verb working, exactly as a blocking `proposal lint` finding is, so
 * a drifted proposal exits `EXIT_EXPECTED_EMPTY` and only a genuine failure exits `EXIT_ERROR`. That split is
 * what makes it usable as a check rather than as a report somebody has to remember to read. A proposal that
 * could not be assessed exits `EXIT_EXPECTED_EMPTY` too: it is not a broken tool, but a scan that could not see
 * a proposal has not found it clean, and an exit of zero would say it had.
 */
import { logger } from "../../../lib/logger.js";
import type { ProposalAddress } from "../../../outbound/proposal/address.js";
import { assessProposalDrift, type ProposalDriftVerdict } from "../../../outbound/proposal/register/drift.js";
import { foldRegisterEntry } from "../../../outbound/proposal/register/events.js";
import { listRegisterSlugs, readRegisterJournal } from "../../../outbound/proposal/register/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type DestinationFreshness, productionDestinationLastEdited } from "./driftFreshness.js";
import { proposalErrorLines } from "./errors.js";
import { parseProposalDriftArgs } from "./registerCoreRead.js";

/** Where a verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies a plain function returning synthetic times; nothing here is a mock. */
export interface ProposalDriftDeps {
  /** When one proposal's destination was last edited, or the reason it cannot be assessed. */
  readonly lastEdited: (args: { address: ProposalAddress; home: string }) => Promise<DestinationFreshness>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** One proposal's assessment, ready to render. */
interface DriftRow {
  readonly slug: string;
  readonly title: string;
  /** Where the proposal lives; absent only for a slug whose journal could not be folded into an entry. */
  readonly address: ProposalAddress | undefined;
  readonly verdict: ProposalDriftVerdict;
}

/** Print each line to stderr and return the code. */
function refuse({ deps, lines, code }: { deps: ProposalDriftDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** The one readable line each proposal gets. */
function rowLine({ row }: { row: DriftRow }): string {
  const { verdict } = row;
  switch (verdict.kind) {
    case "drifted":
      return (
        `DRIFTED  ${row.slug}  ${String(verdict.daysBehind)}d — last edited ${verdict.destinationLastEditedIso}, ` +
        `but "${verdict.what}" ${verdict.basis === "occurred" ? "happened" : "was recorded"} ` +
        `${verdict.latestMaterialIso}`
      );
    case "no-drift-evidence":
      return `ok       ${row.slug}  edited ${verdict.destinationLastEditedIso}, at or after "${verdict.latestMaterialIso}"`;
    case "no-material-events":
      return `ok       ${row.slug}  nothing material recorded yet`;
    case "unassessable":
      return `?        ${row.slug}  ${verdict.why}`;
  }
}

/**
 * Assess one registered proposal: read its journal ONCE, fold the entry from that read, read its destination's last edit, compare.
 *
 * One read, not a load followed by a second read: an event appended between two reads could re-point the
 * proposal at another provider, and the provider guard would then judge an address the events no longer hold.
 */
async function assessOne({
  deps,
  home,
  slug,
}: {
  deps: ProposalDriftDeps;
  home: string;
  slug: string;
}): Promise<DriftRow> {
  const journal = readRegisterJournal({ home, slug });
  const entry = journal.isOk() ? foldRegisterEntry({ events: journal.value.events, slug }) : undefined;
  if (journal.isErr() || entry === undefined) {
    return {
      address: undefined,
      slug,
      title: "",
      verdict: { kind: "unassessable", why: "journal could not be read or holds no created event" },
    };
  }
  const base = { address: entry.address, slug: entry.slug, title: entry.title };
  // An undecodable line may BE the newest material event, so the comparison over what is left would be a
  // clean answer to a question this build cannot actually see all of.
  if (journal.value.unreadable.length > 0) {
    return {
      ...base,
      verdict: {
        kind: "unassessable",
        why: `journal line(s) ${journal.value.unreadable.join(", ")} cannot be decoded by this build`,
      },
    };
  }
  const edited = await deps.lastEdited({ address: entry.address, home });
  if ("why" in edited) {
    return { ...base, verdict: { kind: "unassessable", why: edited.why } };
  }
  return {
    ...base,
    verdict: assessProposalDrift({ destinationLastEditedIso: edited.lastEditedIso, events: journal.value.events }),
  };
}

/**
 * Run `proposal drift`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns `EXIT_OK` when every proposal was assessed and none drifted, `EXIT_EXPECTED_EMPTY` when one drifted
 *   or could not be assessed, `EXIT_USAGE` on a malformed invocation
 */
export async function runProposalDrift({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalDriftDeps;
}): Promise<number> {
  const parsed = parseProposalDriftArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const slugs = listRegisterSlugs({ home })
    .filter((slug) => args.slug === undefined || slug === args.slug)
    .toSorted((a, b) => a.localeCompare(b));
  if (args.slug !== undefined && slugs.length === 0) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [`no proposal registered under "${args.slug}"`] });
  }
  const rows: DriftRow[] = [];
  // Sequential, deliberately: one shared client per provider paces these calls, and racing them would just
  // queue behind the same scheduler while making the output order depend on which destination answered first.
  for (const slug of slugs) {
    rows.push(await assessOne({ deps, home, slug }));
  }
  if (args.json) {
    deps.out(JSON.stringify(rows, null, 2));
  } else {
    for (const row of rows) {
      deps.out(rowLine({ row }));
    }
  }
  const drifted = rows.filter((row) => row.verdict.kind === "drifted").length;
  const unassessable = rows.filter((row) => row.verdict.kind === "unassessable").length;
  deps.err(
    `${String(rows.length)} proposal(s): ${String(drifted)} drifted, ${String(unassessable)} unassessable. ` +
      "A clean result means no TIMESTAMP evidence of drift — any edit advances the same clock, so it never " +
      "proves the destination says the right thing.",
  );
  return drifted > 0 || unassessable > 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionProposalDriftDeps(): ProposalDriftDeps {
  return {
    err: (line) => process.stderr.write(`proposal: ${line}\n`),
    lastEdited: productionDestinationLastEdited(),
    out: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver proposal drift` — every proposal whose destination does not yet say where it ended up. */
export const proposalDriftCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalDrift({ argv, deps: productionProposalDriftDeps() }),
});
