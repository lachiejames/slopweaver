/**
 * The two Microsoft consent verbs — `outlook connect` (mail) and `outlook-calendar connect` (calendar) — over one
 * runner: consent, status and local disconnect, each touching ONLY its own product's grant.
 *
 * Three modes, one per invocation. `--status` reads the stored grant and opens no socket. `--disconnect`
 * deletes the local grant and ALWAYS says where Microsoft-side consent is withdrawn, because there is no
 * revocation endpoint for a personal account's delegated consent and a silent local delete would read as a
 * revocation. A consent records the scopes Microsoft actually GRANTED and warns, by permission name, when they
 * fall short of what was asked for.
 *
 * One warning is the mail door's alone. A mail grant consented before the calendar had a consent of its own may
 * carry `Calendars.Read`, and the calendar reads over it until it has its own grant. A mail re-consent replaces
 * that grant with a mail-only one, so when it does — and no calendar grant is stored — it says so and names
 * `outlook-calendar connect`, judged from the grant the replacement actually displaced under the lock.
 *
 * And one note is the calendar door's alone: with no calendar grant stored, `--status` and `--disconnect` say
 * when a held mail grant still serves the calendar's reads, through the same pure grant choice the reads take
 * (`live/outlook/calendarGrantChoice.ts`) over the files alone, so "not connected" never hides a working read.
 */
import type { Result } from "../../../lib/result.js";
import {
  mailReconnectCalendarWarning,
  missingOutlookScopes,
  type OutlookProduct,
  outlookConnectVerb,
  outlookRequestScopes,
} from "../../../live/outlook/scopes.js";
import type { OutlookGrant, OutlookGrantStatus } from "../../../secrets/outlookGrant.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type OutlookConnectArgs, parseOutlookCalendarConnectArgs, parseOutlookConnectArgs } from "./connectCore.js";
import { type OutlookConnectDeps, productionOutlookConnectDeps } from "./connectDeps.js";
import { type OutlookArgsError, outlookArgsErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** Where a personal Microsoft account withdraws an app's consent — printed on every disconnect. */
export const OUTLOOK_CONSENT_MANAGE_URL = "https://account.live.com/consent/Manage";

/** Which consent verb is running: the product it connects and how its tail is parsed. */
export interface OutlookConnectDoor {
  readonly product: OutlookProduct;
  readonly parse: (args: { rest: readonly string[] }) => Result<OutlookConnectArgs, OutlookArgsError>;
}

/** `outlook connect` — the mail consent. */
export const OUTLOOK_MAIL_CONNECT_DOOR: OutlookConnectDoor = { parse: parseOutlookConnectArgs, product: "mail" };

/** `outlook-calendar connect` — the calendar consent. */
export const OUTLOOK_CALENDAR_CONNECT_DOOR: OutlookConnectDoor = {
  parse: parseOutlookCalendarConnectArgs,
  product: "calendar",
};

/** The token-free view of a grant: everything but its cache. */
function statusOf({ grant, path }: { grant: OutlookGrant; path: string }): OutlookGrantStatus {
  return { account: grant.account, grantedAtIso: grant.grantedAtIso, path, scopes: grant.scopes };
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

/** The account a calendar door reads over the mail grant through, or `undefined` on the mail door or with none. */
function calendarOverMail({
  door,
  deps,
  home,
}: {
  door: OutlookConnectDoor;
  deps: OutlookConnectDeps;
  home: string;
}): string | undefined {
  if (door.product !== "calendar") {
    return undefined;
  }
  return deps.mailGrantCoveringCalendar({ home });
}

/** `--status`: read and report, no socket. */
function runStatus({
  args,
  home,
  deps,
  door,
}: {
  args: OutlookConnectArgs;
  home: string;
  deps: OutlookConnectDeps;
  door: OutlookConnectDoor;
}): number {
  const verb = outlookConnectVerb({ product: door.product });
  const grant = deps.read({ home });
  if (grant.isErr()) {
    for (const line of grant.error) {
      deps.warn(line);
    }
    return EXIT_ERROR;
  }
  if (grant.value === undefined) {
    const overMail = calendarOverMail({ deps, door, home });
    if (args.json) {
      const over = door.product === "calendar" ? { readsOverMailGrant: overMail !== undefined } : {};
      deps.out(JSON.stringify({ connected: false, ...over }));
      return EXIT_OK;
    }
    if (overMail === undefined) {
      deps.out(`not connected — run \`${verb}\``);
      return EXIT_OK;
    }
    deps.out(
      `no grant of its own — reading over the Outlook mail grant for ${overMail}, which carries a calendar ` +
        `permission; run \`${verb}\` to give the calendar its own grant`,
    );
    return EXIT_OK;
  }
  printStatus({ json: args.json, out: deps.out, status: statusOf({ grant: grant.value, path: deps.path({ home }) }) });
  return EXIT_OK;
}

/** `--disconnect`: delete the local grant and say where server consent lives. */
async function runDisconnect({
  args,
  home,
  deps,
  door,
}: {
  args: OutlookConnectArgs;
  home: string;
  deps: OutlookConnectDeps;
  door: OutlookConnectDoor;
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
  // Judged after the removal: removing the calendar's own grant is exactly what lets a covering mail grant read.
  const overMail = calendarOverMail({ deps, door, home });
  if (args.json) {
    const over = door.product === "calendar" ? { readsOverMailGrant: overMail !== undefined } : {};
    deps.out(
      JSON.stringify({ connected: false, removed: removedPath, serverConsent: OUTLOOK_CONSENT_MANAGE_URL, ...over }),
    );
    return EXIT_OK;
  }
  deps.out(removedPath === null ? "no local grant to remove" : `removed the local grant: ${removedPath}`);
  deps.out(`Microsoft still holds this app's consent until you withdraw it at ${OUTLOOK_CONSENT_MANAGE_URL}`);
  if (overMail !== undefined) {
    deps.out(
      `calendar reads still work over the Outlook mail grant for ${overMail}, which carries a calendar ` +
        "permission, until mail is reconnected without one",
    );
  }
  return EXIT_OK;
}

/** The consent mode: browser round trip, then persist exactly what Microsoft granted. */
async function runConsent({
  args,
  home,
  deps,
  door,
}: {
  args: OutlookConnectArgs;
  home: string;
  deps: OutlookConnectDeps;
  door: OutlookConnectDoor;
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
  const replaced = await deps.replace({ grant, home });
  if (replaced.isErr()) {
    for (const line of replaced.error) {
      deps.warn(line);
    }
    return EXIT_ERROR;
  }
  const missing = missingOutlookScopes({ capabilities: args.capabilities, granted: grant.scopes });
  if (missing.length > 0) {
    deps.warn(
      `Microsoft granted less than was asked for — missing ${missing.join(", ")}. Verbs needing ` +
        `those will refuse; re-run \`${outlookConnectVerb({ product: door.product })}\` and approve every permission to widen it`,
    );
  }
  if (door.product === "mail") {
    const narrowed = mailReconnectCalendarWarning({
      calendarGrantStored: deps.calendarGrantStored({ home }),
      previousScopes: replaced.value.previous?.scopes,
      replacementScopes: grant.scopes,
    });
    if (narrowed !== undefined) {
      deps.warn(narrowed);
    }
  }
  printStatus({ json: args.json, out: deps.out, status: statusOf({ grant, path: replaced.value.path }) });
  return EXIT_OK;
}

/**
 * Run one Microsoft consent verb over its effects.
 *
 * @param rest the argv tail after the verb
 * @param door which product's consent verb is running
 * @param deps the effects, production or fake, all aimed at that product's grant
 * @returns the process exit code
 */
export async function runOutlookConnect({
  rest,
  door,
  deps,
}: {
  rest: readonly string[];
  door: OutlookConnectDoor;
  deps: OutlookConnectDeps;
}): Promise<number> {
  const parsed = door.parse({ rest });
  if (parsed.isErr()) {
    for (const line of [...outlookArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.warn(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (args.mode === "status") {
    return runStatus({ args, deps, door, home });
  }
  if (args.mode === "disconnect") {
    return runDisconnect({ args, deps, door, home });
  }
  return runConsent({ args, deps, door, home });
}

/** `slopweaver outlook connect`. */
export const outlookConnectCommand = defineCommand({
  run: (argv) =>
    runOutlookConnect({
      deps: productionOutlookConnectDeps({ product: "mail" }),
      door: OUTLOOK_MAIL_CONNECT_DOOR,
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});

/** `slopweaver outlook-calendar connect`. */
export const outlookCalendarConnectCommand = defineCommand({
  run: (argv) =>
    runOutlookConnect({
      deps: productionOutlookConnectDeps({ product: "calendar" }),
      door: OUTLOOK_CALENDAR_CONNECT_DOOR,
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
