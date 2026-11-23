/*
 * The two posting rules: a go-ahead with nothing to weigh is refused, and every step says where it
 * happens. Each is driven on a step the real builder made, so a case changes exactly the field it is about.
 */
import { describe, expect, it } from "vitest";

import { goAheadPhrase } from "../../../hand/decision.js";
import { HandStepErrors } from "../../../hand/errors.js";
import { addressRefusal, bareGoAhead, postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** Addressed by a stated reason, so a go-ahead case sees only the go-ahead rule. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "store-backup-daily-stopped-firing",
        postedBy: "workspace:12",
        postedIso: "2026-09-27T01:24:00.000Z",
        unaddressed: "it is a word the owner says on the call",
        unblocks: "store-backup-daily, which has not fired since Thursday",
        what: "Tell Sadie the cutover moved to Monday",
        witness: 'slopweaver hand done store-backup-daily-stopped-firing --did "done"',
        ...over,
      },
    }),
  );
}

/** The incident's own sentence. */
const INCIDENT = "Say the word if you want the stale store-backup lease cleared before load drops";

const OWN_CARD = "http://localhost:3000/queue?open=hand%3Astore-backup-daily-stopped-firing&context=work";

describe("goAheadPhrase", () => {
  it.each([
    ["Say the word if you want the lease cleared", "Say the word"],
    ["Say yes and I restart it", "Say yes"],
    ["Say go when the call ends", "Say go"],
    ["Give me the go-ahead to merge", "Give me the go-ahead"],
    ["Give the go-ahead to merge", "Give the go-ahead"],
    ["OK to clear the lease?", "OK to"],
    ["Okay to clear the lease?", "Okay to"],
    ["Want me to clear the lease?", "Want me to"],
    ["Should I clear the lease?", "Should I"],
    ["Should we clear the lease?", "Should we"],
    ["Can I clear the lease?", "Can I"],
    ["May I send this reply as you?", "May I"],
    ["Shall we close the Vanta group?", "Shall we"],
    ["Would you like me to clear the lease?", "Would you like me to"],
    ["Are you happy for me to delete the stale lease?", "Are you happy for me to"],
    ["Is it okay if I delete the stale lease?", "Is it okay if"],
    ["Do you mind if I delete the stale lease?", "mind if I"],
    ["Confirm you want the lease cleared", "Confirm you want"],
  ])("reads %j as asking for a go-ahead", (what, phrase) => {
    expect(goAheadPhrase({ what })).toBe(phrase);
  });

  it.each([
    "Can I have the code from your phone?",
    "Can we get the six digits off your phone?",
    "Sign in to Typeform in the work Chrome profile",
    "Say which account the invoice goes to",
    "Look at the booking page",
  ])("reads %j as no go-ahead", (what) => {
    expect(goAheadPhrase({ what })).toBeUndefined();
  });
});

describe("bareGoAhead", () => {
  it("refuses the incident's sentence, naming the phrase and the rule-10 route", () => {
    const refused = bareGoAhead({ step: step({ what: INCIDENT }) })!;
    expect(refused.code).toBe("INVALID_FIELD");
    expect(refused.message).toBe(
      'what asks the owner for a go-ahead ("Say the word") and carries nothing to weigh — no decision, no --cites, no ' +
        "link to the record, no named Slack draft. Under rule 10 an obvious act is done, not asked: do it and record " +
        "it with `slopweaver autonomy record`. An act reserved to the owner — a send as the owner to a person, a closure the owner must " +
        "judge — carries its draft (name the sd- id) or its decision",
    );
  });

  it("passes a sentence asking no go-ahead", () => {
    expect(bareGoAhead({ step: step() })).toBeUndefined();
  });

  it("passes a go-ahead citing a pull request", () => {
    const cited = step({ cites: ["https://github.com/acme/slopweaver/pull/1410"], what: INCIDENT });
    expect(bareGoAhead({ step: cited })).toBeUndefined();
  });

  it("does not count an EMPTY cites list as something to weigh", () => {
    expect(bareGoAhead({ step: { ...step({ what: INCIDENT }), cites: [] } })!.code).toBe("INVALID_FIELD");
  });

  it("passes a go-ahead linking the record it is about", () => {
    const linked = step({
      unaddressed: undefined,
      url: "https://github.com/acme/slopweaver/pull/1410",
      what: INCIDENT,
    });
    expect(bareGoAhead({ step: linked })).toBeUndefined();
  });

  it("passes a go-ahead opening another queue item", () => {
    const asked = step({
      unaddressed: undefined,
      url: "http://localhost:3000/queue?open=ask%3Arule-10-reeled-in&context=work",
      what: INCIDENT,
    });
    expect(bareGoAhead({ step: asked })).toBeUndefined();
  });

  it("refuses a go-ahead whose only link is its OWN card, which draws only this same sentence", () => {
    const own = step({ unaddressed: undefined, url: OWN_CARD, what: INCIDENT });
    expect(bareGoAhead({ step: own })!.code).toBe("INVALID_FIELD");
  });

  it("admits a go-ahead whose link differs from its own card by an empty fragment, which is another link", () => {
    const other = step({ unaddressed: undefined, url: `${OWN_CARD}#`, what: INCIDENT });
    expect(bareGoAhead({ step: other })).toBeUndefined();
  });

  it("refuses a go-ahead whose only address is a literal — a paste is not something the owner weighs", () => {
    const pasted = step({
      literal: "slopweaver lease clear store-backup-daily",
      unaddressed: undefined,
      what: INCIDENT,
    });
    expect(bareGoAhead({ step: pasted })!.code).toBe("INVALID_FIELD");
  });

  it.each([
    ["what", { what: "Say yes and I send sd-a0615cb5 to Rosa" }],
    ["where", { what: INCIDENT, where: "the draft sd-a0615cb5 on the queue" }],
    ["unblocks", { unblocks: "the reply drafted as sd-a0615cb5", what: INCIDENT }],
    ["witness", { what: INCIDENT, witness: "slopweaver slack draft send sd-a0615cb5" }],
  ])("passes a go-ahead naming a Slack draft in %s", (_field, over) => {
    expect(bareGoAhead({ step: step(over) })).toBeUndefined();
  });
});

describe("addressRefusal", () => {
  const bare = { unaddressed: undefined } as const;

  it("refuses a step with no url, no literal and no stated reason, naming all three routes", () => {
    const refused = addressRefusal({ step: step(bare) })!;
    expect(refused.message).toBe(
      "url is missing, and so are --literal and --no-address — say where it happens: --url (or --open <kind>:<id>), " +
        '--literal, or --no-address "<why there is none>", which the card draws so the owner sees the reason',
    );
  });

  it.each([
    ["a url", { url: "https://github.com/acme/slopweaver/pull/1410" }],
    ["a literal and where it goes", { literal: "slopweaver checkout sync", where: "a terminal" }],
    ["both", { literal: "slopweaver checkout sync", url: "https://github.com/acme/slopweaver/pull/1410" }],
  ])("passes a step carrying %s", (_shape, over) => {
    expect(addressRefusal({ step: step({ ...bare, ...over }) })).toBeUndefined();
  });

  it("refuses a literal that says nowhere it goes, since a paste is payload and not a place", () => {
    expect(addressRefusal({ step: step({ ...bare, literal: "123456", what: "Enter the approval code" }) })).toEqual(
      HandStepErrors.invalidField({
        field: "where",
        why:
          "is missing and a --literal is the step's only address — a paste is WHAT the owner puts somewhere, not where: say " +
          "where it goes with --where (a terminal, the prompt, the app), or give the page as --url",
      }),
    );
  });

  it("passes a step saying why it has no address", () => {
    expect(addressRefusal({ step: step() })).toBeUndefined();
  });

  it.each([
    ["a url", { url: "https://github.com/acme/slopweaver/pull/1410" }],
    ["a literal", { literal: "slopweaver checkout sync", where: "a terminal" }],
  ])("refuses a stated reason beside %s, which the record would contradict", (_shape, over) => {
    expect(addressRefusal({ step: step(over) })!.message).toBe(
      "unaddressed says the step has no address, and it carries a --url, --opened or --literal — drop --no-address, or the address",
    );
  });

  describe("a page the fleet already opened", () => {
    it.each([
      ["a local page", "file:///Users/owner/page.html"],
      ["a NUL inside the address", "https://app.datadoghq.com/\u0000login"],
    ])("refuses %s as the page it opened", (_case, opened) => {
      const built = buildHandStep({
        draft: {
          id: "dd-signin",
          opened,
          postedBy: "workspace:12",
          postedIso: "2026-10-01T10:34:58.274Z",
          unblocks: "backtest-shot capture",
          what: "Sign in to Datadog in the work Chrome window that just opened",
          where: "the Datadog window",
          witness: "slopweaver hand done dd-signin",
        },
      });
      expect(unwrapErr(built).message).toBe(
        "opened must be the one absolute http(s) address the fleet opened on the owner's screen — the page the sign-in happens on",
      );
    });

    it.each([
      ["a default port the browser drops", "https://dashboard.clerk.com:443/"],
      ["a dot segment the browser resolves", "https://dashboard.clerk.com/a/../b"],
      ["a backslash the browser repairs", "https://dashboard.clerk.com/sign-in?r=\\x"],
      ["a character outside printable ASCII", "https://dashboard.clerk.com/é"],
    ])("refuses %s, which the console's reader would refuse the whole queue on", (_case, opened) => {
      const built = buildHandStep({
        draft: {
          id: "clerk-signin",
          opened,
          postedBy: "workspace:12",
          postedIso: "2026-10-05T10:34:58.274Z",
          unblocks: "resync-atlas-clerk",
          what: "Sign in to dashboard.clerk.com in the work Chrome window that just opened",
          where: "the Clerk window",
          witness: "slopweaver hand done clerk-signin",
        },
      });
      expect(unwrapErr(built).message).toContain("opened must be written as the browser keeps it");
    });

    const DATADOG = "https://app.datadoghq.com/account/login";

    it("refuses --opened without a where, since a window the owner cannot tell from the others is no place", () => {
      expect(addressRefusal({ step: step({ ...bare, opened: DATADOG }) })).toEqual(
        HandStepErrors.invalidField({
          field: "where",
          why: "is missing beside --opened — name the window the fleet opened (which browser, which page), so the owner knows where to look",
        }),
      );
    });

    it("refuses --opened beside a literal, since a window already open needs no command", () => {
      const both = step({ ...bare, literal: "123456", opened: DATADOG, where: "the Datadog window" });
      expect(addressRefusal({ step: both })!.message).toBe(
        "literal is beside --opened — the window is already open, so there is nothing for the owner to paste: drop the --literal",
      );
    });

    it("refuses a stated reason beside --opened", () => {
      expect(addressRefusal({ step: step({ opened: DATADOG, where: "the Datadog window" }) })!.message).toBe(
        "unaddressed says the step has no address, and it carries a --url, --opened or --literal — drop --no-address, or the address",
      );
    });

    it("passes the Datadog shape — sign in to Datadog in the window the seat opened, nothing pasted", () => {
      const opened = step({
        ...bare,
        opened: DATADOG,
        what: "Sign in to Datadog in the browser window that just opened, then close it",
        where: "the Datadog sign-in window that opened over your screen",
      });
      expect(addressRefusal({ step: opened })).toBeUndefined();
    });
  });

  describe("a sign-in", () => {
    const SIGN_IN_REFUSAL =
      "url is missing and the step is a sign-in — pass --url with its sign-in page, --opened with the page the fleet " +
      "opened plus --where naming that window, or a --literal command with --where saying where to run it. " +
      "--no-address never excuses a sign-in";
    const what = "Sign in to Typeform in the work Chrome profile";

    it("refuses the incident's shape — a sign-in naming no page", () => {
      expect(addressRefusal({ step: step({ ...bare, what, where: "work Chrome profile" }) })!.message).toBe(
        SIGN_IN_REFUSAL,
      );
    });

    it("refuses a sign-in excused by a stated reason", () => {
      expect(addressRefusal({ step: step({ what }) })!.message).toBe(SIGN_IN_REFUSAL);
    });

    it("refuses a sign-in with a literal but no where, which leaves the owner not knowing where the page opens", () => {
      const pasted = step({
        ...bare,
        literal: "gcloud auth application-default login",
        what: "Sign in to Google Cloud",
      });
      expect(addressRefusal({ step: pasted })!.message).toBe(SIGN_IN_REFUSAL);
    });

    it("passes a sign-in carrying the exact sign-in page", () => {
      expect(
        addressRefusal({ step: step({ ...bare, url: "https://admin.typeform.com/login", what }) }),
      ).toBeUndefined();
    });

    it("passes the gcloud shape — a literal that opens the consent page, and where it opens", () => {
      const gcloud = step({
        ...bare,
        literal: "gcloud auth application-default login",
        what: "Sign in to Google Cloud",
        where: "any terminal; the consent page opens in the work Chrome profile",
      });
      expect(addressRefusal({ step: gcloud })).toBeUndefined();
    });

    it("passes a literal with a where that names no browser — whether the command opens consent is not a pattern's to read", () => {
      const codex = step({ ...bare, literal: "codex login", what: "Sign in to Codex", where: "any terminal" });
      expect(addressRefusal({ step: codex })).toBeUndefined();
    });
  });
});

describe("postingRefusal", () => {
  it("runs the go-ahead rule before the address rule, so the incident is refused for what it asked", () => {
    expect(postingRefusal({ step: step({ unaddressed: undefined, what: INCIDENT }) })!.message).toContain(
      "asks the owner for a go-ahead",
    );
  });

  it("refuses an unaddressed step through the form every writer calls", () => {
    expect(postingRefusal({ step: step({ unaddressed: undefined }) })!.message).toContain("say where it happens");
  });

  it("refuses the incident's literal through the form every writer calls", () => {
    const pasted = step({
      literal: "yarn nx run @acme/cloud-datadog:backtest-shot -- --login --profile /tmp/p",
      unaddressed: undefined,
      what: "Sign in to Datadog once in the browser window this command opens",
      where: "a terminal in the acme-admin worktree",
    });
    expect(postingRefusal({ step: pasted })!.message).toContain("is a command the fleet can run itself");
  });
});
