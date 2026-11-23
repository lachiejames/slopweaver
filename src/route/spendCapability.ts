/**
 * The two MONEY rows — `saas-spend`, what this organisation spends, and `billing`, what it receives.
 *
 * Held apart from `./genericCapabilities.ts` along the seam `file-size-ratchet` found, the same one
 * `./atlasEstateCapability.ts` and `./attachmentsCapability.ts` sit on: that file is at its recorded
 * ceiling, and each row here carries a rationale several times the length of the row. Both are spliced back
 * into `GENERIC_SOURCE_CAPABILITIES` by reference and nothing about merging, ordering, `./sourceNouns.ts`'s
 * partition or a private overlay's by-id replacement changes.
 *
 * ## The rule this file is the reason for
 *
 * `./genericCapabilities.ts`'s header states it — one class of word, one row — and this file is where the
 * money class lands. The two rows are here TOGETHER because neither is correct alone: `billing` held the
 * only cost vocabulary on the roster while being unavailable, so a spend skim found it and read the absence
 * of a leg as the absence of the subject. The fix was one reachable row plus a redirect on the other, which
 * makes them one unit to read and to change. `unit/route/spendCapability.test.ts` already covered both.
 *
 * Everything either row says about what does NOT hold cost is carried in `coverage.detail` rather than in
 * `availability.reason`, because `../live/turn/briefCapabilityContracts.ts`'s `renderCapabilityContracts`
 * prints the first and never the second — so a redirect written only into the reason satisfies a table test
 * and changes nothing a reader sees. That test asserts on the text a reader actually gets, for exactly that
 * reason.
 */
import { type SourceCapability, UNKNOWN_FRESHNESS } from "./profile.js";

/** The SPEND leg: what the estate costs, and the one hand-off to the leg that holds a real number. */
export const SAAS_SPEND_CAPABILITY: SourceCapability = {
  // The SPEND leg. MEASURED by the loop on a DM tag from the owner: `turn brief` offered 44 capabilities
  // and not one of them held cost, so a saas-spend question could only be ranked by a PROXY presented as
  // cost — `google-admin-atlas` seat counts, `vanta-vendor-atlas` risk. The same class as the missing
  // historical leg that `routingCapabilities.ts`'s header measures: the capability list is the world the
  // worker believes, and a missing leg is invisible from inside it. The failure is never a refusal — a
  // worker names current legs and writes something fluent that reads like a spend answer.
  //
  // Cost was in fact REACHABLE the whole time and not FINDABLE as cost. `derivedAtlasTerms` builds a
  // derived atlas row's vocabulary from the platform name alone, so `trelica-atlas` was selectable by
  // "trelica" and by nothing else, and its `what` mentioned "what it costs" in one clause of a sentence
  // about discovery and ownership. A question that does not name the vendor never reaches it.
  //
  // ## Why this row is `sourceClass: "atlas"` on the trelica platform
  //
  // `atlasPlatformOf` reads the argv element after `atlas`, and `withDerivedAtlasCapabilities` skips a
  // platform a base or overlay row already covers, so this row REPLACES the derived `trelica-atlas` row
  // rather than sitting beside it — the mechanism `./atlasCapability.ts` documents for the twenty
  // `vanta-*-atlas` overlay rows, for the same reason: an authored row describes this atlas far better
  // than a mechanical sentence can. The roster's row count is unchanged, and `deriveAtlasCapability`
  // still grades it, so an install with no Trelica generation sees it downgraded with the atlas's own
  // refusal text rather than promising a leg it does not have. If a private overlay ever adds its own
  // trelica row, the suppression is by PLATFORM and this row goes with it — spend vocabulary included.
  //
  // ## The command is `coverage`, and the zero is stated
  //
  // A SCOPE read, for the reason the `drive` row gives: `atlas trelica read --query` takes words that
  // must ALL appear, so a whole question filters to nothing and reads as absence. `coverage` settles what
  // the generation holds without pretending to answer.
  //
  // The zero boundary in `coverage.detail` is the load-bearing sentence, not a caveat. MEASURED again on
  // one generation: all 963 applications carry `lastYearSpend: 0` and not one
  // carries a licence plan. A row that promised "what the org spends" without saying so would swap one
  // misleading answer for a worse one — a session would run the read, get 963 zeroes, and report that the
  // organisation spends nothing, with a citation.
  // Repro: `slopweaver atlas trelica read --kind app --json --limit 1000`.
  //
  // WHY it is zero is witnessed rather than inferred, which is a stronger claim than the row used to
  // make. The atlas's own browser artifact of `https://acme.trelica.app/Spend` (page entity
  // observed with the generation above) renders "No spend data", an
  // EMPTY Data sources panel and a "Track spend" call to action. So the zeroes are not 963 per-application
  // silences: this tenant has no finance source connected to Trelica at all.
  //
  // ## "Nothing else on this roster holds cost" was FALSE, and it sent a worker away from the one leg
  //
  // MEASURED dogfooding the owner's own question in the bot DM: the `corpus` row on
  // this same roster holds negotiated contract values. `slopweaver store read "annual subscription cost"`
  // selects a procurement write-up in Notion that carries negotiated contract values for the vendors that
  // went through procurement. That is the SAME class as the
  // finding this row was written for — a row saying "there is no leg" when a leg
  // exists — one hop further along, and it survived because the sentence was written from the atlas
  // roster rather than from the whole one.
  //
  // The repair is a HAND-OFF inside this row, never spend vocabulary on the `corpus` row: the header's
  // "One class of word, one row" rule is what stops a cost skim landing in two places, and
  // `unit/route/spendCapability.test.ts`'s `claimsSpend` case enforces it. The hand-off has to say
  // per-negotiated-VENDOR and not a register, because the corpus holds a write-up for the vendors that
  // went through procurement and no cost column over the estate — a worker who reads "the corpus holds
  // cost" and sums what `store read` returns reports two vendors as the organisation's SaaS spend.
  //
  // The second hand-off, `spend read`, exists because the owner pasted a company card's statement page and
  // wanted that spend tracked. It is a hand-off here for the same one-row reason, and it carries
  // the limit of what a pasted page proves: it gives no decline reason, so a declined charge cannot be
  // attributed to the card's limit from the page alone.
  //
  // ## AI spend is this row's own leg, not a hand-off
  //
  // MEASURED once the AI Consumption permission was granted: `turn brief` on an AI-spend
  // question still read "this leg ... answers no cost question", while the same atlas held AI spend
  // across 75 cost-explorer rows. The row was the only thing between the bot and the answer, so
  // the zero sentence is now scoped to the APPLICATION rows. The dimensions overlap — one dollar is in an
  // app row, a model row and a team row at once — so the row says never to sum across them.
  // Repro: `slopweaver turn brief --contracts --text "how much AI spend did each model rack up"`.
  availability: { kind: "available" },
  command: ["slopweaver", "atlas", "trelica", "coverage"],
  coverage: {
    detail:
      "which Trelica surfaces the last sync filled. The READING is the separate act: `slopweaver atlas " +
      "trelica read --kind app` is every discovered application with its `lastYearSpend`, its licence " +
      "plans, its account count, its vendor and its owner. That number is a TRAILING-YEAR total, never a " +
      "current run rate, and a spend TRANSACTION row is not stored at all — the surface is reached and " +
      "the per-application total kept, under the voluminous disposition. A `lastYearSpend` of zero is " +
      "Trelica's own finance feed saying nothing on that application, and is NEVER evidence the " +
      "organisation spends nothing: say which it is. On this install every one of them is zero because " +
      "no finance source is connected to the tenant at all — Trelica's own Spend page renders `No spend " +
      "data` over an empty data-source list — so the application rows size the ESTATE and answer no cost " +
      "question until that is connected. AI spend is the exception, and it is this atlas's own: " +
      "`slopweaver atlas trelica read --kind ai-usage` is Trelica's AI cost explorer — estimated spend, " +
      "tokens and requests over a two-year window per AI application, team, cost centre, model, API key " +
      "and person, with a monthly series for the explorer's top rows — and `--kind ai-alert` is its " +
      "spend-spike alerts. The dimensions OVERLAP, one dollar sitting in an application, a model and a team " +
      "row at once, so never sum across them. API keys under $1 are not held: the `ai-usage:api-key-tail` " +
      "coverage cell counts them, and bounds their total only when the walk reached one — a `deferred` " +
      "cell carries no bound, so never quote one. Two other legs hold cost today. The `corpus` row on this same " +
      "roster: `slopweaver store read` reaches the procurement write-ups, which carry a negotiated " +
      "annual contract value per VENDOR — a handful of vendors, never a register over the estate, so " +
      "never sum what it returns and call it the organisation's SaaS spend. And `slopweaver spend read`: " +
      "the company AI card (Airwallex) that the Claude and ChatGPT/Codex plans bill to — its monthly " +
      "limit, headroom, reset day, declines and per-merchant charges, from the newest snapshot: a card page " +
      "the owner pasted and `spend import` stored, or a `spend capture --store` read of their card page in their own " +
      "Chrome, so only as fresh as that snapshot's day. A live snapshot carries Airwallex's own reason for " +
      "each decline; a pasted one gives none, so never call a decline the monthly limit unless it says so. Nothing else holds cost, so " +
      "do not substitute one — seat, licence and account counts are counts; a vendor's own published " +
      "price list (`slopweaver atlas jumpcloud read --kind subscriptions`) is what that vendor CHARGES, " +
      "not what this organisation pays; a Vanta vendor's contract amount is " +
      "withheld to a companion file no verb reads; Xero's books are unreachable with no OAuth connection " +
      "configured; and an invoice or a renewal notice is `gmail` and `drive`",
    kind: "bounded",
  },
  effect: "read",
  freshness: {
    detail:
      "the generation the last `slopweaver atlas trelica sync` published locally; nothing schedules the " +
      "next one, so state the generation's age rather than implying live",
    kind: "cached",
  },
  id: "saas-spend",
  owner: "slopweaver",
  sourceClass: "atlas",
  terms: [
    "spend",
    "spending",
    "cost",
    "costs",
    "how much are we paying",
    "saas spend",
    "subscription",
    "subscriptions",
    "licence",
    "license",
    "licences",
    "licenses",
    "seat",
    "seats",
    "renewal",
    "renewals",
    "contract value",
    "vendor spend",
    "budget",
    "trelica",
    "airwallex",
    "card limit",
    "declined",
    "ai spend",
    "ai usage",
    "ai cost",
    "cost explorer",
    "model spend",
    "token usage",
    "api key spend",
    "spend spike",
  ],
  truthMode: "current",
  what: "what this organisation SPENDS on SaaS and on AI — the trailing-year total per discovered application, with its licence plans, account count and vendor, and AI spend by application, team, cost centre, model, API key and person, out of the org's own SaaS-discovery platform",
};

/** The money-IN leg: unreachable, and pointing at the reachable row a spend skim is really looking for. */
export const BILLING_CAPABILITY: SourceCapability = {
  // Money IN, and the row now says so. It used to read "the payment processor and the billing records it
  // holds", which put `billing`, `invoice` and `charge` — the ONLY cost vocabulary anywhere on the roster
  // — on an UNAVAILABLE row. MEASURED on a DM tag from the owner: a worker skimming a 44-row roster for
  // spend found this, read it as "nothing here holds money", and ranked `google-admin-atlas` seat counts
  // and `vanta-vendor-atlas` risk as though either were cost. Pointing money OUT at the row that holds it
  // is the half an added leg cannot do by itself: otherwise the absence of a leg goes on reading as the
  // absence of the subject.
  availability: {
    kind: "unavailable",
    reason:
      "Slopweaver has no payment-processor connector; use the installation's governed billing access. " +
      "This row is money RECEIVED and nothing else — what this organisation SPENDS is the `saas-spend` " +
      "row on this same roster, which is reachable",
  },
  command: [],
  // Its OWN coverage rather than the shared `UNKNOWN_COVERAGE`, because the redirect has to land where a
  // reader reads: `../live/turn/briefCapabilityContracts.ts`'s `renderCapabilityContracts` prints `what`,
  // `freshness` and `coverage` for an unavailable row and never prints `availability.reason` at all. A
  // redirect written only into the reason would have satisfied a unit test on the table and changed nothing
  // in the brief.
  coverage: {
    detail:
      "no connector can measure this source, and this row is money RECEIVED in any case. What this " +
      "organisation SPENDS is the `saas-spend` row on this same roster, and it is reachable — never " +
      "report the absence of this leg as the absence of cost data",
    kind: "unknown",
  },
  effect: "read",
  freshness: UNKNOWN_FRESHNESS,
  id: "billing",
  owner: "slopweaver",
  sourceClass: "provider",
  terms: ["stripe", "invoice", "invoices", "billing", "payment", "payments", "charge", "charges", "refund"],
  truthMode: "current",
  what: "money RECEIVED — the payment processor and what customers were charged, never what this organisation spends",
};
