/**
 * Pure parser, door request, rendering and outcome decision for `slopweaver github actions`.
 *
 * Reads whether hosted GitHub Actions runs on a repository and switches it OFF through the door. Bare, it only
 * reads; `--disable` previews the switch-off; `--disable --apply` sends it once and judges the outcome by a
 * separate read-back, never by GitHub's acknowledgement, because a dropped connection or a 5xx does not prove the
 * write did not land. There is no switch ON here: that spends hosted runner minutes, so it is
 * `github repo --enable-actions`, under a stated policy and an approved digest.
 */

import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { RepoActionsState } from "../../../outbound/github/repoActions.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";

const BOOLEAN_FLAGS = ["apply", "disable", "json"] as const;
const STRING_FLAGS = ["home", "repo"] as const;

const GITHUB_ACTIONS_FLAGS: FlagSpec = { boolean: [...BOOLEAN_FLAGS], string: [...STRING_FLAGS] };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_ACTIONS_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/** The resolved operation: a read, a preview of the switch-off, or the switch-off itself. */
export type GithubActionsArgs = {
  readonly owner: string;
  readonly repo: string;
  readonly json: boolean;
  readonly home: string | undefined;
} & (
  | { readonly disable: false; readonly apply: false }
  | { readonly disable: true; readonly apply: false }
  | { readonly disable: true; readonly apply: true }
);

/** The `--disable --apply` arm of {@link GithubActionsArgs}. */
export type GithubActionsApplyArgs = Extract<GithubActionsArgs, { readonly apply: true }>;

/** What one invocation reports, by outcome word. */
export type ActionsOutcome =
  "read" | "already off" | "would disable" | "disabled" | "off despite write error" | "unchanged" | "NOT confirmed";

/**
 * Parse the operation before resolving a credential.
 *
 * @param rest argv after `github actions`
 * @returns the resolved repository and operation, or every usage problem
 */
export function parseGithubActionsArgs({ rest }: { rest: readonly string[] }): Result<GithubActionsArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_ACTIONS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = parsed.value.values;
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  const disable = values["disable"] === true;
  const apply = values["apply"] === true;
  const errors: string[] = [];
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  if (apply && !disable) {
    errors.push("--apply requires --disable; this verb only ever switches Actions off");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const homeValue = values["home"];
  const address = {
    home: typeof homeValue === "string" ? homeValue : undefined,
    json: values["json"] === true,
    owner: repo.owner,
    repo: repo.repo,
  };
  if (!disable) {
    return ok({ ...address, apply: false, disable: false });
  }
  if (!apply) {
    return ok({ ...address, apply: false, disable: true });
  }
  return ok({ ...address, apply: true, disable: true });
}

/**
 * The external-write door request for switching one repository's Actions off. The artifact names the setting,
 * not only the repository, so the ledger never confuses it with `github repo`'s description write.
 *
 * @param args the parsed apply
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function repoActionsDoorRequest({ args, home }: { args: GithubActionsApplyArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "actions disable" },
    artifact: { id: `${args.owner}/${args.repo} actions/permissions` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * What a preview says the switch-off will leave: Actions off, and no allowed-actions value, because GitHub stops
 * reporting one once Actions is off (MEASURED on a real apply: before
 * `allowed-actions=all`, read back `not reported`; repro `slopweaver github actions --repo <off repo> --json`).
 *
 * @returns the projected state after the switch-off
 */
export function switchedOff(): RepoActionsState {
  return { allowedActions: undefined, enabled: false };
}

/**
 * One compact human rendering of a state.
 *
 * @param state the state as read or projected
 * @returns `enabled=<bool> allowed-actions=<value|not reported>`
 */
export function stateLine({ state }: { state: RepoActionsState }): string {
  let allowed = "not reported";
  if (state.allowedActions !== undefined) {
    allowed = state.allowedActions;
  }
  return `enabled=${String(state.enabled)} allowed-actions=${allowed}`;
}

/**
 * The JSON form of a state: an absent `allowedActions` is `null`, never a dropped key.
 *
 * @param state the state as read or projected
 * @returns a plain object safe to serialise
 */
export function stateJson({ state }: { state: RepoActionsState }): {
  enabled: boolean;
  allowedActions: string | null;
} {
  if (state.allowedActions === undefined) {
    return { allowedActions: null, enabled: state.enabled };
  }
  return { allowedActions: state.allowedActions, enabled: state.enabled };
}

/**
 * What happened after a performed switch-off, from the write's result and the read-back alone. Only a read-back
 * reading `enabled: false` is success; a failed write that reads back off is still off, and says so.
 *
 * @param wrote whether GitHub acknowledged the write
 * @param after the state as read back
 * @returns the outcome word and whether it is a success
 */
export function appliedOutcome({ wrote, after }: { wrote: boolean; after: RepoActionsState }): {
  outcome: ActionsOutcome;
  succeeded: boolean;
} {
  if (after.enabled === false) {
    return { outcome: wrote ? "disabled" : "off despite write error", succeeded: true };
  }
  return { outcome: wrote ? "NOT confirmed" : "unchanged", succeeded: false };
}
