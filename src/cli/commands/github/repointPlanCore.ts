/**
 * `slopweaver github repoint-plan`'s pure half: the argv parse and the human rendering of a plan. The decision is
 * `src/checkouts/repointPlan.ts`; the reads are `src/checkouts/repointReaders.ts`; the shell is `./repointPlanRun.ts`.
 */
import { isPushRootRepository } from "../../../admit/pushRootRegistry.js";
import type { RepositoryRepointPlan } from "../../../checkouts/repointPlan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail, requiredFlagValue } from "../../optionParsers.js";
import { GITHUB_REPOINT_PLAN_USAGE, type RecutArgsError, RecutArgsErrors } from "./repositoryRecutUsage.js";

/** The verb's flags, one spec the parse and the help-truth sweep both read. */
const REPOINT_PLAN_SPEC = { boolean: ["json"], value: ["repo", "archive-name", "new-checkout", "home"] } as const;

/** Every flag the verb accepts, as the help-truth sweep reads them. */
export const GITHUB_REPOINT_PLAN_FLAG_NAMES: readonly string[] = [
  ...REPOINT_PLAN_SPEC.value,
  ...REPOINT_PLAN_SPEC.boolean,
].map((name) => `--${name}`);

/** What one invocation asked for. */
export interface RepointPlanArgs {
  readonly repository: string;
  readonly archiveName: string;
  readonly newCheckout: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the argv after `github repoint-plan`.
 *
 * @param rest the flags
 * @returns the parsed invocation, or every line refusing it (the usage last)
 */
export function parseRepointPlanArgs({ rest }: { rest: readonly string[] }): Result<RepointPlanArgs, RecutArgsError> {
  const parsed = parseFlagTail({ rest, spec: REPOINT_PLAN_SPEC });
  if (parsed.isErr()) {
    return err(RecutArgsErrors.usage({ problems: parsed.error, usage: GITHUB_REPOINT_PLAN_USAGE }));
  }
  const repository = requiredFlagValue({
    missing: "--repo <owner/name> is required: the repository whose history is re-cut",
    name: "repo",
    parsed: parsed.value,
  });
  const archiveName = requiredFlagValue({
    missing: "--archive-name <name> is required: the name the old history moves to, under the same owner",
    name: "archive-name",
    parsed: parsed.value,
  });
  if (repository.isErr() || archiveName.isErr()) {
    const problems = [
      ...(repository.isErr() ? repository.error : []),
      ...(archiveName.isErr() ? archiveName.error : []),
    ];
    return err(RecutArgsErrors.usage({ problems, usage: GITHUB_REPOINT_PLAN_USAGE }));
  }
  if (!isPushRootRepository({ value: repository.value })) {
    return err(
      RecutArgsErrors.usage({
        problems: [`--repo ${repository.value} is not an owner/name repository`],
        usage: GITHUB_REPOINT_PLAN_USAGE,
      }),
    );
  }
  return ok({
    archiveName: archiveName.value,
    // Unset is undefined for both: the plan is then incomplete, and the shell resolves the state home.
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    newCheckout: parsed.value.values["new-checkout"],
    repository: repository.value,
  });
}

/** One action as a printed line. */
function actionLine({ action }: { action: RepositoryRepointPlan["actions"][number] }): string {
  switch (action.kind) {
    case "git-remote":
      return `${action.checkout}: ${action.configKey} ${action.fromUrl} -> ${action.toUrl}`;
    case "json-field":
      return `${action.surface} ${action.path}#${action.pointer}: ${action.from} -> ${action.to}`;
    case "plist-string":
      return `launch agent ${action.path}#${action.keyPath.join(".")}: ${action.from} -> ${action.to}`;
    case "text-replacements": {
      const count = action.replacements.reduce((sum, replacement) => sum + replacement.occurrences, 0);
      return `${action.path}: ${String(count)} link(s) across ${String(action.replacements.length)} distinct`;
    }
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/**
 * The plan as the human-readable report: archive moves, fresh moves, historical links, then what is disclosed and
 * what keeps the plan incomplete.
 *
 * @returns the report's lines, the verdict first
 */
export function repointPlanLines({ plan }: { plan: RepositoryRepointPlan }): readonly string[] {
  const verdict = plan.complete
    ? "complete: every place below is planned"
    : `INCOMPLETE: ${String(plan.unresolved.length)} item(s) below keep this plan from being applied`;
  const section = ({ title, lines }: { title: string; lines: readonly string[] }): readonly string[] =>
    lines.length === 0 ? [] : ["", `${title}:`, ...lines.map((line) => `  ${line}`)];
  const byRole = ({ role }: { role: string }): readonly string[] =>
    plan.actions.filter((action) => action.role === role).map((action) => actionLine({ action }));
  return [
    `dry run — nothing was changed. ${plan.repository} keeps the fresh history; the old one moves to ${plan.archiveRepository}.`,
    verdict,
    ...section({ lines: byRole({ role: "archive" }), title: `to the archive (${plan.archiveRepository})` }),
    ...section({ lines: byRole({ role: "fresh" }), title: `to the fresh checkout (${String(plan.newCheckout)})` }),
    ...section({ lines: byRole({ role: "historical-link" }), title: "state-home links to numbered objects" }),
    ...section({
      lines: plan.observations.map((item) => `[${item.disposition}] ${item.surface} ${item.locator}: ${item.detail}`),
      title: "disclosed, not changed",
    }),
    ...section({
      lines: plan.unresolved.map((item) => `${item.surface} ${item.locator}: ${item.reason}`),
      title: "unresolved",
    }),
    "",
    `scope: ${plan.scope}`,
  ];
}
