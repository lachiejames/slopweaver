/**
 * Slack preflight: prove `auth.test` reaches the workspace, confirm the token's read breadth (a user token
 * `xoxp` sees every channel; a bot token `xoxb` only invited ones), verify the `users:read.email` scope by
 * sampling one member and checking an email came back, and run a 1-item read probe to catch "token valid
 * but no data visible". The classifier is pure ({@link classifySlack}); the effectful shell awaits the
 * injected probe bag and delegates, so both the probe→field mapping AND the verdicts are unit-tested with
 * plain fake seams (no mocks).
 */
import { absentAs } from "#lib/absent.js";
import type { IngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import { type ConnectCapability, type ConnectCheckReport, finaliseReport, probeScopeDetail } from "./types.js";

/**
 * The EXACT Slack user-token scopes the activity + member + structure ingest lanes need. The single source
 * of truth: the bundled app manifest lists these verbatim (a test asserts equality), and the preflight
 * validates the email scope by observing an email on a sampled member.
 */
export const SLACK_REQUIRED_USER_SCOPES: readonly string[] = [
  "users:read",
  "users:read.email",
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "files:read",
  "pins:read",
  "bookmarks:read",
  "team:read",
  "usergroups:read",
] as const;

/**
 * The scopes an outbound WRITE needs (PR5). Checked separately from the read scopes because a read-only
 * token is a perfectly good token — it just cannot send. Verified WITHOUT side effects: Slack returns the
 * granted scope list in `auth.test`'s `x-oauth-scopes` header, so the preflight never has to post
 * something to discover it cannot post.
 */
export const SLACK_REQUIRED_WRITE_SCOPES: readonly string[] = ["chat:write", "files:write"] as const;

/**
 * The scopes an AS-ME write needs.
 *
 * `files:write` joined `chat:write` here when the as-me lane learned to attach its own evidence: the drip
 * lane uploads on the USER token now, so a token without it can post the owner's words and cannot post the
 * screenshot under them. It stays a WARNING rather than a failure — see {@link grantedScopeCapabilities} —
 * and the report names what each scope actually gates, so a text-only install is not told its sends will be
 * rejected when they will not.
 */
export const SLACK_REQUIRED_USER_WRITE_SCOPES: readonly string[] = ["chat:write", "files:write"] as const;

/**
 * The scopes `slopweaver slack status` writes with, on the USER token only: `users.profile:write` for the owner's
 * status text, emoji and expiry, `users:write` for manual away/auto presence.
 *
 * Kept apart from {@link SLACK_REQUIRED_USER_WRITE_SCOPES} on purpose: that list is worded everywhere as
 * what `slack post --as me` needs, and a token without these two posts perfectly well — only `slack status
 * set|clear|presence` refuses, naming the scope it lacks.
 */
export const SLACK_STATUS_USER_SCOPES: readonly string[] = ["users.profile:write", "users:write"] as const;

/**
 * What each write scope actually GATES, in the words the report uses.
 *
 * Data rather than one sentence per lane, because the report used to say a missing scope meant "every send
 * will be rejected", which is only true of `chat:write`: a token without `files:write` sends prose perfectly
 * well and fails only on `--media`. An over-stated warning is a warning an operator learns to skip.
 */
const SCOPE_GATES: Readonly<Record<string, string>> = {
  "chat:write": "send",
  "files:write": "attach files with --media",
};

/**
 * WHICH identity a write lane posts under, and therefore which token must carry the scopes.
 *
 * The two lanes are separate verdicts, never one: `--as bot` sends with the `xoxb` and `--as me` sends with
 * the `xoxp`, so a workspace can be perfectly configured for one and unable to send at all on the other.
 */
export type SlackWriteLane = "bot" | "user";

/** The token prefix each lane requires. A prefix mismatch is refused before any network call. */
const LANE_PREFIX: Readonly<Record<SlackWriteLane, string>> = { bot: "xoxb-", user: "xoxp-" };

/**
 * One write lane's own probe outcome — and it must be the token that will actually send.
 *
 * This type exists because of a shipped defect: the preflight probed the READ token (a user `xoxp` wins
 * the read chain) and then reported `chat:write`/`files:write` from ITS scopes as "outbound sends are
 * possible". That green-lit sending on a box where `slopweaver slack post` could not send at all, because
 * the bot token it posts with was absent. Two different tokens, two different verdicts — so a write
 * verdict now comes from its own probe or it is not claimed. PR5.1 adds the second lane rather than
 * loosening the first: the as-me lane needs `chat:write` on the USER token, and nothing checked that.
 */
export type SlackWriteProbe =
  | { readonly kind: "absent" }
  | { readonly kind: "wrong-kind" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "reachable"; readonly grantedScopes: readonly string[] };

/**
 * A write lane's auth seam: nothing to probe (absent / wrong kind), or an `auth.test` to run.
 *
 * `auth.test` + the scope header is the whole check — a probe WRITE is never acceptable, because
 * discovering you can post by posting is indistinguishable from posting.
 */
export type SlackWriteAuth =
  | { readonly kind: "absent" }
  | { readonly kind: "wrong-kind" }
  | {
      readonly kind: "probe";
      readonly auth: () => Promise<Result<{ reachable: boolean; scopes: readonly string[] }, IngestError>>;
    };

/**
 * Classify a configured write token by PREFIX, before any network call. Pure.
 *
 * The same rule the send path enforces (`resolveSlackWriteToken`): a token whose prefix says it is the
 * other kind cannot post under the requested identity, so saying so here costs nothing and catches the
 * misconfiguration a preflight earlier.
 *
 * @param token the resolved token for this lane, if any
 * @param lane which identity the lane posts under
 * @returns whether it is absent, the wrong kind, or the right kind and worth probing
 */
export function classifyWriteToken({
  token,
  lane,
}: {
  token: string | undefined;
  lane: SlackWriteLane;
}): "absent" | "wrong-kind" | "ok" {
  if (token === undefined || token.length === 0) {
    return "absent";
  }
  return token.startsWith(LANE_PREFIX[lane]) ? "ok" : "wrong-kind";
}

/** The raw, source-agnostic outcome of the Slack probes — the seam output the classifier reads. */
export interface SlackProbe {
  readonly tokenKind: "user" | "bot";
  readonly authReachable: boolean;
  readonly membersSampled: number;
  /** Non-bot, non-deleted members in the sample — the population whose emails prove the scope. */
  readonly humanMembersSampled: number;
  /** Whether a HUMAN member in the sample exposed an email (⇒ `users:read.email` is granted). */
  readonly emailVisible: boolean;
  readonly channelsSampled: number;
  /**
   * Each WRITE lane's outcome, probed separately from everything above and from each other. Never derived
   * from the read token's scopes — see {@link SlackWriteProbe}. Both are REQUIRED, so "we forgot to check
   * the as-me lane" is not expressible.
   */
  readonly write: Readonly<Record<SlackWriteLane, SlackWriteProbe>>;
}

/**
 * The injectable Slack probe bag. The email-scope probe samples a PAGE (not a single row) and reports the
 * human-member counts, so one non-representative bot/deleted row can't flip the scope verdict either way.
 */
export interface SlackConnectProbes {
  auth(): Promise<Result<{ reachable: boolean; scopes: readonly string[] }, IngestError>>;
  users(): Promise<Result<{ sampled: number; humans: number; anyHumanEmail: boolean }, IngestError>>;
  channels(): Promise<Result<{ sampled: number }, IngestError>>;
}

/** Build the token-breadth capability from the token kind (user = full; bot = reduced-breadth warning). */
function breadthCapability({ tokenKind }: { tokenKind: "user" | "bot" }): ConnectCapability {
  if (tokenKind === "user") {
    return { detail: "user token (xoxp) — full read breadth", id: "token-breadth", status: "ok" };
  }
  return {
    detail: "bot token (xoxb) — only invited channels; set a user token (xoxp) for full breadth",
    id: "token-breadth",
    status: "warning",
  };
}

/** The `users:read.email` scope verdict: a HUMAN member with an email ⇒ granted; humans but no email ⇒ gap. */
function emailCapability({ probe }: { probe: SlackProbe }): ConnectCapability {
  const id = "scope:users:read.email";
  if (probe.emailVisible) {
    return { detail: "a sampled human member exposed an email — users:read.email is present", id, status: "ok" };
  }
  if (probe.humanMembersSampled > 0) {
    return {
      detail: `${String(probe.humanMembersSampled)} human member(s) sampled, none exposed an email — add the users:read.email scope`,
      id,
      status: "missing",
    };
  }
  return { detail: "no human members visible to verify users:read.email", id, status: "warning" };
}

/**
 * The lane-specific wording and capability ids. A record rather than branching prose, so the two lanes
 * cannot drift apart and a third could not be added without stating every field.
 *
 * The BOT lane's ids are unchanged from PR5 (`auth:write`, `scopes:write`, `scope:<scope>`); the USER lane
 * carries its own so both can appear in one report without colliding.
 */
const LANE_FACTS: Readonly<
  Record<
    SlackWriteLane,
    {
      readonly authId: string;
      readonly summaryId: string;
      readonly scopeIdPrefix: string;
      readonly label: string;
      readonly command: string;
      readonly required: readonly string[];
      readonly absentFix: string;
      readonly wrongKind: string;
    }
  >
> = {
  bot: {
    absentFix:
      "no bot token configured, so `slopweaver slack post --as bot` cannot send — run " +
      "`slopweaver secrets set slack-bot-token` (a read-only install is fine without one)",
    authId: "auth:write",
    command: "`slopweaver slack post --as bot`",
    label: "BOT",
    required: SLACK_REQUIRED_WRITE_SCOPES,
    scopeIdPrefix: "scope:",
    summaryId: "scopes:write",
    wrongKind:
      "the configured bot token is not an `xoxb-…`, so every `slopweaver slack post --as bot` is refused " +
      "before it reaches Slack — a user token cannot post as the bot",
  },
  user: {
    absentFix:
      "no user token configured, so `slopweaver slack post --as me` cannot send — run " +
      "`slopweaver secrets set slack-user-token` (a bot-only install is fine without one)",
    authId: "auth:write-as-me",
    command: "`slopweaver slack post --as me`",
    label: "USER",
    required: SLACK_REQUIRED_USER_WRITE_SCOPES,
    scopeIdPrefix: "scope:as-me:",
    summaryId: "scopes:write-as-me",
    wrongKind:
      "the configured user token is not an `xoxp-…`, so every `slopweaver slack post --as me` is refused " +
      "before it reaches Slack — a bot token cannot post under your name",
  },
};

/**
 * The per-scope verdict for a REACHABLE token on one lane. A missing scope is a `warning`, never `missing`:
 * read-only is a legitimate, shipped posture (see the read-only app manifest), so a read-only install must
 * not fail its own preflight. The detail states plainly what that scope's absence costs — see
 * {@link SCOPE_GATES} — which is how "a missing chat:write is discovered BEFORE a send" holds without
 * over-stating what a missing `files:write` costs.
 *
 * An EMPTY scope list means Slack did not return the header, so the verdict is "unverified" rather than a
 * fabricated pass or a fail: a fail-closed check here would block a perfectly good token the day Slack
 * stops sending scope metadata.
 */
function grantedScopeCapabilities({
  grantedScopes,
  lane,
}: {
  grantedScopes: readonly string[];
  lane: SlackWriteLane;
}): readonly ConnectCapability[] {
  const facts = LANE_FACTS[lane];
  if (grantedScopes.length === 0) {
    return [
      {
        detail:
          `the ${facts.label} token reached Slack but its scopes were not reported, so outbound sends are ` +
          `unverified — ${facts.command} needs ${facts.required.join(" + ")}`,
        id: facts.summaryId,
        status: "warning",
      },
    ];
  }
  const granted = new Set(grantedScopes);
  return facts.required.map((scope) => {
    const gates = absentAs({ value: SCOPE_GATES[scope], whenAbsent: "send" });
    return granted.has(scope)
      ? {
          detail: `${scope} is granted on the ${facts.label} token — ${facts.command} can ${gates}`,
          id: `${facts.scopeIdPrefix}${scope}`,
          status: "ok" as const,
        }
      : {
          detail: `${scope} is NOT granted on the ${facts.label} token — ${facts.command} cannot ${gates} until it is added`,
          id: `${facts.scopeIdPrefix}${scope}`,
          status: "warning" as const,
        };
  });
}

/**
 * The outbound-write verdict for the token that will DO the writing on one lane.
 *
 * The two loud cases are the point of this function. A configured token of the wrong KIND, and a token
 * that fails `auth.test`, both mean that lane cannot send — and both are reported `missing` so the
 * preflight exits non-zero instead of green-lighting a send that will fail. An ABSENT token is only a
 * `warning`, because using only one of the two lanes is a supported posture rather than a broken one.
 *
 * @param probe the lane's own probe outcome
 * @param lane which identity the lane posts under
 * @returns the write capabilities, in report order
 */
export function writeScopeCapabilities({
  probe,
  lane,
}: {
  probe: SlackWriteProbe;
  lane: SlackWriteLane;
}): readonly ConnectCapability[] {
  const facts = LANE_FACTS[lane];
  if (probe.kind === "absent") {
    return [{ detail: facts.absentFix, id: facts.summaryId, status: "warning" }];
  }
  if (probe.kind === "wrong-kind") {
    return [{ detail: facts.wrongKind, id: facts.authId, status: "missing" }];
  }
  if (probe.kind === "unreachable") {
    return [
      {
        detail:
          `the ${facts.label} token failed auth.test — invalid, revoked, or from another workspace. ` +
          `${facts.command} will fail even when the read token above is fine; they are different tokens`,
        id: facts.authId,
        status: "missing",
      },
    ];
  }
  return [
    {
      detail: `the ${facts.label} token that ${facts.command} sends with reached the workspace`,
      id: facts.authId,
      status: "ok",
    },
    ...grantedScopeCapabilities({ grantedScopes: probe.grantedScopes, lane }),
  ];
}

/** The read-probe verdict: any member/channel visible ⇒ ok; nothing ⇒ a no-data-visible failure. */
function readCapability({ probe }: { probe: SlackProbe }): ConnectCapability {
  if (probe.membersSampled + probe.channelsSampled > 0) {
    return {
      detail: probeScopeDetail({
        sampled: [`${String(probe.membersSampled)} member(s)`, `${String(probe.channelsSampled)} channel(s)`],
      }),
      id: "read-probe",
      status: "ok",
    };
  }
  return {
    detail: "auth ok but no members/channels visible — the token cannot read any data",
    id: "read-probe",
    status: "missing",
  };
}

/**
 * Classify a Slack probe into a report. Auth-unreachable short-circuits to a single hard failure; otherwise
 * verdicts on token breadth, the email scope, and the read probe. Pure.
 *
 * @param probe the raw probe outcome
 * @returns the finalised report
 */
export function classifySlack({ probe }: { probe: SlackProbe }): ConnectCheckReport {
  if (!probe.authReachable) {
    return finaliseReport({
      capabilities: [
        {
          detail: "auth.test failed — the token is invalid, revoked, or lacks a valid scope",
          id: "auth",
          status: "missing",
        },
      ],
      errors: ["slack: auth.test did not reach the workspace"],
      source: "slack",
      tokenPresent: true,
    });
  }
  return finaliseReport({
    capabilities: [
      { detail: "auth.test reached the workspace", id: "auth", status: "ok" },
      breadthCapability({ tokenKind: probe.tokenKind }),
      emailCapability({ probe }),
      readCapability({ probe }),
      ...writeScopeCapabilities({ lane: "bot", probe: probe.write.bot }),
      ...writeScopeCapabilities({ lane: "user", probe: probe.write.user }),
    ],
    source: "slack",
    tokenPresent: true,
  });
}

/** Await one lane's own `auth.test`, degrading a failed call to `unreachable` rather than throwing. */
async function probeWriteToken({ write }: { write: SlackWriteAuth }): Promise<SlackWriteProbe> {
  if (write.kind !== "probe") {
    return { kind: write.kind };
  }
  const auth = await write.auth();
  if (auth.isErr() || !auth.value.reachable) {
    return { kind: "unreachable" };
  }
  return { grantedScopes: auth.value.scopes, kind: "reachable" };
}

/**
 * Run the Slack probes and classify. Effectful shell over the injected bags — each probe failure degrades to
 * the safe default (unreachable / zero sampled), never a throw.
 *
 * Both write lanes are REQUIRED, not optional: every call site must say something about each token that
 * can send, so "we forgot to check the as-me lane" cannot be expressed.
 *
 * @param tokenKind whether the resolved read token is a user or bot token
 * @param probes the injected read probe bag
 * @param write the bot lane's auth seam (absent / wrong kind / probeable)
 * @param userWrite the as-me lane's auth seam
 * @returns the preflight report
 */
export async function checkSlackConnection({
  tokenKind,
  probes,
  write,
  userWrite,
}: {
  tokenKind: "user" | "bot";
  probes: SlackConnectProbes;
  write: SlackWriteAuth;
  userWrite: SlackWriteAuth;
}): Promise<ConnectCheckReport> {
  const [auth, users, channels, writeProbe, userWriteProbe] = await Promise.all([
    probes.auth(),
    probes.users(),
    probes.channels(),
    probeWriteToken({ write }),
    probeWriteToken({ write: userWrite }),
  ]);
  const usersOk = users.isOk() ? users.value : { anyHumanEmail: false, humans: 0, sampled: 0 };
  const authOk = auth.isOk() ? auth.value : { reachable: false, scopes: [] };
  return classifySlack({
    probe: {
      authReachable: authOk.reachable,
      channelsSampled: channels.isOk() ? channels.value.sampled : 0,
      emailVisible: usersOk.anyHumanEmail,
      humanMembersSampled: usersOk.humans,
      membersSampled: usersOk.sampled,
      tokenKind,
      write: { bot: writeProbe, user: userWriteProbe },
    },
  });
}
