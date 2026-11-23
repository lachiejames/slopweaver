/**
 * `slopweaver github bump-drive` — the pure argument handling, the three caps it runs under, and each child
 * verb's argv.
 *
 * The owner wants scheduled asks that take dependency bump pull requests over the line. So this verb is
 * written to be run BY A RECIPE ROW as well as by hand, and every cap below exists because of that: an
 * unattended pass must never be able to turn one firing into a landing wave or a board nobody can read.
 *
 * The subject is BOTH repositories (every dependency bump pull request is auto-merged, as is nearly any
 * slopweaver one), so `../../../live/automation/standingRows.ts`
 * declares one scheduled row per repository rather than one row naming two. The caps here are per PASS, so a
 * single row reading both would make the two backlogs compete for the same three presses.
 *
 * The rows it writes to the autonomy ledger are `./bumpDriveLedger.ts`, split off to keep this file under the
 * 300-code-line cap.
 */

import { repositoryWorkspaceArgv } from "../../../handover/workspace.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { Organisation } from "../../../organisation/core.js";
import type { DependencyBotActors } from "../../../organisation/dependencyBots.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";
import { type BumpAct, type BumpPlan, type BumpSignal, isRenovateAuthored } from "../../../review/bumpSelection.js";
import type { LandingRow } from "../../../review/landing.js";
import { commaListFlag, positiveIntFlag } from "../../optionParsers.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { BUMP_ENQUEUE_CAP, BUMP_REWRITE_CAP, BUMP_SEAT_CAP, DEFAULT_LIMIT } from "./bumpDriveUsage.js";
import { boardHold } from "./landingRegister.js";
import { DEFAULT_OPT_OUT_LABEL } from "./landingUsage.js";
import { ALLOW_FOREIGN_PR, ALLOW_PR_REPLACE } from "./updateCore.js";

/**
 * The two escape hatches one description rewrite adds to its child call, and nothing else ever.
 *
 * Both already have rows in `../../../hatch/registry.ts` and both are exactly what this act crosses:
 * `foreign-pr` because the pull request belongs to a bump bot rather than to this account, and `pr-replace`
 * because renovate's template shares no field with this repository's form, so there is nothing to amend.
 * Declared as a list so the outcome line, the usage text and the wiring all name the same two — a hatch
 * opened silently is the shape `error-handling.md` refuses.
 *
 * Read from `./updateCore.ts` rather than spelled here: the constants the reader compares against are the
 * only ones that can be right, and a literal would drift the moment either was renamed.
 */
export const BUMP_REWRITE_HATCHES: readonly string[] = [ALLOW_FOREIGN_PR, ALLOW_PR_REPLACE] as const;

const BUMP_DRIVE_STRING_FLAGS = ["repo", "limit", "opt-out-label", "home"] as const;
const BUMP_DRIVE_BOOLEAN_FLAGS = ["json", "dry-run"] as const;

/** The flags this verb accepts, in the shape `parseFlags` wants. */
const GITHUB_BUMP_DRIVE_FLAGS: FlagSpec = {
  boolean: [...BUMP_DRIVE_BOOLEAN_FLAGS],
  string: [...BUMP_DRIVE_STRING_FLAGS],
};

/**
 * Every accepted flag, WITH the `--`, for the help-truth ratchet.
 *
 * Built from the two lists above rather than read back off {@link GITHUB_BUMP_DRIVE_FLAGS}, whose fields are
 * both optional on `FlagSpec` — reading them back needs a `?? []` claiming a literal three lines up might
 * carry no flags at all.
 */
export const GITHUB_BUMP_DRIVE_FLAG_NAMES: readonly string[] = [
  ...BUMP_DRIVE_STRING_FLAGS,
  ...BUMP_DRIVE_BOOLEAN_FLAGS,
].map((name) => `--${name}`);

/** A parsed, side-effect-free bump-drive invocation. */
export interface GithubBumpDriveArgs {
  /** The repositories to read. Empty when none was typed, which the shell resolves to its own default. */
  readonly repos: readonly string[];
  readonly limit: number;
  readonly json: boolean;
  /** Describe every act exactly and perform none. */
  readonly dryRun: boolean;
  /** Labels that hold a bump back from any act, lower-cased. */
  readonly optOutLabels: readonly string[];
  readonly home: string | undefined;
}

/**
 * Parse one `github bump-drive` invocation before any credential, git remote or network is touched.
 *
 * @param rest the argv tail after `github bump-drive`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubBumpDriveArgs({ rest }: { rest: readonly string[] }): Result<GithubBumpDriveArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_BUMP_DRIVE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const limit = positiveIntFlag({ fallback: DEFAULT_LIMIT, name: "limit", problems, values });
  const repos = commaListFlag({ fallback: [], name: "repo", values });
  if (repos.some((slug) => !slug.includes("/"))) {
    problems.push("--repo takes one or more comma-separated owner/name slugs");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  const home = values["home"];
  return ok({
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    limit,
    optOutLabels: commaListFlag({ fallback: [DEFAULT_OPT_OUT_LABEL], name: "opt-out-label", values }).map((label) =>
      label.toLowerCase(),
    ),
    repos,
  });
}

/**
 * One planned act plus whether THIS pass performs it.
 *
 * `capped` is carried rather than the entry being dropped, because a bump the pass declined to act on is the
 * single most useful thing the report says: a reader who cannot see it has no way to tell a backlog that is
 * being worked from one nothing is looking at.
 */
export interface BumpScheduleEntry {
  readonly plan: BumpPlan;
  readonly capped: boolean;
}

/** Whether an act puts something in GitHub's merge queue. */
function isEnqueueing({ act }: { act: BumpAct }): boolean {
  return act === "enqueue" || act === "undraft-and-enqueue";
}

/**
 * Apply every cap to one pass's plans, in fleet order.
 *
 * The three caps count SEPARATELY, and that is the whole design: a backlog of ten conflicted bumps must not
 * be able to eat the pass's three enqueues, three landable ones must not stop the board learning about the
 * rest, and neither may spend the two description rewrites. Counted here rather than in the loop that writes,
 * so what one firing would do is assertable without a network.
 *
 * **The seat cap counts rows THIS PASS would register, never a bump the board already holds.** A seat whose
 * `boardHold` answers is skipped by `./bumpDriveActs.ts`'s `seatOne` and writes nothing, so it is scheduled
 * uncapped and spends no budget. MEASURED with nine open bumps: one pass enqueued two, seated five and
 * capped two — and counted the old way, every later firing spent its five seats on those same five live rows
 * and capped the same two, so no repeat firing could drain the backlog while the first five were being worked.
 *
 * @param plans every selected bump's planned act, in the order the read returned them
 * @returns one entry per plan, each saying whether this pass performs it
 */
export function scheduleBumpActs({ plans }: { plans: readonly BumpPlan[] }): readonly BumpScheduleEntry[] {
  let enqueues = 0;
  let seats = 0;
  let rewrites = 0;
  const scheduled: BumpScheduleEntry[] = [];
  for (const plan of plans) {
    if (isEnqueueing({ act: plan.act })) {
      enqueues += 1;
      scheduled.push({ capped: enqueues > BUMP_ENQUEUE_CAP, plan });
      continue;
    }
    if (plan.act === "rewrite-body") {
      rewrites += 1;
      scheduled.push({ capped: rewrites > BUMP_REWRITE_CAP, plan });
      continue;
    }
    if (plan.act === "seat" && boardHold({ row: plan.row }) !== undefined) {
      scheduled.push({ capped: false, plan });
      continue;
    }
    if (plan.act === "seat") {
      seats += 1;
      scheduled.push({ capped: seats > BUMP_SEAT_CAP, plan });
      continue;
    }
    scheduled.push({ capped: false, plan });
  }
  return scheduled;
}

/** The `--home` pair, or nothing, so every argv builder below spells it once. */
function homeArgs({ home }: { home: string | undefined }): readonly string[] {
  if (home === undefined) {
    return [];
  }
  return ["--home", home];
}

/**
 * Why a BOT's pull request can never satisfy the Codex pairing floor.
 *
 * Written into the door ledger with the acknowledgement, so a waived floor stays countable and says which
 * class waived it rather than reading as one more unexplained bypass.
 */
const BOT_PAIRING_REASON =
  "a dependency bump this bot opened was authored by no session, so no planning or review pass can ever " +
  "exist for it — the pairing floor's subject is work Slopweaver wrote (AGENTS.md rule 9). Its own gate " +
  "still runs in full on the merged result, and `github bump-drive` waives nothing else";

/**
 * The `github enqueue` argv one bump's press runs.
 *
 * **One `--acknowledge`, for one class, and nothing else ever.** MEASURED on the first live pass:
 * `github bump-drive --repo lachiejames/slopweaver` undrafted three bumps and then had all three
 * presses refused with `codex-loop-incomplete`, leaving each one a non-draft that did not queue. That
 * refusal can never be cleared for a bot's pull request — nobody planned it and nobody will review it — so
 * it is a CONFIG FACT, exactly as a codeowner approval that can never arrive is (`AGENTS.md` rule 1), and a
 * verb that stops there does not get a bump over the line at all.
 *
 * It fires on `bot-author` ALONE, not on a branch prefix and not on a title. The claim being made is that no
 * session authored this pull request, and only the bump bots the organisation and the generic Apps declare
 * (`../../../organisation/dependencyBots.ts`) carry that.
 * A `renovate/`-prefixed head under an unrecognised login might be a bot this install has not declared yet
 * or a session that borrowed the convention, and the fix for the first is to add the login deliberately.
 * Every other finding still refuses: a red rollup, a missing required context, an unapproved review and a
 * non-mergeable head each stop the press, and a bump held by one of those is a bump that wants a session.
 *
 * @param row the bump about to be pressed
 * @param signal which test selected it, since only a bot author waives the pairing floor
 * @param home the state home whose credential and door the press uses
 * @returns the argv after `github enqueue`
 */
export function bumpEnqueueArgv({
  row,
  signal,
  home,
}: {
  row: LandingRow;
  signal: BumpSignal;
  home: string | undefined;
}): readonly string[] {
  const pressed = ["--pr", String(row.number), "--repo", row.repoSlug];
  if (signal === "bot-author") {
    return [
      ...pressed,
      "--acknowledge",
      "codex-loop-incomplete",
      "--reason",
      BOT_PAIRING_REASON,
      ...homeArgs({ home }),
    ];
  }
  return [...pressed, ...homeArgs({ home })];
}

/**
 * The `github pr update` argv that replaces one bump's description with the composed form.
 *
 * Full argv including the `node slopweaver github pr` head, exactly as {@link bumpRegisterArgv} is: the write
 * runs in process through the verb that owns pull-request descriptions, because that verb re-reads the live
 * body, prints the diff of what it replaces, re-validates the rendered result against the same `pr-format`
 * check CI runs, and refuses a PATCH that would change nothing. A second implementation of any of those would
 * eventually disagree with the one CI reads.
 *
 * `--form` rather than `--edit`, and that is the reason the act needs the two hatches: renovate's template
 * shares no field with this repository's form, so there is nothing to amend — the whole description is
 * replaced.
 *
 * @param form the composed form, serialised as the inline JSON `--form` takes
 * @param row the bump being rewritten
 * @param home the state home whose credential and door the write uses
 * @returns the whole argv `github pr update` takes
 */
export function bumpRewriteArgv({
  form,
  row,
  home,
}: {
  form: PrFormDraft;
  row: LandingRow;
  home: string | undefined;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "github",
    "pr",
    "update",
    "--form",
    safeJsonStringify({ label: "github bump-drive form", value: form }),
    "--repo",
    row.repoSlug,
    "--number",
    String(row.number),
    ...homeArgs({ home }),
  ];
}

/**
 * The `github ready` argv that undrafts one bump.
 *
 * @param row the draft bump
 * @param home the state home whose credential and door the write uses
 * @returns the argv after `github ready`
 */
export function bumpReadyArgv({ row, home }: { row: LandingRow; home: string | undefined }): readonly string[] {
  return ["--repo", row.repoSlug, "--number", String(row.number), ...homeArgs({ home })];
}

/**
 * The one-line ask a seated bump's board row carries.
 *
 * It names the bump, what is holding it and the distance, because those three are what a session picking the
 * row up would otherwise re-read GitHub for. MEASURED on `lachiejames/slopweaver`: every renovate
 * bump open was between 45 and 319 commits behind `main`, so the distance is the row's first-order fact.
 *
 * An ask the register's unrooted-path gate would refuse is WITHHELD: the pull request's URL, which the gate
 * reads as rooted, stands in for both the `owner/repo#n` and the title. Neither is a path, but
 * `update datadog/agent` reads as one under a state home carrying `datadog/`, as `acme/widgets#1` does under
 * one carrying `acme/`, and the gate refuses the whole row — at every firing, since neither changes. Both
 * are reproducible against the shipped binary. What is left, the `why`
 * and the distance, is this verb's own words.
 *
 * @param plan the planned act, whose `why` names the failing tests
 * @param withheld whether the gate would refuse the full ask, so the URL stands in for the name and title
 * @param bots the dependency-bot identities this install recognises, whose Renovate subset earns the clause
 * @returns the ask, in plain words with the act first
 */
export function bumpRegistrationAsk({
  plan,
  withheld,
  bots,
}: {
  plan: BumpPlan;
  withheld: boolean;
  bots: DependencyBotActors;
}): string {
  const { row } = plan;
  const behind = row.baseDistance.kind === "read" ? `${String(row.baseDistance.value.behindBy)} behind` : "? behind";
  const needs = `is a dependency bump that needs a session (${plan.why}; ${behind})`;
  const named = withheld
    ? `${row.url} ${needs}: its name and title are withheld, as they read as a state-home path`
    : `${row.repoSlug}#${String(row.number)} ${needs}: ${row.title}`;
  if (isRenovateAuthored({ bots, row }) && codeOwnerPending({ row })) {
    return `${named}. ${RENOVATE_SEAT_CLAUSE}`;
  }
  return named;
}

/**
 * The clause a SEATED Renovate bump carries while a code owner is also pending on it.
 *
 * Without the clause a seat that fixed a bump's CI and found the code owner was all that remained would park a
 * review ask to a colleague, because its row says nothing about who reviews a Renovate bump. A Renovate bump's
 * review is the owner's, and the owner is withholding it, so the seat ends there with neither a
 * card nor an ask. `skills/github/reference/backlog.md` carries the rule.
 */
export const RENOVATE_SEAT_CLAUSE =
  "If a code owner is all that remains once it is green, this is a Renovate bump whose review the owner is withholding: " +
  "settle naming that hold, with no Queue card for the owner and never a review ask to a colleague";

/** Whether GitHub still holds this bump for a code owner, read off the landing test that judged it. */
function codeOwnerPending({ row }: { row: LandingRow }): boolean {
  return row.tests.some((test) => test.id === "codeowners-satisfied" && test.verdict === "fail");
}

/**
 * The `handover register` argv that puts one seated bump on the ONE board.
 *
 * Full argv including the `node slopweaver handover register` head, because the register runs in process
 * through the verb that owns the board rather than through a shell.
 *
 * `--dispatch`, because a seated bump is work for a session and no decision of the owner's: `handover register`'s
 * shape gate refuses an undeclared `--ask` with exit 2 and writes nothing. MEASURED: without it the
 * `bump-drive-acme-admin` recipe registered no row at any firing, the same defect
 * `./landingRegister.ts`'s `registrationArgv`, which this producer never received. `--finding` would be wrong
 * for the reason that file records: the pull request already exists and is team-facing.
 * `subprocess/cli/commands/handover/landingDispatchRegister.test.ts` runs this argv through the shipped binary.
 *
 * @param plan the planned seat
 * @param home the state home the board lives under
 * @param checkout the local checkout the bump's repository is declared at, if one is
 * @param askedIso when this pass asked
 * @param slug the slug the row is filed under, carrying the head so a moved bump gets a fresh row
 * @param withheld whether the register's unrooted-path gate would refuse the full ask (see {@link bumpRegistrationAsk})
 * @param organisation the organisation whose repositories say whose work the bump is
 * @param bots the dependency bots the pass resolved once, which say whether the ask carries the Renovate clause
 * @returns the whole argv `handover register` takes
 */
export function bumpRegisterArgv({
  plan,
  home,
  checkout,
  askedIso,
  bots,
  organisation,
  slug,
  withheld,
}: {
  plan: BumpPlan;
  home: string | undefined;
  checkout: string | undefined;
  askedIso: string;
  bots: DependencyBotActors;
  organisation: Organisation;
  slug: string;
  withheld: boolean;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    bumpRegistrationAsk({ bots, plan, withheld }),
    "--dispatch",
    "--slug",
    slug,
    "--branch",
    plan.row.headRefName,
    ...repositoryWorkspaceArgv({
      organisation,
      repository: plan.row.repoSlug,
      what: "the dependency bump's pull request",
    }),
    "--asked-iso",
    askedIso,
    ...(checkout === undefined ? [] : ["--repo", checkout]),
    ...homeArgs({ home }),
  ];
}
