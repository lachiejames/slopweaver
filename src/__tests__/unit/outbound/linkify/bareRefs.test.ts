import { describe, expect, it } from "vitest";
import {
  attestedNumbersInText,
  attestedNumbersInUrls,
  type BareRefContext,
  bareRefIssuesOfPlainText,
  bareRefRefusalMessage,
  linkifyMarkdown,
  linkifyPlainUrl,
  linkifySlackMrkdwn,
  resolveBareRef,
  scanBareRefs,
} from "../../../../outbound/linkify/bareRefs.js";

// register-class: autolinker-resolves-a-cross-repo-number-into-the-wrong-repo (docs/recurring-failure-register/bindings.md)

const NO_CONTEXT: BareRefContext = { repos: [] };
const ONE_REPO: BareRefContext = { repos: [{ owner: "acme", repo: "widget" }] };
const TWO_REPOS: BareRefContext = {
  repos: [
    { owner: "acme", repo: "widget" },
    { owner: "acme", repo: "gadget" },
  ],
};
const WITH_LINEAR: BareRefContext = {
  linearTeamKeys: ["SUP", "INFR"],
  linearWorkspaceSlug: "acme-eng",
  repos: [],
};

describe("scanBareRefs", () => {
  it("finds a bare hash reference", () => {
    const spans = scanBareRefs({ context: NO_CONTEXT, text: "see #123 for detail" });
    expect(spans.length).toBe(1);
    expect(spans[0]!.kind).toBe("githubRef");
  });

  it("finds an explicit owner/repo hash reference and reports the owner and repo", () => {
    const spans = scanBareRefs({ context: NO_CONTEXT, text: "see acme/widget#123 for detail" });
    expect(spans.length).toBe(1);
    const span = spans[0]!;
    expect(span.kind).toBe("githubRef");
    expect(span.kind === "githubRef" ? span.owner : undefined).toBe("acme");
    expect(span.kind === "githubRef" ? span.repo : undefined).toBe("widget");
    expect(span.kind === "githubRef" ? span.number : undefined).toBe(123);
  });

  it("does not double-count the hash inside owner/repo#N as a second bare span", () => {
    const spans = scanBareRefs({ context: NO_CONTEXT, text: "see foo/bar#123 today" });
    expect(spans.length).toBe(1);
  });

  it("matches the reported incident: a merged list of bare digit runs after a colon", () => {
    const spans = scanBareRefs({
      context: NO_CONTEXT,
      text: "merged, 8: 15632, 15717, 15718, 15721, 15723, 15724, 15897, 15900",
    });
    expect(spans.length).toBe(8);
    expect(spans.map((span) => (span.kind === "githubRef" ? span.number : -1))).toEqual([
      15632, 15717, 15718, 15721, 15723, 15724, 15897, 15900,
    ]);
  });

  it("matches a single bare number after 'still open:'", () => {
    const spans = scanBareRefs({ context: NO_CONTEXT, text: "still open: 15895 targeting release" });
    expect(spans.length).toBe(1);
    expect(spans[0]!.kind === "githubRef" ? spans[0]!.number : -1).toBe(15895);
  });

  it("matches a hash reference embedded in prose", () => {
    const spans = scanBareRefs({ context: NO_CONTEXT, text: "renovate's own #15586 closed it" });
    expect(spans.length).toBe(1);
    expect(spans[0]!.kind === "githubRef" ? spans[0]!.number : -1).toBe(15586);
  });

  it("matches two hash references in one sentence", () => {
    const spans = scanBareRefs({ context: NO_CONTEXT, text: "#15489 and #15508 were already open" });
    expect(spans.length).toBe(2);
    expect(spans.map((span) => (span.kind === "githubRef" ? span.number : -1))).toEqual([15489, 15508]);
  });

  it("does not treat an ordinary sentence with a number as a PR list", () => {
    const spans = scanBareRefs({ context: NO_CONTEXT, text: "we have 5 servers in staging" });
    expect(spans.length).toBe(0);
  });

  it("finds a Linear key only when its prefix is a known team key", () => {
    const known = scanBareRefs({ context: WITH_LINEAR, text: "see SUP-123 for detail" });
    expect(known.length).toBe(1);
    expect(known[0]!.kind).toBe("linearKey");

    const unknownPrefix = scanBareRefs({ context: WITH_LINEAR, text: "measured in UTC-5 today" });
    expect(unknownPrefix.length).toBe(0);
  });

  it("finds no Linear key at all when the context names no team keys", () => {
    const spans = scanBareRefs({ context: NO_CONTEXT, text: "see SUP-123 for detail" });
    expect(spans.length).toBe(0);
  });
});

describe("resolveBareRef", () => {
  it("resolves an explicit owner/repo hash reference regardless of context", () => {
    const [span] = scanBareRefs({ context: NO_CONTEXT, text: "acme/widget#42" });
    const resolved = resolveBareRef({ context: NO_CONTEXT, span: span! });
    expect(resolved?.url).toBe("https://github.com/acme/widget/issues/42");
    expect(resolved?.label).toBe("acme/widget#42");
  });

  it("resolves a bare hash reference when the context names exactly one repo", () => {
    const [span] = scanBareRefs({ context: ONE_REPO, text: "#42" });
    const resolved = resolveBareRef({ context: ONE_REPO, span: span! });
    expect(resolved?.url).toBe("https://github.com/acme/widget/issues/42");
    expect(resolved?.label).toBe("#42");
  });

  it("leaves a bare hash reference unresolved with no repo in context", () => {
    const [span] = scanBareRefs({ context: NO_CONTEXT, text: "#42" });
    const resolved = resolveBareRef({ context: NO_CONTEXT, span: span! });
    expect(resolved).toBeUndefined();
  });

  it("leaves a bare hash reference unresolved with two repos in context", () => {
    const [span] = scanBareRefs({ context: TWO_REPOS, text: "#42" });
    const resolved = resolveBareRef({ context: TWO_REPOS, span: span! });
    expect(resolved).toBeUndefined();
  });

  it("resolves a known Linear key when the context carries a workspace slug", () => {
    const [span] = scanBareRefs({ context: WITH_LINEAR, text: "SUP-9" });
    const resolved = resolveBareRef({ context: WITH_LINEAR, span: span! });
    expect(resolved?.url).toBe("https://linear.app/acme-eng/issue/SUP-9");
    expect(resolved?.label).toBe("SUP-9");
  });

  it("leaves a Linear key unresolved with no workspace slug in context", () => {
    const context: BareRefContext = { linearTeamKeys: ["SUP"], repos: [] };
    const [span] = scanBareRefs({ context, text: "SUP-9" });
    const resolved = resolveBareRef({ context, span: span! });
    expect(resolved).toBeUndefined();
  });
});

describe("bareRefRefusalMessage", () => {
  it("names the raw text and the repo ambiguity for a github span", () => {
    const [span] = scanBareRefs({ context: NO_CONTEXT, text: "#42" });
    const message = bareRefRefusalMessage({ context: NO_CONTEXT, span: span! });
    expect(message).toContain('"#42"');
    expect(message).toContain("owner/repo#<number>");
  });

  it("names the raw text and the missing workspace for a linear span", () => {
    const context: BareRefContext = { linearTeamKeys: ["SUP"], repos: [] };
    const [span] = scanBareRefs({ context, text: "SUP-9" });
    const message = bareRefRefusalMessage({ context, span: span! });
    expect(message).toContain('"SUP-9"');
    expect(message).toContain("workspace");
  });

  it("names a malformed workspace slug, and resolves no link from it", () => {
    const context: BareRefContext = { linearTeamKeys: ["SUP"], linearWorkspaceSlug: "evil.test/x", repos: [] };
    const [span] = scanBareRefs({ context, text: "SUP-9" });

    expect(resolveBareRef({ context, span: span! })).toBeUndefined();
    expect(bareRefRefusalMessage({ context, span: span! })).toContain(
      'the workspace slug "evil.test/x" is not a Linear URL key',
    );
  });
});

describe("bareRefIssuesOfPlainText", () => {
  it("reports one issue per unresolved bare reference, at the given path", () => {
    const issues = bareRefIssuesOfPlainText({ context: NO_CONTEXT, path: ["tldr"], text: "closed: 100, 200" });
    expect(issues.length).toBe(2);
    expect(issues[0]!.path).toEqual(["tldr"]);
  });

  it("reports nothing once the reference resolves", () => {
    const issues = bareRefIssuesOfPlainText({ context: ONE_REPO, path: ["tldr"], text: "see #42" });
    expect(issues.length).toBe(0);
  });
});

describe("linkifyMarkdown", () => {
  it("is byte-identical when the text carries no bare reference", () => {
    const result = linkifyMarkdown({ context: ONE_REPO, text: "nothing to see here" });
    expect(result.text).toBe("nothing to see here");
    expect(result.unresolved.length).toBe(0);
  });

  it("rewrites a resolvable reference into a markdown link", () => {
    const result = linkifyMarkdown({ context: ONE_REPO, text: "fixed in #42 today" });
    expect(result.text).toBe("fixed in [#42](https://github.com/acme/widget/issues/42) today");
    expect(result.unresolved.length).toBe(0);
  });

  it("rewrites an explicit owner/repo reference into a markdown link with no context needed", () => {
    const result = linkifyMarkdown({ context: NO_CONTEXT, text: "see acme/widget#42" });
    expect(result.text).toBe("see [acme/widget#42](https://github.com/acme/widget/issues/42)");
  });

  it("rewrites a resolvable Linear key into a markdown link", () => {
    const result = linkifyMarkdown({ context: WITH_LINEAR, text: "tracked in SUP-9 already" });
    expect(result.text).toBe("tracked in [SUP-9](https://linear.app/acme-eng/issue/SUP-9) already");
  });

  it("leaves an unresolvable reference untouched and reports it", () => {
    const result = linkifyMarkdown({ context: NO_CONTEXT, text: "closed: 100, 200" });
    expect(result.text).toBe("closed: 100, 200");
    expect(result.unresolved.length).toBe(2);
  });

  it("never linkifies inside a fenced code block", () => {
    const text = "prose #42\n```\nraw #42 in code\n```";
    const result = linkifyMarkdown({ context: ONE_REPO, text });
    expect(result.text).toBe("prose [#42](https://github.com/acme/widget/issues/42)\n```\nraw #42 in code\n```");
  });

  it("never linkifies inside inline code", () => {
    const result = linkifyMarkdown({ context: ONE_REPO, text: "run `git show #42` first" });
    expect(result.text).toBe("run `git show #42` first");
  });
});

describe("linkifySlackMrkdwn — text-named repo overrides the caller's context", () => {
  const SLOPWEAVER_CONTEXT: BareRefContext = { repos: [{ owner: "octo-self", repo: "slopweaver" }] };

  it("resolves a bare ref against the repo an already-linked PR URL names, not the checkout's own repo", () => {
    const text = "re https://github.com/acme/acme-admin/pull/16349 — also see #16349 for the same fix";
    const result = linkifySlackMrkdwn({ context: SLOPWEAVER_CONTEXT, text });
    expect(result.text).toBe(
      "re https://github.com/acme/acme-admin/pull/16349 — also see " +
        "<https://github.com/acme/acme-admin/issues/16349|#16349> for the same fix",
    );
    expect(result.unresolved.length).toBe(0);
  });

  it("refuses a bare ref when the text names two different repos by link", () => {
    const text =
      "https://github.com/acme/acme-admin/pull/1 and https://github.com/octo-self/slopweaver/pull/2 — see #3";
    const result = linkifySlackMrkdwn({ context: SLOPWEAVER_CONTEXT, text });
    expect(result.unresolved.length).toBe(1);
    expect(result.unresolved[0]!.kind === "githubRef" ? result.unresolved[0]!.number : -1).toBe(3);
  });

  it("still falls back to the checkout's own repo when the text names none", () => {
    const result = linkifySlackMrkdwn({ context: SLOPWEAVER_CONTEXT, text: "fixed in #42 today" });
    expect(result.text).toBe("fixed in <https://github.com/octo-self/slopweaver/issues/42|#42> today");
    expect(result.unresolved.length).toBe(0);
  });
});

describe("linkifySlackMrkdwn", () => {
  it("rewrites a resolvable reference into Slack's own <url|label> link syntax", () => {
    const result = linkifySlackMrkdwn({ context: ONE_REPO, text: "@the-bot #42 is ticked now" });
    expect(result.text).toBe("@the-bot <https://github.com/acme/widget/issues/42|#42> is ticked now");
    expect(result.unresolved.length).toBe(0);
  });

  it("leaves an unresolvable reference untouched and reports it", () => {
    const result = linkifySlackMrkdwn({ context: NO_CONTEXT, text: "closed: 100, 200" });
    expect(result.text).toBe("closed: 100, 200");
    expect(result.unresolved.length).toBe(2);
  });
});

describe("linkifyPlainUrl", () => {
  it("rewrites a resolvable reference into its bare URL, with no link syntax at all", () => {
    const result = linkifyPlainUrl({ context: ONE_REPO, text: "caused by #42" });
    expect(result.text).toBe("caused by https://github.com/acme/widget/issues/42");
    expect(result.unresolved.length).toBe(0);
  });

  it("leaves an unresolvable reference untouched and reports it", () => {
    const result = linkifyPlainUrl({ context: NO_CONTEXT, text: "closed: 100, 200" });
    expect(result.text).toBe("closed: 100, 200");
    expect(result.unresolved.length).toBe(2);
  });
});

describe("attestedNumbersInText", () => {
  it("reads a repo and number out of every numbered github link spelling", () => {
    const text =
      "https://github.com/acme/widget/pull/270 and https://github.com/acme/gadget/issues/16339 and " +
      "https://github.com/acme/widget/discussions/8";
    expect(attestedNumbersInText({ text })).toEqual([
      { number: 270, owner: "acme", repo: "widget" },
      { number: 16339, owner: "acme", repo: "gadget" },
      { number: 8, owner: "acme", repo: "widget" },
    ]);
  });

  it("attests nothing from a repo or commit link that names no object number", () => {
    const text = "https://github.com/acme/widget and https://github.com/acme/widget/commit/15d422aa";
    expect(attestedNumbersInText({ text })).toEqual([]);
  });

  it("reads the same attestations out of a list of URLs a caller already holds", () => {
    expect(
      attestedNumbersInUrls({ urls: ["https://github.com/acme/widget/pull/270", "https://example.com/1"] }),
    ).toEqual([{ number: 270, owner: "acme", repo: "widget" }]);
  });
});

describe("resolveBareRef — a number that cannot be one of this repo's own", () => {
  const THREE_DIGIT_REPO: BareRefContext = {
    attested: [{ number: 270, owner: "acme", repo: "widget" }],
    repos: [{ owner: "acme", repo: "widget" }],
  };

  it("refuses a five-digit bare reference on a repo whose largest known number has three digits", () => {
    const [span] = scanBareRefs({ context: THREE_DIGIT_REPO, text: "see #16339" });
    expect(resolveBareRef({ context: THREE_DIGIT_REPO, span: span! })).toBeUndefined();
  });

  it("still resolves a bare reference of the same digit count", () => {
    const [span] = scanBareRefs({ context: THREE_DIGIT_REPO, text: "see #269" });
    expect(resolveBareRef({ context: THREE_DIGIT_REPO, span: span! })?.url).toBe(
      "https://github.com/acme/widget/issues/269",
    );
  });

  it("takes the LARGEST attestation, so an old small number never shrinks the bound", () => {
    const context: BareRefContext = {
      attested: [
        { number: 4, owner: "acme", repo: "widget" },
        { number: 270, owner: "acme", repo: "widget" },
      ],
      repos: [{ owner: "acme", repo: "widget" }],
    };
    const [span] = scanBareRefs({ context, text: "see #269" });
    expect(resolveBareRef({ context, span: span! })?.url).toBe("https://github.com/acme/widget/issues/269");
  });

  it("ignores an attestation for a DIFFERENT repo than the one being resolved against", () => {
    const context: BareRefContext = {
      attested: [{ number: 16339, owner: "acme", repo: "gadget" }],
      repos: [{ owner: "acme", repo: "widget" }],
    };
    const [span] = scanBareRefs({ context, text: "see #16339" });
    expect(resolveBareRef({ context, span: span! })?.url).toBe("https://github.com/acme/widget/issues/16339");
  });

  it("refuses nothing when no attestation names the repo at all", () => {
    const [span] = scanBareRefs({ context: ONE_REPO, text: "see #16339" });
    expect(resolveBareRef({ context: ONE_REPO, span: span! })?.url).toBe("https://github.com/acme/widget/issues/16339");
  });

  it("is one-directional: a small bare number on a five-digit repo still resolves", () => {
    const context: BareRefContext = {
      attested: [{ number: 16339, owner: "acme", repo: "gadget" }],
      repos: [{ owner: "acme", repo: "gadget" }],
    };
    const [span] = scanBareRefs({ context, text: "see #270" });
    expect(resolveBareRef({ context, span: span! })?.url).toBe("https://github.com/acme/gadget/issues/270");
  });

  it("leaves an EXPLICIT owner/repo reference alone, whatever its magnitude", () => {
    const [span] = scanBareRefs({ context: THREE_DIGIT_REPO, text: "see acme/gadget#16339" });
    expect(resolveBareRef({ context: THREE_DIGIT_REPO, span: span! })?.url).toBe(
      "https://github.com/acme/gadget/issues/16339",
    );
  });

  it("refuses a merged-list digit run on the same magnitude test", () => {
    const spans = scanBareRefs({ context: THREE_DIGIT_REPO, text: "merged, 2: 16339, 16355" });
    expect(spans.length).toBe(2);
    expect(spans.filter((span) => resolveBareRef({ context: THREE_DIGIT_REPO, span }) === undefined).length).toBe(2);
  });

  it("says the number cannot be one of the repo's own, and names the witness", () => {
    const [span] = scanBareRefs({ context: THREE_DIGIT_REPO, text: "see #16339" });
    const message = bareRefRefusalMessage({ context: THREE_DIGIT_REPO, span: span! });
    expect(message).toContain("acme/widget#16339");
    expect(message).toContain("largest number known to exist in acme/widget here is 270");
    expect(message).toContain("5-digit number cannot be one of its own");
  });
});

describe("linkifySlackMrkdwn — the text's own links attest the repo's scale", () => {
  const THREE_DIGIT_CHECKOUT: BareRefContext = { repos: [{ owner: "acme", repo: "widget" }] };

  it("refuses a five-digit bare ref beside a three-digit link to the same repo", () => {
    const text = "landing https://github.com/acme/widget/pull/270 — it cites #16339 too";
    const result = linkifySlackMrkdwn({ context: THREE_DIGIT_CHECKOUT, text });
    expect(result.text).toBe(text);
    expect(result.unresolved.length).toBe(1);
    expect(result.unresolved[0]!.kind === "githubRef" ? result.unresolved[0]!.number : -1).toBe(16339);
  });

  it("carries the anchored context out, so the refusal names the repo the resolver actually used", () => {
    const text = "landing https://github.com/acme/widget/pull/270 — it cites #16339 too";
    const result = linkifySlackMrkdwn({ context: THREE_DIGIT_CHECKOUT, text });
    const message = bareRefRefusalMessage({ context: result.context, span: result.unresolved[0]! });
    expect(message).toContain("largest number known to exist in acme/widget here is 270");
  });

  it("resolves the three-digit ref in the same message", () => {
    const text = "landing https://github.com/acme/widget/pull/270 — it also cites #269";
    const result = linkifySlackMrkdwn({ context: THREE_DIGIT_CHECKOUT, text });
    expect(result.text).toBe(
      "landing https://github.com/acme/widget/pull/270 — it also cites " +
        "<https://github.com/acme/widget/issues/269|#269>",
    );
    expect(result.unresolved.length).toBe(0);
  });
});

describe("compliance control ids — the third reference kind", () => {
  const HRS_52 = "https://app.vanta.com/c/acme/controls?controlId=0syn0002";
  const WITH_CONTROLS: BareRefContext = {
    complianceControls: [
      { id: "HRS-52", url: HRS_52 },
      { id: "BCD-69", url: null },
    ],
    repos: [],
  };

  it("finds a control id the caller's table holds", () => {
    const spans = scanBareRefs({ context: WITH_CONTROLS, text: "HRS-52 is one test away" });
    expect(spans.length).toBe(1);
    expect(spans[0]!.kind).toBe("controlId");
    expect(spans[0]!.raw).toBe("HRS-52");
  });

  it("leaves an ABC-123 shape the table does not hold as ordinary prose", () => {
    expect(scanBareRefs({ context: WITH_CONTROLS, text: "audited against ISO-27001 at UTC-5" })).toEqual([]);
  });

  it("sees nothing at all with no control table — this is the pre-fix behaviour, stated", () => {
    expect(scanBareRefs({ context: { repos: [] }, text: "HRS-52 is one test away" })).toEqual([]);
  });

  it("resolves a control to the page its own table names", () => {
    const span = scanBareRefs({ context: WITH_CONTROLS, text: "HRS-52" })[0]!;
    expect(resolveBareRef({ context: WITH_CONTROLS, span })).toEqual({ label: "HRS-52", url: HRS_52 });
  });

  it("refuses a recognised control whose url could not be built, naming it and the fix", () => {
    const span = scanBareRefs({ context: WITH_CONTROLS, text: "BCD-69" })[0]!;
    expect(resolveBareRef({ context: WITH_CONTROLS, span })).toBeUndefined();
    const message = bareRefRefusalMessage({ context: WITH_CONTROLS, span });
    expect(message).toContain('"BCD-69" is a compliance control written as plain text');
    expect(message).toContain("[BCD-69](url)");
  });

  it("leaves a control unresolved against a context with no table, or a table without that id", () => {
    const span = scanBareRefs({ context: WITH_CONTROLS, text: "HRS-52" })[0]!;
    const otherTable: BareRefContext = { complianceControls: [{ id: "BCD-69", url: HRS_52 }], repos: [] };
    expect(resolveBareRef({ context: WITH_CONTROLS, span })).toEqual({ label: "HRS-52", url: HRS_52 });
    expect(resolveBareRef({ context: { repos: [] }, span })).toBeUndefined();
    expect(resolveBareRef({ context: otherTable, span })).toBeUndefined();
  });

  it("linkifies a control id inside markdown", () => {
    expect(linkifyMarkdown({ context: WITH_CONTROLS, text: "start with HRS-52 today" }).text).toBe(
      `start with [HRS-52](${HRS_52}) today`,
    );
  });

  it("leaves an already-linked control id byte-identical", () => {
    const text = `start with [HRS-52](${HRS_52}) today`;
    const result = linkifyMarkdown({ context: WITH_CONTROLS, text });
    expect(result.text).toBe(text);
    expect(result.unresolved.length).toBe(0);
  });

  it("reports an unresolvable control as residue in a plain-string field", () => {
    const issues = bareRefIssuesOfPlainText({ context: WITH_CONTROLS, path: ["lead"], text: "BCD-69 is next" });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["lead"]);
  });

  it("gives a Linear key the token when both scans could claim it", () => {
    const both: BareRefContext = {
      complianceControls: [{ id: "SUP-12", url: HRS_52 }],
      linearTeamKeys: ["SUP"],
      linearWorkspaceSlug: "acme",
      repos: [],
    };
    const spans = scanBareRefs({ context: both, text: "SUP-12 landed" });
    expect(spans.length).toBe(1);
    expect(spans[0]!.kind).toBe("linearKey");
  });
});

describe("linkifySlackMrkdwn — Slack's own angle-bracket markup is already linked", () => {
  it("leaves a reference inside a <url|label> label alone, so no link is nested in another", () => {
    const text = "bumping <https://github.com/acme/widget/pull/42|add the package #42> in case it got buried";
    const result = linkifySlackMrkdwn({ context: ONE_REPO, text });

    expect(result.text).toBe(text);
    expect(result.unresolved.length).toBe(0);
  });

  it("still links a bare reference sitting outside one", () => {
    const result = linkifySlackMrkdwn({
      context: ONE_REPO,
      text: "<https://github.com/acme/widget/pull/42|the package> and #43",
    });

    expect(result.text).toBe(
      "<https://github.com/acme/widget/pull/42|the package> and <https://github.com/acme/widget/issues/43|#43>",
    );
  });

  it("leaves a channel reference's own markup alone", () => {
    const text = "see <#C0SYN000002|dev-team> about #42";
    const result = linkifySlackMrkdwn({ context: ONE_REPO, text });

    expect(result.text).toBe("see <#C0SYN000002|dev-team> about <https://github.com/acme/widget/issues/42|#42>");
  });

  it("leaves a label alone when a bare URL is glued to the link before it", () => {
    const text =
      "the old one https://github.com/acme/widget/pull/41—<https://github.com/acme/widget/pull/42|the fix #42>";
    const result = linkifySlackMrkdwn({ context: ONE_REPO, text });

    expect(result.text).toBe(text);
  });
});
