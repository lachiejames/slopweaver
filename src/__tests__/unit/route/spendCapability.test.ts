/**
 * The SPEND leg — `saas-spend`, and the `billing` row that used to stand in for it.
 *
 * MEASURED by the loop on a DM tag: `turn brief` offered 44 capabilities and not one held
 * cost, so a saas-spend question could only be ranked by a proxy presented as cost (`google-admin-atlas`
 * seat counts, `vanta-vendor-atlas` risk). The cases below are that finding's two halves rather than a
 * sweep of the table: a leg that HOLDS cost, and an unreachable row that can no longer read as the absence
 * of the subject.
 *
 * Every assertion here is on text a reader actually sees. `../../../live/turn/briefCapabilityContracts.ts`'s
 * `renderCapabilityContracts` prints `what`, `freshness` and `coverage` and never prints
 * `availability.reason`, and `buildRoutingCapabilities` never reads `terms` at all — so a claim written
 * into either of those alone would pass a table test and change nothing in the brief.
 */
import { describe, expect, it } from "vitest";

import { withDerivedAtlasCapabilities } from "../../../route/atlasCapability.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/sourcePlan.js";
import { BILLING_CAPABILITY, SAAS_SPEND_CAPABILITY } from "../../../route/spendCapability.js";

const SPEND = GENERIC_SOURCE_CAPABILITIES.find((capability) => capability.id === "saas-spend")!;
const BILLING = GENERIC_SOURCE_CAPABILITIES.find((capability) => capability.id === "billing")!;
const AUDIT = GENERIC_SOURCE_CAPABILITIES.find((capability) => capability.id === "audit")!;

describe("the `saas-spend` row", () => {
  // The row lives in its own module (`../../../route/spendCapability.ts`) and is spliced into the table by
  // REFERENCE, which is what keeps every case below about the row a reader actually gets: a second copy
  // authored inline would satisfy the `find` above and leave the module itself untested.
  it("is the exact object the table carries, not a second copy that happens to share the id", () => {
    expect(SPEND).toBe(SAAS_SPEND_CAPABILITY);
  });

  it("is a reachable, current-truth leg — the bucket a spend question can actually be answered from", () => {
    expect(SPEND.availability).toEqual({ kind: "available" });
    expect(SPEND.truthMode).toBe("current");
    expect(SPEND.effect).toBe("read");
  });

  it("names spend in the first words of `what`, which is the line a skimming session reads", () => {
    expect(SPEND.what.startsWith("what this organisation SPENDS on SaaS")).toBe(true);
  });

  it("runs a cheap SCOPE command, never a question substituted into a words-must-all-appear filter", () => {
    expect(SPEND.command).toEqual(["slopweaver", "atlas", "trelica", "coverage"]);
    expect(SPEND.coverage.detail).toContain("slopweaver atlas trelica read --kind app");
  });

  it("states what the number IS — a trailing-year total, with no transaction row stored", () => {
    expect(SPEND.coverage.detail).toContain("TRAILING-YEAR total, never a current run rate");
    expect(SPEND.coverage.detail).toContain("spend TRANSACTION row is not stored");
  });

  // The load-bearing sentence, not a caveat. MEASURED on this install's
  // latest generation: all 951 applications carry `lastYearSpend: 0`, because this tenant's Trelica has no finance
  // source connected to fill that column. Without this clause the row swaps one misleading answer for a
  // worse one — a session runs the read, gets 951 zeroes, and reports that the organisation spends nothing,
  // with a citation. Repro: `slopweaver atlas trelica read --kind app --json --limit 1000`.
  it("says a zero is the feed saying nothing, never evidence the organisation spends nothing", () => {
    expect(SPEND.coverage.detail).toContain(
      "A `lastYearSpend` of zero is Trelica's own finance feed saying nothing on that application, and is " +
        "NEVER evidence the organisation spends nothing",
    );
  });

  // The half an added leg cannot do by itself. A leg that comes back empty is exactly when a worker reaches
  // for the proxy, so the row names every non-leg by the reason it is not one.
  it("names what does NOT hold cost, so a proxy cannot be silently substituted for the leg", () => {
    expect(SPEND.coverage.detail).toContain("seat, licence and account counts are counts");
    expect(SPEND.coverage.detail).toContain("contract amount is withheld to a companion file no verb reads");
    expect(SPEND.coverage.detail).toContain("Xero's books are unreachable with no OAuth connection configured");
    expect(SPEND.coverage.detail).toContain("invoice or a renewal notice is `gmail` and `drive`");
  });

  // MEASURED by dogfooding a question in the owner's bot DM. This row used to close with
  // "Nothing else on this roster holds cost, so do not substitute one", and that absolute was FALSE: the
  // `corpus` row holds negotiated contract values in a procurement write-up in Notion, reachable with
  // `slopweaver store read`. The same class as the
  // finding this file exists for — a row saying "there is no leg" while a leg answers — so the two cases
  // below are a pair: the negative is falsifiable only because its sibling asserts the replacement text is
  // there, which is what reddens if somebody deletes the clause instead of correcting it.
  it("hands a cost question off to the legs that do hold cost, naming the verb that reaches each", () => {
    expect(SPEND.coverage.detail).toContain("Two other legs hold cost today. The `corpus` row");
    expect(SPEND.coverage.detail).toContain("`slopweaver store read`");
    expect(SPEND.coverage.detail).toContain("And `slopweaver spend read`");
  });

  // A pasted export gives no decline reason, and the first import proved that the obvious story — "the
  // monthly limit declined it" — was false for the declines it held (charges went through the day after). A
  // live capture carries Airwallex's own reason. So the hand-off carries the limit of what each source can say.
  it("says the card leg is as fresh as its newest snapshot, and only a live one names a decline reason", () => {
    expect(SPEND.coverage.detail).toContain("so only as fresh as that snapshot's day");
    expect(SPEND.coverage.detail).toContain("A live snapshot carries Airwallex's own reason for each decline");
    expect(SPEND.coverage.detail).toContain("never call a decline the monthly limit unless it says so");
  });

  // MEASURED: with AI spend held across dozens of cost-explorer rows, this row still told the bot "this leg ...
  // answers no cost question". The zero is now the APPLICATION rows' alone, so the pair below is falsifiable:
  // the AI leg is named with its verb, and the leg-wide "answers no cost question" sentence is gone.
  it("names AI spend as this atlas's own leg, and scopes the zero to the application rows", () => {
    expect(SPEND.coverage.detail).toContain("`slopweaver atlas trelica read --kind ai-usage`");
    expect(SPEND.coverage.detail).toContain("The dimensions OVERLAP");
    expect(SPEND.coverage.detail).toContain("a `deferred` cell carries no bound, so never quote one");
    expect(SPEND.coverage.detail).toContain("the application rows size the ESTATE and answer no cost question");
    expect(SPEND.coverage.detail).not.toContain("this leg sizes the ESTATE and answers no cost question");
  });

  it("says that leg is per-VENDOR and not a register, so its rows are not summed into an estate total", () => {
    expect(SPEND.coverage.detail).toContain("a handful of vendors, never a register over the estate");
    expect(SPEND.coverage.detail).not.toContain("Nothing else on this roster holds cost");
  });

  // The zero clause survives the correction rather than being replaced by it: "a zero is not evidence of
  // none" is the property, and the tenant fact is what upgrades it from 963 per-application silences to
  // one configuration fact. Witness: the atlas's own browser artifact of acme.trelica.app/Spend,
  // the Trelica page entity on the latest generation.
  it("names the tenant fact behind the zeroes — no finance source connected, on Trelica's own page", () => {
    expect(SPEND.coverage.detail).toContain("no finance source is connected to the tenant at all");
    expect(SPEND.coverage.detail).toContain("`No spend data`");
  });

  // JumpCloud's `subscriptions` kind is 7 entities of `annualPrice`/`listPrice`/`optionalAddOns` — the
  // vendor's own price list. It reads like cost to a one-word skim and is the nearest remaining proxy now
  // that seat counts are named, so the row names it by the reason it is not one.
  it("names a vendor's published price list as what that vendor CHARGES, not what the org pays", () => {
    expect(SPEND.coverage.detail).toContain("is what that vendor CHARGES, not what this organisation pays");
  });

  it("carries the spend vocabulary `route plan`'s keyword match needs, alongside the vendor name", () => {
    expect(SPEND.terms).toContain("spend");
    expect(SPEND.terms).toContain("cost");
    expect(SPEND.terms).toContain("subscription");
    expect(SPEND.terms).toContain("renewal");
    expect(SPEND.terms).toContain("trelica");
  });
});

describe("the `saas-spend` row REPLACES the derived trelica row rather than sitting beside it", () => {
  const derived = withDerivedAtlasCapabilities({
    atlases: [
      { platform: "trelica", summary: "The Trelica atlas" },
      { platform: "aether", summary: "The Aether atlas" },
    ],
    baseCapabilities: GENERIC_SOURCE_CAPABILITIES,
  });
  const ids = derived.map((capability) => capability.id);

  it("suppresses `trelica-atlas`, because the suppression key is the PLATFORM and not the id", () => {
    expect(ids).toContain("saas-spend");
    expect(ids).not.toContain("trelica-atlas");
  });

  it("suppresses nothing else — a platform no base row reads still gets its derived row", () => {
    expect(ids).toContain("aether-atlas");
  });

  it("leaves the roster's row count unchanged: one authored row lands as one derived row goes", () => {
    expect(derived.length).toBe(GENERIC_SOURCE_CAPABILITIES.length + 1);
  });
});

describe("the `billing` row can no longer read as the absence of cost data", () => {
  // `billing` moved into `../../../route/spendCapability.ts` beside `saas-spend` when the attachments row
  // pushed `genericCapabilities.ts` past its `file-size-ratchet` floor, and the two belong together: the
  // redirect below is only correct while its target is reachable. Spliced in by REFERENCE, so this case is
  // what keeps the rest about the row a reader actually gets rather than an inline copy sharing its id.
  it("is the exact object the table carries, not a second copy that happens to share the id", () => {
    expect(BILLING).toBe(BILLING_CAPABILITY);
  });

  it("stays unreachable and carries no command, which is what it always was", () => {
    expect(BILLING.availability.kind).toBe("unavailable");
    expect(BILLING.command).toEqual([]);
  });

  it("says money RECEIVED in `what` — the line that used to read as every billing record there is", () => {
    expect(BILLING.what.startsWith("money RECEIVED")).toBe(true);
    expect(BILLING.what).toContain("never what this organisation spends");
  });

  // The redirect lives in `coverage` rather than in `availability.reason` on purpose: the brief renderer
  // prints the first and never the second, so a redirect written only into the reason would have satisfied
  // a table test and left the observed failure exactly where it was.
  it("redirects money SPENT to `saas-spend` in the coverage line a reader actually sees", () => {
    expect(BILLING.coverage.detail).toContain("`saas-spend` row on this same roster, and it is reachable");
    expect(BILLING.coverage.detail).toContain("never report the absence of this leg as the absence of cost data");
  });
});

// One class of word, one row. A reader skimming the roster for cost must land somewhere unambiguous, which
// is the whole failure: `audit` reported "source counts, newest record and cost" — the world model's own
// INGEST cost — so a worker asked what the org spends could run `slopweaver audit run` and report a corpus
// figure. Smaller than the seat-count substitution, reachable from the same one-word skim.
describe("the three money-shaped rows each say which money they mean", () => {
  it("scopes `audit`'s cost to INGEST, and says it is not what the organisation spends", () => {
    expect(AUDIT.what).toContain("INGEST cost");
    expect(AUDIT.what).toContain("never what this organisation spends");
  });

  it("leaves exactly one row on the generic table claiming what the organisation SPENDS", () => {
    const claimsSpend = GENERIC_SOURCE_CAPABILITIES.filter((capability) =>
      /\bSPENDS\b/.test(capability.what.replace("never what this organisation spends", "")),
    );
    expect(claimsSpend.map((capability) => capability.id)).toEqual(["saas-spend"]);
  });
});
