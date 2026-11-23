/**
 * Turning an atlas's declared `resyncCommand` into the argv steps a scheduled pass actually runs.
 *
 * Every registered atlas already declares the one command that brings it current
 * (`atlas/kit/contract.ts`'s required `resyncCommand`), and `atlas freshness` already prints it as the
 * remedy a reader is meant to type. Deriving the steps from that string keeps ONE source of truth: an
 * atlas whose resync verb changes moves its schedule with it, and there is no second field to forget.
 *
 * ## Parsing a command string is safe here because the parse cannot be trusted alone
 *
 * The obvious objection is that splitting a human command string is fragile — the declarations really do
 * vary, and a naive reader gets every one of them wrong. `clerk` and `vanta` declare two commands joined
 * by `&&`; `cloudflare`, `crowdstrike` and `onepassword` sit under their own noun rather than `atlas`;
 * the `slack` atlas resyncs through `atlas slack-drive`. So the parse handles the compound and never
 * assumes the noun.
 *
 * What makes it sound rather than merely careful is that a parsed step is INERT until it routes. Every
 * step is checked against the same verb registry `slopweaver <noun> <verb>` dispatches through
 * ({@link resolveResyncSteps}), and a step that does not route is a hard refusal at registration time
 * rather than a row that fails unattended. A declaration carrying a placeholder — `--control <id>` — is
 * refused for the same reason: a scheduled pass has nobody to fill it in.
 *
 * ## The one thing it does NOT check, stated rather than discovered
 *
 * An `atlas <platform> <verb>` step is validated two words deep — `atlas airtable` routes, and a platform
 * this build does not register fails there — but the platform's OWN verb, the third word, is not. Atlas
 * routing is one level deeper than the manifest and each platform keeps its verb list in its own
 * dispatcher, so there is no registry to ask. Checking the second word against `atlasPlatforms()` as well
 * was tried and removed: it is already covered by the manifest lookup, and it would falsely refuse a
 * future declaration naming a kit-level atlas verb such as `atlas doctor`.
 * `slopweaver atlas airtable teleport` therefore registers and fails when it runs.
 * That residue is bounded rather than silent: `live/resync/outcome.ts` records the failure and the
 * briefing's freshness section shows the target as failing, which is the whole reason that record exists.
 *
 * Pure: strings in, steps or refusals out. Nothing here runs anything.
 */
import { verbsOfNoun } from "../../cli/nounGroups.js";
import { err, ok, type Result } from "../../lib/result.js";

/** The leading word every declared command carries, and the one word a step's argv drops. */
const CLI_NAME = "slopweaver";

/** One command a resync runs, as argv words past the binary name. */
export interface ResyncStep {
  readonly argv: readonly string[];
}

/**
 * Split one declared `resyncCommand` into its steps, without deciding whether they route.
 *
 * @param command the descriptor's declared command, `&&`-joined when it takes more than one
 * @returns one step per command, or every reason the declaration cannot be scheduled
 */
export function parseResyncCommand({ command }: { readonly command: string }): Result<readonly ResyncStep[]> {
  const problems: string[] = [];
  const steps: ResyncStep[] = [];
  const parts = command
    .split("&&")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return err([`\`${command}\` declares no command at all`]);
  }

  for (const part of parts) {
    const words = part.split(/\s+/u).filter((word) => word.length > 0);
    if (words[0] !== CLI_NAME) {
      problems.push(`\`${part}\` does not start with \`${CLI_NAME}\`, so no verb can be resolved from it`);
      continue;
    }
    const argv = words.slice(1);
    if (argv.length < 2) {
      problems.push(`\`${part}\` names fewer than a noun and a verb`);
      continue;
    }
    const placeholder = argv.find((word) => word.includes("<") || word.includes(">"));
    if (placeholder !== undefined) {
      problems.push(
        `\`${part}\` carries the placeholder \`${placeholder}\`, which a scheduled pass has nobody to fill in`,
      );
      continue;
    }
    steps.push({ argv });
  }

  if (problems.length > 0) {
    return err(problems);
  }
  return ok(steps);
}

/**
 * Split a declared command AND check every step against the verb registry.
 *
 * The two halves are one function because a caller that skipped the second would be holding argv nothing
 * had checked — which is the whole reason the parse is allowed to exist.
 *
 * @param command the descriptor's declared command
 * @returns the routable steps, or every reason this declaration may not be scheduled
 */
export function resolveResyncSteps({ command }: { readonly command: string }): Result<readonly ResyncStep[]> {
  const parsed = parseResyncCommand({ command });
  if (parsed.isErr()) {
    return parsed;
  }
  const problems = parsed.value.flatMap((step) => stepProblems({ step }));
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(parsed.value);
}

/** Everything wrong with one parsed step, checked as deeply as the registry allows. */
function stepProblems({ step }: { readonly step: ResyncStep }): readonly string[] {
  // Safe: `parseResyncCommand` refused an argv shorter than two words.
  const noun = step.argv[0]!;
  const verb = step.argv[1]!;
  if (routesAsVerb({ noun, verb })) {
    return [];
  }
  return [`\`${CLI_NAME} ${noun} ${verb}\` is not a verb this build routes`];
}

/**
 * Whether one noun and verb resolve to a registry entry the dispatcher would run.
 *
 * A pair this build does not route answers false rather than true: a verb whose declared effect cannot be
 * read is a verb whose row cannot be checked, which is the same judgement `live/automation/verbRun.ts` makes for
 * the same reason.
 */
function routesAsVerb({ noun, verb }: { readonly noun: string; readonly verb: string }): boolean {
  return verbsOfNoun({ noun })?.[verb] !== undefined;
}

/**
 * How one step reads in a line a person sees.
 *
 * @param step the resolved step
 * @returns the command as it would be typed
 */
export function resyncStepLine({ step }: { readonly step: ResyncStep }): string {
  return `${CLI_NAME} ${step.argv.join(" ")}`;
}
