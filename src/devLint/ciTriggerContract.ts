/**
 * The gate that keeps "a job runs only when its outcome could change" true.
 *
 * ## The hole this closes
 *
 * CI triggers align with when it makes sense to rerun CI. A job that reruns on a pull request trigger whose
 * change could not possibly alter its outcome (unit tests rerun because the PR description changed) is fixed
 * by making the trigger more specific, and the same applies to every CI job.
 *
 * MEASURED, which is the rule's subject: 49 `ci.yml` laps across 20 merged pull requests, read through the
 * door. A lap is p50 9m23s / p95 9m45s, and TWENTY-NINE of the 49 ran
 * on a head commit whose code had not changed at all — 13m32s per landing spent re-running byte-identical
 * code. Reproduce:
 *
 * ```bash
 * slopweaver github read https://github.com/lachiejames/slopweaver/pull/<n> --json \
 *   | jq '.data.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[]
 *         | {name, startedAt, completedAt, detailsUrl}'
 * ```
 *
 * Group by the run id in `detailsUrl`; one group is one lap.
 *
 * Fixing the three jobs standing today was a one-commit act. Keeping the property is not, because of one
 * asymmetry: **a trigger list is WORKFLOW-scoped and an outcome is JOB-scoped.** So every job added to an
 * existing file silently inherits every trigger that file declares, and correctly-shaped YAML is exactly
 * what an over-triggered job looks like. That is why this is a gate rather than a comment — `ci.yml` carried
 * an accurate comment explaining its `edited` trigger for weeks, and the comment was right about `dev-gate`
 * while two other jobs rode along behind it at 9m23s a lap.
 *
 * ## Why the fix was a second FILE, not an `if:`
 *
 * Worth stating here because it is the thing a future reader will try to simplify away. Skipping a job with
 * `if:` does not stop a check run being created: a job skipped that way emits one whose `skipped` conclusion
 * counts as PASSING — to GitHub's branch protection, and to `PASSING_CONCLUSIONS` in
 * `../live/github/checks.ts` — and it is the LATEST run for that name. So gating `build` off `edited` inside
 * `ci.yml` would have let a description edit turn a RED `build` GREEN in the rollup. Two files, each firing
 * only on what its own jobs need, creates no check run to be misread. {@link WORKFLOW_JOB_ACTIONS} is keyed
 * by file for that reason rather than incidentally.
 *
 * ## What it proves, and what it does not
 *
 * Per workflow file, three properties, each its own finding so a failure names which one broke:
 *
 * 1. **Every job declares itself.** A job with no entry is a finding, and that is the half that outlives
 *    this commit — it is what makes a new job answer the question instead of inheriting an answer.
 * 2. **No dead trigger.** A file's `pull_request.types` must equal the union of its own jobs' declared
 *    actions, so a type no job there needs cannot sit costing a lap. `ready_for_review` went by this check.
 * 3. **No job in two files.** A duplicated job name would produce two check runs under one name, which is
 *    the same rollup-masking hazard the split exists to avoid.
 *
 * It does NOT prove a declaration is TRUE. "Could this event change this job's outcome" is a judgement about
 * what the job reads, and no parse of YAML can settle it — each entry carries its reasoning so the judgement
 * is reviewable, and the gate holds the shape around it. Nor does it read `push:` or `merge_group:`, which
 * carry no action list and where the question does not arise.
 *
 * Pure core / effectful shell: {@link triggerContractFindings} takes one file's text and returns findings;
 * {@link runCiTriggerContract} reads every declared file and prints.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { absentAsEmpty } from "#lib/absent.js";
import { appendAll } from "../lib/arrays.js";
import { repoRootOf } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";
import { unitShardJobs } from "../testLanes/unitShards.js";
import { readWorkflowFiles, WORKFLOWS_DIR } from "./ciWorkflowActions.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/**
 * Every workflow file with a `pull_request` trigger, its jobs, and the actions whose arrival could change
 * each job's verdict — with WHY, which is the half a reader checks when the gate can only check shape.
 *
 * `opened`, `synchronize` and `reopened` appear everywhere because each hands the job a different tree.
 * `edited` is the action that discriminates, and it is not the pure title/body signal it reads as: GitHub
 * fires it for a BASE retarget too, and fires nothing else for one. `ci.yml`'s jobs still do not take it —
 * that case is caught at merge by their `merge_group` run against the real base tip, which is where this
 * branch's two required contexts are enforced.
 */
export const WORKFLOW_JOB_ACTIONS: readonly {
  readonly workflow: string;
  readonly jobs: readonly { readonly job: string; readonly actions: readonly string[]; readonly why: string }[];
}[] = [
  {
    jobs: [
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "lint",
        why: "the full lint lane over the checked-out MERGE tree, including the coverage floor's integrity against the base sha — a function of the tree, which only these three actions change",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "typecheck",
        why: "`tsc --noEmit` over the checked-out MERGE tree — src, eval and hooks — and nothing else",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "site",
        why: "`yarn build` under site/ over the checked-out MERGE tree — the console and the docs it embeds are a function of the tree and nothing else",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "desktop",
        why: "`tsc` under desktop/ over the checked-out MERGE tree — the shell's compile and typecheck are a function of the tree and nothing else",
      },
      ...unitShardJobs().map((job) => ({
        actions: ["opened", "synchronize", "reopened"],
        job,
        why: "one shard of the unit lane over the checked-out MERGE tree, written as a report the merge reads — a function of the tree",
      })),
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "unit",
        why: "merges every shard's report into the whole lane's coverage, then the measured coverage floor against the base sha — both functions of the tree",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "subprocess",
        why: "the subprocess lane over the checked-out MERGE tree and nothing else",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "desktop-e2e",
        why: "the console's browser lane over the checked-out MERGE tree, its applicability the diff from the base sha — both functions of the tree, which only these three actions change",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "compile",
        why: "`tsc` EMITS from the checked-out MERGE tree — the source-root, output-collision and emit-option classes `--noEmit` never computes — and reads nothing about the pull request",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "build",
        why: "reads nothing but the workers' results, so it fires on exactly what they fire on — never more, or a skipped worker could stand beside a passing verdict",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "integration",
        why: "runs the committed integration suites offline over the checked-out MERGE tree and reads nothing from the pull request itself",
      },
      {
        actions: ["opened", "synchronize", "reopened"],
        job: "ci-timing",
        why: "times the jobs of the run it is itself part of, so it fires on exactly what they fire on — an edit creates no run for it to read, and reading the previous run would report code this head no longer carries",
      },
    ],
    workflow: ".github/workflows/ci.yml",
  },
  {
    jobs: [
      {
        actions: ["opened", "synchronize", "reopened", "edited", "labeled", "unlabeled"],
        job: "dev-gate",
        why: "its subject IS the pull-request body, title and labels (the kind-label check reads the pull request's labels live), so `edited`, `labeled` and `unlabeled` each change its verdict; it also reads the head sha and the merge commit's patch id",
      },
    ],
    workflow: ".github/workflows/pr-body-gate.yml",
  },
];

/**
 * One thing wrong with the workflows, as a line to print.
 *
 * @internal — this gate's own return shape and its test.
 */
export interface TriggerFinding {
  readonly line: string;
  /**
   * True when the gate could not EVALUATE this workflow at all — it did not parse, or it has no `jobs` map
   * to read. That is a fact about the input, not a contract the gate judged and found broken, so the caller
   * reports it and exits rather than rendering the four-line policy refusal over it.
   */
  readonly unevaluated?: true;
}

/**
 * The `pull_request.types` a workflow declares.
 *
 * Reads defensively rather than trusting a shape, exactly as `./ciOffloadContract.ts` does: a document that
 * does not parse into the expected shape is a FINDING for the caller, never an empty list that reads clean.
 * The `on` key is read through {@link onBlockOf} because YAML's own history makes that key unreliable.
 *
 * @param workflow the parsed workflow document
 * @returns the declared types, or `undefined` when there is no `pull_request.types` list to read
 */
export function pullRequestTypesOf({ workflow }: { workflow: unknown }): readonly string[] | undefined {
  const on = onBlockOf({ workflow });
  if (on === undefined) {
    return undefined;
  }
  const pullRequest = on["pull_request"];
  if (!isRecord(pullRequest)) {
    return undefined;
  }
  const types = pullRequest["types"];
  if (!Array.isArray(types)) {
    return undefined;
  }
  return types.filter((entry: unknown): entry is string => typeof entry === "string");
}

/**
 * A workflow's trigger block, whatever key the parser gave it.
 *
 * YAML 1.1 resolves a bare `on:` to the BOOLEAN true, and 1.2 does not. Which one a parser applies is a
 * version and configuration question rather than a property of the file, so both keys are tried and the
 * answer never depends on which convention is in force — a gate that silently found no triggers would
 * report every workflow clean, which is the one failure direction this must not have.
 *
 * @param workflow the parsed workflow document
 * @returns the trigger map, or `undefined` when neither key holds one
 */
export function onBlockOf({ workflow }: { workflow: unknown }): Record<string, unknown> | undefined {
  if (!isRecord(workflow)) {
    return undefined;
  }
  const candidates = [workflow["on"], workflow["true"]];
  return candidates.find((candidate): candidate is Record<string, unknown> => isRecord(candidate));
}

/**
 * Every job name a workflow declares, in file order.
 *
 * @param workflow the parsed workflow document
 * @returns the job names, or `undefined` when there is no `jobs` map to read
 */
export function jobNamesOf({ workflow }: { workflow: unknown }): readonly string[] | undefined {
  if (!isRecord(workflow)) {
    return undefined;
  }
  const jobs = workflow["jobs"];
  if (!isRecord(jobs)) {
    return undefined;
  }
  return Object.keys(jobs);
}

/**
 * The union of one declared workflow's jobs' actions, sorted, so the comparison against `types` is
 * order-free.
 *
 * @param workflow the workflow path to look up in {@link WORKFLOW_JOB_ACTIONS}
 * @returns the sorted union, empty when nothing is declared for that path
 */
export function declaredActionUnion({ workflow }: { workflow: string }): readonly string[] {
  const entry = WORKFLOW_JOB_ACTIONS.find((candidate) => candidate.workflow === workflow);
  return [...new Set(absentAsEmpty({ value: entry?.jobs }).flatMap((job) => job.actions))].toSorted();
}

/**
 * Judge ONE workflow's text against the trigger contract. Pure.
 *
 * @param text the workflow file's contents
 * @param workflow the file's repo-relative path, which selects its declaration
 * @returns one finding per broken property; empty means this file's contract holds
 */
export function triggerContractFindings({
  text,
  workflow,
}: {
  text: string;
  workflow: string;
}): readonly TriggerFinding[] {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error: unknown) {
    return [{ line: `${workflow} does not parse as YAML: ${String(error)}`, unevaluated: true }];
  }
  const jobs = jobNamesOf({ workflow: parsed });
  if (jobs === undefined) {
    return [{ line: `${workflow} has no \`jobs\` map to read`, unevaluated: true }];
  }
  const types = pullRequestTypesOf({ workflow: parsed });
  if (types === undefined) {
    return [{ line: `${workflow} declares no \`pull_request.types\` list — every action would fire it` }];
  }
  const declared = absentAsEmpty({ value: WORKFLOW_JOB_ACTIONS.find((entry) => entry.workflow === workflow)?.jobs });
  const declaredNames = new Set(declared.map((entry) => entry.job));
  const present = new Set(jobs);
  const union = declaredActionUnion({ workflow });

  const undeclared = jobs
    .filter((job) => !declaredNames.has(job))
    .map((job) => ({
      line:
        `job \`${job}\` in ${workflow} declares no pull_request actions — add it to WORKFLOW_JOB_ACTIONS in ` +
        "src/devLint/ciTriggerContract.ts, naming the actions whose arrival could change its verdict, and why",
    }));
  const vanished = declared
    .filter((entry) => !present.has(entry.job))
    .map((entry) => ({
      line: `WORKFLOW_JOB_ACTIONS declares \`${entry.job}\` in ${workflow}, which no longer has it — drop the entry`,
    }));
  const dead = types
    .filter((type) => !union.includes(type))
    .map((type) => ({
      line:
        `${workflow} lists \`pull_request.types: ${type}\`, which none of its jobs needs — every job it starts ` +
        "would run on an event that cannot change its verdict. Remove the type, or move the job that needs " +
        "it into its own workflow; do NOT skip the job with `if:`, whose `skipped` conclusion reads as PASSED",
    }));
  const missing = union
    .filter((action) => !types.includes(action))
    .map((action) => ({
      line: `${workflow} declares a job needing \`${action}\` but its \`pull_request.types\` never delivers it`,
    }));
  return [...undeclared, ...vanished, ...dead, ...missing];
}

/**
 * Whether a parsed workflow fires on `pull_request` in any of the three spellings GitHub accepts: a bare
 * string, a list of event names, or a map key.
 *
 * @param workflow the parsed workflow document
 * @returns true when a `pull_request` event starts it
 */
export function firesOnPullRequest({ workflow }: { workflow: unknown }): boolean {
  if (!isRecord(workflow)) {
    return false;
  }
  return [workflow["on"], workflow["true"]].some((on) => {
    if (on === "pull_request") return true;
    if (Array.isArray(on)) return on.includes("pull_request");
    return isRecord(on) && Object.hasOwn(on, "pull_request");
  });
}

/**
 * Every workflow file in the directory that fires on `pull_request` with no {@link WORKFLOW_JOB_ACTIONS}
 * entry. Pure. The gate used to read only the files the registry named, so a NEW pull-request workflow was
 * never opened and its jobs inherited every trigger unjudged while the gate printed clean.
 *
 * @param files every workflow file in `.github/workflows`, with its text
 * @returns one finding per unregistered pull-request workflow; an unparseable one is unevaluated
 */
export function unregisteredWorkflowFindings({
  files,
}: {
  files: readonly { path: string; text: string }[];
}): readonly TriggerFinding[] {
  const registered = new Set(WORKFLOW_JOB_ACTIONS.map((entry) => entry.workflow));
  const findings: TriggerFinding[] = [];
  for (const file of files.filter((candidate) => !registered.has(candidate.path))) {
    let parsed: unknown;
    try {
      parsed = parse(file.text);
    } catch (error: unknown) {
      findings.push({ line: `${file.path} does not parse as YAML: ${String(error)}`, unevaluated: true });
      continue;
    }
    // An empty or scalar document has no trigger map to read, so it is unevaluated, never skipped.
    if (!isRecord(parsed)) {
      findings.push({ line: `${file.path} is not a workflow map, so its triggers were never read`, unevaluated: true });
      continue;
    }
    if (firesOnPullRequest({ workflow: parsed })) {
      findings.push({
        line:
          `${file.path} fires on pull_request but has no WORKFLOW_JOB_ACTIONS entry, so none of its jobs ` +
          "was judged — add it in src/devLint/ciTriggerContract.ts with each job's actions and why",
      });
    }
  }
  return findings;
}

/**
 * Job names declared in more than one workflow, which would put two check runs under one name.
 *
 * @returns one finding per duplicated job name; empty when every name is unique
 */
export function duplicateJobFindings(): readonly TriggerFinding[] {
  const seen = new Map<string, string[]>();
  for (const entry of WORKFLOW_JOB_ACTIONS) {
    for (const job of entry.jobs) {
      // A job name's first declaration opens its list of declaring workflows; every later one joins it.
      if (!seen.has(job.job)) {
        seen.set(job.job, []);
      }
      seen.get(job.job)!.push(entry.workflow);
    }
  }
  return [...seen.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([job, files]) => ({
      line:
        `job \`${job}\` is declared in ${files.join(" and ")} — two workflows producing one check name means ` +
        "the rollup reads only the latest, which is the masking the split exists to avoid",
    }));
}

/**
 * Fail when a CI job can run on an event that could not change its verdict.
 *
 * @returns 0 when every declared workflow's contract holds, else 1
 */
export function runCiTriggerContract(): number {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const findings: TriggerFinding[] = [...duplicateJobFindings()];
  const unreadable: string[] = [];
  // Enumerate the DIRECTORY, not just the registry, so an unregistered pull-request workflow is a finding.
  try {
    appendAll({ from: unregisteredWorkflowFindings({ files: readWorkflowFiles({ root }) }), into: findings });
  } catch (error: unknown) {
    unreadable.push(`cannot list ${WORKFLOWS_DIR}: ${String(error)}`);
  }
  for (const entry of WORKFLOW_JOB_ACTIONS) {
    let text: string;
    try {
      text = readFileSync(join(root, entry.workflow), "utf8");
    } catch (error: unknown) {
      // A workflow this gate could not read is a workflow whose contract it did NOT check. It used to join
      // `findings`, so the four policy lines claimed a broken contract over a file nobody had seen.
      unreadable.push(`cannot read ${entry.workflow}: ${String(error)}`);
      continue;
    }
    appendAll({ from: triggerContractFindings({ text, workflow: entry.workflow }), into: findings });
  }
  const unevaluated = [...unreadable, ...findings.filter((f) => f.unevaluated === true).map((f) => f.line)];
  const judged = findings.filter((finding) => finding.unevaluated !== true);
  for (const line of unevaluated) {
    // devlint: not-a-refusal -- a workflow the gate could not read or parse is one whose contract it never
    // evaluated, so this reports the gap rather than claiming the contract is broken
    process.stderr.write(`  ${line}\n`);
  }
  if (gateOutcome({ refused: judged.length, unseen: unevaluated.length }) === "incomplete") {
    // devlint: not-a-refusal -- every contract the gate DID read holds; what is missing is a reading, not a
    // verdict, so this exits on the fact above rather than rendering a policy refusal over it
    return 1;
  }
  if (judged.length === 0) {
    const jobs = WORKFLOW_JOB_ACTIONS.reduce((total, entry) => total + entry.jobs.length, 0);
    process.stdout.write(
      `ci-trigger-contract: clean (${String(jobs)} job(s) across ` +
        `${String(WORKFLOW_JOB_ACTIONS.length)} workflow(s), each firing only on what it reads)\n`,
    );
    return 0;
  }
  for (const finding of judged) {
    process.stderr.write(`  ${finding.line}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "ci-trigger-contract" }),
      detail: `${String(judged.length)} broken contract(s)`,
    })}\n`,
  );
  return 1;
}
