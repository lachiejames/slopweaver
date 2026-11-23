/**
 * The pure half of `slopweaver write vanta edit-policy-draft` — flags, the editor address, and every line
 * this verb prints.
 *
 * No fs, no clock, no network, no browser; `policyDraftRun.ts` does every read and every write.
 */
import { vantaTenantRootFromSlug } from "../../../atlas/vanta/browserPages.js";
import type { VantaDraftEditPlan } from "../../../atlas/vanta/policyDraft.js";
import { renderVantaDraftDiff } from "../../../atlas/vanta/policyDraft.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, parseFlagTail } from "../../optionParsers.js";

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_EDIT_POLICY_DRAFT_USAGE =
  "usage: slopweaver write vanta edit-policy-draft --policy <id> --find <text> --replace <text>\n" +
  "       [--tenant <slug>] [--approve <digest>] [--dry-run] [--shot <path>] [--json] [--home <dir>]\n" +
  "  Applies ONE exact text substitution to a Vanta policy DRAFT, in the owner's own Chrome, through the\n" +
  "  Playwright relay. Vanta's Manage API has no policy-version operation at all, so this is the only\n" +
  "  route a policy change can ever take\n" +
  "  --policy     the policy id, as `atlas vanta read --kind policy` reports it\n" +
  "  --find       the exact run of text to replace. It must occur EXACTLY ONCE in the draft, or nothing\n" +
  "               is typed — extend it until it is unique rather than hoping\n" +
  "  --replace    what to put there. Every byte outside the matched run is left alone\n" +
  "  --tenant     the Vanta tenant slug, when it is not already configured\n" +
  "  --approve    the digest printed by --dry-run, which covers that exact substitution against that exact\n" +
  "               draft. Without it the door HOLDS and nothing is typed\n" +
  "  --dry-run    read the draft, print the diff and the digest, type nothing, touch no ledger\n" +
  "  --shot       where to write the PNG of the result. The verb photographs what it did\n" +
  "  THE EDITOR AUTOSAVES, so the write boundary is the keystroke and not the Save. A run that cannot say\n" +
  "  what happened has left a real compliance document in an unknown state — read it before acting again";

/** The validated invocation. */
export interface VantaEditPolicyDraftOptions {
  readonly policy: string;
  readonly find: string;
  readonly replace: string;
  /** The `--tenant` value, or `null` to fall through to the environment and the secrets store. */
  readonly tenant: string | null;
  readonly approve: string | null;
  readonly dryRun: boolean;
  readonly shot: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Resolve the flag tail this verb accepts.
 *
 * @param rest the argv tail past the verb
 * @returns the resolved options, or every reason the tail is unusable
 */
export function parseVantaEditPolicyDraftOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<VantaEditPolicyDraftOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["dry-run", "json"], value: ["policy", "find", "replace", "tenant", "approve", "shot", "home"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { flags, values } = parsed.value;
  const problems: string[] = [];
  const policy = values["policy"];
  const find = values["find"];
  const replace = values["replace"];
  if (policy === undefined || policy.length === 0) {
    problems.push("--policy takes the policy id this substitution is for");
  }
  if (find === undefined) {
    problems.push("--find takes the exact run of text to replace");
  }
  if (replace === undefined) {
    problems.push("--replace takes what to put there");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  // Every one of the three is present: `problems` is non-empty otherwise and the function has already
  // returned. An assertion rather than a coalesce, so a future edit that drops a check fails loudly here
  // instead of silently substituting an empty string for a missing policy id.
  return ok({
    approve: flagValue({ name: "approve", parsed: parsed.value }),
    dryRun: flags.has("dry-run"),
    find: find!,
    home: values["home"],
    json: flags.has("json"),
    policy: policy!,
    replace: replace!,
    shot: values["shot"],
    tenant: flagValue({ name: "tenant", parsed: parsed.value }),
  });
}

/**
 * The editor address for one policy.
 *
 * Built from a tenant root the caller resolved rather than from a constant, because the tenant slug is the
 * organisation's own name and `browserPages.ts` keeps it out of this repository entirely.
 *
 * @param tenantSlug the organisation's own Vanta slug
 * @param policy the policy id
 * @returns the policy editor address
 */
export function vantaPolicyEditorUrl({ tenantSlug, policy }: { tenantSlug: string; policy: string }): string {
  return `${vantaTenantRootFromSlug({ tenantSlug })}/policies/${encodeURIComponent(policy)}/edit`;
}

/**
 * What a dry run prints: the diff Vanta itself does not have, and the digest an approval is bound to.
 *
 * @param plan the resolved substitution
 * @param digest the approval digest over it
 * @param title the page title the draft was read from, so the reader can see which policy this is
 * @returns the lines to print
 */
export function renderVantaEditDryRun({
  plan,
  digest,
  title,
}: {
  plan: VantaDraftEditPlan;
  digest: string;
  title: string;
}): readonly string[] {
  return [
    `edit-policy-draft (dry run) — ${title}`,
    `  ${plan.url}`,
    "",
    ...renderVantaDraftDiff({ plan }),
    "",
    `nothing was typed. To apply this exact substitution: --approve ${digest}`,
  ];
}
