/**
 * The `dev gate` — the single bar every PR must clear, composed from the four checks the foundation
 * owns: the public hygiene scan, the PR-description format, the deterministic evidence-handoff check, and
 * the answer-quality scorer's own ordering properties. It runs ALL four (no short-circuit, so one run tells
 * you everything that's wrong), then exits non-zero if any failed. It writes an append-only JSONL run log +
 * the baseline↔candidate diff under `$SLOPWEAVER_HOME/ledgers/`. The same command runs locally and in CI.
 *
 * The last two are the eval lane's two graders, and they are deliberately adjacent: `evidence-handoff`
 * grades whether the right records reached an answer, `answer-quality` grades what the answer SAID. See `./answerQualityCheck.ts` for what a green from it does and does
 * not mean on a machine without the private rubrics.
 *
 * Pure core / effectful shell: the check evaluators, the compose, and the log-line builder are pure and
 * unit-tested; `runDevGate` is the thin effectful edge that reads the body, runs the real hygiene scan,
 * loads the fixture+baseline, and writes the ledger. (Typecheck + unit tests stay standard build steps —
 * the gate is the leak/format/regression bar the spec names, not a test runner.)
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_USAGE } from "../cli/exitCodes.js";
import { parseFlags } from "../cli/parseFlags.js";
import { slopweaverHome } from "../config.js";
import { runScan } from "../hygiene/repoScan.js";
import { loadDenylist } from "../hygiene/scan.js";
import { appendLines } from "../lib/appendSeparator.js";
import type { Result } from "../lib/result.js";
import type { Organisation } from "../organisation/core.js";
import { type DependencyBotActors, dependencyBotsOf } from "../organisation/dependencyBots.js";
import type { OrganisationError } from "../organisation/errors.js";
import { readOrganisation } from "../organisation/read.js";
import { scanPrMetadataLeaks } from "../prformat/checkCore.js";
import { gatePrBody, prOwnership } from "../prformat/prBodyGate.js";
import { stateHomePaths } from "../stateHome.js";
import { answerQualityResult } from "./answerQualityCheck.js";
import { handoffVerdict, observeHandoff } from "./handoffCheck.js";

/** The four check names the gate composes, in run order. */
const GATE_CHECK_NAMES = ["hygiene", "pr-format", "evidence-handoff", "answer-quality"] as const;
type GateCheckName = (typeof GATE_CHECK_NAMES)[number];

/** One check's outcome — its pass/fail + a one-line human summary for the log and the console. */
export interface GateCheckResult {
  readonly name: GateCheckName;
  readonly ok: boolean;
  readonly summary: string;
}

/**
 * The PR-format check. This repository's own pull request must carry a present body that is the exact C3 render
 * (`../prformat/prBodyGate.ts`), with the kind labels its title derives when the event carries them; a missing or
 * blank body is a failure, never a skip. A stranger's pull request (a fork, a Renovate bot, an App nothing here
 * names) is judged by the security scans alone. Both run the hygiene denylist over the PR TITLE + BODY. Pure.
 *
 * @param body the PR description (from `--pr-body-file` or `$PR_BODY`), or undefined
 * @param title the PR title (from `$PR_TITLE`), or undefined
 * @param labels the PR's labels (from `$PR_LABELS`, one per line), or undefined when the event did not carry them
 * @param author the PR author's login (from `$PR_AUTHOR`), which decides whether the pull request is a stranger's
 * @param authorType the author's GitHub account type (from `$PR_AUTHOR_TYPE`): an unnamed `Bot` App is a stranger
 * @param headRepository the head branch's `owner/repo` (from `$PR_HEAD_REPOSITORY`): a fork is a stranger
 * @param denylist the private denylist substrings (empty ⇒ still catches generic leak-class shapes)
 * @param bots the dependency-bot identities this install recognises, whose Renovate bots are strangers
 * @param ownRepository the pull request's own `owner/repo` (from `$PR_REPOSITORY`, set from the CI event), which the
 *   identifier scan over the title and body does not count
 * @returns the check result
 */
export function prFormatResult({
  // A stranger may leave the body absent: the scans then read an empty string, which is what was published.
  body: text = "",
  title,
  labels,
  author,
  authorType,
  headRepository,
  denylist = [],
  bots,
  ownRepository,
}: {
  body: string | undefined;
  title?: string;
  labels?: readonly string[];
  author?: string;
  authorType?: string;
  headRepository?: string;
  denylist?: readonly string[];
  bots: DependencyBotActors;
  ownRepository?: string;
}): GateCheckResult {
  const owned = prOwnership({ author, authorType, bots, headRepository, ownRepository }) === "owned";
  const blank = text.trim().length === 0;
  if (owned && blank) {
    return {
      name: "pr-format",
      ok: false,
      summary:
        "no PR body provided (pass --pr-body-file <path> or set $PR_BODY) — expected before you've drafted one; the hygiene, evidence-handoff and answer-quality results above already ran and are real signal on their own",
    };
  }
  const format = gatePrBody({
    body: text,
    owned,
    ...(title !== undefined ? { title } : {}),
    ...(labels !== undefined ? { labels } : {}),
  });
  const leaks = scanPrMetadataLeaks({
    body: text,
    denylist,
    ...(title !== undefined ? { title } : {}),
    ...(ownRepository !== undefined ? { ownRepository } : {}),
  });
  const errors = [...format.errors, ...leaks.errors];
  const scope = owned ? "" : " (a stranger's pull request: only the security scans ran)";
  // The note for identifiers the switch reports rather than refuses rides BOTH arms, so a red description still
  // says what it carries.
  const reports = leaks.identifierReports.map((report) => `; ${report}`).join("");
  return {
    name: "pr-format",
    ok: errors.length === 0,
    summary: errors.length === 0 ? `PR description conforms${scope}${reports}` : `${errors.join("; ")}${reports}`,
  };
}

/**
 * The evidence-handoff check: pack the frozen records, collect a frozen set of reader findings, and
 * confirm the collector kept and refused exactly what the grounding contract requires. Pure.
 *
 * @returns the check result
 */
export function evidenceHandoffResult(): GateCheckResult {
  const { observation } = observeHandoff();
  const verdict = handoffVerdict({ observation });
  return { name: "evidence-handoff", ok: verdict.ok, summary: verdict.summary };
}

/**
 * The answer-quality check: run the substance scorer's own ordering properties over the committed fixture,
 * and over the private ten-golden rubrics when this machine holds them.
 *
 * @param home the state home holding the private rubrics; defaults to `$SLOPWEAVER_HOME`
 * @returns the check result — its summary names BOTH lanes, so a green never reads as ten real rubrics
 *   having passed on a machine that has none of them
 */
export function answerQualityCheckResult({ home }: { home?: string } = {}): GateCheckResult {
  const verdict = answerQualityResult(home === undefined ? {} : { home });
  return { name: "answer-quality", ok: verdict.ok, summary: verdict.summary };
}

/**
 * Compose the final verdict from the per-check results. `ok` iff EVERY one of the four checks ran exactly once
 * and passed; exit 0 or 1. Pure.
 *
 * Fail closed: `every` over a list is true of an EMPTY one, so a run that dropped a check —
 * or all of them — would otherwise read PASS. A check missing or doubled fails the gate.
 *
 * @param results the per-check results
 * @returns the overall pass/fail + the process exit code
 */
export function composeGate({ results }: { results: readonly GateCheckResult[] }): {
  readonly ok: boolean;
  readonly exit: number;
} {
  const exactlyOnce = GATE_CHECK_NAMES.every((name) => results.filter((r) => r.name === name).length === 1);
  const ok = exactlyOnce && results.length === GATE_CHECK_NAMES.length && results.every((r) => r.ok);
  return { exit: ok ? 0 : 1, ok };
}

/**
 * Build the append-only JSONL run-log lines (one per check). Pure — `runId`/`tsIso` are injected so this
 * is deterministic and testable.
 *
 * @param tsIso the run timestamp
 * @param results the per-check results
 * @returns one JSON string per check
 */
export function gateLogLines({
  runId,
  tsIso,
  results,
}: {
  runId: string;
  tsIso: string;
  results: readonly GateCheckResult[];
}): readonly string[] {
  return results.map((r) =>
    JSON.stringify({
      check: r.name,
      runId,
      schemaVersion: 1,
      status: r.ok ? "pass" : "fail",
      summary: r.summary,
      tsIso,
    }),
  );
}

/**
 * The pr-format check under the organisation's dependency bots. Pure.
 *
 * Which authors keep the retired table shape is the organisation's word (`../organisation/dependencyBots.ts`). No
 * organisation configured — CI's throwaway home among them — judges with the generic Renovate alone and says so
 * in the summary, on either arm, so a green never hides that a self-hosted bot was not recognised. One that will
 * not read fails the check with its code and message: reading it as "no bot of its own" would turn that
 * organisation's Renovate bumps red for a reason that is not theirs.
 *
 * @param organisation the result of the one organisation read, taken at the shell
 * @param check the pr-format check itself, given the actors to judge with
 * @returns the check result, carrying the generic-only note when nothing is configured
 */
export function prFormatUnderOrganisation({
  organisation,
  check,
}: {
  organisation: Result<Organisation, OrganisationError>;
  check: (args: { bots: DependencyBotActors }) => GateCheckResult;
}): GateCheckResult {
  const resolved = dependencyBotsOf({ organisation });
  if (resolved.isErr()) {
    return {
      name: "pr-format",
      ok: false,
      summary: `${resolved.error.code}: which authors are dependency bots could not be read — ${resolved.error.message}`,
    };
  }
  const result = check({ bots: resolved.value.bots });
  if (resolved.value.note === undefined) {
    return result;
  }
  return { ...result, summary: `${result.summary}; ${resolved.value.note}` };
}

/**
 * The labels the CI event carries, a JSON array of names in `$PR_LABELS`; undefined when the variable is unset, so
 * a local run skips the kind-label check rather than reading "no labels". A set variable that is not an array of
 * strings THROWS: the workflow broke, and saying so beats a refusal that blames the pull request's labels.
 *
 * @param value the variable's text, or undefined
 * @returns the label names, or undefined when unset
 */
export function labelsFromEnv({ value }: { value: string | undefined }): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((name): name is string => typeof name === "string")) {
    throw new Error(`$PR_LABELS is not a JSON array of label names: ${value}`);
  }
  return parsed;
}

/**
 * The pr-format step: the description shape plus the hygiene denylist over the PR title + body (item #8).
 *
 * The denylist is the same private list the file scan uses. `$PR_TITLE`, `$PR_LABELS`, `$PR_AUTHOR` and the two
 * repository slugs all come from the CI event rather than from the body. Split out of {@link runDevGate} to keep it
 * under the repo's per-function line ceiling.
 */
async function prFormatStep({
  bodyFile,
  home,
}: {
  bodyFile: string | undefined;
  home: string | undefined;
}): Promise<GateCheckResult> {
  const prTitle = process.env["PR_TITLE"];
  const prAuthor = process.env["PR_AUTHOR"];
  const prAuthorType = process.env["PR_AUTHOR_TYPE"];
  const prRepository = process.env["PR_REPOSITORY"];
  const prHeadRepository = process.env["PR_HEAD_REPOSITORY"];
  const labels = labelsFromEnv({ value: process.env["PR_LABELS"] });
  // An `if` that RETURNS rather than `home ?? slopweaverHome()`: the ambient home standing in for an
  // unspecified one is a decision a reader must see, not an operator (`no-silent-fallback`).
  const organisationHome = (): string => {
    if (home === undefined) {
      return slopweaverHome();
    }
    return home;
  };
  const organisation = await readOrganisation({ home: organisationHome() });
  return prFormatUnderOrganisation({
    check: ({ bots }) =>
      prFormatResult({
        body: readPrBody({ bodyFile }),
        bots,
        denylist: loadDenylist(home === undefined ? {} : { home }),
        ...(prTitle !== undefined ? { title: prTitle } : {}),
        ...(labels !== undefined ? { labels } : {}),
        ...(prAuthor !== undefined ? { author: prAuthor } : {}),
        ...(prAuthorType !== undefined ? { authorType: prAuthorType } : {}),
        ...(prHeadRepository !== undefined ? { headRepository: prHeadRepository } : {}),
        ...(prRepository !== undefined ? { ownRepository: prRepository } : {}),
      }),
    organisation,
  });
}

/** Read a string flag from tokenised values (absent/boolean ⇒ undefined). */
function flagValue({
  values,
  key,
}: {
  values: Readonly<Record<string, string | boolean>>;
  key: string;
}): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/** Read the PR body from a `--pr-body-file` path (wins) or `$PR_BODY`; undefined when neither is usable. */
function readPrBody({ bodyFile }: { bodyFile: string | undefined }): string | undefined {
  if (bodyFile !== undefined) {
    try {
      return readFileSync(bodyFile, "utf8");
    } catch {
      return undefined;
    }
  }
  return process.env["PR_BODY"];
}

/**
 * Run the whole gate: the four checks, the compose, and the ledger writes. The effectful shell over the
 * pure evaluators above.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code (0 all-clear, 1 any failure)
 */
export async function runDevGate(argv: readonly string[]): Promise<number> {
  // Positionals allowed (and ignored) so the `dev gate` verb token in the tail doesn't trip parsing.
  const parsed = parseFlags({
    allowPositionals: true,
    args: argv.slice(3),
    spec: { string: ["home", "pr-body-file"] },
  });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      process.stderr.write(`dev gate: ${e}\n`);
    });
    process.stderr.write("usage: slopweaver dev gate [--home <dir>] [--pr-body-file <path>]\n");
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const home = flagValue({ key: "home", values });
  const paths = stateHomePaths(home !== undefined ? { home } : {});

  // 1) hygiene — the real repo scan (reads the private denylist from $SLOPWEAVER_HOME). Prints its own hits.
  const hygieneCode = runScan();
  const hygiene: GateCheckResult = {
    name: "hygiene",
    ok: hygieneCode === 0,
    summary: hygieneCode === 0 ? "clean" : "leak-class/denylist hit(s) — see above",
  };

  // 2) evidence-handoff — deterministic grounding accounting over frozen records, through the real
  // shard planner and collector. This is NOT the retired recall measurement; see ./handoffCheck.ts.
  const handoff = evidenceHandoffResult();

  // 3) pr-format — the description schema + the hygiene denylist over the PR title + body (item #8).
  const prFormat = await prFormatStep({ bodyFile: flagValue({ key: "pr-body-file", values }), home });

  // 4) answer-quality — the substance scorer's own ordering properties, over the committed fixture always
  // and over the private ten-golden rubrics when this machine holds them. Beside the
  // retrieval grader above, never instead of it: the two grade different halves of the same answer.
  const answerQuality = answerQualityCheckResult(home === undefined ? {} : { home });

  const results = [hygiene, prFormat, handoff, answerQuality];
  const runId = randomUUID();
  const tsIso = new Date().toISOString();

  mkdirSync(paths.ledgers, { recursive: true });
  appendLines({
    path: join(paths.ledgers, "dev-gate.jsonl"),
    text: `${gateLogLines({ results, runId, tsIso }).join("\n")}\n`,
  });

  process.stdout.write("\ndev gate:\n");
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? "✓" : "✗"} ${r.name}: ${r.summary}\n`);
  }
  const { ok, exit } = composeGate({ results });
  process.stdout.write(ok ? "dev gate: PASS\n" : "dev gate: FAIL\n");
  process.stdout.write(`(run log: ${join(paths.ledgers, "dev-gate.jsonl")})\n`);
  return exit;
}
