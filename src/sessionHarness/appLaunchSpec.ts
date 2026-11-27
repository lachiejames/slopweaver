/**
 * The app's launch spec for one seam spec, by vendor, or why the app cannot host it. Pure.
 *
 * A Codex seat boots on the repository's Codex model whichever tier `cmux spawn --model` named, exactly as the cmux
 * route does (`cmux/seatRoute.ts`), and names the app instance whose binary its browser door judged once the launch
 * has pinged it. A Claude seat carries what its cmux boot line would have carried, as data rather than shell words:
 * the login the credential gate routed it to, by path only (`claude/seatPinning.ts` `bootEnvPrefix`); the rule files
 * its template leaves out (`cmux/launchTemplate.ts` `claudeMdExcludesFor`); its model, effort and plugin directory.
 */
import { err, ok, type Result } from "#lib/result.js";
import { claudeMdExcludesFor } from "../cmux/launchTemplate.js";
import type { VisibleSessionPlan } from "../cmux/plan.js";
import { CODEX_MODEL } from "../codex/profiles.js";
import {
  APP_CLAUDE_EFFORTS,
  type AppClaudeEffort,
  type ClaudeAppLaunchSpec,
  type CodexAppLaunchSpec,
} from "./appProtocol.js";
import type { ClaudeCredentialRoute } from "./credentialRouteWire.js";
import { type HarnessLaunchOperation, SessionHarnessErrors, type SessionLaunchFailedError } from "./errors.js";
import type { HarnessLaunchSpec } from "./launch.js";

/** A launch the app may be asked for, but the judged instance a Codex one gains once the app has named it. */
type AppLaunchDraft = Omit<CodexAppLaunchSpec, "judgedInstanceId"> | ClaudeAppLaunchSpec;

function appLaunchFailed({
  operation,
  message,
}: {
  operation: HarnessLaunchOperation;
  message: string;
}): SessionLaunchFailedError {
  return SessionHarnessErrors.launchFailed({ message: `app harness: ${message}`, opened: undefined, operation });
}

function isAppEffort(effort: string): effort is AppClaudeEffort {
  return APP_CLAUDE_EFFORTS.some((level) => level === effort);
}

function credentialRouteOf({ gated }: { gated: VisibleSessionPlan }): ClaudeCredentialRoute | undefined {
  const { credentialStoreDir: secureStorageDir, credentialTokenPath: tokenFilePath } = gated;
  if (secureStorageDir === undefined) {
    return undefined;
  }
  if (tokenFilePath === undefined) {
    return { kind: "store", secureStorageDir };
  }
  return { kind: "setup-token", secureStorageDir, tokenFilePath };
}

function claudeDraftOf({
  spec,
  gated,
  pluginDir,
  operation,
  ledgerHome,
  stateHome,
}: {
  spec: HarnessLaunchSpec;
  gated: VisibleSessionPlan;
  pluginDir: string | undefined;
  operation: HarnessLaunchOperation;
  ledgerHome: string | undefined;
  stateHome: string | undefined;
}): Result<ClaudeAppLaunchSpec, SessionLaunchFailedError> {
  const credential = credentialRouteOf({ gated });
  if (credential === undefined) {
    const message = "no plan routed this Claude seat a credential store, and the app runs no unrouted login";
    return err(appLaunchFailed({ message, operation }));
  }
  if (spec.effort !== undefined && !isAppEffort(spec.effort)) {
    return err(appLaunchFailed({ message: `the app does not know the effort level ${spec.effort}`, operation }));
  }
  return ok({
    claudeMdExcludes: claudeMdExcludesFor({ cwd: spec.directory, template: spec.template }),
    credential,
    directory: spec.directory,
    ledgerKey: spec.ledgerKey,
    title: spec.title,
    vendor: "claude",
    ...(spec.model === undefined ? {} : { model: spec.model }),
    ...(spec.effort === undefined ? {} : { effort: spec.effort }),
    ...(pluginDir === undefined ? {} : { pluginDir }),
    ...(ledgerHome === undefined ? {} : { ledgerHome }),
    ...(stateHome === undefined ? {} : { stateHome }),
  });
}

/**
 * The app's launch spec for a seam spec.
 *
 * @param spec the seam's launch spec
 * @param gated the plan the Claude credential gate allowed, carrying its routed login; the spec's own plan for Codex
 * @param pluginDir the plugin directory a Claude seat loads, when the spawn resolved one
 * @param operation the launch act it is for, which a refusal names
 * @param ledgerHome the state home the ledger row is written under, when the spawn named one, for the card's close
 * @param stateHome the state home the session's own verbs run under, only when the spawn was EXPLICITLY given
 *   `--home`; absent, the spec carries no key, so an app from before the field opens it as before
 * @returns the draft spec, or the launch failure refusing it
 */
export function appLaunchSpecOf({
  spec,
  gated,
  pluginDir,
  operation,
  ledgerHome,
  stateHome,
}: {
  spec: HarnessLaunchSpec;
  gated: VisibleSessionPlan;
  pluginDir: string | undefined;
  operation: HarnessLaunchOperation;
  ledgerHome: string | undefined;
  stateHome: string | undefined;
}): Result<AppLaunchDraft, SessionLaunchFailedError> {
  if (spec.host === "claude-code") {
    return claudeDraftOf({ gated, ledgerHome, operation, pluginDir, spec, stateHome });
  }
  if (spec.codexHome === undefined) {
    const message = "the session has no routed CODEX_HOME, so the app cannot say which plan it spends";
    return err(appLaunchFailed({ message, operation }));
  }
  return ok({
    codexHome: spec.codexHome,
    directory: spec.directory,
    ledgerKey: spec.ledgerKey,
    model: CODEX_MODEL,
    title: spec.title,
    vendor: "codex",
    ...(ledgerHome === undefined ? {} : { ledgerHome }),
    ...(stateHome === undefined ? {} : { stateHome }),
  });
}
