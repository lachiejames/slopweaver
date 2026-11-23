/*
 * The posting rule: a step naming a place on the web carries a link to it, so its queue card has a
 * call to action. Each case is a step the real builder made, changing exactly the field it is about.
 */
import { describe, expect, it } from "vitest";

import { namedHosts, placeGaps, placeWithoutLink, unlinkedPlace } from "../../../hand/placeLink.js";
import { postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** The Clerk card's own record, as the monitor lane posted it. */
const CLERK: HandStepDraft = {
  context: "work",
  id: "mon-signin-dashboard-clerk-com",
  opened: "https://dashboard.clerk.com",
  postedBy: "supervisor",
  postedIso: "2026-10-02T19:45:47.806Z",
  unblocks: "resync-atlas-clerk stopped at dashboard.clerk.com's sign-in page",
  url: "http://localhost:3000/queue?open=hand%3Amon-signin-dashboard-clerk-com&context=work",
  what: "Sign in to dashboard.clerk.com in the work Chrome window that just opened on its sign-in page",
  where: "Your work Chrome profile, on that platform's sign-in page — sign in there, then press Done",
  witness: "slopweaver monitor check --fire",
};

/**
 * A step built from the Clerk record with some fields replaced.
 *
 * @returns the built step
 */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(buildHandStep({ draft: { ...CLERK, ...over } }));
}

describe("namedHosts", () => {
  it.each([
    ["Sign in to dashboard.clerk.com in Chrome", ["dashboard.clerk.com"]],
    ["Sign in to acme.trelica.app.", ["acme.trelica.app"]],
    ["Open acme.com and GO.XERO.COM", ["acme.com", "go.xero.com"]],
    ["Sign in to app.hex.tech and app.datadoghq.eu", ["app.hex.tech", "app.datadoghq.eu"]],
  ])("reads %j as naming %j", (text, hosts) => {
    expect(namedHosts({ text })).toEqual(hosts);
  });

  it.each([
    ["an email address", "Enter the code mailed to security@slopweaver.ai"],
    ["an address the card already chips", "Answer on https://claude.ai/code/artifact/e5db0406"],
    ["a file name", "Open SKILL.md and run hook.sh against plan.ts"],
    ["a macOS application bundle", "Open Raycast.app and allow Accessibility for Chrome.app"],
    ["no host at all", "Run gcloud auth application-default login in a plain terminal"],
  ])("reads %s as naming no host", (_label, text) => {
    expect(namedHosts({ text })).toEqual([]);
  });
});

describe("placeWithoutLink", () => {
  it("passes the Clerk card, whose opened page is on the host it names", () => {
    expect(placeWithoutLink({ step: step() })).toBeUndefined();
  });

  it("refuses the same card with nothing on dashboard.clerk.com, naming the host", () => {
    const refused = placeWithoutLink({ step: step({ opened: undefined, literal: "x", where: "your terminal" }) })!;

    expect(refused.code).toBe("INVALID_FIELD");
    expect(refused.message).toContain("url is missing for dashboard.clerk.com");
    expect(refused.message).toContain("--url https://dashboard.clerk.com/");
  });

  it("refuses the trelica sign-in shape: a host named, only a pasted command beside it", () => {
    const trelica = step({
      id: "mon-signin-acme-trelica-app",
      literal: "slopweaver browser open acme.trelica.app",
      opened: undefined,
      url: "http://localhost:3000/queue?open=hand%3Amon-signin-acme-trelica-app&context=work",
      what: "Sign in to acme.trelica.app in your work Chrome",
      where: "your terminal",
    });

    expect(unlinkedPlace({ step: trelica })).toEqual({
      host: "acme.trelica.app",
      link: "https://acme.trelica.app/…",
      linkedElsewhere: false,
    });
  });

  it.each<[string, Partial<HandStepDraft>]>([
    ["a url on the host", { opened: undefined, url: "https://dashboard.clerk.com/sign-in" }],
    ["a sole cited address on the host", { cites: ["https://dashboard.clerk.com/apps"], opened: undefined }],
    [
      "a checklist line opening the host",
      {
        checklist: [{ action: "Sign in", url: "https://dashboard.clerk.com" }],
        opened: undefined,
      },
    ],
    [
      "an OAuth scope spelled out beside a console url",
      {
        opened: undefined,
        url: "https://console.cloud.google.com/auth/scopes",
        what: "Add scope https://www.googleapis.com/auth/chronicle to the Slopweaver OAuth client",
      },
    ],
  ])("passes a step carrying %s", (_label, over) => {
    expect(placeWithoutLink({ step: step(over) })).toBeUndefined();
  });

  it.each<[string, Partial<HandStepDraft>, string]>([
    ["a link on another host", { opened: "https://dashboard.clerk.dev" }, "dashboard.clerk.com"],
    ["a link on the parent the host sits under", { opened: "https://clerk.com" }, "dashboard.clerk.com"],
  ])("does not count %s as reaching the named one", (_label, over, host) => {
    expect(unlinkedPlace({ step: step(over) })).toEqual({ host, link: `https://${host}/…`, linkedElsewhere: false });
  });

  it.each<[string, Partial<HandStepDraft>]>([
    [
      "its own card beside two cites, so it draws no go to row",
      { cites: ["https://dashboard.clerk.com", "https://github.com/lachiejames/slopweaver/pull/1"], opened: undefined },
    ],
    [
      "another link drawn first, the host only cited",
      {
        cites: ["https://dashboard.clerk.com"],
        opened: undefined,
        url: "https://github.com/lachiejames/slopweaver/pull/1",
      },
    ],
  ])("refuses a step whose host is linked but not drawn as its call to action: %s", (_label, over) => {
    const refused = placeWithoutLink({ step: step(over) })!;

    expect(refused.message).toContain("url does not reach dashboard.clerk.com");
    expect(refused.message).toContain("--opened, else --url when it is not this card, else a sole --cite");
  });

  it("refuses an address spelled out in the prose when the card draws no call to action at all", () => {
    const spelled = step({ opened: undefined, what: "Reload http://localhost:3000/queue and read the check-ins" });

    expect(unlinkedPlace({ step: spelled })).toEqual({
      host: "localhost",
      link: "http://localhost:3000/queue",
      linkedElsewhere: true,
    });
    expect(placeWithoutLink({ step: spelled })!.message).toContain("pass --url http://localhost:3000/queue (or");
  });

  it("passes a notice whose sentence names a host, which sends the owner nowhere", () => {
    const notice = step({
      id: "mon-org-inc-98",
      notice: true,
      opened: undefined,
      url: "https://app.incident.io/acme/incidents/98",
      what: "INC-98 · Elevated 502s on api.acme.com — investigating",
      where: undefined,
    });

    expect(placeWithoutLink({ step: notice })).toBeUndefined();
  });

  it("reports every open card with the gap, and only those, as hand list --gaps reads them", () => {
    const gap = step({ id: "mon-signin-go-xero-com", literal: "x", opened: undefined, what: "Sign in to go.xero.com" });

    expect(placeGaps({ steps: [step(), gap] })).toEqual([
      { host: "go.xero.com", id: "mon-signin-go-xero-com", what: "Sign in to go.xero.com" },
    ]);
  });

  it("is one of the posting form's rules, so every writer meets it", () => {
    const refused = postingRefusal({ step: step({ opened: "https://example.com", where: "the Chrome window" }) })!;

    expect(refused.message).toContain("url is missing for dashboard.clerk.com");
  });
});
