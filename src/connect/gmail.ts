/**
 * Gmail preflight: unlike the other four sources, the interesting question is not "does the token work" but
 * "WHAT did the owner actually approve". A Gmail grant is user-consented and Google's screen lets a person
 * tick a narrower set than was asked for — so a grant can be perfectly valid, reach the API, and still make
 * `gmail label` refuse. That is the failure this check is built to name in advance.
 *
 * Three capability rows, all of them read off the STORED grant plus one live probe:
 *   - `auth` — a grant exists and `users.getProfile` reaches the mailbox over it;
 *   - `scope:<uri>` — one row per Gmail capability, so a partial consent is visible per verb rather than as
 *     one pass/fail;
 *   - `read-probe` — the mailbox reports a message total, catching "authorised but empty/wrong account".
 *
 * Pure classifier ({@link classifyGmail}) + a thin injected-probe shell, exactly like its four siblings.
 */
import type { IngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import { GMAIL_SCOPE_TABLE, GMAIL_SCOPES, type GmailCapability } from "../live/gmail/scopes.js";
import { type RefreshTokenLapse, refreshTokenLapse } from "../live/google/refreshLapse.js";
import { satisfiesCapability } from "../live/google/scopes.js";
import { type ConnectCapability, type ConnectCheckReport, finaliseReport, probeScopeDetail } from "./types.js";

/** The raw outcome of the Gmail probes. */
export interface GmailProbe {
  /** Whether a grant is stored at all. */
  readonly grantPresent: boolean;
  /** The mailbox the grant bound to, empty when none is stored. */
  readonly account: string;
  /** The scope URIs the stored grant carries. */
  readonly grantedScopes: readonly string[];
  /** Whether `users.getProfile` reached the mailbox. */
  readonly profileReachable: boolean;
  /** Gmail's own reported total for the mailbox — a mailbox statistic, not a corpus one. */
  readonly messagesTotal: number;
  /** The stored refresh token's lapse, judged against the clock at the edge; absent or `none` adds no row. */
  readonly refreshLapse?: RefreshTokenLapse;
}

/** The injectable Gmail probe bag — one live call, plus the stored grant read. */
export interface GmailConnectProbes {
  profile(): Promise<Result<{ account: string; messagesTotal: number }, IngestError>>;
}

/** Which capability each reported scope row stands for, in the order a reader wants them. */
const REPORTED: readonly GmailCapability[] = ["identity", "read", "modify", "compose", "send", "docs"];

/** What each capability unlocks, said in verbs rather than in scope URIs. */
const UNLOCKS: Readonly<Record<GmailCapability, string>> = {
  compose: "gmail draft",
  docs: "reading the FULL meeting transcript a Gemini notes email links to (without it, only the inline summary is stored)",
  identity: "naming which mailbox the grant bound to",
  modify: "gmail label / gmail unread / gmail archive",
  read: "gmail list / gmail read",
  send: "gmail send",
};

/**
 * One capability's row. A missing Gmail capability is a `warning`, not a `missing`: a read-only grant is a
 * legitimate, deliberate choice, and failing the whole preflight because the owner declined send access
 * would make the check a nag rather than a diagnostic. Identity is the exception — without it the grant
 * cannot say which mailbox it is, and a report that cannot name its account is not a useful report.
 */
function scopeCapability({ probe, capability }: { probe: GmailProbe; capability: GmailCapability }): ConnectCapability {
  const id = `scope:${GMAIL_SCOPES[capability]}`;
  if (satisfiesCapability({ capability, granted: probe.grantedScopes, table: GMAIL_SCOPE_TABLE })) {
    return { detail: `granted — unlocks ${UNLOCKS[capability]}`, id, status: "ok" };
  }
  return {
    detail: `not granted — ${UNLOCKS[capability]} will refuse; re-run \`slopweaver gmail connect\` to widen it`,
    id,
    status: capability === "identity" ? "missing" : "warning",
  };
}

/** The live read-probe verdict. */
function readCapability({ probe }: { probe: GmailProbe }): ConnectCapability {
  if (!probe.profileReachable) {
    return {
      detail: "the grant did not reach the mailbox — it may have been revoked at myaccount.google.com/permissions",
      id: "read-probe",
      status: "missing",
    };
  }
  return {
    detail: probeScopeDetail({ sampled: [`${String(probe.messagesTotal)} message(s) reported by the mailbox`] }),
    id: "read-probe",
    status: "ok",
  };
}

/**
 * The refresh-token row, present only when the grant recorded a lapse. A lapsed or unreadable one is `missing`,
 * since every call through the grant then fails; one inside the warning window is a `warning`.
 */
function refreshTokenRows({ probe }: { probe: GmailProbe }): readonly ConnectCapability[] {
  const lapse = probe.refreshLapse;
  if (lapse === undefined || lapse.kind === "none") {
    return [];
  }
  const id = "refresh-token";
  if (lapse.kind === "ok") {
    const detail = `lapses at ${lapse.expiresAtIso}, as Google does for a Testing-status OAuth client — publish the client to Production to stop it lapsing`;
    return [{ detail, id, status: "ok" }];
  }
  return [{ detail: lapse.warning, id, status: lapse.kind === "soon" ? "warning" : "missing" }];
}

/**
 * Classify a Gmail probe into a report. Pure.
 *
 * @param probe the raw probe outcome
 * @returns the finalised report
 */
export function classifyGmail({ probe }: { probe: GmailProbe }): ConnectCheckReport {
  if (!probe.grantPresent) {
    return finaliseReport({
      capabilities: [{ detail: "no grant stored — run `slopweaver gmail connect`", id: "auth", status: "missing" }],
      errors: ["no gmail grant stored for this home"],
      source: "gmail",
      tokenPresent: false,
    });
  }
  return finaliseReport({
    capabilities: [
      {
        detail: probe.profileReachable
          ? `the stored grant reached the mailbox as ${probe.account}`
          : `a grant for ${probe.account} is stored, but the mailbox refused it`,
        id: "auth",
        status: probe.profileReachable ? "ok" : "missing",
      },
      ...refreshTokenRows({ probe }),
      ...REPORTED.map((capability) => scopeCapability({ capability, probe })),
      readCapability({ probe }),
    ],
    source: "gmail",
    tokenPresent: true,
  });
}

/**
 * Run the Gmail probe and classify. Effectful shell over the injected bag.
 *
 * @param probes the injected probe bag
 * @param grantedScopes the scopes the stored grant carries
 * @param account the mailbox the stored grant bound to
 * @param refreshTokenExpiresAtIso the stored grant's recorded refresh-token lapse, absent when Google named none
 * @param nowMs the clock the lapse is judged against, read by the caller
 * @returns the preflight report
 */
export async function checkGmailConnection({
  probes,
  grantedScopes,
  account,
  refreshTokenExpiresAtIso,
  nowMs,
}: {
  probes: GmailConnectProbes;
  grantedScopes: readonly string[];
  account: string;
  refreshTokenExpiresAtIso: string | undefined;
  nowMs: number;
}): Promise<ConnectCheckReport> {
  const profile = await probes.profile();
  return classifyGmail({
    probe: {
      account: profile.isOk() ? profile.value.account : account,
      grantPresent: true,
      grantedScopes,
      messagesTotal: profile.isOk() ? profile.value.messagesTotal : 0,
      profileReachable: profile.isOk(),
      refreshLapse: refreshTokenLapse({
        expiresAtIso: refreshTokenExpiresAtIso,
        nowMs,
        reconnectVerb: "slopweaver gmail connect",
      }),
    },
  });
}
