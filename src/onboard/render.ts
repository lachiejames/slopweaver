/**
 * What `slopweaver onboard` actually says — the whole session, rendered as pure text.
 *
 * ## Why the copy is a pure function
 *
 * The deliverable of this verb IS its words: a new user reads them once, at the moment they are deciding how
 * much reach to hand a piece of software, and then acts on them. So the copy is a value computed from the
 * two answers and the tier declarations, with no I/O anywhere in it — which means the exact words a user
 * sees are asserted in a unit test rather than discovered by running the verb and reading the scrollback.
 *
 * ## The governing rule of the copy
 *
 * The MOST capable tier is RECOMMENDED and is called the least secure option in the same breath, never in a
 * footnote and never as a blocking warning. Every tier states its trade in one line, next to the manifest,
 * and the one cost that cannot be taken back — Slack's Agents feature — is stated at the point of choice in
 * plain words. Choosing a safer rung is one answer away and is never nagged about. Nothing here gates
 * anything: we do not force the risky thing, and we do not quietly withhold the capable thing.
 *
 * ## The two things onboarding cannot let the user discover later
 *
 * A manifest pasted over an EXISTING app replaces its configuration wholesale — it renames the app and
 * revokes every scope the manifest omits. And a scope change needs a REINSTALL, which in a managed
 * workspace needs an admin to approve it. A flow that ends at "paste this" and leaves someone stuck at an
 * approval wall has not onboarded anyone, so both are said before the paste, not after it fails.
 *
 * Pure: no I/O, no clock.
 */

import { APP_TOKEN_SECRET, LISTEN_SETUP_STEPS } from "../live/listen/preflight.js";
import { mailboxCommandLines, mailboxLines, mailboxPlan } from "./mailbox.js";
import type { ScopeGrant, ScopeLane } from "./scopeGrants.js";
import { connectSourceLines, ONBOARD_SOURCES, SOURCE_SPECS } from "./sources.js";
import { buildSlackAppManifest, type OnboardTier, renderSlackAppManifest, TIER_ORDER, TIERS } from "./tiers.js";

/**
 * The answers the whole render is a function of.
 *
 * The first two are the verb's two QUESTIONS and always have a value. The last two are flag-only and may be
 * absent, which is a state the mailbox block renders rather than a gap it papers over: an identity guessed
 * from anything on this machine would routinely fail `../alias/address.ts`'s own label rule, so a blank is
 * more honest than a derivation. See `./mailbox.ts`.
 */
export interface OnboardAnswers {
  readonly appName: string;
  readonly tier: OnboardTier;
  /** `--identity`: whose assistant plan the derived mailbox is for, or undefined when it was not given. */
  readonly identity: string | undefined;
  /** `--mailbox-zone`: the Cloudflare zone the address lives on, or undefined when it was not given. */
  readonly mailboxZone: string | undefined;
}

/** Where an answer came from — asked at the prompt, given as a flag, or taken as the default. */
export type AnswerSource = "asked" | "flag" | "default";

/** One answer, with where it came from — so a non-interactive run says what it assumed rather than hiding it. */
export interface AnswerNote {
  /** The human label (`app name`). */
  readonly label: string;
  /** The answer, as it will be used. */
  readonly value: string;
  readonly source: AnswerSource;
  /** The flag that sets this answer without being asked (`--app-name`). */
  readonly flag: string;
}

/** The width the scope column is padded to, so the capability column lines up across both lanes. */
const SCOPE_COLUMN = 20;

/** How an answer's origin is said out loud. */
const SOURCE_NOTE: Readonly<Record<AnswerSource, string>> = {
  asked: "you chose this",
  default: "the default",
  flag: "from the flag",
};

/** The answers, each with where it came from and the flag that would set it without a question. */
function answerLines({ notes }: { notes: readonly AnswerNote[] }): readonly string[] {
  return [
    "Your answers",
    ...notes.map(
      (note) => `  ${note.label.padEnd(10)}${note.value.padEnd(14)}(${SOURCE_NOTE[note.source]} — ${note.flag})`,
    ),
    "",
  ];
}

/**
 * Every tier's trade, in one line each — the chosen one marked, the others an answer away.
 *
 * The `ONE-WAY` lines are here rather than further down on purpose: this block IS the point of choice, and
 * the owner's instruction is that a cost which cannot be reversed is read before the choice is made, not
 * discovered in a footnote afterwards.
 */
function tradeLines({ tier }: { tier: OnboardTier }): readonly string[] {
  return [
    "The three tiers, and what each one costs",
    ...TIER_ORDER.flatMap((name) => {
      const spec = TIERS[name];
      const chosen = name === tier ? "▸" : " ";
      const badge = spec.recommended ? "RECOMMENDED, and " : "";
      return [
        `  ${chosen} ${name} — ${badge}${spec.securityLabel}`,
        `      ${spec.trade}`,
        ...spec.irreversible.map((cost) => `      ONE-WAY: ${cost}`),
      ];
    }),
    ...TIER_ORDER.filter((name) => name !== tier).map((name) => `  Switch with: slopweaver onboard --tier ${name}`),
    "",
  ];
}

/**
 * The Agents panel in full, printed only for the tier that turns it on.
 *
 * It buys two methods and costs a permanent change, and both halves are measured rather than assumed — see
 * `docs/slack-agent-surface/manifests-and-layout.md`. Saying what it buys is what keeps the recommendation
 * honest: a user who reads this and decides the two methods are not worth a one-way door has the `standard`
 * rung one line up.
 */
function agentViewLines({ tier }: { tier: OnboardTier }): readonly string[] {
  const spec = TIERS[tier];
  if (!spec.agentView) {
    return [];
  }
  return [
    "The Agents panel — read this before you paste",
    "  What it BUYS, measured against a live app: two methods. `assistant.threads.setTitle` names the thread",
    "  your question opened, and `assistant.threads.setSuggestedPrompts` seeds it. Everything else on the agent",
    "  surface — the thinking indicator, streaming, the todo card, the provenance footer — already runs on",
    "  `chat:write`, so a tag is answered identically on the `standard` tier.",
    "",
    "  What it COSTS, and this is the whole of it:",
    ...spec.irreversible.map((cost) => `    • ${cost}`),
    "    • it needs a reinstall, because `assistant:write` is a new scope — a new `xoxb-` token, and",
    "      `slopweaver secrets set slack-bot-token` again.",
    "",
    "  This is the recommended tier anyway, because the choice is yours to make and the capable thing should",
    "  not be withheld quietly. Now you know what it costs.",
    "",
  ];
}

/** The manifest itself, fenced so a copy is unambiguous about where it starts and stops. */
function manifestLines({ answers }: { answers: OnboardAnswers }): readonly string[] {
  return [
    `Paste this — the ${answers.tier} manifest`,
    "─".repeat(72),
    renderSlackAppManifest({ appName: answers.appName, tier: answers.tier }),
    "─".repeat(72),
    "",
  ];
}

/** Where the manifest goes, and the one way pasting it destroys something. */
function pasteLines(): readonly string[] {
  return [
    "Where it goes",
    "  1. https://api.slack.com/apps → Create New App → From an app manifest",
    "  2. pick your workspace, paste the JSON above, read the summary Slack shows you, then Create",
    "  3. Install to Workspace, then copy the tokens the install page gives you",
    "",
    "  Paste it into a NEW app. A manifest pasted over an EXISTING app REPLACES its whole configuration:",
    "  it renames the app and REVOKES every scope the manifest does not list, including ones something",
    "  else is running on. There is no diff and no undo — Slack applies it.",
    "",
  ];
}

/** What happens after the paste — the reinstall, and the admin wall a managed workspace puts in front of it. */
function afterPasteLines(): readonly string[] {
  return [
    "After the paste",
    "  • Changing scopes needs a REINSTALL. Tokens you already hold keep their OLD scopes until you",
    "    reinstall, and a call needing a new one fails with `missing_scope` until you do.",
    "  • In a managed workspace, installing (and every later reinstall) may need a WORKSPACE ADMIN to",
    "    approve it. You will see a request-sent notice instead of a token — that is the flow working, and",
    "    there is nothing to do but wait for them. Ask early if you know your workspace restricts apps.",
    "  • No token is ever pasted into a chat, passed on a command line, or written to this repository.",
    "    `slopweaver secrets set` reads it with echo off and stores it 0600 under $SLOPWEAVER_HOME/secrets.",
    "",
  ];
}

/**
 * The Socket Mode credential, printed from `listen`'s own step list rather than restated.
 *
 * The manifest already performs three of the five steps, so saying which ones is the difference between
 * reusing the list and contradicting it.
 */
function socketModeLines(): readonly string[] {
  return [
    "Socket Mode needs a THIRD credential",
    "  Neither the bot nor the user token can open a Socket Mode connection — it takes an app-level `xapp-`",
    "  token, which only the app itself can mint. These are `slopweaver listen --check`'s own five steps,",
    "  printed from the same list so the two can never drift:",
    "",
    ...LISTEN_SETUP_STEPS.map((step) => `    ${step}`),
    "",
    "  The manifest above already did 1, 3 and 4 — socket_mode_enabled, BOTH bot events (`app_mention` for a",
    "  channel tag and `message.im` for a DM), and both of the scopes they need (`app_mentions:read` and",
    "  `im:history`). Steps 2 and 5 are yours: a token cannot be carried in a manifest.",
    "",
  ];
}

/** One lane's grants — every scope, the capability it buys, and the call that fails without it. */
function laneLines({
  grants,
  lane,
  heading,
}: {
  grants: readonly ScopeGrant[];
  lane: ScopeLane;
  heading: string;
}): readonly string[] {
  const mine = grants.filter((grant) => grant.lane === lane);
  if (mine.length === 0) {
    return [];
  }
  return [
    `  ${heading}`,
    ...mine.flatMap((grant) => [
      `    ${grant.scope.padEnd(SCOPE_COLUMN)}${grant.capability}`,
      `    ${" ".repeat(SCOPE_COLUMN)}↳ ${grant.why}`,
    ]),
    "",
  ];
}

/** Every scope in the chosen tier, with its justification — the list an admin is being asked to approve. */
function scopeLines({ tier }: { tier: OnboardTier }): readonly string[] {
  const spec = TIERS[tier];
  return [
    `Every scope the ${tier} manifest asks for, and the call that needs it`,
    "",
    ...laneLines({
      grants: spec.grants,
      heading: "USER TOKEN (xoxp-) — acts as YOU, and reaches exactly what you can already reach",
      lane: "user",
    }),
    ...laneLines({
      grants: spec.grants,
      heading: "BOT TOKEN (xoxb-) — acts as a separate member of the workspace, with its own name",
      lane: "bot",
    }),
  ];
}

/** What this tier makes usable, and what it does not — stated now rather than discovered on a refusal. */
function capabilityLines({ tier }: { tier: OnboardTier }): readonly string[] {
  const spec = TIERS[tier];
  const withheld =
    spec.withholds.length === 0
      ? "  withholds  nothing — this is the whole surface"
      : `  withholds  ${spec.withholds.join(", ")} (unavailable without the scopes above)`;
  return [`This tier`, `  enables    ${spec.enables.join(", ")}`, withheld, ""];
}

/**
 * The two one-time steps that get a live Slack tag flowing, once the ingest-and-read steps above already
 * work — the `xapp-` capture used to live ONLY inside {@link socketModeLines}'s narrative, which a user
 * reading for the mechanical checklist could miss entirely; and nothing here ever said that `responders.json`
 * starts empty, which refuses every tag including the owner's own until someone explicitly whitelists it (see
 * `stateHome.ts`'s own doc on `respondersJson`: "absent means every identity is refused... the one gate in
 * this repository where 'not configured yet' and 'configured closed' are the same state on purpose"). Neither
 * line here changes that: `onboard` still reads and writes nothing, it only makes both steps explicit.
 */
function liveListenerCommandLines(): readonly string[] {
  return [
    "",
    "  To let the bot answer a live Slack tag (not just `store read` run locally), two more one-time steps:",
    `  slopweaver secrets set ${APP_TOKEN_SECRET}       # the xapp- token — Socket Mode → App-Level Tokens, above`,
    '  slopweaver responders add --user <your Slack user id> --reason "onboarding"',
    "                                                    # responders.json starts EMPTY — until this runs, every",
    "                                                    # tag is refused, including your own",
  ];
}

/**
 * The commands to run once the app exists, in the order they have to happen — for EVERY source, not only
 * Slack.
 *
 * This block is the single command authority of the whole session: the source block above names each
 * credential and the page it comes from, and this is the only place that spells a command to run. Two
 * places printing the same command is how a flow starts contradicting itself the first time one is edited.
 *
 * Only the sources a user actually connected need running, and nothing here can know which those are, so
 * every source is listed and the leading line says to skip the ones they are not using. That is the honest
 * shape for a rendering with no state: the alternative is a flow that asks five questions to save five
 * lines of scrollback.
 */
function nextCommandLines({ tier, answers }: { tier: OnboardTier; answers: OnboardAnswers }): readonly string[] {
  // Asked of the GRANTS rather than the tier name: a bot token is worth capturing exactly when the manifest
  // provisions a bot, so adding a rung can never leave this list quietly telling the truth about the wrong one.
  const hasBot = TIERS[tier].grants.some((grant) => grant.lane === "bot");
  return [
    "Then, in this order — skip any source you are not connecting",
    "  slopweaver init",
    "",
    "  # capture each credential (echo OFF; stored 0600 under $SLOPWEAVER_HOME/secrets)",
    "  slopweaver secrets set slack-user-token          # the xoxp- token from the install page",
    ...(hasBot ? ["  slopweaver secrets set slack-bot-token           # the xoxb- token, same page"] : []),
    "  slopweaver secrets set linear-token              # Linear → Settings → API → Personal API keys",
    "  slopweaver secrets set notion-token              # a Notion internal integration secret",
    "  slopweaver secrets set google-client-id           # the Desktop-app OAuth client, from Google Cloud",
    "  slopweaver secrets set google-client-secret       # SHOWN ONCE — save it to your password manager before you leave the page",
    "  slopweaver gmail connect --grant read            # Gmail's one consent step, in the browser",
    "  slopweaver secrets set outlook-client-id         # the Entra app registration's Application (client) ID",
    "  slopweaver outlook connect --grant manage        # Outlook's one consent step, in the browser",
    "",
    "  # prove every credential AND its scopes, before anything crawls",
    "  slopweaver connect slack --check",
    "  slopweaver connect github --check --repo <owner/repo>",
    "  slopweaver connect linear --check",
    "  slopweaver connect notion --check",
    "  slopweaver connect gmail --check",
    "  slopweaver connect outlook --check",
    "",
    "  # pull them CONCURRENTLY — `slopweaver onboard plan` emits the exact argv per source",
    "  slopweaver refresh --source slack --lookback-days 90",
    "  slopweaver refresh --source gmail --lookback-days 90",
    "                                                    # gmail is NEVER included by --all-sources; name it.",
    "                                                    # `--all --accept-full-history` pulls the whole mailbox;",
    "                                                    # `slopweaver gmail measure` prices that first.",
    "  slopweaver refresh --source outlook",
    "                                                    # outlook is NEVER included by --all-sources; name it.",
    "                                                    # it reads every folder whole once, then what changed.",
    "",
    "  slopweaver derive && slopweaver distil",
    '  slopweaver store read "what has the team shipped recently?"',
    ...(TIERS[tier].socketMode ? liveListenerCommandLines() : []),
    ...mailboxCommandLines({ plan: mailboxPlan({ identity: answers.identity, zone: answers.mailboxZone }) }),
    "",
    "  `slopweaver onboard` is safe to re-run: it reads nothing and writes nothing, it only renders this.",
  ];
}
/**
 * The whole onboarding session as lines — the answers, both tiers' trade, the manifest, where it goes, what
 * happens after the paste, every scope with its justification, and what to run next.
 *
 * @param answers the app name and tier this render is a function of
 * @param notes where each answer came from
 * @returns the lines to print, in order
 */
export function renderOnboardSession({
  answers,
  notes,
}: {
  answers: OnboardAnswers;
  notes: readonly AnswerNote[];
}): readonly string[] {
  return [
    `slopweaver onboard — five sources, live Outlook, one Slack app, one org-owned mailbox, and how much it may do`,
    "",
    ...answerLines({ notes }),
    ...connectSourceLines({ hasBot: TIERS[answers.tier].grants.some((grant) => grant.lane === "bot") }),
    // "What to connect", then "what identity you connect AS", then "how much reach the Slack app gets". The
    // org-owned mailbox is not a sixth source — `ConnectSource` is a closed type it cannot join, and neither is the
    // live Outlook connector, which renders inside the source block as its own section — so it sits beside
    // the source block rather than inside it, and ahead of a tier choice it has nothing to do with.
    ...mailboxLines({ plan: mailboxPlan({ identity: answers.identity, zone: answers.mailboxZone }) }),
    ...tradeLines({ tier: answers.tier }),
    ...agentViewLines({ tier: answers.tier }),
    ...manifestLines({ answers }),
    ...pasteLines(),
    ...afterPasteLines(),
    ...(TIERS[answers.tier].socketMode ? socketModeLines() : []),
    ...scopeLines({ tier: answers.tier }),
    ...capabilityLines({ tier: answers.tier }),
    ...nextCommandLines({ answers, tier: answers.tier }),
  ];
}

/**
 * The same session as a machine-readable value: the manifest object itself, both tiers' trade, and every
 * scope with its justification. Carries no token and no workspace identifier — there is nothing here that
 * is not a function of the app name the user typed.
 *
 * @param answers the app name and tier
 * @param notes where each answer came from
 * @returns the JSON text
 */
export function renderOnboardJson({
  answers,
  notes,
}: {
  answers: OnboardAnswers;
  notes: readonly AnswerNote[];
}): string {
  const spec = TIERS[answers.tier];
  return JSON.stringify(
    {
      answers,
      appLevelTokenSteps: spec.socketMode ? LISTEN_SETUP_STEPS : [],
      // Every source `onboard` connects, with the exact credential and page each one needs. A consumer
      // reading this document can drive the whole cold start without re-deriving any of it from prose.
      connectSources: ONBOARD_SOURCES.map((source) => SOURCE_SPECS[source]),
      enables: spec.enables,
      grants: spec.grants,
      // The derived addresses themselves, for the same reason `connectSources` carries the source specs: a
      // consumer of this document can drive the whole cold start without re-deriving anything from prose.
      mailbox: mailboxPlan({ identity: answers.identity, zone: answers.mailboxZone }),
      manifest: buildSlackAppManifest({ appName: answers.appName, tier: answers.tier }),
      notes,
      tiers: TIER_ORDER.map((name) => ({
        agentView: TIERS[name].agentView,
        irreversible: TIERS[name].irreversible,
        recommended: TIERS[name].recommended,
        securityLabel: TIERS[name].securityLabel,
        tier: name,
        trade: TIERS[name].trade,
      })),
      withholds: spec.withholds,
    },
    null,
    2,
  );
}
