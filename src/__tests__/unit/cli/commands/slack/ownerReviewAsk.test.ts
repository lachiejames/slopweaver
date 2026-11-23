/**
 * The regression witness for the as-me REVIEW-ASK lane: the owner's own batch ask stays expressible, no override.
 *
 * The finding this holds down is that the as-me one-card lane could not express the owner's own review ask: the
 * ten-PR ask the owner APPROVED went out only under the voice-rules override, because the
 * composing session knew the `one-card` form (whose `maxLines` is 8) and the `--body` escape hatch (which
 * the paragraph-spacing rule refuses when its lines touch) and nothing else. The `one-list` form already
 * held the shape. So the property under test is not "a list validates" but "the owner's message, at the SHIPPED
 * defaults, needs nothing switched off" — and every bound is read from the shipped profile template rather
 * than restated here, so lowering one reddens this file instead of silently shrinking what the owner can send.
 *
 * The fixture is the message the owner SENT, read live off Slack (`C0SYN000006`/`1787942086.747699`): one lead
 * line carrying two mentions, ten bullets of PR link plus label, the last of them a scoped npm package.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { formSchemaFor } from "../../../../../cli/commands/slack/asMeForm.js";
import { unwrap } from "../../../../../lib/result.js";
import type { AsMeArtifact } from "../../../../../outbound/artifact/types.js";
import { renderDrip } from "../../../../../outbound/slack/dripRender.js";
import type { ResolvedMentions } from "../../../../../outbound/slack/render.js";
import { storedRenderIssues } from "../../../../../outbound/slack/renderCheck.js";
import { isParagraphDense } from "../../../../../outbound/voice/paragraphSpacing.js";
import { parseProfile } from "../../../../../profile.js";

/** The owner's ten pull requests, in the order they listed them, with the labels they wrote. */
const HIS_TEN: readonly { readonly number: number; readonly label: string; readonly scoped?: string }[] = [
  { label: "drop stale basic-ftp pin", number: 16304 },
  { label: "bump kysely", number: 16316 },
  { label: "bump js-yaml", number: 16317 },
  { label: "bump minimatch", number: 16318 },
  { label: "bump fast-uri", number: 16319 },
  { label: "bump brace-expansion", number: 16320 },
  { label: "bump protobufjs", number: 16321 },
  { label: "bump undici", number: 16322 },
  { label: "bump axios", number: 16324 },
  { label: "bump ", number: 16330, scoped: "@xmldom/xmldom" },
];

/** The two people the owner tagged, as identity-map keys resolved to the ids Slack stored on the message. */
const MENTIONS: ResolvedMentions = {
  groups: new Map(),
  people: new Map([
    ["jasper", "U0SYN000006"],
    ["rosa", "U0SYN000002"],
  ]),
};

/** One bullet: the PR as a typed link, then the label the owner wrote after it. */
function bulletFor({ number, label, scoped }: { number: number; label: string; scoped?: string }): unknown {
  const link = {
    label: `#${String(number)}`,
    type: "link",
    url: `https://github.com/acme/acme-admin/pull/${String(number)}`,
  };
  const prose = { text: ` ${label}`, type: "text" };
  return scoped === undefined ? [link, prose] : [link, prose, { text: scoped, type: "text" }];
}

/** The owner's message as the form a composer would fill today. */
function ownerAsk(): unknown {
  return {
    bullets: HIS_TEN.map((row) => bulletFor(row)),
    kind: "one-list",
    lead: [
      { person: "jasper", type: "mention" },
      { text: " ", type: "text" },
      { person: "rosa", type: "mention" },
      { text: " could you review the security dependency bump PRs below?", type: "text" },
    ],
    trailing: [],
  };
}

/** The as-me bounds the SHIPPED template hands an operator who has configured nothing. */
function shippedBounds(): {
  cardVisibleMax: number;
  maxBullets: number;
  maxLines: number;
  maxMessages: number;
  messageVisibleMax: number;
} {
  const template: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../../../templates/profile.template.json", import.meta.url)), "utf8"),
  );
  const { drip } = unwrap(parseProfile({ value: template })).slackMe;
  return {
    cardVisibleMax: drip.cardVisibleMax,
    maxBullets: drip.maxBullets,
    maxLines: drip.maxLines,
    maxMessages: drip.maxMessages,
    messageVisibleMax: drip.messageVisibleMax,
  };
}

/**
 * The bullets of a parsed artifact, THROWING on any other kind rather than narrowing inside an assertion.
 *
 * `testing.md` bans a conditional in an assertion, and `artifact.kind === "one-list" ? … : 0` is one: it
 * passes for a `one-card` parse as readily as for the shape under test. Throwing here is the same move
 * `unwrap` makes on a `Result` — the failure names what it actually got.
 */
function bulletsOf({ artifact }: { artifact: AsMeArtifact }): readonly unknown[] {
  if (artifact.kind !== "one-list") {
    throw new Error(`expected a one-list artifact, got ${artifact.kind}`);
  }
  return artifact.bullets;
}

describe("the owner's own review ask, at the shipped defaults", () => {
  it("has ten dot points, which is exactly what the shipped maxBullets allows", () => {
    expect(HIS_TEN.length).toBe(10);
    expect(shippedBounds().maxBullets).toBe(HIS_TEN.length);
  });

  it("is reachable through the --form door as a one-list, and keeps every bullet", () => {
    const parsed = formSchemaFor({ config: shippedBounds(), raw: ownerAsk() }).safeParse(ownerAsk());

    expect(parsed.success).toBe(true);
    const artifact = parsed.data!;
    expect(artifact.kind).toBe("one-list");
    expect(bulletsOf({ artifact }).length).toBe(10);
  });

  it("does NOT fit the one-card form, which is the finding the list form answers", () => {
    const asCard = {
      kind: "one-card",
      lines: [{ runs: [{ text: "x", type: "text" }] }].concat(
        HIS_TEN.map(() => ({ runs: [{ text: "one pull request", type: "text" }] })),
      ),
    };
    const parsed = formSchemaFor({ config: shippedBounds(), raw: asCard }).safeParse(asCard);

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toContain("lines");
    expect(JSON.stringify(parsed.error!.issues)).toContain(String(shippedBounds().maxLines));
  });

  it("tells a composer who overflowed a CARD to reach for the list, not the override", () => {
    const asCard = {
      kind: "one-card",
      lines: HIS_TEN.concat(HIS_TEN).map(() => ({ runs: [{ text: "one pull request", type: "text" }] })),
    };
    const parsed = formSchemaFor({ config: shippedBounds(), raw: asCard }).safeParse(asCard);
    const [issue] = parsed.error!.issues;

    expect(issue!.message).toContain('{"kind":"one-list"}');
    expect(issue!.message).toContain("never a voice-rules grant");
  });

  it("tells a composer who overflowed the LIST to change the profile, not the override", () => {
    const eleven = { ...(ownerAsk() as Record<string, unknown>) };
    eleven["bullets"] = HIS_TEN.concat(HIS_TEN).map((row) => bulletFor(row));
    const parsed = formSchemaFor({ config: shippedBounds(), raw: eleven }).safeParse(eleven);
    const [issue] = parsed.error!.issues;

    expect(issue!.message).toContain("slackMe.drip.maxBullets");
    expect(issue!.message).toContain("never a voice-rules grant");
  });

  it("renders as ONE message whose paragraphs breathe, so the spacing gate never fires", () => {
    const artifact = formSchemaFor({ config: shippedBounds(), raw: ownerAsk() }).parse(ownerAsk());
    const payloads = renderDrip({ artifact, mentions: MENTIONS });

    expect(payloads.length).toBe(1);
    expect(isParagraphDense({ text: payloads[0]!.text })).toBe(false);
  });

  it("carries both of the owner's mentions and every pull request into the rendered text", () => {
    const artifact = formSchemaFor({ config: shippedBounds(), raw: ownerAsk() }).parse(ownerAsk());
    const [payload] = renderDrip({ artifact, mentions: MENTIONS });

    expect(payload!.text).toContain("<@U0SYN000006>");
    expect(payload!.text).toContain("<@U0SYN000002>");
    expect(HIS_TEN.filter((row) => !payload!.text.includes(`#${String(row.number)}`))).toEqual([]);
  });

  it("shows a reader nothing wrong, scoped npm package included", () => {
    const artifact = formSchemaFor({ config: shippedBounds(), raw: ownerAsk() }).parse(ownerAsk());
    const [payload] = renderDrip({ artifact, mentions: MENTIONS });
    const blocks = payload!.form === "rich" ? payload!.blocks : [];

    expect(JSON.stringify(blocks)).toContain("@xmldom/xmldom");
    expect(storedRenderIssues({ blocks })).toEqual([]);
  });

  it("still reports a bare handle a composer typed as prose, so the check is not simply off", () => {
    const withHandle = {
      ...(ownerAsk() as Record<string, unknown>),
      trailing: [[{ text: "cc @jonah-example", type: "text" }]],
    };
    const artifact = formSchemaFor({ config: shippedBounds(), raw: withHandle }).parse(withHandle);
    const [payload] = renderDrip({ artifact, mentions: MENTIONS });
    const issues = storedRenderIssues({ blocks: payload!.form === "rich" ? payload!.blocks : [] });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain('"@jonah-example"');
  });
});
