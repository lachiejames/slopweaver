/**
 * Outlook preflight: a LIVE mailbox connector, read at question time and never crawled, so it is a
 * preflight target beside Datadog rather than a corpus source.
 *
 * Connecting it takes two things the other targets do not, and this report names each as its own row so a
 * fresh machine sees which one is missing rather than one generic "not connected":
 *   - `registration` — the Entra app registration's client id (`outlook-client-id`). A public client with
 *     PKCE, so there is no secret; without the id there is nothing to consent through;
 *   - `auth` — the user-consent grant `outlook connect` stores;
 *   - `scope:read` / `scope:manage` / `scope:send` — one row per grant tier, a missing tier a WARNING, because
 *     a read-only grant is a deliberate choice rather than a fault (Gmail's rule, `gmail.ts`);
 *   - `read-probe` — `GET /me` through the real session helper, which proves the stored MSAL cache still
 *     refreshes silently and Graph accepts the token. `outlook connect --status` reads the file alone and
 *     cannot see a revoked consent; this row can.
 *
 * Pure classifier ({@link classifyOutlook}) + a thin injected-probe shell, like its siblings.
 */
import type { Result } from "../lib/result.js";
import type { OutlookIdentity } from "../live/outlook/apiCore.js";
import type { OutlookError } from "../live/outlook/errors.js";
import { missingOutlookScopes, OUTLOOK_REGISTRATION_STEPS, type OutlookCapability } from "../live/outlook/scopes.js";
import { type ConnectCapability, type ConnectCheckReport, finaliseReport } from "./types.js";

/** The raw outcome of the Outlook probes. */
export interface OutlookProbe {
  /** Whether `outlook-client-id` resolved (the secret file or `OUTLOOK_CLIENT_ID`). */
  readonly clientIdPresent: boolean;
  /** Whether a consent grant is stored at all. */
  readonly grantPresent: boolean;
  /** The mailbox the stored grant bound to, empty when none is stored. */
  readonly account: string;
  /** The Graph permissions Microsoft reported on the stored grant. */
  readonly grantedScopes: readonly string[];
  /** Whether `GET /me` reached Graph over a silently refreshed token. */
  readonly meReachable: boolean;
  /** The door's own refusal when `GET /me` did not reach Graph, else undefined. */
  readonly meRefusal: string | undefined;
}

/** The injectable Outlook probe bag — the one live call. */
export interface OutlookConnectProbes {
  readonly me: () => Promise<Result<OutlookIdentity, OutlookError>>;
}

/** One grant tier's row: which capabilities it needs, what it unlocks, and the grant that adds it. */
interface TierRow {
  readonly id: string;
  readonly capabilities: readonly OutlookCapability[];
  readonly unlocks: string;
  readonly grant: string;
}

/** The three grant tiers, narrowest first — `OUTLOOK_GRANTS` in `scopes.ts` is the source of each set. */
const TIERS: readonly TierRow[] = [
  {
    capabilities: ["read", "settings"],
    grant: "read",
    id: "scope:read",
    unlocks: "outlook list / read / triage / measure / folders / categories / attachment",
  },
  {
    capabilities: ["modify"],
    grant: "manage",
    id: "scope:manage",
    unlocks: "outlook mark / category / archive / draft",
  },
  { capabilities: ["send"], grant: "full", id: "scope:send", unlocks: "outlook send" },
];

/** One tier's verdict against the stored grant. */
function tierCapability({ probe, tier }: { probe: OutlookProbe; tier: TierRow }): ConnectCapability {
  const missing = missingOutlookScopes({ capabilities: tier.capabilities, granted: probe.grantedScopes });
  if (missing.length === 0) {
    return { detail: `granted — unlocks ${tier.unlocks}`, id: tier.id, status: "ok" };
  }
  return {
    detail:
      `not granted (${missing.join(", ")}) — ${tier.unlocks} will refuse; widen with ` +
      `\`slopweaver outlook connect --grant ${tier.grant}\``,
    id: tier.id,
    status: "warning",
  };
}

/** The live `GET /me` verdict. */
function meCapability({ probe }: { probe: OutlookProbe }): ConnectCapability {
  if (probe.meReachable) {
    return {
      detail: "`GET /me` reached Microsoft Graph over a silently refreshed token",
      id: "read-probe",
      status: "ok",
    };
  }
  const why = probe.meRefusal === undefined ? "" : `: ${probe.meRefusal}`;
  return {
    detail:
      `the stored grant did not reach Microsoft Graph${why} — consent may have been withdrawn at ` +
      "https://account.live.com/consent/Manage; run `slopweaver outlook connect` again",
    id: "read-probe",
    status: "missing",
  };
}

/**
 * Replace every occurrence of the configured client id in a relayed refusal with its secret NAME, so a
 * printed row says which value Microsoft rejected without printing it. Pure.
 *
 * @param clientId the configured client id, when one resolved; nothing is replaced without one
 * @param message the refusal text as Microsoft or MSAL worded it
 * @returns the message with the client id named rather than shown
 */
export function redactClientId({ clientId, message }: { clientId: string | undefined; message: string }): string {
  if (clientId === undefined || clientId === "") {
    return message;
  }
  return message.split(clientId).join("<outlook-client-id>");
}

/** The `registration` row: whether the app registration's client id resolved. */
function registrationCapability({ clientIdPresent }: { clientIdPresent: boolean }): ConnectCapability {
  if (clientIdPresent) {
    return { detail: "the app registration's client id is configured", id: "registration", status: "ok" };
  }
  return { detail: `no client id — ${OUTLOOK_REGISTRATION_STEPS}`, id: "registration", status: "missing" };
}

/**
 * The report for a grant file that exists and cannot be read. It is reported as itself, never as "not
 * connected", and the registration row still stands beside it so a home missing BOTH halves names both. Pure.
 *
 * @param clientIdPresent whether `outlook-client-id` resolved
 * @param why the grant reader's own refusal, which never quotes the file
 * @returns the non-ok report
 */
export function outlookGrantUnreadableReport({
  clientIdPresent,
  why,
}: {
  clientIdPresent: boolean;
  why: string;
}): ConnectCheckReport {
  return finaliseReport({
    capabilities: [
      registrationCapability({ clientIdPresent }),
      {
        detail: `the stored Outlook grant is unreadable: ${why} — run \`slopweaver outlook connect\` again`,
        id: "auth",
        status: "missing",
      },
    ],
    errors: ["the stored outlook grant is unreadable"],
    source: "outlook",
    tokenPresent: false,
  });
}

/**
 * Classify an Outlook probe into a report. Pure.
 *
 * @param probe the raw probe outcome
 * @returns the finalised report — `ok` needs the registration, the grant and a reachable `/me`
 */
export function classifyOutlook({ probe }: { probe: OutlookProbe }): ConnectCheckReport {
  const registration = registrationCapability({ clientIdPresent: probe.clientIdPresent });
  if (!probe.grantPresent) {
    return finaliseReport({
      capabilities: [
        registration,
        {
          detail: "no grant stored — run `slopweaver outlook connect --grant manage` (one consent in the browser)",
          id: "auth",
          status: "missing",
        },
      ],
      errors: ["no outlook grant stored for this home"],
      source: "outlook",
      tokenPresent: false,
    });
  }
  return finaliseReport({
    capabilities: [
      registration,
      { detail: `a grant is stored for ${probe.account}`, id: "auth", status: "ok" },
      ...TIERS.map((tier) => tierCapability({ probe, tier })),
      ...(probe.clientIdPresent ? [meCapability({ probe })] : []),
    ],
    source: "outlook",
    tokenPresent: true,
  });
}

/**
 * Run the Outlook probe and classify. Effectful shell over the injected bag: `/me` is called once, and only
 * when both a client id and a grant exist — without either there is nothing to refresh.
 *
 * @param probe the stored-state half of the probe, read by the caller
 * @param probes the injected live probe
 * @returns the preflight report
 */
export async function checkOutlookConnection({
  probe,
  probes,
}: {
  probe: Omit<OutlookProbe, "meReachable" | "meRefusal">;
  probes: OutlookConnectProbes;
}): Promise<ConnectCheckReport> {
  if (!probe.clientIdPresent || !probe.grantPresent) {
    return classifyOutlook({ probe: { ...probe, meReachable: false, meRefusal: undefined } });
  }
  const me = await probes.me();
  return classifyOutlook({
    probe: { ...probe, meReachable: me.isOk(), meRefusal: me.isErr() ? me.error.message : undefined },
  });
}
