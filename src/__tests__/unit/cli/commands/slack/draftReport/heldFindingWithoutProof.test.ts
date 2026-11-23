/*
 * A held finding without its proof: listed as no-proof naming what it lacks, marked in the Queue's document,
 * and never marked once it is resolved.
 */
import { describe, expect, it } from "vitest";

import { draftListDocument } from "../../../../../../cli/commands/slack/draftListDocument.js";
import { draftListRow } from "../../../../../../cli/commands/slack/draftReport.js";
import type { DraftMediaOf } from "../../../../../../outbound/slack/draftProof.js";
import { annotatedRecord } from "../../../../../annotatedShotFixture.js";
import { item, NO_MEDIA, picture, SHOT_DIGEST } from "./harness.js";

describe("a held finding without its proof", () => {
  const finding = {
    form: '{"kind":"one-card","problem":{"kind":"possible","affects":"many"}}',
    kind: "finding",
  } as const;
  const proved = {
    ...finding,
    impact: "12 users could not check out",
    media: [{ bytes: 1, name: "pool.png", sha256: "0".repeat(64) }],
    payload: {
      form: "plain",
      text: "12 users could not check out\n<https://grafana.example.com/d/pool|the pool>",
      unfurl_links: false,
      unfurl_media: false,
    },
  } as const;

  it("lists it as no-proof, naming what it lacks, never as held", () => {
    const row = draftListRow({ item: item({ over: finding }), media: [] });
    expect(row).toContain("no-proof");
    // The fixture is also a first message in a channel, so the annotation a first message owes is named beside the finding's.
    expect(row).toContain("NO PROOF: screenshot, link, annotation, impact.");
  });

  it("marks it in the Queue's document, and leaves a finding bringing its proof unmarked", () => {
    const bare = item({ over: finding });
    const whole = item({ over: { ...proved, id: "sd-22222222" } });
    const mediaOf: DraftMediaOf = ({ item: one }) =>
      one.id === whole.id ? picture({ records: [annotatedRecord({ digest: SHOT_DIGEST })] }) : [];
    const document = draftListDocument({ items: [bare, whole], mediaOf, people: [] });
    expect(document.items.map((row) => row.proofMissing)).toEqual([
      ["screenshot", "link", "annotation", "impact"],
      undefined,
    ]);
    expect(draftListRow({ item: whole, media: mediaOf({ item: whole }) })).not.toContain("no-proof");
  });

  it("never marks a resolved row: only a held one would reach the owner's Queue", () => {
    const dropped = item({ over: finding, state: "dropped" });
    expect(draftListDocument({ items: [dropped], mediaOf: NO_MEDIA, people: [] }).items[0]!.proofMissing).toBe(
      undefined,
    );
  });
});
