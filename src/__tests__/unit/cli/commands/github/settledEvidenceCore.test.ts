/**
 * The settled-evidence criterion: which screenshots and run links a body carries, which a rewrite loses, and
 * which board rows are a settled ask of the owner's naming the pull request. Rows are parsed from real front matter by
 * the board's own parser, so a field this reads is the field the board writes.
 */
import { describe, expect, it } from "vitest";
import {
  lostProtectedEvidence,
  protectedEvidenceOf,
  rowNamesPullRequest,
  settledEvidenceLoss,
} from "../../../../../cli/commands/github/settledEvidenceCore.js";
import { settledEvidenceDecision } from "../../../../../cli/commands/github/settledEvidenceGate.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../../../handover/doc.js";

const PULL = { number: 17564, owner: "acme", repo: "acme-admin" } as const;
const SHOT = "https://github.com/user-attachments/assets/a";
const RUN = "https://github.com/acme/acme-admin/actions/runs/123";
/** The directory of PULL's page, which a path-relative link resolves into. */
const PAGE_DIR = "https://github.com/acme/acme-admin/pull/";

/** Markdown folded into a closed Longer notes disclosure. */
function folded({ inner }: { inner: string }): string {
  return `<details><summary>Longer notes</summary>\n\n${inner}\n\n</details>`;
}

/** A board row parsed from front matter, the measured 17564 row's shape unless a field is overridden. */
function row({
  slug = "acme-admin-17564-gets-before-and-after-proof",
  fields = {},
}: {
  slug?: string;
  fields?: Readonly<Record<string, string | undefined>>;
}): HandoverDoc {
  const base: Record<string, string | undefined> = {
    kind: "ask",
    status: "ready",
    summary: "acme-admin 17564 gets before and after proof",
    settlement: "answered",
    settlementWitness: "https://github.com/acme/acme-admin/pull/17564",
    anchor: "transcript:a0000032-0000-4000-8000-000000000035#0633bdef-34d9-48a7-92cf-8e02bd019433",
    ownerWords: "it needs before and after proof with screenshots and links to the CI runs",
    ownerWordsAnchor: "transcript:a0000032-0000-4000-8000-000000000035#0633bdef-34d9-48a7-92cf-8e02bd019433",
    ownerWordsIso: "2026-09-25T02:41:26.704Z",
    ownerWordsWhere: "session",
    ownerWordsCut: "none",
    ...fields,
  };
  const lines = Object.entries(base)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return parseHandoverDoc({
    path: `/h/${slug}.md`,
    text: [`---`, `slug: ${slug}`, ...lines, `---`, "", "# Row"].join("\n"),
  });
}

describe("protectedEvidenceOf", () => {
  it("reads screenshots and run links, and never the derived badge row", () => {
    const body = [
      '<img src="https://img.shields.io/badge/risk-low-2ea44f?style=flat" alt="risk">',
      "![before](https://github.com/user-attachments/assets/before)",
      '<img alt="after" src="https://github.com/user-attachments/assets/after">',
      '<a href="https://github.com/Acme/acme-admin/actions/runs/123/job/456">the run</a>',
      "and https://ap1.datadoghq.com/ci/test/runs?query=x&amp;start=1.",
    ].join("\n");
    expect(protectedEvidenceOf({ pull: PULL, body })).toStrictEqual({
      attachmentLinks: [],
      // `after` is an img tag's src; `before` follows it inside the same raw HTML block, so it is text, not an
      // image — an attachment outside a link fails closed and is protected after everything drawn.
      // GitHub shows that line as its literal text, so the `)` closing it is part of what a reader sees.
      images: [
        "https://github.com/user-attachments/assets/after",
        "https://github.com/user-attachments/assets/before)",
      ],
      runs: [
        "https://github.com/Acme/acme-admin/actions/runs/123/job/456",
        // Raw text in an HTML block is never autolinked, so the sentence's `.` stays: identity is never trimmed.
        "https://ap1.datadoghq.com/ci/test/runs?query=x&start=1.",
      ],
    });
  });

  it("counts a Datadog pipeline execution and test run, never a CI setting, a log view or a look-alike host", () => {
    const body = [
      "https://ap1.datadoghq.com/ci/pipeline-executions?query=ci.status%3Aerror",
      "https://ap1.datadoghq.com/ci/test/runs?query=x",
      "https://ap1.datadoghq.com/ci/settings/visibility",
      "https://ap1.datadoghq.com/logs?query=x",
      "https://datadoghq.com.evil.test/ci/test/runs",
      "https://github.com/o/r/actions/workflows/ci.yml",
    ].join(" ");
    expect(protectedEvidenceOf({ pull: PULL, body }).runs).toStrictEqual([
      "https://ap1.datadoghq.com/ci/pipeline-executions?query=ci.status%3Aerror",
      "https://ap1.datadoghq.com/ci/test/runs?query=x",
    ]);
  });

  it("reads a reference-style screenshot in all three forms and an unquoted img tag, as GitHub draws them", () => {
    const body = [
      "![before][Shot One] ![after][] ![ last ]",
      "<img alt=x src=https://github.com/user-attachments/assets/bare />",
      "![undefined label][nowhere]",
      "",
      "[shot  one]: https://github.com/user-attachments/assets/one",
      "[after]: <https://github.com/user-attachments/assets/two>",
      "[last]: https://github.com/user-attachments/assets/three",
      "[last]: https://github.com/user-attachments/assets/shadowed",
    ].join("\n");
    expect(protectedEvidenceOf({ pull: PULL, body }).images).toStrictEqual([
      "https://github.com/user-attachments/assets/one",
      "https://github.com/user-attachments/assets/two",
      "https://github.com/user-attachments/assets/three",
      "https://github.com/user-attachments/assets/bare",
    ]);
  });

  it("splits attachments carried only as links from those drawn, autolinked bare, or in a shape it does not know", () => {
    const body = [
      "[its screenshot](https://github.com/user-attachments/assets/linked)",
      '<a href="https://github.com/user-attachments/assets/anchored">clip</a>',
      "https://github.com/user-attachments/assets/alone",
      '<video src="https://github.com/user-attachments/assets/video"></video>',
      "[also linked](https://github.com/user-attachments/assets/mixed) and https://github.com/user-attachments/assets/mixed",
      "`https://github.com/user-attachments/assets/code`",
    ].join("\n\n");
    expect(protectedEvidenceOf({ pull: PULL, body })).toStrictEqual({
      attachmentLinks: [
        "https://github.com/user-attachments/assets/linked",
        "https://github.com/user-attachments/assets/anchored",
      ],
      images: [
        "https://github.com/user-attachments/assets/video",
        "https://github.com/user-attachments/assets/alone",
        "https://github.com/user-attachments/assets/mixed",
        "https://github.com/user-attachments/assets/code",
      ],
      runs: [],
    });
  });

  it("reads nothing from an absent body", () => {
    expect(protectedEvidenceOf({ pull: PULL, body: undefined })).toStrictEqual({
      attachmentLinks: [],
      images: [],
      runs: [],
    });
  });
});

describe("lostProtectedEvidence", () => {
  it("counts a screenshot rewritten as a link as lost — the 17564 rollout's exact move", () => {
    expect(
      lostProtectedEvidence({ pull: PULL, liveBody: `![shot](${SHOT})`, newBody: `[its screenshot](${SHOT})` }),
    ).toStrictEqual([SHOT]);
  });

  it("counts a reference-style screenshot dropped by a rewrite as lost — the r1 review's counterexample", () => {
    expect(
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `![before][shot]\n\n[shot]: ${SHOT}`,
        newBody: "a body with no image",
      }),
    ).toStrictEqual([SHOT]);
  });

  it("counts an upper-case-scheme screenshot dropped by a rewrite as lost — the r2 review's counterexample", () => {
    expect(
      lostProtectedEvidence({
        pull: PULL,
        liveBody: "![shot](HTTPS://GitHub.com/user-attachments/assets/a)",
        newBody: "a body with no image",
      }),
    ).toStrictEqual([SHOT]);
  });

  it("protects a repository-relative screenshot, inline or by reference — the r3 review's counterexample", () => {
    const relative = "../../raw/main/docs/proof.png";
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody: `![proof](${relative})`, newBody: "a body with no image" }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `![proof][p]\n\n[p]: ${relative}`,
        newBody: `[the proof](${relative})`,
      }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `![proof](${relative})`,
        newBody: `<img src="${relative}" alt="proof">`,
      }),
    ]).toStrictEqual([
      ["https://github.com/acme/raw/main/docs/proof.png"],
      ["https://github.com/acme/raw/main/docs/proof.png"],
      [],
    ]);
  });

  it("protects a screenshot whose alt text holds balanced brackets — the fourth review pass's counterexample", () => {
    expect(
      lostProtectedEvidence({
        pull: PULL,
        liveBody: "![proof [desktop]](docs/proof.png)",
        newBody: "a body with no image",
      }),
    ).toStrictEqual([`${PAGE_DIR}docs/proof.png`]);
  });

  it("never lets a URL that differs by a final dot, or text naming the URL, stand in for the picture — the fifth pass", () => {
    const liveBody = `<img src="${SHOT}">`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `<img src="${SHOT}.">` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `see \`${SHOT}\`.` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `the shot:\n\n${SHOT}` }),
      lostProtectedEvidence({ pull: PULL, liveBody: `\`${SHOT}\``, newBody: `![shot](${SHOT})` }),
    ]).toStrictEqual([[SHOT], [SHOT], [SHOT], []]);
  });

  it("never keeps a run link held only in an alt attribute, and keeps a linked screenshot redrawn — the sixth pass", () => {
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody: `[CI run](${RUN})`, newBody: `![${RUN}](${SHOT})` }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `[its screenshot](${SHOT})`,
        newBody: `![its screenshot](${SHOT})`,
      }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `[its screenshot](${SHOT})`,
        newBody: `<img alt="${SHOT}" src="x.png">`,
      }),
      lostProtectedEvidence({ pull: PULL, liveBody: `\`${SHOT}\``, newBody: `<img alt="${SHOT}" src="x.png">` }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `[shot](${SHOT}) <img alt="${SHOT}" src="x.png">`,
        newBody: "gone",
      }),
    ]).toStrictEqual([[RUN], [], [SHOT], [SHOT], [`${PAGE_DIR}x.png`, SHOT]]);
  });

  it("reads a srcset as HTML does: a comma inside a URL is part of it — the eighth pass", () => {
    const one = "https://github.com/user-attachments/assets/a,https://github.com/user-attachments/assets/b";
    const picture = ({ srcset }: { srcset: string }): string =>
      `<picture><source srcset="${srcset}"><img src="${SHOT}"></picture>`;
    expect([
      protectedEvidenceOf({ pull: PULL, body: picture({ srcset: `${one} 1x` }) }).images,
      protectedEvidenceOf({ pull: PULL, body: picture({ srcset: "x.png 2x,y.png, z.png" }) }).images,
      lostProtectedEvidence({
        pull: PULL,
        liveBody: picture({ srcset: `${one} 1x` }),
        newBody: `![a](https://github.com/user-attachments/assets/a) ![b](https://github.com/user-attachments/assets/b) ![s](${SHOT})`,
      }),
    ]).toStrictEqual([[one, SHOT], [`${PAGE_DIR}x.png`, `${PAGE_DIR}y.png`, `${PAGE_DIR}z.png`, SHOT], [one]]);
  });

  it("reads a src as drawn only on an image or a video, never a div or a lone source — the 13th and 14th passes", () => {
    const stray = `<div src="${SHOT}"></div>`;
    expect([
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `![shot](${SHOT})\n\n${stray}`,
        newBody: `the shot is gone\n\n${stray}`,
      }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `![shot](${SHOT})`,
        newBody: `<picture><source srcset="${SHOT}"></picture>`,
      }),
      lostProtectedEvidence({ pull: PULL, liveBody: `![shot](${SHOT})`, newBody: `<video src="${SHOT}"></video>` }),
    ]).toStrictEqual([[SHOT], [SHOT], []]);
  });

  it("reads a poster and a bare image's srcset as drawing nothing, since GitHub may strip both — the 28th pass", () => {
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody: `![shot](${SHOT})`, newBody: `<video poster="${SHOT}"></video>` }),
      lostProtectedEvidence({ pull: PULL, liveBody: `![shot](${SHOT})`, newBody: `<img srcset="${SHOT} 1x">` }),
    ]).toStrictEqual([[SHOT], [SHOT]]);
  });

  it("resolves a relative link against the pull request's page, as GitHub does — the seventeenth pass", () => {
    const liveBody = "[CI run](/acme/acme-admin/actions/runs/123) and [again](../actions/runs/456)";
    expect([
      protectedEvidenceOf({ pull: PULL, body: liveBody }).runs,
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: "the runs are gone" }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `[CI run](${RUN}) and [again](../actions/runs/456)` }),
    ]).toStrictEqual([
      [RUN, "https://github.com/acme/acme-admin/actions/runs/456"],
      [RUN, "https://github.com/acme/acme-admin/actions/runs/456"],
      [],
    ]);
  });

  it("protects a file attachment link like a media one — the sixteenth pass", () => {
    const logs = "https://github.com/user-attachments/files/12345678/logs.zip";
    expect([
      protectedEvidenceOf({ pull: PULL, body: `[logs.zip](${logs})` }).attachmentLinks,
      lostProtectedEvidence({ pull: PULL, liveBody: `[logs.zip](${logs})`, newBody: "the logs are gone" }),
    ]).toStrictEqual([[logs], [logs]]);
  });

  it("protects a repository-scoped upload, and not the pull request's files tab — the 20th and 23rd passes", () => {
    const logs = "https://github.com/o/r/files/12345678/logs.zip";
    const shot = "https://github.com/o/r/assets/1234567/01234567-89ab-cdef-0123-456789abcdef";
    const tab = "https://github.com/o/r/pull/42/files";
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody: `[logs.zip](${logs}) [shot](${shot})`, newBody: "gone" }),
      protectedEvidenceOf({ pull: PULL, body: `[diff](${tab})` }).attachmentLinks,
    ]).toStrictEqual([[logs, shot], []]);
  });

  it("reads a picture's source as drawn beside its image, so dropping a dark-mode one is lost — the 15th pass", () => {
    const light = '<img src="../../raw/main/docs/light-proof.png" alt="proof">';
    const dark = '<source media="(prefers-color-scheme: dark)" srcset="../../raw/main/docs/dark-proof.png">';
    expect(
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `<picture>${dark}${light}</picture>`,
        newBody: `<picture>${light}</picture>`,
      }),
    ).toStrictEqual(["https://github.com/acme/raw/main/docs/dark-proof.png"]);
  });

  it("reads a URL in text whole, parentheses and all, and never trims one into another — the ninth and tenth passes", () => {
    const run = "https://github.com/o/r/actions/runs/123?name=(proof)";
    const unmatched = "https://github.com/o/r/actions/runs/123?name=proof)";
    expect([
      protectedEvidenceOf({ pull: PULL, body: `[${run}](https://example.com/live)` }).runs,
      protectedEvidenceOf({ pull: PULL, body: `\`(see ${RUN}).\`` }).runs,
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `[${run}](https://example.com/live)`,
        newBody: "[https://github.com/o/r/actions/runs/123?name=](https://example.com/new)",
      }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `[${unmatched}](https://example.com/report)`,
        newBody: "[https://github.com/o/r/actions/runs/123?name=proof](https://example.com/report)",
      }),
    ]).toStrictEqual([[run], [`${RUN}).`], [run], [unmatched]]);
  });

  it("reads a URL inline markup splits as the one URL a reader sees, and one a block break splits as two — the eleventh pass", () => {
    expect([
      protectedEvidenceOf({
        pull: PULL,
        body: '<a href="https://example.com/report">https://github.com/o/r/actions/<em>runs</em>/123</a>',
      }).runs,
      protectedEvidenceOf({ pull: PULL, body: "`https://github.com/o/r/actions/runs/`\n\n`123`" }).runs,
    ]).toStrictEqual([["https://github.com/o/r/actions/runs/123"], []]);
  });

  it("protects an attachment shown only as a link's text — the seventh pass", () => {
    const liveBody = `[${SHOT}](https://example.com)`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: "[the shot](https://example.com)" }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `[${SHOT}](https://example.org)` }),
    ]).toStrictEqual([[SHOT], []]);
  });

  it("counts evidence moved into an HTML comment or a hidden element as lost, since neither is drawn", () => {
    const liveBody = `![shot](${SHOT})\n\n${RUN}`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `<!-- ![shot](${SHOT}) ${RUN} -->` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `<div hidden>\n\n![shot](${SHOT})\n\n${RUN}\n\n</div>` }),
    ]).toStrictEqual([
      [SHOT, RUN],
      [SHOT, RUN],
    ]);
  });

  it("loses evidence shown open whose only copy left is folded into a closed details — the twelfth pass", () => {
    const liveBody = `![shot](${SHOT})\n\n[the run](${RUN})\n\n${folded({ inner: `[the run](${RUN})` })}`;
    expect([
      lostProtectedEvidence({
        pull: PULL,
        liveBody,
        newBody: `![shot](${SHOT})\n\n${folded({ inner: `[the run](${RUN})` })}`,
      }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody,
        newBody: `[the run](${RUN})\n\n${folded({ inner: `![shot](${SHOT})` })}`,
      }),
      lostProtectedEvidence({
        pull: PULL,
        liveBody,
        newBody: `![shot](${SHOT})\n\n<details open>\n\n[the run](${RUN})\n\n</details>`,
      }),
    ]).toStrictEqual([[RUN], [SHOT], []]);
  });

  it("keeps evidence the live body only folded away while the new body still carries it, folded or open", () => {
    const liveBody = folded({ inner: `![shot](${SHOT})\n\n[the run](${RUN})` });
    expect([
      lostProtectedEvidence({
        pull: PULL,
        liveBody,
        newBody: folded({ inner: `![shot](${SHOT})\n\n[the run](${RUN})` }),
      }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `![shot](${SHOT})\n\n[the run](${RUN})` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: folded({ inner: `[the shot](${SHOT})` }) }),
    ]).toStrictEqual([[], [], [SHOT, RUN]]);
  });

  it("keeps an attachment the live body only linked while the new body still carries it, and loses it once dropped", () => {
    const liveBody = `[its screenshot](${SHOT})`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `see <a href="${SHOT}">the shot</a>` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: "the link is gone" }),
    ]).toStrictEqual([[], [SHOT]]);
  });

  it("fails closed on a shape it does not know: kept unchanged, lost once rewritten as a link", () => {
    const liveBody = `<video src="${SHOT}"></video>\n\n${RUN}`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: liveBody }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `[the clip](${SHOT}) ${RUN}` }),
    ]).toStrictEqual([[], [SHOT]]);
  });

  it("keeps an attachment alone on its line only while it stays outside a link", () => {
    const liveBody = `The clip:\n${SHOT}\n`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `Reworded:\n\n  ${SHOT}  \n` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `Reworded: [the clip](${SHOT})` }),
    ]).toStrictEqual([[], [SHOT]]);
  });

  it("keeps a screenshot redrawn as an img tag, and a run link carried bare", () => {
    expect(
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `![shot](${SHOT}) <a href="${RUN}">run</a>`,
        newBody: `<img src="${SHOT}" alt="shot"> see ${RUN}`,
      }),
    ).toStrictEqual([]);
  });

  it("names every lost URL once, screenshots first in live order, then run links", () => {
    const second = "https://github.com/user-attachments/assets/b";
    const other = "https://github.com/acme/acme-admin/actions/runs/124";
    expect(
      lostProtectedEvidence({
        pull: PULL,
        liveBody: `${RUN} ![a](${SHOT}) ![a again](${SHOT}) ${other} ![b](${second})`,
        newBody: "nothing kept",
      }),
    ).toStrictEqual([SHOT, second, RUN, other]);
  });

  it("loses nothing when the live body had no evidence", () => {
    expect(lostProtectedEvidence({ pull: PULL, liveBody: "plain prose", newBody: "other prose" })).toStrictEqual([]);
  });
});

describe("rowNamesPullRequest", () => {
  it("names the pull request on the measured row, whose authored status stays ready", () => {
    expect(rowNamesPullRequest({ doc: row({}), pull: PULL })).toBe(true);
  });

  it("matches the number exactly, under any repository name a rename or transfer would redirect here", () => {
    const named = ({ witness }: { witness: string }): boolean =>
      rowNamesPullRequest({ doc: row({ fields: { settlementWitness: witness } }), pull: PULL });
    expect([
      named({ witness: "https://github.com/ACME/ACME-ADMIN/pull/17564" }),
      named({ witness: "https://github.com/acme/acme-admin/pull/175640" }),
      named({ witness: "https://github.com/acme/acme-admin/issues/17564" }),
      named({ witness: "https://github.com/acme/admin-old-name/pull/17564" }),
      named({ witness: "https://github.com/former-owner/acme-admin/pull/17564" }),
      named({ witness: "https://example.com/acme/acme-admin/pull/17564" }),
    ]).toStrictEqual([true, false, false, true, true, false]);
  });

  it("reads any spelling GitHub opens as the pull request — the eighteenth and twenty-first passes", () => {
    const named = ({ witness }: { witness: string }): boolean =>
      rowNamesPullRequest({ doc: row({ fields: { settlementWitness: witness } }), pull: PULL });
    expect([
      named({ witness: "https://github.com:443/acme/acme-admin/pull/17564" }),
      named({ witness: "HTTPS://GitHub.com/acme/acme-admin/pull/17564/files." }),
      named({ witness: "https://github.com.example/acme/acme-admin/pull/17564" }),
      named({ witness: "keep the screenshot on [https://github.com/acme/acme-admin/pull/17564]" }),
      named({ witness: "https://WWW.github.com/acme/acme-admin/pull/17564" }),
      named({ witness: "https://github.com/acme/acme%2Dadmin/pull/%317564" }),
      named({ witness: "https://github.com/acme/acme-admin/pull/17564%" }),
    ]).toStrictEqual([true, true, false, true, true, true, true]);
  });

  it("loses a run link left only as unlinked text, and keeps one autolinked — the twenty-second pass", () => {
    const liveBody = `<table><tr><td><a href="${RUN}">CI run</a></td></tr></table>`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `<table><tr><td>${RUN}</td></tr></table>` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `CI run: ${RUN}` }),
    ]).toStrictEqual([[RUN], []]);
  });

  it("loses a screenshot whose only remaining copy is sized 0×0", () => {
    const shot = "https://github.com/user-attachments/assets/a";
    const hidden = `<img src="${shot}" alt="" width="0" height="0">`;
    expect(
      lostProtectedEvidence({ pull: PULL, liveBody: `![proof](${shot})\n\n${hidden}`, newBody: `text\n\n${hidden}` }),
    ).toStrictEqual([shot]);
  });

  it("protects a live picture drawn at 9px, and credits only a copy of ten or more — the thirtieth pass", () => {
    const shot = "https://github.com/github/docs/raw/main/assets/images/help/repo.png";
    const liveBody = `<img src="${shot}" width="9" alt="proof">`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: "gone" }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: liveBody }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `<img src="${shot}" width="10" alt="proof">` }),
    ]).toStrictEqual([[shot], [shot], []]);
  });

  it("never keeps a run link by a copy in a video's or audio's fallback — the thirty-first pass", () => {
    const clip = "https://github.com/user-attachments/assets/clip";
    const fallback = `<a href="${RUN}">CI run</a>`;
    const liveBody = `[CI run](${RUN})`;
    expect([
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `<video src="${clip}">${fallback}</video>` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `<audio src="${clip}">${fallback}</audio>` }),
      lostProtectedEvidence({ pull: PULL, liveBody, newBody: `<p>${fallback}</p>` }),
    ]).toStrictEqual([[RUN], [RUN], []]);
  });

  it("protects a percent-encoded run and upload like a plain one", () => {
    const run = "https://github.com/o/r/actions/runs/%31%323";
    const logs = "https://github.com/user%2Dattachments/files/1/logs.zip";
    expect(
      lostProtectedEvidence({ pull: PULL, liveBody: `[run](${run}) [logs](${logs})`, newBody: "gone" }),
    ).toStrictEqual([logs, run]);
  });

  it("protects a check run's page like a workflow run's", () => {
    const check = "https://github.com/o/r/runs/987654";
    expect(lostProtectedEvidence({ pull: PULL, liveBody: `[check](${check})`, newBody: "gone" })).toStrictEqual([
      check,
    ]);
  });

  it("protects a www-spelled run and upload like the bare host's", () => {
    const run = "https://www.github.com/o/r/actions/runs/9";
    const logs = "https://www.github.com/user-attachments/files/1/logs.zip";
    expect(
      lostProtectedEvidence({ pull: PULL, liveBody: `[run](${run}) [logs](${logs})`, newBody: "gone" }),
    ).toStrictEqual([logs, run]);
  });

  it("finds the pull request in the owner's own words when the witness names something else", () => {
    const doc = row({
      fields: {
        ownerWords: "i think https://github.com/acme/acme-admin/pull/17564 makes some sense",
        settlementWitness: "acme-admin-17564-description-carries-the-before-and-after-proof",
        settlement: "filed",
      },
    });
    expect(rowNamesPullRequest({ doc, pull: PULL })).toBe(true);
  });

  it("refuses a declined ask, an open one, a non-ask and a row with no words of the owner's", () => {
    const named = ({ fields }: { fields: Readonly<Record<string, string | undefined>> }): boolean =>
      rowNamesPullRequest({ doc: row({ fields }), pull: PULL });
    expect([
      named({ fields: { settlement: "declined", settlementReason: "no" } }),
      named({ fields: { settlement: undefined, settlementWitness: undefined } }),
      named({ fields: { kind: "doc" } }),
      named({
        fields: {
          ownerWords: undefined,
          ownerWordsAnchor: undefined,
          ownerWordsCut: undefined,
          ownerWordsIso: undefined,
          ownerWordsWhere: undefined,
        },
      }),
    ]).toStrictEqual([false, false, false, false]);
  });

  it("never takes the anchor alone as naming the pull request", () => {
    const doc = row({
      fields: {
        anchor: "https://github.com/acme/acme-admin/pull/17564",
        ownerWords: "add the proof",
        ownerWordsAnchor: "https://github.com/acme/acme-admin/pull/17564",
        settlementWitness: "answered in thread",
      },
    });
    expect(rowNamesPullRequest({ doc, pull: PULL })).toBe(false);
  });
});

describe("settledEvidenceLoss", () => {
  it("names the settled row and every lost URL", () => {
    const docs = [row({}), row({ fields: { settlementWitness: "https://github.com/o/r/pull/1" }, slug: "unrelated" })];
    expect(
      settledEvidenceLoss({
        docs,
        liveBody: `![shot](${SHOT}) ${RUN}`,
        newBody: `[its screenshot](${SHOT})`,
        pull: PULL,
      }),
    ).toStrictEqual({ lostUrls: [SHOT, RUN], rowSlugs: ["acme-admin-17564-gets-before-and-after-proof"] });
  });

  it("is clear when no settled ask names the pull request, however much is lost", () => {
    const docs = [row({ fields: { settlementWitness: "https://github.com/o/r/pull/1" }, slug: "unrelated" })];
    expect(
      settledEvidenceLoss({
        docs: docs.map((doc) => ({ ...doc, hisWords: { kind: "absent" } })),
        liveBody: `![shot](${SHOT})`,
        newBody: "",
        pull: PULL,
      }),
    ).toBe(undefined);
  });

  it("is clear when the rewrite keeps every screenshot and run link", () => {
    expect(
      settledEvidenceLoss({ docs: [row({})], liveBody: `![shot](${SHOT})`, newBody: `![moved](${SHOT})`, pull: PULL }),
    ).toBe(undefined);
  });
});

describe("settledEvidenceDecision", () => {
  const lost = { liveBody: `![shot](${SHOT})`, newBody: `[its screenshot](${SHOT})`, pull: PULL };

  it("refuses with the four-line hatch refusal naming the row and every lost URL", () => {
    expect(settledEvidenceDecision({ docs: [row({})], hatchIsOpen: false, ...lost })).toStrictEqual({
      kind: "refused",
      refusal: [
        `slopweaver github pr update blocked because the new description drops a screenshot or a CI run link that a settled ask of the owner's named this pull request for, and SLOPWEAVER_ALLOW_PR_REPLACE does not release it (settled owner rows: acme-admin-17564-gets-before-and-after-proof; lost: ${SHOT}).`,
        "Legitimate exceptions may include the owner superseded or withdrew that evidence requirement, and the new description records the newer word; the old screenshot or run URL is dead or wrong, and the new description carries the same evidence at its corrected URL.",
        'To override use the designated escape hatch slopweaver hatch open pr-evidence-loss --reason "<why this one is a legitimate exception>", then re-run slopweaver github pr update.',
        "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.",
      ].join("\n"),
    });
  });

  it("passes under a live grant and says what it waived", () => {
    expect(settledEvidenceDecision({ docs: [row({})], hatchIsOpen: true, ...lost })).toStrictEqual({
      kind: "overridden",
      notice: `OVERRIDDEN via the journalled pr-evidence-loss grant — dropping evidence a settled ask named (settled owner rows: acme-admin-17564-gets-before-and-after-proof; lost: ${SHOT}). Say so in the pull request.`,
    });
  });

  it("is clear when no settled ask is on the board, however much is lost", () => {
    expect(settledEvidenceDecision({ docs: [], hatchIsOpen: false, ...lost })).toStrictEqual({ kind: "clear" });
  });
});
