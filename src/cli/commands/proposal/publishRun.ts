/**
 * `slopweaver proposal publish` and `teaser` — the effectful shells. `intake` is `./intakeRun.js`.
 *
 * ## `publish` is a composition, not a second writer
 *
 * It lints the bytes and then hands them to the install's destination through that provider's own door:
 * `notion page` for a Notion page, `page publish` for a local page. There is exactly one path from this
 * program to each, and a proposal is one caller of it — so the ownership ledger, the authorship check, the
 * intent reservation and the door record are the ones that door already carries, rather than a parallel set
 * that could drift.
 *
 * ## Where it goes is the install's choice, read from the store
 *
 * A first publish goes wherever `proposal destination set` recorded (`destination.json` under the state home),
 * never a flag repeated per run and never a default this repository assumes. With none set the verb refuses,
 * naming the command that sets one.
 *
 * ## The lint gate is what makes this verb different from `notion page`
 *
 * `notion page` will publish any markdown. `proposal publish` REFUSES a document with a blocking finding, so
 * a proposal cannot reach a page carrying an uncited figure, a missing section, or a phrase from the
 * operator's own banned list.
 *
 * ## `teaser` renders. It never posts.
 *
 * Posting under the owner's own name is the owner's act. This verb prints the form `slack post --as me` accepts.
 */
import { dirname } from "node:path";

import { addressLabel, type ProposalAddress } from "../../../outbound/proposal/address.js";
import { readProposalDestination } from "../../../outbound/proposal/destinationStore.js";
import { blockingUnanswered, type ProposalIntake } from "../../../outbound/proposal/intake.js";
import { loadIntake, saveIntake } from "../../../outbound/proposal/intakeStore.js";
import { lintProposal, proposalFindingLines } from "../../../outbound/proposal/lint/lintProposal.js";
import { deriveRegisterSlug } from "../../../outbound/proposal/register/identity.js";
import { appendRegisterEvent, loadRegisterEntry } from "../../../outbound/proposal/register/store.js";
import { renderTeaser } from "../../../outbound/proposal/teaser.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseProposalForm } from "./core.js";
import { proposalErrorLines } from "./errors.js";
import {
  parseProposalPublishArgs,
  parseProposalTeaserArgs,
  publishTarget,
  requirePublishTitle,
} from "./publishCore.js";
import {
  type ProposalPublishDeps,
  type PublishOutcome,
  productionProposalPublishDeps,
  refuse,
  VERB_ARG_OFFSET,
} from "./publishRunShared.js";

/**
 * The lint gate over the bytes about to be published, or the refusal it produced.
 *
 * A `profile.json` that is there but corrupt refuses with the error code rather than linting against no voice
 * rules, which would pass every phrase the owner bans. It is a fact about the install, not a finding.
 */
function lintGate({
  deps,
  markdown,
  home,
}: {
  deps: ProposalPublishDeps;
  markdown: string;
  home: string;
}): { readonly code: number; readonly lines: readonly string[] } | undefined {
  const voiceRules = deps.voiceRules({ home });
  if (voiceRules.isErr()) {
    return { code: EXIT_ERROR, lines: [`refused: ${voiceRules.error.message}. nothing was published.`] };
  }
  const { findings, blocked } = lintProposal({ markdown, voiceRules: voiceRules.value });
  for (const line of proposalFindingLines({ findings })) {
    deps.err(line);
  }
  if (!blocked) {
    return undefined;
  }
  return { code: EXIT_EXPECTED_EMPTY, lines: ["refusing to publish: fix the blocking findings above first."] };
}

/**
 * The intake this publish belongs to, or the refusal that stops it.
 *
 * Question-first intake, enforced at the irreversible step. A proposal published past a question only the
 * stakeholder can settle is the document that gets rewritten after somebody reads it, and that is the
 * expensive rewrite: the numbers and the shots were gathered around the wrong argument.
 */
function resolveIntake({
  home,
  intakeId: id,
}: {
  home: string;
  intakeId: string | undefined;
}):
  | { readonly record: ProposalIntake | undefined }
  | { readonly errors: readonly string[]; readonly unreadable: boolean } {
  if (id === undefined) {
    return { record: undefined };
  }
  const loaded = loadIntake({ home, id });
  if (loaded.isErr()) {
    return { errors: [loaded.error.message], unreadable: true };
  }
  const record = loaded.value;
  const open = blockingUnanswered({ intake: record });
  if (open.length > 0) {
    return {
      errors: [
        `intake ${record.id} still has ${String(open.length)} blocking question(s) open:`,
        ...open.map((question) => `  ${question.key}: ${question.question}`),
        "Answer them with the stakeholder before this goes out.",
      ],
      unreadable: false,
    };
  }
  return { record };
}

/** The draft's text, or `undefined` when the file cannot be read — the caller refuses naming the path. */
function readDraft({ deps, path }: { deps: ProposalPublishDeps; path: string }): string | undefined {
  try {
    return deps.readText({ source: path });
  } catch {
    return undefined;
  }
}

/**
 * Run `proposal publish`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runProposalPublish({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalPublishDeps;
}): Promise<number> {
  const parsed = parseProposalPublishArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  // The install's destination is read FIRST: with none set, there is nowhere this proposal could go, and
  // linting a draft only to refuse it afterwards would report findings for a publish that was never possible.
  const destination = readProposalDestination({ home });
  if (destination.isErr()) {
    return refuse({
      code: destination.error.code === "DESTINATION_UNSET" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR,
      deps,
      lines: [destination.error.message],
    });
  }
  const titled = requirePublishTitle({ destination: destination.value, title: args.title });
  if (titled.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: titled.error }) });
  }
  const markdown = readDraft({ deps, path: args.path });
  if (markdown === undefined) {
    return refuse({ code: EXIT_ERROR, deps, lines: [`cannot read ${args.path}`] });
  }
  const blockedBy = lintGate({ deps, home, markdown });
  if (blockedBy !== undefined) {
    return refuse({ code: blockedBy.code, deps, lines: blockedBy.lines });
  }
  const intake = resolveIntake({ home, intakeId: args.intakeId });
  if ("errors" in intake) {
    // A missing or malformed intake is a usage problem; an unanswered question is a legitimate "not yet" status.
    return refuse({ code: intake.unreadable ? EXIT_USAGE : EXIT_EXPECTED_EMPTY, deps, lines: intake.errors });
  }
  const target = publishTarget({ destination: destination.value, intake: intake.record });
  if (target.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: proposalErrorLines({ error: target.error }) });
  }
  const outcome = await deps.publish({
    dryRun: args.dryRun,
    home,
    icon: args.icon,
    intakeId: intake.record?.id,
    // The draft file's own directory, because `![](file:./shots/hero.png)` in a draft means relative to the
    // draft. The body reaches the destination's door in memory, so it has nothing else to resolve against.
    mediaBase: dirname(args.path),
    markdown,
    target: target.value,
    title: args.title,
  });
  recordPublish({ args, deps, home, outcome, record: intake.record });
  return outcome.code;
}

/**
 * Remember where this proposal published, so the NEXT publish is an update that keeps this URL rather than a
 * second copy under the same title. Nothing about the document itself could have said this.
 *
 * Also records the register entry — the only automatic write into it. Unlike the intake update above, this
 * runs whether or not `--intake` was given: a proposal published with no tracked intake still gets a
 * register entry, identified by `deriveRegisterSlug` off its title and address rather than an intake id.
 */
function recordPublish({
  args,
  deps,
  home,
  outcome,
  record,
}: {
  args: { readonly dryRun: boolean; readonly title: string | undefined };
  deps: ProposalPublishDeps;
  home: string;
  outcome: PublishOutcome;
  record: ProposalIntake | undefined;
}): void {
  // Keyed on an address having been REPORTED, never on the exit code. A publish whose images half-attached
  // exits non-zero and still created a page; forgetting it would make the next publish create a second one.
  const { address } = outcome;
  if (args.dryRun || address === undefined) {
    return;
  }
  if (record !== undefined) {
    // Only `address` is written: a legacy URL-only residue is dropped, so the record names one place.
    const { linkOnlyPageUrl: _residue, ...rest } = record;
    saveIntake({ home, intake: { ...rest, address, status: "published" } });
    deps.err(`intake ${record.id} now points at ${addressLabel({ address })}`);
  }
  recordRegisterOnPublish({ address, args, deps, home, record });
}

/** The title a register entry carries: `--title`, else the intake's brief, else a word saying it was given none. */
function registerTitle({ title, record }: { title: string | undefined; record: ProposalIntake | undefined }): string {
  if (title !== undefined) {
    return title;
  }
  if (record === undefined) {
    return "(untitled proposal)";
  }
  return record.brief;
}

/** Create or update this proposal's register entry for a non-dry-run publish that reported an address. */
function recordRegisterOnPublish({
  address,
  args,
  deps,
  home,
  record,
}: {
  address: ProposalAddress;
  args: { readonly title: string | undefined };
  deps: ProposalPublishDeps;
  home: string;
  record: ProposalIntake | undefined;
}): void {
  const slug = deriveRegisterSlug({ address, intakeId: record?.id, title: args.title });
  const title = registerTitle({ record, title: args.title });
  const existing = loadRegisterEntry({ home, slug });
  if (existing.isErr()) {
    deps.err(`could not read the register entry for ${slug}: ${existing.error.message}`);
    return;
  }
  const atIso = deps.now().toISOString();
  const event =
    existing.value === undefined
      ? { address, atIso, intakeId: record?.id, kind: "created" as const, source: "publish" as const, title }
      : { address, atIso, kind: "destination-linked" as const, title };
  const appended = appendRegisterEvent({ event, home, slug });
  if (appended.isErr()) {
    deps.err(`could not update the register entry for ${slug}: ${appended.error.message}`);
    return;
  }
  deps.err(`registered as ${slug}`);
}

/**
 * The link a teaser leads with: `--page`, else the URL its intake published to (a legacy URL-only record
 * included), else none — an address whose destination handed back no URL has nothing a reader can click.
 */
function teaserLink({
  pageUrl,
  intake,
}: {
  pageUrl: string | undefined;
  intake: ProposalIntake | undefined;
}): string | undefined {
  if (pageUrl !== undefined) {
    return pageUrl;
  }
  if (intake === undefined) {
    return undefined;
  }
  if (intake.address !== undefined) {
    return intake.address.url;
  }
  return intake.linkOnlyPageUrl;
}

/** The intake a teaser refusal names: its id, or `(none)` for a teaser asked for with no `--intake`. */
function namedIntake({ intakeId }: { intakeId: string | undefined }): string {
  if (intakeId === undefined) {
    return "(none)";
  }
  return intakeId;
}

/**
 * Run `proposal teaser`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runProposalTeaser({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalPublishDeps;
}): Promise<number> {
  const parsed = parseProposalTeaserArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const form = parseProposalForm({ raw: deps.readText({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: form.error }) });
  }
  const fromIntake = args.intakeId === undefined ? undefined : loadIntake({ home, id: args.intakeId });
  if (fromIntake?.isErr() === true) {
    return refuse({ code: EXIT_USAGE, deps, lines: [fromIntake.error.message] });
  }
  const intake = fromIntake?.isOk() === true ? fromIntake.value : undefined;
  const proposalUrl = teaserLink({ intake, pageUrl: args.pageUrl });
  if (proposalUrl === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: [
        `intake ${namedIntake({ intakeId: args.intakeId })} has not published a page yet, so there is no link to lead with. ` +
          "Publish first, or pass --page <url>.",
      ],
    });
  }
  deps.out(JSON.stringify(renderTeaser({ form: form.value, proposalUrl }), null, 2));
  deps.err("this is a FORM, not a post. Send it yourself with:");
  deps.err("  slopweaver slack post --as me --channel <id> --shape top-level --form -");
  return EXIT_OK;
}

/** `slopweaver proposal publish` — lint-gated publish through the one Notion write path. */
export const proposalPublishCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalPublish({ argv, deps: productionProposalPublishDeps() }),
});

/** `slopweaver proposal teaser` — render the Slack announce form. It never posts. */
export const proposalTeaserCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalTeaser({ argv, deps: productionProposalPublishDeps() }),
});
