/**
 * The PR body gate CI runs: an owned body is accepted only as the exact C3 render, a pre-C3 one is refused naming the
 * conversion, a published grade, anchor or origin line is refused, a missing kind label is refused, and a stranger's
 * body is not judged at all.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../lib/result.js";
import { dependencyBotActors } from "../../../organisation/dependencyBots.js";
import { PRE_C3_CONVERSION } from "../../../outbound/github/errors.js";
import { renderStampedBody } from "../../../outbound/github/legacy/render.js";
import type { RiskRowShape } from "../../../outbound/github/legacy/riskRow.js";
import type { BadgeRowShape } from "../../../outbound/github/legacy/tooltips.js";
import type { StampedPrBody } from "../../../outbound/github/legacy/types.js";
import { renderBodyIn, renderPrBody } from "../../../outbound/github/render.js";
import type { PrBody } from "../../../outbound/github/types.js";
import { gatePrBody, prOwnership, retiredPublicationErrors } from "../../../prformat/prBodyGate.js";
import { FEATURE_BODY, FIX_BODY, formOf, shot, TESTS_ONLY_BODY } from "../outbound/github/fixtures.js";
import { FULL_BODY, TARGET as LEGACY_TARGET, MINIMAL_BODY } from "../outbound/github/legacy/fixtures.js";

/** An install with no organisation of its own: the generic Renovate and Dependabot alone. */
const GENERIC = dependencyBotActors({ dependencyBots: [] });

/** An install whose organisation names its own self-hosted Renovate App, `acme-renovate`. */
const CONFIGURED = dependencyBotActors({ dependencyBots: ["acme-renovate"] });

/** The fix fixture, rendered exactly as the door writes it. */
const FIX_RENDERED = unwrap(renderPrBody({ form: formOf({ body: FIX_BODY }) }));

/** A pre-C3 reading-order body, rendered by the frozen legacy renderer. */
const LEGACY_RENDERED = unwrap(
  renderStampedBody({ anchor: undefined, badges: "plain", body: MINIMAL_BODY, riskRows: "sentence" }),
);

/** A C3 body rendered exactly as the door writes it. */
function c3({ body }: { body: PrBody }): string {
  return unwrap(renderPrBody({ form: formOf({ body }) }));
}

/** A pre-C3 stamped body, its anchor pointing into the legacy fixture target, plain badges and sentence rows unless asked. */
function legacy({
  badges = "plain",
  body,
  riskRows = "sentence",
}: {
  badges?: BadgeRowShape;
  body: StampedPrBody;
  riskRows?: RiskRowShape;
}): string {
  const anchor = body.goldAnchor === undefined ? undefined : { goldAnchor: body.goldAnchor, repo: LEGACY_TARGET };
  return unwrap(renderStampedBody({ anchor, badges, body, riskRows }));
}

/** The verdict on a pre-C3 body of a given shape: refused, naming the conversion. */
function preC3({ shape }: { shape: "reading-order" | "retired-table" }): { errors: string[]; shape: "pre-c3" } {
  return {
    errors: [
      `PRE_C3_SHAPE: the description is a pre-C3 ${shape} body. Convert it, which writes an authoring file and ` +
        `sends nothing: \`${PRE_C3_CONVERSION}\`.`,
    ],
    shape: "pre-c3",
  };
}

/** A conforming retired table body. */
const TABLE_BODY = [
  "![CI](https://img.shields.io/badge/CI-x-2ea44f)",
  "<table><tr><td><strong>Risk</strong></td><td>Low risk.</td></tr><tr><td><strong>Blast radius</strong></td><td>This test.</td></tr><tr><td><strong>Problem</strong></td><td>p <a href='https://linear.app/acme/issue/ABC-1'>ABC-1</a></td></tr>",
  "<tr><td><strong>Solution</strong></td><td>s</td></tr>",
  "<tr><td><strong>Proof</strong></td><td>x</td></tr></table>",
].join("\n");

/** The refusal of a published gold anchor. */
const GOLD_ANCHOR_PUBLISHED =
  "RETIRED_PUBLICATION: the description publishes a gold anchor, which a C3 description never carries. Remove it";

describe("gatePrBody — a pre-C3 body is read by its shape and refused naming the conversion", () => {
  it("refuses the canonical full reading-order body", () => {
    expect(gatePrBody({ body: legacy({ body: FULL_BODY }), owned: true })).toEqual(preC3({ shape: "reading-order" }));
  });

  it("reads the legacy three-badge row, which live pull requests still carry, as the reading order", () => {
    const body = legacy({ badges: "withSolved", body: FULL_BODY, riskRows: "dotted" });
    expect(gatePrBody({ body, owned: true })).toEqual(preC3({ shape: "reading-order" }));
  });

  it("reads a body written before risk rows became sentences as the reading order", () => {
    const dotted = legacy({ body: FULL_BODY, riskRows: "dotted" });
    expect(dotted).not.toBe(legacy({ body: FULL_BODY }));
    expect(gatePrBody({ body: dotted, owned: true })).toEqual(preC3({ shape: "reading-order" }));
  });

  it("judges a CRLF pre-C3 body by its content", () => {
    const body = legacy({ body: FULL_BODY }).replaceAll("\n", "\r\n");
    expect(gatePrBody({ body, owned: true })).toEqual(preC3({ shape: "reading-order" }));
  });

  it("refuses a retired table body, naming the table shape", () => {
    expect(gatePrBody({ body: TABLE_BODY, owned: true })).toEqual(preC3({ shape: "retired-table" }));
  });

  it("reads a body carrying both pre-C3 shapes as the reading order, the newer of the two", () => {
    const body = `${LEGACY_RENDERED}\n${TABLE_BODY}\n`;
    expect(gatePrBody({ body, owned: true })).toEqual(preC3({ shape: "reading-order" }));
  });

  it("reads a C3 render with a table appended as C3, never as a pre-C3 body, and refuses the trailing table", () => {
    const verdict = gatePrBody({ body: `${FIX_RENDERED}\n${TABLE_BODY}\n`, owned: true });
    expect(verdict.shape).toBe("c3");
    expect(verdict.errors[0]).toContain("The description is not a canonical C3 body");
  });
});

describe("gatePrBody — a C3 body is held to the form rules", () => {
  it("reads an anchor line inside a screenshot's alt as the human's words, never as a published anchor", () => {
    const solutionProof = {
      ...FIX_BODY.solutionProof,
      image: shot({ alt: "proof-commit: the anchor for CI", id: "22222222-aaaa-4bbb-8ccc-000000000003" }),
    };
    expect(gatePrBody({ body: c3({ body: { ...FIX_BODY, solutionProof } }), owned: true })).toEqual({
      errors: [],
      shape: "c3",
    });
  });

  it("refuses a hand-edited badge as not canonical", () => {
    const body = FIX_RENDERED.replace("?style=flat", "?style=for-the-badge");
    expect(body).not.toBe(FIX_RENDERED);
    const verdict = gatePrBody({ body, owned: true });
    expect(verdict.shape).toBe("c3");
    expect(verdict.errors).toHaveLength(1);
    expect(verdict.errors[0]).toContain("The description is not a canonical C3 body");
  });

  it("refuses a screenshot hosted anywhere but a GitHub user attachment, naming its code and the attach verb", () => {
    const solutionProof = {
      ...FIX_BODY.solutionProof,
      image: { alt: "store start refusing", kind: "image" as const, url: "https://example.com/after.png" },
    };
    const { errors } = gatePrBody({ body: c3({ body: { ...FIX_BODY, solutionProof } }), owned: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("solutionProof.image.url: IMAGE_NOT_USER_ATTACHMENT: ");
    expect(errors[0]).toContain("slopweaver github attach");
  });

  it("refuses an explainer one word over its cap, read off the rendered body", () => {
    const explainer = Array.from({ length: 71 }, () => "word").join(" ");
    const body = c3({ body: { ...FIX_BODY, explainer: [{ kind: "text", text: explainer }] } });
    expect(gatePrBody({ body, owned: true }).errors).toEqual([
      "explainer: WORD_CAP: The explainer is 71 words (max 70). Trim it.",
    ]);
  });

  it("holds a layout-2 body's words and its title to the content rules", () => {
    const body = c3({
      body: { ...FIX_BODY, explainer: [{ kind: "text", text: "Anyone could reach the open store." }] },
    });
    expect(gatePrBody({ body, owned: true, title: "fix(store): a lap refuses an open store" }).errors).toEqual([
      expect.stringMatching(/^title: TEAMMATE_WORDS: /u),
      expect.stringMatching(/^explainer: AUDIENCE_UNNAMED: /u),
    ]);
  });

  it("passes a layout-1 body published before the content rules, words and all", () => {
    const explainer = [{ kind: "text" as const, text: "Anyone could reach the open store." }];
    const body = unwrap(renderBodyIn({ body: { ...FIX_BODY, explainer }, layout: 1 }));
    expect(gatePrBody({ body, owned: true })).toEqual({ errors: [], shape: "c3" });
  });

  it("refuses a gold anchor appended after the render, as trailing content and as a published anchor", () => {
    const body = `${FIX_RENDERED}\nproof-commit: c6b7dbca1f2e3d4b5a6978890abcdef012345678\nproof-patch-id: 5e1877358e8c58c6bdc46b92483800474b4b1b32\n`;
    const { errors } = gatePrBody({ body, owned: true });
    expect(errors).toHaveLength(2);
    expect(errors[1]).toBe(GOLD_ANCHOR_PUBLISHED);
  });
});

describe("gatePrBody — an owned body", () => {
  it("accepts each fixture's exact C3 render", () => {
    for (const body of [FIX_BODY, FEATURE_BODY, TESTS_ONLY_BODY]) {
      expect(gatePrBody({ body: unwrap(renderPrBody({ form: formOf({ body }) })), owned: true })).toEqual({
        errors: [],
        shape: "c3",
      });
    }
  });

  it("judges content, not line endings: a CRLF copy of the render passes", () => {
    expect(gatePrBody({ body: FIX_RENDERED.replace(/\n/g, "\r\n"), owned: true })).toEqual({ errors: [], shape: "c3" });
  });

  it("refuses a pre-C3 body naming the conversion, which sends nothing", () => {
    expect(gatePrBody({ body: LEGACY_RENDERED, owned: true })).toEqual({
      errors: [
        "PRE_C3_SHAPE: the description is a pre-C3 reading-order body. Convert it, which writes an authoring file and " +
          `sends nothing: \`${PRE_C3_CONVERSION}\`.`,
      ],
      shape: "pre-c3",
    });
  });

  it("refuses prose, naming the template and the two write verbs", () => {
    const verdict = gatePrBody({ body: "just some prose", owned: true });
    expect(verdict.shape).toBe("unknown");
    expect(verdict.errors).toEqual([
      "The description is not a C3 body. Write it in the shape .github/pull_request_template.md describes, through " +
        "`slopweaver github stack push --file <f>` or `slopweaver github pr update <n> --file <f>`.",
    ]);
  });

  it("accepts a screenshot a human pasted on github.com between two sections", () => {
    const paste =
      '<img width="1512" height="982" alt="Image" src="https://github.com/user-attachments/assets/abc-1" />';
    const form = formOf({ body: FIX_BODY });
    const body = unwrap(renderPrBody({ form, pasted: [{ after: "problem-proof", occurrence: 1, raw: paste }] }));
    expect(body).toContain(`\n\n${paste}\n\n`);
    expect(gatePrBody({ body, owned: true })).toEqual({ errors: [], shape: "c3" });
  });

  it("refuses an image pasted between two sections from anywhere but a GitHub user attachment", () => {
    const elsewhere = '<img width="10" height="10" alt="Image" src="https://example.invalid/a.png" />';
    const form = formOf({ body: FIX_BODY });
    const body = unwrap(renderPrBody({ form, pasted: [{ after: "problem-proof", occurrence: 1, raw: elsewhere }] }));
    const verdict = gatePrBody({ body, owned: true });
    expect(verdict.shape).toBe("c3");
    expect(verdict.errors[0]).toContain("The description is not a canonical C3 body");
  });

  it("refuses a hand edit to the render's layout as not canonical", () => {
    const edited = FIX_RENDERED.replace("\n\n", "\n\n\n");
    const verdict = gatePrBody({ body: edited, owned: true });
    expect(verdict.shape).toBe("c3");
    expect(verdict.errors[0]).toContain("The description is not a canonical C3 body");
  });

  it("refuses the old hidden grade comment after the render, as trailing markup and as a published grade", () => {
    const body = `${FIX_RENDERED}\n\n<!-- slopweaver-review grade=silver -->\n`;
    const errors = gatePrBody({ body, owned: true }).errors;
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain("The description is not a canonical C3 body: content follows the rendered description");
    expect(errors[1]).toBe(
      "RETIRED_PUBLICATION: the description publishes a proof grade, which a C3 description never carries. Remove it",
    );
  });

  it("lets an explainer talk about grades and the gold anchor, since prose is not a published grade", () => {
    const explainer = "The gold anchor and anything graded gold leave the body; a proof grade is no longer shown.";
    const form = formOf({ body: { ...FIX_BODY, explainer: [{ kind: "text", text: explainer }] } });
    expect(gatePrBody({ body: unwrap(renderPrBody({ form })), owned: true })).toEqual({ errors: [], shape: "c3" });
  });

  it("refuses a missing kind label when the event carries the title and labels", () => {
    expect(
      gatePrBody({ body: FIX_RENDERED, labels: ["docs"], owned: true, title: "fix(widgets): refuse an open store" })
        .errors,
    ).toEqual([
      'KIND_LABEL_MISSING: the title\'s kind derives the label "bug fix", which the pull request does not carry. ' +
        "`slopweaver github pr update <n>` applies the derived labels",
    ]);
  });

  it("passes once the derived label is carried", () => {
    expect(
      gatePrBody({ body: FIX_RENDERED, labels: ["bug fix"], owned: true, title: "fix(widgets): refuse an open store" }),
    ).toEqual({ errors: [], shape: "c3" });
  });

  it("skips the label check when the event carries no labels", () => {
    expect(gatePrBody({ body: FIX_RENDERED, owned: true, title: "fix(widgets): refuse an open store" })).toEqual({
      errors: [],
      shape: "c3",
    });
  });
});

/** A synthetic credential shape, built at runtime so no token-shaped literal sits in this file. */
const TOKEN = `ghp_${"a".repeat(30)}`;

/** The line a refusal quoting a credential shape prints instead. */
const WITHHELD =
  "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
  "the secret scan names, and the refusal prints in full";

describe("gatePrBody — a line that would quote a credential shape is withheld", () => {
  it("withholds the parse refusal quoting a recovered run that carries a backtick", () => {
    const body = c3({ body: { ...FIX_BODY, explainer: [{ kind: "text", text: `rotated \`${TOKEN}\` today` }] } });
    expect(body).toContain(TOKEN);
    const { errors, shape } = gatePrBody({ body, owned: true });
    expect(shape).toBe("c3");
    expect(errors.filter((line) => line.includes(TOKEN))).toStrictEqual([]);
    expect(errors).toContain(WITHHELD);
  });

  it("withholds the invented-visual refusal quoting an embed's address", () => {
    const body = `${FIX_RENDERED}\n<img src="http://127.0.0.1:8792/before.html?t=${TOKEN}">\n`;
    expect(body).toContain(TOKEN);
    const { errors, shape } = gatePrBody({ body, owned: true });
    expect(shape).toBe("c3");
    expect(errors.filter((line) => line.includes(TOKEN))).toStrictEqual([]);
    expect(errors).toContain(WITHHELD);
  });
});

describe("gatePrBody — a stranger's body", () => {
  it("is not judged, whatever its shape", () => {
    expect(gatePrBody({ body: "just some prose", owned: false })).toEqual({ errors: [], shape: "stranger" });
    expect(gatePrBody({ body: LEGACY_RENDERED, owned: false })).toEqual({ errors: [], shape: "stranger" });
  });

  it("is not held to the kind label either", () => {
    expect(
      gatePrBody({ body: TABLE_BODY, labels: [], owned: false, title: "fix(widgets): refuse an open store" }),
    ).toEqual({ errors: [], shape: "stranger" });
  });
});

describe("retiredPublicationErrors", () => {
  it("names each kind of retired publication once", () => {
    const body = "<!-- slopweaver-review grade=gold -->\nproof-commit: abc123\norigin: a thread\n";
    expect(retiredPublicationErrors({ body })).toEqual([
      "RETIRED_PUBLICATION: the description publishes a proof grade, which a C3 description never carries. Remove it",
      "RETIRED_PUBLICATION: the description publishes a gold anchor, which a C3 description never carries. Remove it",
      "RETIRED_PUBLICATION: the description publishes an origin line, which a C3 description never carries. Remove it",
    ]);
  });

  it("finds nothing in a C3 render", () => {
    expect(retiredPublicationErrors({ body: FIX_RENDERED })).toEqual([]);
  });

  it("names a gold anchor once when it carries both its lines", () => {
    const body = "proof-commit: c6b7dbca1f2e\nproof-patch-id: 5e1877358e8c\n";
    expect(retiredPublicationErrors({ body })).toEqual([GOLD_ANCHOR_PUBLISHED]);
  });

  it("reads an origin line through the tags wrapping it", () => {
    expect(retiredPublicationErrors({ body: "<p><strong>Origin:</strong> a thread</p>" })).toEqual([
      "RETIRED_PUBLICATION: the description publishes an origin line, which a C3 description never carries. Remove it",
    ]);
  });

  it("reads a gold anchor through the emphasis, code marks and list marker wrapping it", () => {
    const body = "**proof-commit:** c6b7dbca1f2e\n- `proof-patch-id:` 5e1877358e8c\n> _proof-commit_: abc\n";
    expect(retiredPublicationErrors({ body })).toEqual([GOLD_ANCHOR_PUBLISHED]);
    expect(retiredPublicationErrors({ body: "`proof-commit:` c6b7dbca1f2e" })).toEqual([GOLD_ANCHOR_PUBLISHED]);
  });

  it("reads an anchor's words mid-sentence as prose, never as an anchor line", () => {
    expect(
      retiredPublicationErrors({ body: "The old proof-commit: line is gone, and so is the origin: line." }),
    ).toEqual([]);
  });
});

describe("prOwnership", () => {
  it("reads a fork as a stranger", () => {
    expect(
      prOwnership({ author: "octocat", bots: GENERIC, headRepository: "fork/widgets", ownRepository: "acme/widgets" }),
    ).toBe("stranger");
  });

  it("reads a branch of this repository by a person as owned", () => {
    expect(
      prOwnership({ author: "octocat", bots: GENERIC, headRepository: "acme/widgets", ownRepository: "acme/widgets" }),
    ).toBe("owned");
  });

  it("reads Renovate as a stranger, its body coming from renovate.json", () => {
    expect(prOwnership({ author: "renovate[bot]", bots: GENERIC })).toBe("stranger");
  });

  it("reads the organisation's self-hosted Renovate as a stranger where the organisation names it", () => {
    expect(prOwnership({ author: "acme-renovate[bot]", bots: CONFIGURED })).toBe("stranger");
  });

  it("reads an unlisted App the event types a Bot as a stranger", () => {
    expect(prOwnership({ author: "acme-renovate[bot]", authorType: "Bot", bots: GENERIC })).toBe("stranger");
  });

  it("reads the public Dependabot as owned, so github bump-drive rewrites its body", () => {
    expect(prOwnership({ author: "dependabot[bot]", authorType: "Bot", bots: GENERIC })).toBe("owned");
  });

  it("reads a user whose login is an App's bare name as owned", () => {
    expect(prOwnership({ author: "acme-renovate", bots: CONFIGURED })).toBe("owned");
  });

  it("reads a local run with no CI event as owned", () => {
    expect(prOwnership({ author: undefined, bots: GENERIC })).toBe("owned");
  });

  it("reads an unlisted App as owned where the event does not type it, rather than guessing it is Renovate", () => {
    expect(prOwnership({ author: "acme-renovate[bot]", bots: GENERIC })).toBe("owned");
  });

  it("reads an author the event types a User as owned, whatever the login ends with", () => {
    expect(prOwnership({ author: "acme-renovate[bot]", authorType: "User", bots: GENERIC })).toBe("owned");
  });

  it("reads a Bot-typed author whose login is not an App's REST spelling as owned", () => {
    expect(prOwnership({ author: "acme-renovate", authorType: "Bot", bots: GENERIC })).toBe("owned");
  });

  it("reads a listed Renovate as a stranger whatever the event types it", () => {
    expect(prOwnership({ author: "renovate[bot]", authorType: "User", bots: GENERIC })).toBe("stranger");
  });

  it("reads a fork as a stranger even with no author", () => {
    expect(
      prOwnership({ author: undefined, bots: GENERIC, headRepository: "fork/widgets", ownRepository: "acme/widgets" }),
    ).toBe("stranger");
  });

  it("does not read a fork off the head repository alone, with no base to compare it to", () => {
    expect(prOwnership({ author: "octocat", bots: GENERIC, headRepository: "fork/widgets" })).toBe("owned");
  });
});
