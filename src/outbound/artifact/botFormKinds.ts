/**
 * The DECLARED set of bot form kinds — one entry per shape `slopweaver slack post --as bot --form -` takes,
 * each carrying its own parser and its own canonical fixture. The parsers themselves are `./botFormLanes.ts`.
 *
 * ## Why this is a registry rather than three `if`s
 *
 * It used to be three `if`s in `./coreForm.ts`, and the set was therefore not enumerable by anything. That
 * cost nothing until something needed to ASK how many kinds there are: the `derived-card-voice` gate
 * (`../../../devLint/derivedCardVoice.ts`) runs the operator's own voice rules over every kind's DERIVED
 * card, and a gate built on a hand-written list of kinds would have covered every kind somebody remembered
 * to add to it. That is the same defect the gate exists to close, one level up.
 *
 * So the set is a value. `parseSlackForm` finds the entry whose `kind` matches the payload's discriminant,
 * the gate iterates the same array, and neither can see a kind the other cannot.
 *
 * ## `fixture` is REQUIRED by the type, and that is the whole mechanism
 *
 * A kind cannot be added here without a canonical form that exercises its derivation, because the compiler
 * refuses an entry without one. That is what makes the gate's coverage claim structural rather than a
 * convention somebody keeps: there is no arrangement of this file in which a kind exists and its fixture
 * does not.
 *
 * A fixture is not a test fixture. It is the SMALLEST form that makes the derivation mint every piece of
 * prose it mints — a separator, a count sentence, a closing clause — because text no fixture provokes is
 * text the gate never sees. `derivedCardVoice.test.ts` asserts each one still provokes its own derivation,
 * so gutting a fixture reddens a test rather than quietly narrowing the gate.
 */
import { defaultIntro } from "../../live/automation/firstFiring.js";
import type { SlackDelivery } from "../slack/deliveryErrors.js";
import { AUTOMATION_PROMPT_KIND } from "./automationPrompt.js";
import {
  type ParsedForm,
  parseAlertSummaryForm,
  parseAutomationPromptForm,
  parseDigestForm,
  parseFindingForm,
  parseNoFoldForm,
  parseUpdateForm,
  parseWitnessForm,
} from "./botFormLanes.js";
import { FINDING_KIND } from "./finding.js";
import { WITNESS_KIND } from "./witness.js";

/** One shape the bot lane can be handed, its parser, and the canonical form that exercises its derivation. */
export interface BotFormKind {
  /** The `kind` discriminant a payload carries. */
  readonly kind: string;
  /** What this posting IS, in one line — what a reader needs to choose between the kinds. */
  readonly what: string;
  /**
   * Whether this entry is the one a payload with no recognised `kind` falls through to.
   *
   * Exactly one entry is, and `botFormKinds.test.ts` asserts it: a set with two fallbacks has an ordering
   * dependence nobody declared, and a set with none silently refuses every hand-written card.
   */
  readonly fallback: boolean;
  /**
   * Every canonical form for this kind: one per branch its derivation composes DIFFERENTLY.
   *
   * Non-empty by its TYPE, so a kind cannot join the registry contributing nothing to the scan. Plural
   * because one fixture per kind is one derivation PATH per kind, and the paths are where the prose is:
   * `countSentence` writes three wordings, and the alerts derivation's baseline sentence two. A single fixture leaves the others composing text no gate has read, which
   * is precisely the shape this gate exists to close — it was written that way first, and the review of its
   * own first commit is what found it.
   *
   * `unknown`-typed on purpose: each goes through the same `parse` every real payload does, so a fixture
   * that has drifted out of its own schema is caught by the gate rather than by a cast here.
   */
  readonly fixtures: readonly [unknown, ...(readonly unknown[])];
  /** Parse a raw payload of this kind into the artifact it sends. */
  readonly parse: (args: { raw: unknown; isKnownPerson: (person: string) => boolean }) => SlackDelivery<ParsedForm>;
}

/**
 * Every shape `--as bot --form -` accepts, in dispatch order.
 *
 * Five of them derive the FOLDED card, and the split among those is between one that carries LAYOUT and four
 * that carry DOMAIN DATA. The no-fold and automation-prompt kinds are a different message shape entirely.
 * The derived kinds are right when the composer is a scheduled job, because then nothing is watching: the
 * ordering, the table columns and the link placement stop being things that can be got wrong.
 */
export const BOT_FORM_KINDS: readonly BotFormKind[] = [
  {
    fallback: false,
    fixtures: [
      {
        items: [
          {
            count: 41,
            owner: { ask: "confirm the rollback landed", person: "owner" },
            severity: "red",
            state: "fix on staging, awaits release",
            substance: "The pool exhausts under the nightly reindex and the retry storm keeps it exhausted.",
            ticket: { id: "SUP-912", url: "https://example.invalid/SUP-912" },
            title: "staging connection pool exhausts",
            trend: "rising",
          },
          {
            count: 3,
            severity: "green",
            state: "watching",
            title: "cache miss storm",
          },
        ],
        kind: "digest",
        label: "Triage",
        lead: "One of these wants a decision today.",
        window: "7d",
      },
      // The ALERTS derivation writes its own TL;DR (a priority, a trend clause) and two below-fold sentences,
      // an impact basis and a baseline. Two fixtures, because the baseline sentence has two wordings: one naming
      // what was divided by what, and one saying nothing was compared.
      {
        alerts: { trend: { priorTotal: 30, priorWindows: 3 } },
        items: [
          {
            citationUrl: "https://example.invalid/logs?query=nz",
            count: 4,
            impact: { matched: 4, scope: 2000, service: "jobs-api" },
            severity: "red",
            state: "third digest",
            title: "NZ push-token registration",
          },
          {
            citationUrl: "https://example.invalid/logs?query=pending",
            count: 300,
            impact: { matched: 300, scope: 1000, service: "jobs-api" },
            severity: "orange",
            title: "purchase-payment-pending 422",
            trend: "rising",
          },
          { count: 0, severity: "green", title: "notification transition race" },
        ],
        kind: "digest",
        label: "Knock",
        lead: "NZ is still dark.",
        window: "24h",
      },
      {
        alerts: {},
        items: [{ count: 12, severity: "orange", title: "send failures" }],
        kind: "digest",
        label: "Growth ops",
        window: "24h",
      },
    ],
    kind: "digest",
    parse: ({ isKnownPerson, raw }) => parseDigestForm({ isKnownPerson, raw }),
    what:
      "a TRIAGE LIST — severities, tickets, owners — whose layout is derived by `digestToUpdate`; with an " +
      "`alerts` block, ranked by the P0-P4 priority matrix and compared with the windows before it",
  },
  {
    fallback: false,
    // FIVE. Three because `countSentence` writes three different sentences, each a claim above the fold, and
    // two more for the day-one INTRO, which is the other prose this repository composes into that region —
    // `live/automation/firstFiring.ts`'s `defaultIntro`, whose lines interpolate a cadence phrase with four
    // outcomes of its own. They import the real function rather than restating it, so a reworded intro is read
    // here on the next push instead of on a channel. The two cadences are the named shape and the fallback.
    // The normal tally: two rows so the ranked list renders, an `omitted` tail so the derived total is not the
    // visible sum, a `trend` so the comparison clause is minted, a non-zero `skipped` so the coverage note is
    // written. Then the two empties, which are different FACTS rather than the same fact with a different
    // number — the whole point of that function.
    fixtures: [
      {
        kind: "alert-summary",
        label: "Gateway",
        lead: "The top two are the same deploy.",
        omitted: { count: 23, monitors: 7 },
        rows: [
          { citationUrl: "https://example.invalid/logs?q=timeout", count: 240, label: "upstream timeout" },
          { count: 12, label: "queue-drain stalled" },
        ],
        skipped: 4,
        trend: { priorTotal: 120, priorWindows: 3 },
        window: "7d",
      },
      { kind: "alert-summary", label: "Knock", rows: [], skipped: 18, window: "14d" },
      { kind: "alert-summary", label: "Knock", rows: [], skipped: 0, window: "14d" },
      {
        intro: defaultIntro({ cadence: "0 9 * * 1-5" }),
        kind: "alert-summary",
        label: "Gateway",
        rows: [{ count: 9, label: "upstream timeout" }],
        skipped: 0,
        window: "7d",
      },
      {
        intro: defaultIntro({ cadence: "*/7 3 1 * *" }),
        kind: "alert-summary",
        label: "Gateway",
        rows: [{ count: 9, label: "upstream timeout" }],
        skipped: 0,
        window: "7d",
      },
    ],
    kind: "alert-summary",
    parse: ({ raw }) => parseAlertSummaryForm({ raw }),
    what: "a TALLY — what fired and how often — whose layout, total and comparison clause are all derived",
  },
  {
    fallback: false,
    // BOTH blast-radius branches, because each composes its own index line and its own below-fold sentence:
    // a measured count of unique users, and a count nothing could take with the nearest number beside it.
    // Both are made up, their citations on the synthetic `us3` site.
    fixtures: [
      {
        blastRadius: { basis: "unique usr.id on the checkout spans", users: 240, window: "24 hours" },
        citationUrl: "https://us3.datadoghq.com/apm/traces?query=env%3Aproduction%20status%3Aerror",
        env: "production",
        impact: { grade: "high", what: "Customers cannot pay for a booking." },
        introduced: "first failing call right after the payments deploy, none the week before",
        kind: FINDING_KIND,
        options: ["Roll back the payments deploy.", "Retry the charge on the new gateway."],
        priorThread: { none: "no #defects or #urgent-defects thread on checkout in the last 14 days" },
        title: "Checkout payments fail after the deploy",
        tracking: { none: "searched Linear for payment and checkout, nothing open" },
      },
      {
        blastRadius: {
          proxy: "120 failed calls from one account",
          unmeasuredBecause: "these spans carry no user id and no parent trace does either",
        },
        citationUrl: "https://us3.datadoghq.com/apm/traces?query=env%3Aproduction%20%40http.status_code%3A404",
        env: "production",
        impact: { grade: "high", what: "Users on that account see no slots and cannot check out." },
        introduced: "first failing call three days ago",
        kind: FINDING_KIND,
        options: ["Ask the account owner to reissue its integration key."],
        priorThread: { none: "no #defects thread on the account in the last 14 days" },
        title: "One account's checkout calls all fail",
        tracking: { none: "searched Linear for the account name, nothing open" },
      },
      // Evidence beyond Datadog: a listed console, whose name the card's link carries.
      {
        blastRadius: { basis: "customer ids on the refunded purchases in the warehouse", users: 63, window: "30 days" },
        citationUrl: "https://app.hex.tech/acme/app/refunds",
        env: "production",
        impact: { grade: "medium", what: "Refunded customers keep bookings nobody pays for." },
        introduced: "since at least three months ago, the first refund the warehouse shows it on",
        kind: FINDING_KIND,
        options: ["Cancel the orphaned tasks for each refunded purchase."],
        priorThread: { none: "no #defects thread on refunds in the last 90 days" },
        title: "Refunds leave paid care booked",
        tracking: { none: "searched Linear for refund and entitlement, nothing open" },
      },
    ],
    kind: FINDING_KIND,
    parse: ({ raw }) => parseFindingForm({ raw }),
    what:
      "ONE issue an investigation found — impact, unique-user blast radius, env, when introduced, where earlier " +
      "threads were searched, options, and an optional daily `cost` — ranked by the finding matrix, refused below P2 " +
      "or when already tracked, a P0 or P1 with a cost tagging its `escalate` people, and released into a team " +
      "channel on the owner's yes",
  },
  {
    fallback: false,
    // ALL THREE materialities, because each leads the claim paragraph with its own label, and both `checked`
    // branches, because the list below the fold is composed only when it is present.
    fixtures: [
      {
        claim: { messageTs: "1759650000.000100", quote: "Resolved, the retry went through for the customer." },
        finding: "Booking errors kept arriving for another hour after the thread called this resolved.",
        kind: WITNESS_KIND,
        materiality: "claim-contradicted",
        proof: [
          {
            label: "The booking error view",
            shows: "41 failed bookings after the retry",
            url: "https://example.invalid/logs?query=booking-errors",
          },
        ],
      },
      {
        checked: ["The payments service logs for the same hour.", "The account's own sync status."],
        claim: { messageTs: "1759650000.000200", quote: "Retried the sync and the customer can book now." },
        finding: "The retry fixed one customer, but twenty others hit the same sync failure today.",
        kind: WITNESS_KIND,
        materiality: "wider-impact",
        proof: [
          {
            label: "The sync failure traces",
            shows: "21 customers failing the same step since 09:00",
            url: "https://example.invalid/traces?query=sync-failure",
          },
          {
            label: "The customer who was retried",
            shows: "one successful booking after the retry",
            url: "https://example.invalid/customers/synthetic-1",
          },
        ],
      },
      {
        checked: ["The deploy log for the morning."],
        claim: { messageTs: "1759650000.000300", quote: "No idea what changed, nothing was deployed." },
        finding: "A config change to the booking service landed ten minutes before the first error.",
        kind: WITNESS_KIND,
        materiality: "missing-fact",
        proof: [
          {
            label: "The config change",
            shows: "the booking timeout lowered at 08:50",
            url: "https://example.invalid/pr/2",
          },
        ],
      },
    ],
    kind: WITNESS_KIND,
    parse: ({ raw }) => parseWitnessForm({ raw }),
    what:
      "ONE material finding about a thread the bot witnessed — a contradicted claim, a wider impact or a missing " +
      "fact — in one sentence, with at least one https proof and the thread's own words quoted below the fold",
  },
  {
    fallback: false,
    fixtures: [
      {
        bullets: [[{ text: "Read the policy.", type: "text" }], [{ text: "Say yes in this thread.", type: "text" }]],
        kind: "no-fold",
        lead: [{ text: "Two things to do before Friday.", type: "text" }],
        trailing: [[{ text: "That is the whole ask.", type: "text" }]],
      },
    ],
    kind: "no-fold",
    parse: ({ raw }) => parseNoFoldForm({ raw }),
    what: "a message that must render ENTIRELY ABOVE THE FOLD — no card, no wrapper, no `detail`",
  },
  {
    fallback: false,
    // BOTH branches of the trailing run. A row that names a `postTo` spends a destination line out of the
    // same whole-message budget as the prompt, and it is prose this repository composes — so a fixture that
    // only exercised the absent branch would leave that sentence unread by every gate in the chain, which is
    // the defect this registry's own `fixtures` field exists to close.
    fixtures: [
      {
        kind: AUTOMATION_PROMPT_KIND,
        postTo: "Cteamroom",
        prompt:
          "daily summary post. FIRST run the summary verb with --json and use its tldr and index lines verbatim. " +
          "Below the fold, lead with your own ranked list of what closes the most open items per hour.",
        recipeId: "daily-summary",
      },
      {
        kind: AUTOMATION_PROMPT_KIND,
        prompt: "read yesterday's recommendation set and raise the first kept entry as a draft pull request.",
        recipeId: "team-alerts-actioned",
      },
    ],
    kind: AUTOMATION_PROMPT_KIND,
    parse: ({ raw }) => parseAutomationPromptForm({ raw }),
    what: "the bot's OWN instructions for one scheduled row — refused anywhere but the private prompt conversation",
  },
  {
    fallback: true,
    fixtures: [
      {
        citations: [],
        detail: [
          { runs: [{ text: "What changed, and what it means for the reader.", type: "text" }], type: "paragraph" },
        ],
        index: [],
        kind: "update",
        media: [],
        primaryLink: { label: "the change", url: "https://example.invalid/pr/1" },
        tldr: "One short line that leads the above-the-fold region.",
      },
    ],
    kind: "update",
    parse: ({ raw }) => parseUpdateForm({ raw }),
    what: "a LAYOUT — the caller decided what sits above the fold, so nothing is derived",
  },
];

/**
 * The entry that handles one raw payload: the kind whose discriminant it carries, else the fallback.
 *
 * @param raw the payload, already JSON-parsed
 * @returns the entry to parse it with — never undefined, because exactly one entry is the fallback
 */
export function botFormKindFor({ raw }: { raw: unknown }): BotFormKind {
  const discriminant = typeof raw === "object" && raw !== null && "kind" in raw ? raw.kind : undefined;
  const named = BOT_FORM_KINDS.find((entry) => entry.kind === discriminant && !entry.fallback);
  if (named !== undefined) {
    return named;
  }
  return BOT_FORM_KINDS.find((entry) => entry.fallback)!;
}
