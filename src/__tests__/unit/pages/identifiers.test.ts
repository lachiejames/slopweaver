import { describe, expect, it } from "vitest";

import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import {
  identifierFindings,
  linkPageIdentifiers,
  PageIdentifierFindings,
  pageIdentifierContext,
} from "../../../pages/identifiers.js";
import { machineIdsIn } from "../../../pages/machineIds.js";

const NET_93_URL = "https://app.vanta.com/acme/controls?controlId=0syn0001";
const TDA_41_URL = "https://app.vanta.com/acme/controls?controlId=0syn0004";

/** The install as the Vanta evidence page met it: two controls with their atlas URLs, one without, no repository. */
const INSTALL: BareRefContext = {
  complianceControls: [
    { id: "NET-93", url: NET_93_URL },
    { id: "TDA-41", url: TDA_41_URL },
    { id: "HRS-52", url: null },
  ],
  linearTeamKeys: ["JJJJ"],
  linearWorkspaceSlug: "acme",
  repos: [],
};

const SESSION = "a0000021-0000-4000-8000-000000000024";

describe("linkPageIdentifiers — the door's linking half, over HTML", () => {
  it("wraps a bare control id the atlas holds in its control link, the words verbatim (the Vanta page)", () => {
    const fragment = "<table><tr><td>NET-93, TDA-41</td></tr></table>";
    const result = linkPageIdentifiers({ context: INSTALL, fragment });
    expect(result.fragment).toBe(
      `<table><tr><td><a href="${NET_93_URL}">NET-93</a>, <a href="${TDA_41_URL}">TDA-41</a></td></tr></table>`,
    );
    expect(result.linked).toStrictEqual([
      { raw: "NET-93", url: NET_93_URL },
      { raw: "TDA-41", url: TDA_41_URL },
    ]);
  });

  it("leaves an id already inside a link, a code element or the title untouched", () => {
    const fragment = '<title>NET-93 evidence</title><p><a href="https://x.test">NET-93</a> and <code>NET-93</code></p>';
    expect(linkPageIdentifiers({ context: INSTALL, fragment })).toStrictEqual({ fragment, linked: [] });
  });

  it("never reads a tag's attribute or a script body as prose", () => {
    const fragment = '<p data-id="NET-93">x</p><script>const id = "NET-93";</script><style>.a{color:#131619}</style>';
    expect(linkPageIdentifiers({ context: INSTALL, fragment }).fragment).toBe(fragment);
  });

  it("resolves a bare hash-number reference against the one repository the page's own links name, never the checkout", () => {
    const fragment = '<p><a href="https://github.com/acme/acme-admin/pull/18158">the PR</a>, see #18160.</p>';
    const context = pageIdentifierContext({ fragment, install: INSTALL });
    expect(linkPageIdentifiers({ context, fragment }).fragment).toBe(
      '<p><a href="https://github.com/acme/acme-admin/pull/18158">the PR</a>, see ' +
        '<a href="https://github.com/acme/acme-admin/issues/18160">#18160</a>.</p>',
    );
  });

  it("reads a hash-number rank at or under one hundred as a rank, neither linked nor refused, and an owner/repo#N at any number", () => {
    const fragment =
      '<p class="rank">#1 · the fix</p><p>cause #2, <a href="https://github.com/acme/acme-admin/pull/18158">x</a>, ' +
      "lachiejames/slopweaver#12</p>";
    const context = pageIdentifierContext({ fragment, install: INSTALL });
    expect(linkPageIdentifiers({ context, fragment }).linked).toStrictEqual([
      { raw: "lachiejames/slopweaver#12", url: "https://github.com/lachiejames/slopweaver/issues/12" },
    ]);
  });

  it("links neither a Linear key nor a control when one id is both, and says so", () => {
    const context: BareRefContext = { ...INSTALL, linearTeamKeys: ["JJJJ", "NET"] };
    const fragment = "<p>NET-93 is failing.</p>";
    expect(linkPageIdentifiers({ context, fragment })).toStrictEqual({ fragment, linked: [] });
    expect(identifierFindings({ context, fragment })).toStrictEqual([
      PageIdentifierFindings.unlinkedIdentifier({
        identifier: "NET-93",
        reason: '"NET-93" is both a Linear key and a compliance control on this install, so it is not linked for you.',
      }),
    ]);
  });

  it("never reads a github.com/orgs link as a repository a bare #N resolves against", () => {
    const fragment = '<p><a href="https://github.com/orgs/acme/projects/5">board</a>, see #18160.</p>';
    expect(pageIdentifierContext({ fragment, install: INSTALL }).repos).toStrictEqual([]);
  });

  it("never links inside a button, which may not hold a link", () => {
    const fragment = "<button>NET-93</button>";
    expect(linkPageIdentifiers({ context: INSTALL, fragment })).toStrictEqual({ fragment, linked: [] });
  });

  it("reads a numeric entity as the character it is, never as a hash-number reference", () => {
    const fragment = "<p>before&#8212;after</p>";
    const context: BareRefContext = { repos: [{ owner: "acme", repo: "acme-admin" }] };
    expect(linkPageIdentifiers({ context, fragment }).fragment).toBe(fragment);
    expect(identifierFindings({ context, fragment })).toStrictEqual([]);
  });
});

describe("identifierFindings — the residue, refused", () => {
  it("names a bare control id that resolves, with its URL, when the page was not linked first", () => {
    const findings = identifierFindings({ context: INSTALL, fragment: "<p>NET-93 is the control.</p>" });
    expect(findings).toStrictEqual([
      PageIdentifierFindings.unlinkedIdentifier({
        identifier: "NET-93",
        reason: `"NET-93" is a reference written as plain text, and it resolves to ${NET_93_URL}.`,
      }),
    ]);
  });

  it("refuses a control the atlas knows but cannot link, an incident and a URL in prose", () => {
    const fragment =
      "<p>HRS-52 and INC-98 — https://acme.slack.com/archives/C0SYN000002/p1789444018901359 says so.</p>";
    expect(identifierFindings({ context: INSTALL, fragment }).map((finding) => finding.code)).toStrictEqual([
      "UNLINKED_IDENTIFIER",
      "UNLINKED_IDENTIFIER",
      "UNLINKED_URL",
    ]);
    expect(identifierFindings({ context: INSTALL, fragment })[1]).toStrictEqual(
      PageIdentifierFindings.unlinkedIncident({ identifier: "INC-98" }),
    );
  });

  it("leaves a linked page with nothing to refuse — linking then linting is a fixed point", () => {
    const fragment = "<h1>NET-93 evidence</h1><p>NET-93, TDA-41 and JJJJ-1071.</p>";
    const linked = linkPageIdentifiers({ context: INSTALL, fragment });
    expect(identifierFindings({ context: INSTALL, fragment: linked.fragment })).toStrictEqual([]);
  });

  it("does not read UTC-5 or ISO-8601 as a reference, since neither prefix is a team or a control", () => {
    expect(identifierFindings({ context: INSTALL, fragment: "<p>UTC-5 and ISO-8601.</p>" })).toStrictEqual([]);
  });

  it("refuses a session id in prose and in link text, never in a title= hover or a code element", () => {
    const shown = `<p>Session ${SESSION} put this here, <a href="https://x.test">${SESSION}</a>.</p>`;
    expect(identifierFindings({ context: INSTALL, fragment: shown })).toStrictEqual([
      PageIdentifierFindings.rawMachineId({ id: SESSION }),
    ]);
    const hidden = `<p title="${SESSION}">the supervisor chair put this here</p><code>${SESSION}</code>`;
    expect(identifierFindings({ context: INSTALL, fragment: hidden })).toStrictEqual([]);
  });

  it("refuses a short id joined to its name by an entity, which renders as a space", () => {
    const fragment = "<p>It came from session&nbsp;a0000019.</p>";
    expect(identifierFindings({ context: INSTALL, fragment })).toStrictEqual([
      PageIdentifierFindings.rawMachineId({ id: "session a0000019" }),
    ]);
  });
});

describe("machineIdsIn", () => {
  it("finds a session UUID whole, a provider turn id and a named call, talk or run id", () => {
    expect(
      machineIdsIn({
        text: `Session ${SESSION}; turn_000000000000000000010 on call a0000055, talk:f0d25d3a, run a0000019`,
      }),
    ).toStrictEqual([SESSION, "turn_000000000000000000010", "call a0000055", "talk:f0d25d3a", "run a0000019"]);
  });

  it("reads ordinary prose as prose", () => {
    expect(
      machineIdsIn({ text: "the session facade, a call with Riley, run 2026 numbers, commit a254f341" }),
    ).toStrictEqual([]);
  });

  it("reads a snake_case word, a phone number and a CI run number as prose", () => {
    expect(
      machineIdsIn({ text: "turn_detection, run_migrations, msg_formatting, call 0412345678, run #123456789" }),
    ).toStrictEqual([]);
  });

  it("finds the short session id that happens to be all digits", () => {
    expect(machineIdsIn({ text: "from session 61445570" })).toStrictEqual(["session 61445570"]);
  });
});
