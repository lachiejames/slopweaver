/**
 * The precedence a partial `--edit` follows to find the form it merges into.
 *
 * Two of these tests exist because the repository shipped the bug they pin: a digest match alone was treated
 * as licence to re-render the cached form, and the cached form's TITLE was sent even when a human had changed
 * it on github.com. Both are silent-data-loss shapes, so both get a falsifiable test rather than a comment.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { renderPrBody as renderLegacyBody } from "../../../../outbound/github/legacy/render.js";
import { bodyHash, type PrRecord } from "../../../../outbound/github/prLedger.js";
import { recoverPrForm } from "../../../../outbound/github/recovery.js";
import { renderPrBody } from "../../../../outbound/github/render.js";
import type { PrForm, PrTarget } from "../../../../outbound/github/types.js";
import { FEATURE_BODY, FIX_BODY, formOf, P2_CHECKED, TARGET, t } from "./fixtures.js";
import { FULL_BODY as LEGACY_FULL_BODY, formOf as legacyFormOf } from "./legacy/fixtures.js";

const NUMBER = 213;

/** A form whose one risk item carries its level's canonical priority, so a parse reads it back exactly. */
const FORM: PrForm = formOf({ body: FEATURE_BODY });
const BODY = unwrap(renderPrBody({ form: FORM }));
const LIVE = { draft: FORM.draft, target: TARGET, title: FORM.title };

/** What every refusal's reason opens on, so the caller learns which operation could not proceed. */
const REASON_PREFIX = "a partial --edit needs the description's current form to merge into, and it has none: ";

/** A confirmed record whose stored form and digest both describe `body`. */
function record({
  overrides,
  body = BODY,
  form = FORM,
}: {
  overrides: Partial<PrRecord>;
  body?: string;
  form?: PrForm;
}): PrRecord {
  const base: PrRecord = {
    bodyHash: bodyHash({ body }),
    confirmedIso: "2026-10-01T00:00:00.000Z",
    form,
    locus: "acme/widgets#main...c3-form",
    number: NUMBER,
    reservedIso: "2026-10-01T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

/** The explainer a human typed over the rendered one on github.com, and the form that renders it. */
const HUMAN_EXPLAINER = "A human rewrote this explainer on github.com.";
const DRIFTED_FORM: PrForm = { ...FORM, explainer: t({ text: HUMAN_EXPLAINER }) };
const DRIFTED = unwrap(renderPrBody({ form: DRIFTED_FORM }));

describe("recoverPrForm — the cached form is the fast path when it is exact", () => {
  it("uses the cache when the stored form re-renders the live body", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: BODY, number: NUMBER, record: record({ overrides: {} }) });
    expect(found).toStrictEqual({ form: FORM, kind: "cached", pasted: [], trailing: "" });
  });

  it("falls through to the parser when the record is for a DIFFERENT pull request number", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: BODY, number: 999, record: record({ overrides: {} }) });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: "" });
  });

  it("falls through to the parser when the record carries no form", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: BODY,
      number: NUMBER,
      record: record({ overrides: { form: undefined } }),
    });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: "" });
  });

  it("falls through to the parser when the record carries no digest, the marker of a complete record", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: BODY,
      number: NUMBER,
      record: record({ overrides: { bodyHash: undefined } }),
    });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: "" });
  });

  it("falls through to the parser when there is no record at all", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: BODY, number: NUMBER, record: undefined });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: "" });
  });
});

describe("recoverPrForm — the cache is where the risk items below the top one survive", () => {
  const fix = formOf({ body: FIX_BODY });
  const fixBody = unwrap(renderPrBody({ form: fix }));

  it("keeps both ranked items on a cache hit", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: fixBody,
      number: NUMBER,
      record: record({ body: fixBody, form: fix, overrides: {} }),
    });
    expect(found).toStrictEqual({ form: { ...fix, ...LIVE }, kind: "cached", pasted: [], trailing: "" });
  });

  it("reads back the top item alone when it has to parse, since the description publishes only that one", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: fixBody, number: NUMBER, record: undefined });
    expect(found).toEqual({
      form: { ...fix, ...LIVE, risk: { items: [P2_CHECKED] } },
      kind: "parsed",
      pasted: [],
      trailing: "",
    });
  });
});

describe("recoverPrForm — a screenshot pasted between two sections rides beside the form", () => {
  const fix = formOf({ body: FIX_BODY });
  const fixBody = unwrap(renderPrBody({ form: fix }));
  const screenshot =
    '<img width="1512" height="982" alt="Image" src="https://github.com/user-attachments/assets/abc-1" />';
  const solutionHeading = '\n\n## <a name="proof-of-the-solution"></a>';
  const pastedBody = fixBody.replace(solutionHeading, `\n\n${screenshot}${solutionHeading}`);
  const keyed = [{ after: "problem-proof", occurrence: 1, raw: screenshot }];

  it("keeps the cache, and both ranked risk items, with the paste keyed to the block it followed", () => {
    expect(pastedBody).toContain(screenshot);
    const found = recoverPrForm({
      live: LIVE,
      liveBody: pastedBody,
      number: NUMBER,
      record: record({ body: fixBody, form: fix, overrides: {} }),
    });
    expect(found).toStrictEqual({ form: { ...fix, ...LIVE }, kind: "cached", pasted: keyed, trailing: "" });
  });

  it("parses the form and the paste off the live body when there is no record", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: pastedBody, number: NUMBER, record: undefined });
    expect(found).toStrictEqual({
      form: { ...fix, ...LIVE, risk: { items: [P2_CHECKED] } },
      kind: "parsed",
      pasted: keyed,
      trailing: "",
    });
  });

  it("keeps the cache and the paste with a third-party block appended after the description", () => {
    const appended = "\n---\nAppended by a release bot.\n";
    const found = recoverPrForm({
      live: LIVE,
      liveBody: `${pastedBody}${appended}`,
      number: NUMBER,
      record: record({ body: fixBody, form: fix, overrides: {} }),
    });
    expect(found).toStrictEqual({ form: { ...fix, ...LIVE }, kind: "cached", pasted: keyed, trailing: appended });
  });
});

describe("recoverPrForm — a digest is never what decides a cache hit", () => {
  // The digest is taken over the body GitHub STORED while the form kept is the one slopweaver SENT, so a
  // normalising server makes them agree while the stored form no longer renders those bytes. Trusting the
  // digest here would re-render the stale form and overwrite whatever is actually live.
  it("parses the LIVE body when the digest matches but the stored form renders something else", () => {
    const lying = record({ overrides: { bodyHash: bodyHash({ body: DRIFTED }) } });
    const found = recoverPrForm({ live: LIVE, liveBody: DRIFTED, number: NUMBER, record: lying });
    expect(found).toEqual({ form: DRIFTED_FORM, kind: "parsed", pasted: [], trailing: "" });
  });

  it("the parsed form re-renders the human's edit byte for byte, so it is preserved rather than refused over", () => {
    expect(DRIFTED).toContain(HUMAN_EXPLAINER);
    expect(unwrap(renderPrBody({ form: DRIFTED_FORM }))).toBe(DRIFTED);
  });

  it("no longer refuses merely because the description changed since the last write", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: DRIFTED, number: NUMBER, record: record({ overrides: {} }) });
    expect(found).toEqual({ form: DRIFTED_FORM, kind: "parsed", pasted: [], trailing: "" });
  });
});

describe("recoverPrForm — the live shell always wins, on both paths", () => {
  const edited = { draft: false, target: TARGET, title: "a title a human changed in the browser" };

  it("overlays the live title and draft onto a CACHED form, which is the title-reversion bug", () => {
    const found = recoverPrForm({ live: edited, liveBody: BODY, number: NUMBER, record: record({ overrides: {} }) });
    expect(found).toStrictEqual({ form: { ...FORM, ...edited }, kind: "cached", pasted: [], trailing: "" });
  });

  it("overlays the live title and draft onto a PARSED form", () => {
    const found = recoverPrForm({ live: edited, liveBody: BODY, number: NUMBER, record: undefined });
    expect(found).toEqual({ form: { ...FORM, ...edited }, kind: "parsed", pasted: [], trailing: "" });
  });

  it("overlays the live target, so a renamed base cannot be silently reverted", () => {
    const moved: PrTarget = { ...TARGET, base: "release" };
    const live = { ...LIVE, target: moved };
    const found = recoverPrForm({ live, liveBody: BODY, number: NUMBER, record: record({ overrides: {} }) });
    expect(found).toStrictEqual({ form: { ...FORM, target: moved }, kind: "cached", pasted: [], trailing: "" });
  });
});

describe("recoverPrForm — refuses with the parser's code when neither source has a form", () => {
  it("refuses an absent body as ABSENT_BODY", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: undefined, number: NUMBER, record: undefined });
    expect(found).toMatchObject({ code: "ABSENT_BODY", kind: "refused" });
  });

  it("refuses a description a human typed by hand, carrying the parser's own reason after the prefix", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: "a description a human typed by hand",
      number: NUMBER,
      record: undefined,
    });
    expect(found).toMatchObject({ code: "STRUCTURE", kind: "refused", reason: expect.stringContaining(REASON_PREFIX) });
  });

  it("refuses a reading-order body written before C3 as PRE_C3_SHAPE, naming the conversion verb", () => {
    const legacyBody = unwrap(renderLegacyBody({ form: legacyFormOf({ body: LEGACY_FULL_BODY }) }));
    const found = recoverPrForm({ live: LIVE, liveBody: legacyBody, number: NUMBER, record: undefined });
    expect(found).toMatchObject({
      code: "PRE_C3_SHAPE",
      kind: "refused",
      reason: expect.stringContaining("--convert-c3"),
    });
  });

  it("refuses a body in the retired table shape as PRE_C3_SHAPE too, naming the conversion verb", () => {
    const retired = [
      "> 👉 <strong>Next</strong>: nothing",
      "<table>",
      "<tr>\n<td><strong>Problem</strong></td>\n<td>a problem</td>\n</tr>",
      "<tr>\n<td><strong>Solution</strong></td>\n<td>a solution</td>\n</tr>",
      "</table>",
    ].join("\n\n");
    const found = recoverPrForm({ live: LIVE, liveBody: retired, number: NUMBER, record: undefined });
    expect(found).toEqual({
      code: "PRE_C3_SHAPE",
      kind: "refused",
      reason: expect.stringContaining("--convert-c3"),
    });
  });
});

describe("recoverPrForm — a C3 body links into no repository, so a moved target is simply overlaid", () => {
  it("parses a body under a live target in another repository, overlaying that target", () => {
    const elsewhere: PrTarget = { ...TARGET, owner: "x", repo: "elsewhere" };
    const found = recoverPrForm({
      live: { ...LIVE, target: elsewhere },
      liveBody: BODY,
      number: NUMBER,
      record: undefined,
    });
    expect(found).toEqual({ form: { ...FORM, target: elsewhere }, kind: "parsed", pasted: [], trailing: "" });
  });
});

/**
 * The cache has to survive a third party appending to the description too, and this is not a nicety: the
 * ledger record is written from the body GitHub RETURNED, block included, so a whole-body equality test
 * could never hit again after one successful write.
 */
const APPENDED = "\n<!-- This is an auto-generated comment: release notes by coderabbit.ai -->\n\n## Summary\n";

/** An image a human pasted into the description on github.com, below everything the renderer wrote. */
const PASTE = "![image](https://github.com/user-attachments/assets/abc-1)";

describe("recoverPrForm — the cache reads the stored form as the live body's PREFIX", () => {
  it("hits the cache and carries the appended block back so the write can re-append it", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: BODY + APPENDED,
      number: NUMBER,
      record: record({ overrides: {} }),
    });
    expect(found).toStrictEqual({ form: FORM, kind: "cached", pasted: [], trailing: APPENDED });
  });

  it("hits even though the stored digest describes the body BEFORE the block was appended", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: BODY + APPENDED,
      number: NUMBER,
      record: record({ overrides: {} }),
    });
    expect(found).toMatchObject({ kind: "cached", pasted: [], trailing: APPENDED });
  });

  it("parses the appended block back as the trailing region when the cache misses", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: BODY + APPENDED, number: NUMBER, record: undefined });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: APPENDED });
  });

  it("parses past a record for another pull request and still carries the appended block back", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: BODY + APPENDED,
      number: 999,
      record: record({ overrides: {} }),
    });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: APPENDED });
  });

  it("keeps the cache for an image a human pasted after the description, carrying it back verbatim", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: `${BODY}\n${PASTE}\n`,
      number: NUMBER,
      record: record({ overrides: {} }),
    });
    expect(found).toStrictEqual({ form: FORM, kind: "cached", pasted: [], trailing: `\n${PASTE}\n` });
  });

  it("parses that pasted image back as the trailing region when the cache misses", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: `${BODY}\n${PASTE}\n`, number: NUMBER, record: undefined });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: `\n${PASTE}\n` });
  });

  it("carries the pasted image back when no newline closes it, too", () => {
    const found = recoverPrForm({ live: LIVE, liveBody: `${BODY}\n${PASTE}`, number: NUMBER, record: undefined });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: `\n${PASTE}` });
  });

  // The guard, and the reason it is not optional: preserving a second rendered badge row verbatim beside a freshly
  // rendered one would leave two descriptions standing in one body.
  it("refuses, as TRAILING_MARKUP, a region after the description carrying our own markup", () => {
    const badgeRow = BODY.split("\n")[0]!;
    const found = recoverPrForm({
      live: LIVE,
      liveBody: `${BODY}\n${badgeRow}\n`,
      number: NUMBER,
      record: record({ overrides: {} }),
    });
    expect(found).toMatchObject({ code: "TRAILING_MARKUP", kind: "refused" });
  });

  it("still parses the live body when the stored form renders something the live body does not open with", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: DRIFTED + APPENDED,
      number: NUMBER,
      record: record({ overrides: {} }),
    });
    expect(found).toEqual({ form: DRIFTED_FORM, kind: "parsed", pasted: [], trailing: APPENDED });
  });

  it("carries a whitespace-only trailing region back verbatim on the cached path", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: `${BODY}\n`,
      number: NUMBER,
      record: record({ overrides: {} }),
    });
    expect(found).toStrictEqual({ form: FORM, kind: "cached", pasted: [], trailing: "\n" });
  });
});

describe("recoverPrForm — a description GitHub stored with CRLF line endings", () => {
  const crlf = ({ text }: { text: string }): string => text.replaceAll("\n", "\r\n");

  it("hits the cache, reading CRLF as LF, rather than parsing the live body", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: crlf({ text: BODY }),
      number: NUMBER,
      record: record({ overrides: {} }),
    });
    expect(found).toStrictEqual({ form: FORM, kind: "cached", pasted: [], trailing: "" });
  });

  // The update verb sends nothing over an unchanged CRLF body, so the body stays CRLF: a cache miss here would
  // parse it and drop every ranked risk below the top one, which is the loss this hit prevents.
  it("keeps both ranked risk items over a CRLF body, which a parse would cut to one", () => {
    const fix = formOf({ body: FIX_BODY });
    const fixBody = unwrap(renderPrBody({ form: fix }));
    // The falsifier: parsed off the same CRLF body, only the top item survives.
    const parsed = recoverPrForm({ live: LIVE, liveBody: crlf({ text: fixBody }), number: NUMBER, record: undefined });
    expect(parsed).toEqual({
      form: { ...fix, ...LIVE, risk: { items: [P2_CHECKED] } },
      kind: "parsed",
      pasted: [],
      trailing: "",
    });
    const found = recoverPrForm({
      live: LIVE,
      liveBody: crlf({ text: fixBody }),
      number: NUMBER,
      record: record({ body: fixBody, form: fix, overrides: {} }),
    });
    expect(found).toStrictEqual({ form: { ...fix, ...LIVE }, kind: "cached", pasted: [], trailing: "" });
  });

  it("hits the cache over a CRLF body with an appended block, handing the block back with LF", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: crlf({ text: BODY + APPENDED }),
      number: NUMBER,
      record: record({ overrides: {} }),
    });
    expect(found).toStrictEqual({ form: FORM, kind: "cached", pasted: [], trailing: APPENDED });
  });

  it("hands the appended block back with its CRLF read as LF when it was parsed off the live body", () => {
    const found = recoverPrForm({
      live: LIVE,
      liveBody: crlf({ text: BODY + APPENDED }),
      number: NUMBER,
      record: undefined,
    });
    expect(found).toEqual({ form: FORM, kind: "parsed", pasted: [], trailing: APPENDED });
  });
});
