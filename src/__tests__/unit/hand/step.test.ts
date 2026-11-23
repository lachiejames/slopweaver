/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { uncitedNumbers } from "../../../hand/cites.js";
import { decisionWithoutAsk } from "../../../hand/decision.js";
import { HandStepErrors } from "../../../hand/errors.js";
import { unplainStep } from "../../../hand/posting.js";
import { parseHandLine } from "../../../hand/row.js";
import {
  buildHandStep,
  fleetActorPhrase,
  fleetWordInWhat,
  type HandStepDraft,
  linkAsLiteral,
  proofWitnessStep,
  WHAT_CAP,
  waitingHandSteps,
} from "../../../hand/step.js";
import { LITERAL_CAP, UNADDRESSED_CAP } from "../../../hand/stepAddress.js";
import { reactionWithoutQueueLink } from "../../../hand/stepReaction.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TALK_GLOSSARY } from "../../../talk/glossary.js";

/** A complete draft, so each case changes exactly the field it is about. */
function draft(over: Partial<HandStepDraft> = {}): HandStepDraft {
  return {
    id: "gcloud-signin",
    postedBy: "workspace:129",
    postedIso: "2026-09-19T04:35:44.113Z",
    unblocks: "handover run datadog-monitor-deploy, stopped at the deploy step",
    what: "Sign in to Google Cloud so the monitor deploy can finish",
    witness: 'slopweaver hand done gcloud-signin --did "signed in"',
    ...over,
  };
}

describe("buildHandStep", () => {
  it("builds a step with only the required fields, and carries no optional key at all", () => {
    const step = unwrap(buildHandStep({ draft: draft() }));
    expect(step.id).toBe("gcloud-signin");
    expect(step.what).toBe("Sign in to Google Cloud so the monitor deploy can finish");
    expect(Object.keys(step).toSorted()).toEqual(["id", "postedBy", "postedIso", "unblocks", "what", "witness"]);
  });

  it("keeps the three optionals when they are supplied, trimmed", () => {
    const step = unwrap(
      buildHandStep({
        draft: draft({
          literal: "  gcloud auth application-default login  ",
          url: "https://console.cloud.google.com/",
          where: " any terminal ",
        }),
      }),
    );
    expect(step.literal).toBe("gcloud auth application-default login");
    expect(step.url).toBe("https://console.cloud.google.com/");
    expect(step.where).toBe("any terminal");
  });

  it("DROPS an optional supplied as whitespace rather than writing an empty string", () => {
    const step = unwrap(buildHandStep({ draft: draft({ literal: "   ", where: "" }) }));
    expect(Object.keys(step).includes("literal")).toBe(false);
    expect(Object.keys(step).includes("where")).toBe(false);
  });

  it("keeps a stated context, so the console never has to guess where the step belongs", () => {
    expect(unwrap(buildHandStep({ draft: draft({ context: "work" }) })).context).toBe("work");
    expect(unwrap(buildHandStep({ draft: draft({ context: "slopweaver" }) })).context).toBe("slopweaver");
  });

  it("carries no `context` key at all when none was stated, so a round trip stays byte-stable", () => {
    expect(Object.keys(unwrap(buildHandStep({ draft: draft() }))).includes("context")).toBe(false);
  });

  it("refuses a third context value rather than dropping it — a row it could not place would look placed", () => {
    const error = unwrapErr(buildHandStep({ draft: draft({ context: "acme" }) }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("context is `slopweaver` or `work` and nothing else");
  });

  it("refuses the empty string and a non-string, rather than reading either as `did not say`", () => {
    expect(unwrapErr(buildHandStep({ draft: draft({ context: "" }) })).code).toBe("INVALID_FIELD");
    expect(unwrapErr(buildHandStep({ draft: draft({ context: null }) })).code).toBe("INVALID_FIELD");
    expect(unwrapErr(buildHandStep({ draft: draft({ context: 1 }) })).code).toBe("INVALID_FIELD");
  });

  it("refuses an empty required field by name", () => {
    const error = unwrapErr(buildHandStep({ draft: draft({ unblocks: "  " }) }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toBe("unblocks is required and was empty");
  });

  it("refuses a `what` one character past its cap, rather than truncating it", () => {
    const error = unwrapErr(buildHandStep({ draft: draft({ what: "x".repeat(WHAT_CAP + 1) }) }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("is 121 characters and the cap is 120");
    expect(error.message).toContain("refused rather than truncated");
  });

  it("accepts a `what` exactly at its cap", () => {
    const step = unwrap(buildHandStep({ draft: draft({ what: "x".repeat(WHAT_CAP) }) }));
    expect(step.what.length).toBe(WHAT_CAP);
  });

  it("accepts a literal exactly at its own, much larger cap", () => {
    const step = unwrap(buildHandStep({ draft: draft({ literal: "k".repeat(LITERAL_CAP) }) }));
    expect(step.literal!.length).toBe(LITERAL_CAP);
  });

  it("refuses a second sentence, naming where the rest belongs", () => {
    const error = unwrapErr(
      buildHandStep({ draft: draft({ what: "Sign in to Google Cloud. Then re-run the deploy" }) }),
    );
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("is more than one sentence");
  });

  it("allows a full stop with nothing after it", () => {
    const step = unwrap(buildHandStep({ draft: draft({ what: "Sign in to Google Cloud." }) }));
    expect(step.what).toBe("Sign in to Google Cloud.");
  });

  it("refuses an id that is not a slug", () => {
    const error = unwrapErr(buildHandStep({ draft: draft({ id: "Gcloud SignIn" }) }));
    expect(error).toEqual(HandStepErrors.invalidId({ id: "Gcloud SignIn" }));
  });

  it("refuses a url that is not an absolute http address", () => {
    const error = unwrapErr(buildHandStep({ draft: draft({ url: "the cloud console" }) }));
    expect(error).toEqual(
      HandStepErrors.invalidField({
        field: "url",
        why: "must be one absolute http(s) or file:/// address — the note opens it, so a fragment or a description is a button that goes nowhere",
      }),
    );
  });
});

describe("fleetActorPhrase — both polarities of the one refusal", () => {
  it("names the phrase when the sentence makes the fleet the actor", () => {
    expect(fleetActorPhrase({ what: "The session rotates the Datadog key" })).toBe("The session");
    expect(fleetActorPhrase({ what: "A bot picks the code owners" })).toBe("A bot");
    expect(fleetActorPhrase({ what: "Slopweaver will restack the branch" })).toBe("Slopweaver will");
  });

  it("passes a step that is genuinely the owner's, including the flagship sign-in", () => {
    expect(fleetActorPhrase({ what: "Sign in to Google Cloud" })).toBe(undefined);
    expect(fleetActorPhrase({ what: "Pick the code owners on #885" })).toBe(undefined);
    expect(fleetActorPhrase({ what: "Approve the Vanta access request" })).toBe(undefined);
  });

  it("passes a sentence that names a session but hands the owner the hand action", () => {
    expect(fleetActorPhrase({ what: "Click Approve on the session's Vanta request" })).toBe(undefined);
  });

  it("refuses through buildHandStep, carrying the phrase for a rewrite", () => {
    const error = unwrapErr(buildHandStep({ draft: draft({ what: "The session rotates the key" }) }));
    expect(error.code).toBe("FLEET_CAN_DO_IT");
    expect(error.message).toContain('names the fleet as the actor with "The session"');
  });
});

describe("a published page is a url, never a command to paste", () => {
  const PAGE = "file:///Users/someone/.slopweaver/pages/vanta-entry-group/index.html";

  it("accepts an absolute file:/// address as the step's url, so the note's Open button can take it", () => {
    const step = unwrap(buildHandStep({ draft: draft({ url: PAGE }) }));
    expect(step.url).toBe(PAGE);
  });

  it("accepts an absolute address whose scheme is upper case, since a scheme is case-insensitive", () => {
    const step = unwrap(buildHandStep({ draft: draft({ url: "HTTPS://console.example.org/queue" }) }));
    expect(step.url).toBe("HTTPS://console.example.org/queue");
  });

  it("still refuses a relative file address — `open` would resolve it against nobody knows where", () => {
    const error = unwrapErr(buildHandStep({ draft: draft({ url: "file://pages/index.html" }) }));
    expect(error.code).toBe("INVALID_FIELD");
  });

  it("refuses at posting the literal the owner was actually handed: `open <page>`", () => {
    const step = unwrap(buildHandStep({ draft: draft({ literal: `open ${PAGE}` }) }));
    expect(linkAsLiteral({ step })).toEqual(
      HandStepErrors.invalidField({
        field: "literal",
        why: "is a link, or a command that only opens one — pass the address as --url instead, so the note's own Open button opens it and the owner never pastes a command to read a page",
      }),
    );
  });

  it("refuses a bare https link and a quoted one, the other two spellings of the same thing", () => {
    const bare = unwrap(buildHandStep({ draft: draft({ literal: "https://console.cloud.google.com/auth" }) }));
    const quoted = unwrap(buildHandStep({ draft: draft({ literal: `open '${PAGE}'` }) }));
    expect(linkAsLiteral({ step: bare })!.code).toBe("INVALID_FIELD");
    expect(linkAsLiteral({ step: quoted })!.code).toBe("INVALID_FIELD");
  });

  it("refuses an `open` with flags, an application, a spaced path or xdg-open — the same paste in other spellings", () => {
    const spellings = [
      `open -a "Google Chrome" ${PAGE}`,
      `open -na Safari ${PAGE}`,
      `open "file:///Users/ada/My Pages/index.html"`,
      "xdg-open https://console.cloud.google.com/auth",
    ];
    const codes = spellings.map(
      (literal) => linkAsLiteral({ step: unwrap(buildHandStep({ draft: draft({ literal }) })) })!.code,
    );
    expect(codes).toEqual(["INVALID_FIELD", "INVALID_FIELD", "INVALID_FIELD", "INVALID_FIELD"]);
  });

  it("passes an `open` that names no link — launching an application is a paste only the owner can do", () => {
    const app = unwrap(buildHandStep({ draft: draft({ literal: "open -a Slack" }) }));
    expect(linkAsLiteral({ step: app })).toBeUndefined();
  });

  it("passes a literal the owner genuinely pastes, including a command that merely CONTAINS a link", () => {
    const signin = unwrap(buildHandStep({ draft: draft({ literal: "gcloud auth application-default login" }) }));
    const curl = unwrap(buildHandStep({ draft: draft({ literal: "curl -sSf https://example.com/install | sh" }) }));
    expect(linkAsLiteral({ step: signin })).toBeUndefined();
    expect(linkAsLiteral({ step: curl })).toBeUndefined();
    expect(linkAsLiteral({ step: unwrap(buildHandStep({ draft: draft() })) })).toBeUndefined();
  });

  it("keeps a register row that already carries such a literal READABLE — the refusal is posting-only", () => {
    const step = unwrap(buildHandStep({ draft: draft({ literal: `open ${PAGE}` }) }));
    expect(step.literal).toBe(`open ${PAGE}`);
  });
});

describe("proofWitnessStep", () => {
  it("refuses at posting a step whose unblocks names a gold proof — the one that reached the owner", () => {
    const step = unwrap(
      buildHandStep({ draft: draft({ unblocks: "gold proof on #1213, the voice's verb and browser tools" }) }),
    );
    expect(proofWitnessStep({ step })).toEqual(HandStepErrors.proofWitnessIsOurs({ phrase: "gold" }));
  });

  it("refuses a PR's proof named without a grade, and a silver or bronze one, in any case", () => {
    const unblocks = [
      "PR 6 (#1230), whose proof shows only the empty record",
      "the Silver landing's owed witness",
      "#1199's BRONZE grade",
    ];
    const refusals = unblocks.map((text) =>
      proofWitnessStep({ step: unwrap(buildHandStep({ draft: draft({ unblocks: text }) })) }),
    );
    expect(refusals).toEqual(
      ["proof", "Silver", "BRONZE"].map((phrase) => HandStepErrors.proofWitnessIsOurs({ phrase })),
    );
  });

  it("passes a step whose unblocks names what it gives the owner, and a word that only contains a grade", () => {
    const own = unwrap(buildHandStep({ draft: draft() }));
    const inside = unwrap(
      buildHandStep({ draft: draft({ unblocks: "the goldfish tank monitor and a proofreader pass" }) }),
    );
    expect(proofWitnessStep({ step: own })).toBeUndefined();
    expect(proofWitnessStep({ step: inside })).toBeUndefined();
  });

  it("keeps a register row that already names a proof READABLE — the refusal is posting-only", () => {
    const step = unwrap(
      buildHandStep({ draft: draft({ unblocks: "#1224's gold (revisited pages drawing at once)" }) }),
    );
    expect(step.unblocks).toBe("#1224's gold (revisited pages drawing at once)");
  });
});

describe("a note says what to do in words the owner already has", () => {
  const REJECTED = "Give the console voice a steer on a call that opened with a context pack";
  const QUEUE = "http://localhost:3000/queue?open=ask%3Avoice-pack-steer";

  it("refuses the exact note the owner could not act on, naming the fleet word and what it means", () => {
    const step = unwrap(buildHandStep({ draft: draft({ url: QUEUE, what: REJECTED }) }));
    const means = TALK_GLOSSARY.find((entry) => entry.term === "context pack")!.means;
    expect(fleetWordInWhat({ step })).toEqual(HandStepErrors.fleetWord({ means, word: "context pack" }));
  });

  it("passes the same step said plainly", () => {
    const step = unwrap(
      buildHandStep({
        draft: draft({ url: QUEUE, what: "Open Talk on the console, ask it about today, and say if it knew" }),
      }),
    );
    expect(fleetWordInWhat({ step })).toBe(undefined);
  });

  it("leaves a word the owner uses themselves alone, and an ordinary word the glossary also defines", () => {
    const step = unwrap(
      buildHandStep({ draft: draft({ what: "Grant cmux access in System Settings, then check the board" }) }),
    );
    expect(fleetWordInWhat({ step })).toBe(undefined);
  });
});

describe("a note asking the owner to react links straight to the queue item", () => {
  const REACT = "Pick one of the three reviewers for the codeowners change";

  it("refuses a reaction on the queue with no url, naming this step's own queue key", () => {
    const step = unwrap(
      buildHandStep({ draft: draft({ what: "Pick one of the three reviewers waiting on the queue" }) }),
    );
    const error = reactionWithoutQueueLink({ step })!;
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("is missing and the step asks the owner to react");
    expect(error.message).toContain("hand%3Agcloud-signin");
  });

  it("refuses a reaction linking to the queue page without opening an item", () => {
    const step = unwrap(
      buildHandStep({ draft: draft({ url: "http://localhost:3000/queue?context=work", what: REACT }) }),
    );
    expect(reactionWithoutQueueLink({ step })!.message).toContain("opens the queue but no item on it");
  });

  it("leaves a paste step alone — its terminal is where the owner acts", () => {
    const what = "Run the pasted gcloud command and pick the work account in the browser it opens";
    const step = unwrap(buildHandStep({ draft: draft({ literal: "gcloud auth application-default login", what }) }));
    expect(reactionWithoutQueueLink({ step })).toBe(undefined);
  });

  it("leaves a step that acts on the queue list itself — the r2 review's counterexample", () => {
    const step = unwrap(
      buildHandStep({
        draft: draft({
          url: "http://localhost:3000/queue",
          what: "Hover a link on a queue card: it is a chip now, and its card says where it goes before you open it",
        }),
      }),
    );
    expect(reactionWithoutQueueLink({ step })).toBe(undefined);
  });

  it("does not read an ordinary sentence as a queue reaction — every counterexample the r2-r5 reviews found", () => {
    const sentences = [
      "Pick up your YubiKey and touch it when the terminal asks",
      "Pick your YubiKey up and touch it when the terminal asks",
      "Say a steer to the console voice and check it relays",
      "Start a voice call and say a quick steer out loud, then check it lands in your chat",
      "Reload the console and check the React error overlay no longer shows",
      "Pick your work account in the Google sign-in window that just opened",
      "Log into Google Cloud and pick the work account so the monitor deploy can finish",
      "Sign into Google Cloud and pick the work account so the monitor deploy can finish",
      "Finish signing in to Google Cloud and pick the work account",
      "Complete the GitHub single sign-on prompt and pick the acme org",
      "Approve the Duo push on your phone and pick the matching number",
      "Open Microsoft Authenticator on your phone and pick the number the terminal shows",
      "Unlock 1Password on your laptop and pick the Acme vault when it asks",
      "Start a voice call with music playing and check the voice does not react to it",
      "Open Duo on your phone and pick the option to approve with a push",
      "In the macOS privacy prompt that just opened, pick the option that allows cmux full disk access",
      "Pick the company card in the Apple Pay sheet on your phone to renew the Claude plan",
      "Start a voice call and check the voice does not react to the queue cards you open mid-call",
      "Pick a reviewer for the new repo in the GitHub dialog left open in your work Chrome",
    ];
    const refused = sentences.filter(
      (what) => reactionWithoutQueueLink({ step: unwrap(buildHandStep({ draft: draft({ what }) })) }) !== undefined,
    );
    expect(refused).toEqual([]);
  });

  it("leaves a reaction step that links to the page the owner acts on — the review's counterexamples", () => {
    const talk = unwrap(
      buildHandStep({
        draft: draft({
          url: "http://localhost:3000/talk",
          what: "Say one test line into the console Talk tab and ask the voice to pass it on as a steer",
        }),
      }),
    );
    const owners = unwrap(
      buildHandStep({
        draft: draft({
          url: "https://github.com/lachiejames/slopweaver/settings",
          what: "Pick the code owners on the GitHub settings page",
        }),
      }),
    );
    expect(reactionWithoutQueueLink({ step: talk })).toBe(undefined);
    expect(reactionWithoutQueueLink({ step: owners })).toBe(undefined);
  });

  it("does not read a sign-in's account choice as a reaction", () => {
    const step = unwrap(
      buildHandStep({ draft: draft({ what: "Sign in to Google Cloud and choose your work account" }) }),
    );
    expect(reactionWithoutQueueLink({ step })).toBe(undefined);
  });

  it("passes a reaction step that opens its queue item, context and all", () => {
    const url = "http://localhost:3000/queue?open=pr%3A1273&context=slopweaver";
    const step = unwrap(buildHandStep({ draft: draft({ url, what: REACT }) }));
    expect(reactionWithoutQueueLink({ step })).toBe(undefined);
  });

  it("leaves a sign-in step, which reacts to nothing, free to link its own address", () => {
    const step = unwrap(buildHandStep({ draft: draft({ url: "https://console.cloud.google.com/" }) }));
    expect(reactionWithoutQueueLink({ step })).toBe(undefined);
  });
});

describe("a decision opens the record that holds its choice", () => {
  const POST = "Post the 16676 PR description announcement to #dev-team now, or hold it until 16672 lands";
  const DECIDE = "Decide 16406, the booking seed draft: take it forward with 16400, rebase it alone, or close it";
  const ASK = "http://localhost:3000/queue?open=ask%3Aacme-post-16676-description-form&context=work";

  it("refuses a decision that links nowhere, naming the phrase and the shaped-ask verb", () => {
    const error = decisionWithoutAsk({ step: unwrap(buildHandStep({ draft: draft({ what: DECIDE }) })) })!;
    expect(error.code).toBe("DECISION_WITHOUT_ASK");
    expect(error.message).toContain('("Decide")');
    expect(error.message).toContain("handover ask --problem --options --lean --risk --blast-radius --still-real");
    expect(error.message).toContain("--open ask:<slug>");
    expect(error.message).toContain('say it without one ("Press Continue before the window closes")');
  });

  it("refuses a decision that opens itself — the card the owner could not read", () => {
    const url = "http://localhost:3000/queue?open=hand%3Agcloud-signin";
    const error = decisionWithoutAsk({ step: unwrap(buildHandStep({ draft: draft({ url, what: POST }) })) })!;
    expect(error.code).toBe("DECISION_WITHOUT_ASK");
    expect(error.message).toContain('(", or")');
  });

  it("refuses a decision on the queue list that opens no item", () => {
    const url = "http://localhost:3000/queue?context=work";
    const error = decisionWithoutAsk({ step: unwrap(buildHandStep({ draft: draft({ url, what: POST }) })) })!;
    expect(error.code).toBe("DECISION_WITHOUT_ASK");
  });

  it("passes a decision opening its ask, a pull request, a held draft, or the page the choice is made on", () => {
    const urls = [
      ASK,
      "http://localhost:3000/queue?open=pr%3A1273",
      "http://localhost:3000/queue?open=post%3Asd-e8ecf199",
      "https://github.com/lachiejames/slopweaver/settings",
    ];
    const refused = urls.filter(
      (url) =>
        decisionWithoutAsk({ step: unwrap(buildHandStep({ draft: draft({ url, what: DECIDE }) })) }) !== undefined,
    );
    expect(refused).toEqual([]);
  });

  it("reads whether-or and either-or as a decision, and leaves a step with no alternative alone", () => {
    const whether = "Say whether to drop the unused atlas or provision a token for it";
    const either = "Tell me either the work card or the personal one for the renewal";
    const plain = "Pick one of the three reviewers for the codeowners change";
    const refused = [whether, either, plain].filter(
      (what) => decisionWithoutAsk({ step: unwrap(buildHandStep({ draft: draft({ what }) })) }) !== undefined,
    );
    expect(refused).toEqual([whether, either]);
  });

  it("leaves a sign-in and a paste alone, even when they offer an alternative", () => {
    const signIn = unwrap(
      buildHandStep({ draft: draft({ what: "Sign in to Google Cloud with the work account, or the admin one" }) }),
    );
    const paste = unwrap(
      buildHandStep({
        draft: draft({ literal: "gcloud auth login", what: "Run the pasted line, or skip it if you are signed in" }),
      }),
    );
    expect(decisionWithoutAsk({ step: signIn })).toBe(undefined);
    const authenticate = unwrap(
      buildHandStep({ draft: draft({ what: "Authenticate to Google Cloud with the work account, or the admin one" }) }),
    );
    expect(decisionWithoutAsk({ step: authenticate })).toBe(undefined);
    expect(decisionWithoutAsk({ step: paste })).toBe(undefined);
  });

  it("reads a comma-or naming a consequence as no alternative — the r3 counterexample", () => {
    const whats = [
      "Press Continue, or the window will close",
      "Approve it on your phone, or else the login expires",
      "Tap the button, or it'll time out",
      "Press Continue, or the window might close",
      "Approve the push, or your session ends",
      "Press Continue, or authentication will expire",
    ];
    expect(
      whats.map((what) => decisionWithoutAsk({ step: unwrap(buildHandStep({ draft: draft({ what }) })) })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    const held = unwrap(buildHandStep({ draft: draft({ what: "Post it now, or hold it until 16672 lands" }) }));
    expect(decisionWithoutAsk({ step: held })!.code).toBe("DECISION_WITHOUT_ASK");
  });

  it("refuses a step saying decide even when it names auth — the r2 counterexample", () => {
    const step = unwrap(buildHandStep({ draft: draft({ what: "Decide whether auth should use email or phone" }) }));
    expect(decisionWithoutAsk({ step })!.code).toBe("DECISION_WITHOUT_ASK");
  });

  it("is one of the plain-words rules hand post applies", () => {
    expect(unplainStep({ step: unwrap(buildHandStep({ draft: draft({ what: DECIDE }) })) })!.code).toBe(
      "DECISION_WITHOUT_ASK",
    );
  });
});

const PR_16672 = "https://github.com/acme/acme-admin/pull/16672";
const PR_16676 = "https://github.com/acme/acme-admin/pull/16676";

describe("cites", () => {
  it("keeps the addresses a step cites, trimmed and deduplicated, first seen first", () => {
    const issue = "https://linear.app/acme/issue/EEEE-840/some-title";
    const step = unwrap(buildHandStep({ draft: draft({ cites: [` ${PR_16676} `, issue, PR_16676] }) }));
    expect(step.cites).toEqual([PR_16676, issue]);
  });

  it("DROPS an empty list, so a step citing nothing reads back as one written before the field", () => {
    const step = unwrap(buildHandStep({ draft: draft({ cites: [] }) }));
    expect(Object.keys(step).includes("cites")).toBe(false);
  });

  it("keeps any https address, a localhost console route and a local page — every reference is a chip", () => {
    const cites = [
      "https://app.vanta.com/c/acme/controls/change-management",
      "https://app.ap1.datadoghq.com/monitors/4412",
      "https://github.com/lachiejames/slopweaver/issues/1280",
      "http://localhost:3000/workstreams?row=iso-compliance-violations-bigtask",
      "file:///Users/x/.slopweaver/pages/console-steer-composer-write-target/index.html",
    ];
    expect(unwrap(buildHandStep({ draft: draft({ cites }) })).cites).toEqual(cites);
  });

  it("refuses what a card cannot chip — another scheme, a plain-http host, a sentence, a paste — and a non-list", () => {
    const refused = [
      "ftp://example.com/x",
      "http://example.com/x",
      "https://example.com/a b",
      "https://localhost",
      `https://example.com/${"a".repeat(2048)}`,
    ];
    expect(refused.map((cite) => unwrapErr(buildHandStep({ draft: draft({ cites: [cite] }) })).message)).toEqual(
      refused.map(
        (cite) =>
          `cites names "${cite}", which is not an https:// address, a localhost console route nor a local page — the only addresses a card draws as a chip`,
      ),
    );
    expect(unwrapErr(buildHandStep({ draft: draft({ cites: PR_16676 }) })).message).toBe(
      "cites is a list of addresses",
    );
  });
});

describe("uncitedNumbers", () => {
  it("refuses the 16676 step, naming each spelling and what to write instead", () => {
    const step = unwrap(
      buildHandStep({
        draft: draft({
          url: "http://localhost:3000/queue?open=ask%3Aacme-post-16676-description-form",
          what: "Post the 16676 PR description announcement to #dev-team now, or hold it until #16672 lands",
        }),
      }),
    );
    expect(uncitedNumbers({ step })).toEqual(
      HandStepErrors.invalidField({
        field: "cites",
        why: 'names a pull request its queue card may not draw as a chip: "#16672" names no one pull request it carries — pass its github.com URL with --cites <url,url>; "the 16676 PR" is a spelling a hand step does not carry — write it #16676 and cite it',
      }),
    );
  });

  it("passes #N when --cites or the step's own url carries that number", () => {
    const cited = unwrap(
      buildHandStep({ draft: draft({ cites: [PR_16676, PR_16672], what: "Post #16676, or hold until #16672 lands" }) }),
    );
    const own = unwrap(buildHandStep({ draft: draft({ url: PR_16672, what: "Approve #16672 in GitHub" }) }));
    expect(uncitedNumbers({ step: cited })).toBeUndefined();
    expect(uncitedNumbers({ step: own })).toBeUndefined();
  });

  it("refuses a bare PR N even when it is cited, because the card never links one — the review's counterexample", () => {
    const step = unwrap(buildHandStep({ draft: draft({ url: PR_16672, what: "Approve PR 16672 in GitHub" }) }));
    expect(uncitedNumbers({ step })!.message).toBe(
      'cites names a pull request its queue card may not draw as a chip: "Approve PR 16672" is a spelling a hand step does not carry — write it #16672 and cite it',
    );
  });

  it("passes a repository then PR N only when a carried address is that repository's N", () => {
    const own = unwrap(buildHandStep({ draft: draft({ url: PR_16672, what: "Approve acme/acme-admin PR 16672" }) }));
    const other = unwrap(
      buildHandStep({
        draft: draft({
          url: "https://github.com/lachiejames/slopweaver/pull/16672",
          what: "Approve acme-admin PR 16672",
        }),
      }),
    );
    expect(uncitedNumbers({ step: own })).toBeUndefined();
    expect(uncitedNumbers({ step: other })!.message).toContain(
      '"acme-admin PR 16672" is a spelling a hand step does not',
    );
  });

  it("refuses what a hand step does not carry: a lowercase pr, a carried repository's other N, an ambiguous #N", () => {
    const slopweaver = "https://github.com/lachiejames/slopweaver/pull/16672";
    const lower = unwrap(buildHandStep({ draft: draft({ url: PR_16672, what: "Approve acme-admin pr 16672" }) }));
    const otherN = unwrap(
      buildHandStep({
        draft: draft({
          cites: ["https://github.com/acme/acme-admin/pull/100", slopweaver],
          what: "Merge acme-admin #16672",
        }),
      }),
    );
    const twoRepos = unwrap(buildHandStep({ draft: draft({ cites: [PR_16672, slopweaver], what: "Merge #16672" }) }));
    expect(uncitedNumbers({ step: lower })!.message).toContain(
      '"acme-admin pr 16672" is a spelling a hand step does not',
    );
    expect(uncitedNumbers({ step: otherN })!.message).toContain('"#16672" names no one pull request it carries');
    expect(uncitedNumbers({ step: twoRepos })!.message).toContain('"#16672" names no one pull request it carries');
  });

  it("refuses PR#N and a carried repository's PR #N it does not carry, and passes a bare PR #N it does", () => {
    const joined = unwrap(buildHandStep({ draft: draft({ url: PR_16672, what: "Approve PR#16672 in GitHub" }) }));
    const otherN = unwrap(
      buildHandStep({
        draft: draft({
          cites: [
            "https://github.com/acme/acme-admin/pull/100",
            "https://github.com/lachiejames/slopweaver/pull/16672",
          ],
          what: "Approve acme-admin PR #16672",
        }),
      }),
    );
    const bare = unwrap(buildHandStep({ draft: draft({ url: PR_16672, what: "Approve PR #16672 in GitHub" }) }));
    expect(uncitedNumbers({ step: joined })!.message).toContain('"PR#16672" is a spelling a hand step does not carry');
    expect(uncitedNumbers({ step: otherN })!.message).toContain(
      '"acme-admin PR #16672" is a spelling a hand step does not',
    );
    expect(uncitedNumbers({ step: bare })).toBeUndefined();
  });

  it("counts every address the card carries — where, a sentence's own address, the witness — so none is refused falsely", () => {
    const PR = "https://github.com/acme/acme-admin/pull/17564";
    const place = unwrap(
      buildHandStep({ draft: draft({ what: "Open acme-admin #17564: the Proof cell", where: PR }) }),
    );
    const inline = unwrap(buildHandStep({ draft: draft({ what: `Approve #17564 (${PR}) in GitHub` }) }));
    const witness = unwrap(
      buildHandStep({ draft: draft({ what: "Approve #17564 in GitHub", witness: `slopweaver github read ${PR}` }) }),
    );
    expect(uncitedNumbers({ step: place })).toBeUndefined();
    expect(uncitedNumbers({ step: inline })).toBeUndefined();
    expect(uncitedNumbers({ step: witness })).toBeUndefined();
  });

  it("passes #N PR and a carried repository's N PR, which the card links, and refuses the bare N PR it does not", () => {
    const cites = ["https://github.com/acme/acme-admin/pull/17564"];
    const hashed = unwrap(buildHandStep({ draft: draft({ cites, what: "Approve the #17564 PR in GitHub" }) }));
    const repo = unwrap(buildHandStep({ draft: draft({ cites, what: "Review the acme-admin 17564 PR" }) }));
    const bare = unwrap(buildHandStep({ draft: draft({ cites, what: "Review the 17564 PR" }) }));
    expect(uncitedNumbers({ step: hashed })).toBeUndefined();
    expect(uncitedNumbers({ step: repo })).toBeUndefined();
    expect(uncitedNumbers({ step: bare })!.message).toContain(
      '"the 17564 PR" is a spelling a hand step does not carry',
    );
  });

  it("reads unblocks and where too, and leaves a position, a count and a channel alone", () => {
    const position = unwrap(buildHandStep({ draft: draft({ what: "Pick option #1 of 32 MiB in #dev-team" }) }));
    const unblocks = unwrap(buildHandStep({ draft: draft({ unblocks: "merged as #1280" }) }));
    const where = unwrap(buildHandStep({ draft: draft({ where: "pull request 1280" }) }));
    expect(uncitedNumbers({ step: position })).toBeUndefined();
    expect(uncitedNumbers({ step: unblocks })!.message).toContain('"#1280" names no one pull request it carries');
    expect(uncitedNumbers({ step: where })!.message).toContain('"pull request 1280" is a spelling');
  });

  it("keeps a register row that already names an uncited number READABLE — the refusal is posting-only", () => {
    const step = unwrap(buildHandStep({ draft: draft({ unblocks: "nothing, it has landed as #1280" }) }));
    expect(step.unblocks).toBe("nothing, it has landed as #1280");
  });
});

describe("buildHandStep's stated reason for having no address", () => {
  it("keeps the reason trimmed, byte for byte otherwise", () => {
    const step = unwrap(buildHandStep({ draft: draft({ unaddressed: "  it is a word the owner says on the call " }) }));
    expect(step.unaddressed).toBe("it is a word the owner says on the call");
  });

  it("keeps a reason at the cap and refuses one past it rather than truncate it", () => {
    expect(
      unwrap(buildHandStep({ draft: draft({ unaddressed: "r".repeat(UNADDRESSED_CAP) }) })).unaddressed!.length,
    ).toBe(UNADDRESSED_CAP);
    expect(
      unwrapErr(buildHandStep({ draft: draft({ unaddressed: "r".repeat(UNADDRESSED_CAP + 1) }) })).message,
    ).toContain("unaddressed is 121 characters and the cap is 120");
  });

  it("refuses an empty reason — a reason that says nothing is the silence the rule removes", () => {
    expect(unwrapErr(buildHandStep({ draft: draft({ unaddressed: "   " }) })).message).toBe(
      "unaddressed is required and was empty",
    );
  });

  it("refuses a reason that is not a string, which only a direct writer could have supplied", () => {
    expect(unwrapErr(buildHandStep({ draft: draft({ unaddressed: 7 }) })).message).toBe(
      "unaddressed is a sentence saying why the step has no address, or absent — `hand post --no-address` is the only thing that writes it",
    );
  });

  it("reads a row written before the field with no unaddressed key at all", () => {
    expect(Object.keys(unwrap(buildHandStep({ draft: draft() }))).includes("unaddressed")).toBe(false);
  });
});

describe("stopsWork — a step the owner's Queue draws as a stopped automation", () => {
  it("is kept as true, and absent on a step that never carried it", () => {
    expect([
      unwrap(buildHandStep({ draft: draft({ stopsWork: true }) })).stopsWork,
      Object.hasOwn(unwrap(buildHandStep({ draft: draft() })), "stopsWork"),
    ]).toEqual([true, false]);
  });

  it("refuses one spelled anything but true, naming the field", () => {
    expect(unwrapErr(buildHandStep({ draft: draft({ stopsWork: false }) })).message).toContain(
      "stopsWork is `true` or absent",
    );
    expect(unwrapErr(buildHandStep({ draft: draft({ stopsWork: "yes" }) })).message).toContain("stopsWork");
  });

  it("survives a register line round trip byte for byte", () => {
    const step = unwrap(buildHandStep({ draft: draft({ stopsWork: true }) }));
    const line = JSON.stringify({ kind: "posted", step });
    expect(unwrap(parseHandLine({ line, lineNumber: 1 }))).toEqual({ kind: "posted", step });
  });
});

describe("a notice — news with nothing waiting on the owner", () => {
  const NOTICE_WHAT = "vulnfix-digest-acme-admin stopped firing — seat fix-the-digest is repairing it";

  it("is kept on a step that asks nothing", () => {
    expect(unwrap(buildHandStep({ draft: draft({ notice: true, what: NOTICE_WHAT }) })).notice).toBe(true);
  });

  it("refuses a notice that also hands the owner something to paste", () => {
    expect(
      unwrapErr(buildHandStep({ draft: draft({ literal: "gcloud auth login", notice: true }) })).message,
    ).toContain("also carries a literal");
  });

  it("refuses a notice that also carries a decision", () => {
    const decision = {
      lean: "B — the cause is still unread.",
      options: [
        { option: "Do it now", tradeoff: "the output comes back first, and may stop again" },
        { option: "Fix the cause first", tradeoff: "the output stays absent while it is investigated" },
      ],
      problem: "The step is undecided and its record carries the choice.",
      stakes: { blastRadius: "one work row", risk: "It stays undecided.", stillReal: "This pass read it undecided." },
    };
    expect(unwrapErr(buildHandStep({ draft: draft({ decision, notice: true }) })).message).toContain(
      "also carries a decision",
    );
  });

  it("refuses a notice spelled anything but true", () => {
    expect(unwrapErr(buildHandStep({ draft: draft({ notice: false }) })).message).toContain("is `true` or absent");
  });

  it("is left off every surface that lists what waits on the owner, in order", () => {
    const waiting = unwrap(buildHandStep({ draft: draft({ id: "step-a" }) }));
    const notice = unwrap(buildHandStep({ draft: draft({ id: "step-b", notice: true, what: NOTICE_WHAT }) }));
    const later = unwrap(buildHandStep({ draft: draft({ id: "step-c" }) }));

    expect(waitingHandSteps({ steps: [waiting, notice, later] }).map((step) => step.id)).toEqual(["step-a", "step-c"]);
  });
});
