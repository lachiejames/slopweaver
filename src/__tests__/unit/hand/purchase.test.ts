/*
 * The purchase-ask posting rule: a step asking the owner to buy capacity is refused, for every writer.
 * The refused sentences are the register's own, verbatim; the passing ones are the near misses measured beside them.
 */
import { describe, expect, it } from "vitest";

import { HandStepErrors } from "../../../hand/errors.js";
import { postingRefusal } from "../../../hand/posting.js";
import { purchaseAsk, purchasePhrase } from "../../../hand/purchase.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** Addressed by a stated reason, so a case sees only the field it changes. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "codex-capped-28-sep",
        postedBy: "workspace:a-store-backup-restore-rehearsal-28-sep",
        postedIso: "2026-09-28T11:06:26.000Z",
        unaddressed: "a note naming the reset",
        unblocks: "Codex planning and review",
        what: "Codex is capped on every account until 3 Oct",
        witness: 'slopweaver hand done codex-capped-28-sep --did "seen"',
        ...over,
      },
    }),
  );
}

describe("purchasePhrase", () => {
  it.each([
    ["Buy or raise a Codex plan: every account is capped until 3 Oct ~17:10Z", "Buy or raise a Codex plan"],
    ["Buy one more Codex plan: all five accounts hit their weekly cap", "Buy one more Codex plan"],
    ["Buy a Codex plan: all five accounts are spent this week", "Buy a Codex plan"],
    ["Codex is capped until 3 Oct; buy more usage to bring planning and review back", "buy more usage"],
    ["or wait for its Sep 30 reset, then buy the codex-5 plan", "buy the codex-5 plan"],
    ["Add OpenAI credits: every Talk session is refused with 429", "Add OpenAI credits"],
    ["Top up the ChatGPT subscription", "Top up the ChatGPT subscription"],
    ["top-up credits on the account", "top-up credits"],
    ["Upgrade the plan to Pro", "Upgrade the plan"],
    ["Renew the subscription before Friday", "Renew the subscription"],
    ["Renew their Codex subscription before Friday", "Renew their Codex subscription"],
    ["Top up my ChatGPT plan", "Top up my ChatGPT plan"],
    ["Pay for another plan", "Pay for another plan"],
    ["Codex won't reset until 3 Oct so buy another plan", "buy another plan"],
    ["Codex can't plan or review until 3 Oct unless you buy another plan", "buy another plan"],
    ["No Codex until 3 Oct unless you buy one more plan", "buy one more plan"],
    ["Codex can't review so buy another plan", "buy another plan"],
    ["Why not buy another Codex plan?", "buy another Codex plan"],
    ["Don't wait and buy another plan", "buy another plan"],
    ["Buy a sixth ChatGPT Pro Codex plan", "Buy a sixth ChatGPT Pro Codex plan"],
    ["Upgrade plan-two to Max 20x", "Upgrade plan-two to Max"],
    ["Upgrade plan two to Pro", "Upgrade plan two to Pro"],
    ["Upgrade codex-5 to Pro", "Upgrade codex-5 to Pro"],
    ["Raise codex-5 to Pro", "Raise codex-5 to Pro"],
    ["Upgrade codex-5's plan to Pro", "Upgrade codex-5's plan"],
    ["Upgrade to Max 20x on plan-two", "Upgrade to Max"],
    ["Upgrade codex-3 to ChatGPT Pro", "Upgrade codex-3 to ChatGPT Pro"],
    ["Upgrade plan-two to Claude Max 20x", "Upgrade plan-two to Claude Max"],
    ["Upgrade to a Pro plan", "Upgrade to a Pro"],
    ["Upgrade to the Max plan", "Upgrade to the Max"],
    ["Upgrade codex-5 to a Pro plan", "Upgrade codex-5 to a Pro"],
    ["Upgrade plan-two to Team", "Upgrade plan-two to Team"],
    ["Buy ChatGPT Pro on a sixth Codex account: all five are capped", "Buy ChatGPT Pro"],
    ["Pay for ChatGPT Pro on codex-6", "Pay for ChatGPT Pro"],
    ["Buy another Claude Max", "Buy another Claude Max"],
    ["Subscribe to ChatGPT Pro on codex-6", "Subscribe to ChatGPT Pro"],
    ["Renew plan-two's subscription: it lapsed", "Renew plan-two's subscription"],
    ["Raise codex-5's plan", "Raise codex-5's plan"],
    ["Buy 1,000 Codex credits", "Buy 1,000 Codex credits"],
    ["Upgrade plan-two to Max", "Upgrade plan-two to Max"],
    ["Upgrade plan-two to Max: it is capped until 3 Oct", "Upgrade plan-two to Max"],
    ["Upgrade to Max on plan-two", "Upgrade to Max"],
    ["Raise plan-two to Max", "Raise plan-two to Max"],
    ["Renew ChatGPT Pro on codex-5: the card was declined", "Renew ChatGPT Pro"],
    ["Renew Claude Max on plan-two", "Renew Claude Max"],
    ["Upgrade plan-two to Max or wait for the reset", "Upgrade plan-two to Max"],
    ["Upgrade plan-two to Max — it is capped", "Upgrade plan-two to Max"],
    ["Upgrade plan-two to Max (20x)", "Upgrade plan-two to Max"],
    ["Upgrading plan-two to Max would lift the cap", "Upgrading plan-two to Max"],
    ["Not now, but buy another plan tomorrow", "buy another plan"],
  ])("reads %j as a purchase ask", (text, phrase) => {
    expect(purchasePhrase({ texts: [text] })).toBe(phrase);
  });

  // A cap note carries only accounts and resets, so a purchase it mentions is surplus however it is phrased.
  it.each([
    ["Keep plan-four paused: the owner is not buying another plan", "buying another plan"],
    ["Confirm the fleet should not buy another plan", "buy another plan"],
    ["Route to Claude instead of buying another plan", "buying another plan"],
    ["The owner ruled against buying more plans", "buying more plans"],
    ["Codex capped until 3 Oct; not asking you to buy another plan", "buy another plan"],
    ["Nobody asks the owner to buy another plan", "buy another plan"],
  ])("refuses %j, a negated purchase", (text, phrase) => {
    expect(purchasePhrase({ texts: [text] })).toBe(phrase);
  });

  it.each([
    ["keep the limit, raise it, or warn and restart"],
    ["until the org grant is renewed"],
    ["it runs on your ChatGPT plan now, and the badge says if the key pays"],
    ["Add the team 1Password account to the op CLI"],
    ["added credits, and the voice answered"],
    ["raise a PR for it"],
    ["raise a seat for the resync"],
    ["top up the seats to fill idle capacity"],
    ["what each Codex plan buys per window"],
    ["you bought plan five; sign it in"],
    ["buy time, then plan the rest"],
    ["Renew plan-two's Claude sign-in"],
    ["Upgrade Claude Code on plan-three"],
    ["Renew the Claude sign-in: plan two's token expired"],
    ["Upgrade the Codex CLI. The plan then signs in"],
    ["Top-up went through: sign the plan in"],
    ["Renew the Codex plan's sign-in"],
    ["Renew plan two's sign-in"],
    ["Raise a PR for the plan"],
    ["Raise the usage alert threshold"],
    ["Renew the Max plan login"],
    ["Renew the subscription sign-in on codex-5"],
    ["Renew the plan OAuth token"],
    ["Upgrade the Claude Max plan app"],
    ["Upgrade plan-two's Codex CLI to 0.9"],
    ["Upgrade Node to 24 on plan-two"],
    ["Raise the limit, then move to Pro later"],
    ["Raise the effort to max"],
    ["Raise the threshold to max"],
    ["Raise this to team leads"],
    ["Raise the effort to max."],
    ["Raise the seat's effort to max for the rebase"],
    ["Renew the Claude Max sign-in on plan-two"],
    ["Upgrade Claude Code on plan-two to the latest"],
    ["Upgrade Codex to the Pro model"],
    ["renew Claude Max's token"],
    ["Renew the sign-in on the ChatGPT Pro account"],
    ["Upgrade Claude Code on the Claude Max account"],
    ["Raise it to the team"],
    ["Raise the Claude Max cap alert"],
  ])("passes %j", (text) => {
    expect(purchasePhrase({ texts: [text] })).toBe(undefined);
  });

  it("skips an absent field and reads the next", () => {
    expect(purchasePhrase({ texts: [undefined, "buy more usage"] })).toBe("buy more usage");
  });
});

describe("purchaseAsk", () => {
  it("refuses the incident's own sentence, quoting the phrase", () => {
    const refused = purchaseAsk({
      step: step({ what: "Buy or raise a Codex plan: every account is capped until 3 Oct ~17:10Z" }),
    });
    expect(refused).toEqual(HandStepErrors.purchaseAsk({ phrase: "Buy or raise a Codex plan" }));
  });

  it("reads the literal and the where too", () => {
    const inLiteral = step({ literal: "buy more usage", unaddressed: undefined, where: "chatgpt.com" });
    expect(purchaseAsk({ step: inLiteral })!.code).toBe("PURCHASE_ASK");
    expect(purchaseAsk({ step: step({ where: "the billing page, to top up credits" }) })!.code).toBe("PURCHASE_ASK");
  });

  it("leaves unblocks alone, where the monitor lane carries a paused plan's own reason", () => {
    const signIn = step({ unblocks: "plan-four, paused: capped until 3 Oct, not buying another plan" });
    expect(purchaseAsk({ step: signIn })).toBe(undefined);
  });

  it("passes a cap note naming only the accounts and the reset", () => {
    expect(purchaseAsk({ step: step() })).toBe(undefined);
  });

  it("names the ruling and says there is no override", () => {
    const message = HandStepErrors.purchaseAsk({ phrase: "buy more usage" }).message;
    expect(message).toContain("the owner's ruling is that enough plans are bought and nobody asks for more money");
    expect(message).toContain("There is no override");
    expect(message).toContain("names only the capped accounts and when each resets");
  });
});

describe("postingRefusal", () => {
  it("tells a purchase ask the real reason before any fixable one", () => {
    const unaddressedPurchase = step({ unaddressed: undefined, what: "Buy one more Codex plan" });
    expect(postingRefusal({ step: unaddressedPurchase })!.code).toBe("PURCHASE_ASK");
  });
});
