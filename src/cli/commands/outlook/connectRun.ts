/**
 * `slopweaver outlook connect` — consent, status and local disconnect for the Outlook door.
 *
 * Three modes, one per invocation. `--status` reads the stored grant and opens no socket. `--disconnect`
 * deletes the local grant and ALWAYS says where Microsoft-side consent is withdrawn, because there is no
 * revocation endpoint for a personal account's delegated consent and a silent local delete would read as a
 * revocation. A consent records the scopes Microsoft actually GRANTED and warns, by permission name, when they
 * fall short of what the chosen grant asked for.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { OutlookConsentOutcome } from "../../../live/outlook/consent.js";
import { productionOutlookConsentDeps, runOutlookConsent } from "../../../live/outlook/consent.js";
import type { OutlookError } from "../../../live/outlook/errors.js";
import { missingOutlookScopes, outlookRequestScopes } from "../../../live/outlook/scopes.js";
import { requireOutlookClientId, withOutlookGrantLock } from "../../../live/outlook/session.js";
import {
  type OutlookGrant,
  type OutlookGrantStatus,
  outlookGrantStatus,
  readOutlookGrant,
  removeOutlookGrant,
  writeOutlookGrant,
} from "../../../secrets/outlookGrant.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type OutlookConnectArgs, parseOutlookConnectArgs } from "./connectCore.js";
import { outlookArgsErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** Where a personal Microsoft account withdraws an app's consent — printed on every disconnect. */
export const OUTLOOK_CONSENT_MANAGE_URL = "https://account.live.com/consent/Manage";

/** The effects `outlook connect` composes, production or fake. */
export interface OutlookConnectDeps {
  readonly consent: (args: {
    home: string;
    scopes: readonly string[];
  }) => Promise<Result<OutlookConsentOutcome, OutlookError>>;
  readonly read: (args: { home: string }) => Result<OutlookGrant | undefined>;
  /** Replace the grant; production holds the grant lock, so a refresh in flight cannot write over it. */
  readonly write: (args: { home: string; grant: OutlookGrant }) => Promise<Result<string>>;
  /** Delete the grant; production holds the grant lock, so a refresh in flight cannot write it back. */
  readonly remove: (args: { home: string }) => Promise<Result<string>>;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly warn: (line: string) => void;
}

/** Print one status, as JSON or as lines. */
function printStatus({
  status,
  json,
  out,
}: {
  status: OutlookGrantStatus;
  json: boolean;
  out: (line: string) => void;
}): void {
  if (json) {
    out(JSON.stringify({ connected: true, ...status }));
    return;
  }
  out(`connected: ${status.account}`);
  out(`scopes: ${status.scopes.join(" ")}`);
  out(`granted: ${status.grantedAtIso}`);
  out(`grant file: ${status.path}`);
}

/** `--status`: read and report, no socket. */
function runStatus({ args, home, deps }: { args: OutlookConnectArgs; home: string; deps: OutlookConnectDeps }): number {
  const grant = deps.read({ home });
  if (grant.isErr()) {
    for (const line of grant.error) {
      deps.warn(line);
    }
    return EXIT_ERROR;
  }
  if (grant.value === undefined) {
    deps.out(args.json ? JSON.stringify({ connected: false }) : "not connected — run `slopweaver outlook connect`");
    return EXIT_OK;
  }
  printStatus({ json: args.json, out: deps.out, status: outlookGrantStatus({ grant: grant.value, home }) });
  return EXIT_OK;
}

/** `--disconnect`: delete the local grant and say where server consent lives. */
async function runDisconnect({
  args,
  home,
  deps,
}: {
  args: OutlookConnectArgs;
  home: string;
  deps: OutlookConnectDeps;
}): Promise<number> {
  // Read first, so a missing grant is "nothing to remove" rather than a failed delete — and a grant that is
  // present but unreadable is still removed, since an unusable credential is exactly what disconnect is for.
  const present = deps.read({ home });
  const absent = present.isOk() && present.value === undefined;
  let removedPath: string | null = null;
  if (!absent) {
    const removed = await deps.remove({ home });
    if (removed.isErr()) {
      for (const line of removed.error) {
        deps.warn(line);
      }
      return EXIT_ERROR;
    }
    removedPath = removed.value;
  }
  if (args.json) {
    deps.out(JSON.stringify({ connected: false, removed: removedPath, serverConsent: OUTLOOK_CONSENT_MANAGE_URL }));
    return EXIT_OK;
  }
  deps.out(removedPath === null ? "no local grant to remove" : `removed the local grant: ${removedPath}`);
  deps.out(`Microsoft still holds this app's consent until you withdraw it at ${OUTLOOK_CONSENT_MANAGE_URL}`);
  return EXIT_OK;
}

/** The consent mode: browser round trip, then persist exactly what Microsoft granted. */
async function runConsent({
  args,
  home,
  deps,
}: {
  args: OutlookConnectArgs;
  home: string;
  deps: OutlookConnectDeps;
}): Promise<number> {
  const scopes = outlookRequestScopes({ capabilities: args.capabilities });
  const outcome = await deps.consent({ home, scopes });
  if (outcome.isErr()) {
    deps.warn(outcome.error.message);
    return EXIT_ERROR;
  }
  const grant: OutlookGrant = {
    account: outcome.value.account,
    grantedAtIso: deps.nowIso(),
    homeAccountId: outcome.value.homeAccountId,
    msalCache: outcome.value.msalCache,
    scopes: outcome.value.scopes,
    ...(outcome.value.expiryMs === undefined ? {} : { expiryMs: outcome.value.expiryMs }),
  };
  const written = await deps.write({ grant, home });
  if (written.isErr()) {
    for (const line of written.error) {
      deps.warn(line);
    }
    return EXIT_ERROR;
  }
  const missing = missingOutlookScopes({ capabilities: args.capabilities, granted: grant.scopes });
  if (missing.length > 0) {
    deps.warn(
      `Microsoft granted less than was asked for — missing ${missing.join(", ")}. Verbs needing ` +
        "those will refuse; re-run `slopweaver outlook connect` and approve every permission to widen it",
    );
  }
  printStatus({ json: args.json, out: deps.out, status: outlookGrantStatus({ grant, home }) });
  return EXIT_OK;
}

/**
 * Run `outlook connect` over its effects.
 *
 * @param rest the argv tail after `outlook connect`
 * @param deps the effects, production or fake
 * @returns the process exit code
 */
export async function runOutlookConnect({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookConnectDeps;
}): Promise<number> {
  const parsed = parseOutlookConnectArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...outlookArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.warn(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (args.mode === "status") {
    return runStatus({ args, deps, home });
  }
  if (args.mode === "disconnect") {
    return runDisconnect({ args, deps, home });
  }
  return runConsent({ args, deps, home });
}

/**
 * The production effects: the app registration's client id from the home, the loopback + MSAL consent, and
 * the owner-only grant file.
 *
 * @returns the effects {@link runOutlookConnect} composes
 */
export function productionOutlookConnectDeps(): OutlookConnectDeps {
  const warn: OutlookConnectDeps["warn"] = (line) => {
    logger.warn({ msg: line });
  };
  return {
    consent: async ({ home, scopes }) => {
      const clientId = requireOutlookClientId({ home });
      if (clientId.isErr()) {
        return err(clientId.error);
      }
      return runOutlookConsent({
        deps: productionOutlookConsentDeps({ clientId: clientId.value, writeLine: warn }),
        scopes,
      });
    },
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    read: ({ home }) => readOutlookGrant({ home }),
    remove: ({ home }) => underGrantLock({ act: () => removeOutlookGrant({ home }), home }),
    warn,
    write: ({ home, grant }) => underGrantLock({ act: () => writeOutlookGrant({ grant, home }), home }),
  };
}

/** One grant-file act under the grant lock, its refusal folded into the same lines the act itself answers. */
async function underGrantLock({ home, act }: { home: string; act: () => Result<string> }): Promise<Result<string>> {
  const locked = await withOutlookGrantLock({ act: () => Promise.resolve(ok(act())), home });
  if (locked.isErr()) {
    return err([locked.error.message]);
  }
  return locked.value;
}

/** `slopweaver outlook connect`. */
export const outlookConnectCommand = defineCommand({
  run: (argv) => runOutlookConnect({ deps: productionOutlookConnectDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
