/**
 * The screenshot floor a bot `finding` card owes at `slack post`: three DISTINCT pictures, counted by digest over
 * the bytes the send attaches, with real PNGs minted by Jimp so the decode is the real one.
 *
 * Every Datadog host in this file reads a synthetic site (`ap1`, and `us3` for the foreign one) rather than the
 * install's own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findingMediaFloor,
  findingMediaRefusals,
  imageDigestsOf,
} from "../../../../../cli/commands/slack/findingMedia.js";
import type { SlackUpload } from "../../../../../corpus/slack/writeTransport.js";
import { unwrap } from "../../../../../lib/result.js";
import { BOT_FORM_KINDS } from "../../../../../outbound/artifact/botFormKinds.js";
import { parseFindingForm, parseUpdateForm } from "../../../../../outbound/artifact/botFormLanes.js";
import type { SlackBotArtifact } from "../../../../../outbound/artifact/types.js";
import { grantedEnv, grantSessionEnv } from "../../../../hatchGrantFixture.js";

/** One solid-colour PNG, distinct per colour. */
async function png({ color, name }: { color: number; name: string }): Promise<SlackUpload> {
  const image = new Jimp({ color, height: 8, width: 8 });
  return { bytes: new Uint8Array(await image.getBuffer("image/png")), filename: name };
}

const PDF: SlackUpload = { bytes: new TextEncoder().encode("%PDF-1.7\n%\n1 0 obj\n<<>>\nendobj\n"), filename: "a.pdf" };

const finding = unwrap(
  parseFindingForm({ raw: BOT_FORM_KINDS.find((entry) => entry.kind === "finding")!.fixtures[0] }),
).artifact;

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "finding-media-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("imageDigestsOf", () => {
  it("digests every picture and skips a document", async () => {
    const red = await png({ color: 0xff0000ff, name: "red.png" });
    const digests = await imageDigestsOf({ uploads: [red, PDF, red] });
    expect(digests).toHaveLength(2);
    expect(digests[0]).toBe(digests[1]);
  });
});

describe("findingMediaRefusals", () => {
  it("admits three distinct pictures", async () => {
    const uploads = [
      await png({ color: 0xff0000ff, name: "a.png" }),
      await png({ color: 0x00ff00ff, name: "b.png" }),
      await png({ color: 0x0000ffff, name: "c.png" }),
    ];
    expect(await findingMediaRefusals({ artifact: finding, env: {}, formKind: "finding", home, uploads })).toEqual([]);
  });

  it("refuses the same picture under three names, naming the count and the graph", async () => {
    const red = await png({ color: 0xff0000ff, name: "a.png" });
    const uploads = [red, { ...red, filename: "b.png" }, { ...red, filename: "c.png" }];
    const lines = await findingMediaRefusals({ artifact: finding, env: {}, formKind: "finding", home, uploads });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("attaches 1 distinct picture(s); a finding carries at least 3");
    expect(lines[0]).toContain("https://us3.datadoghq.com/apm/traces?query=");
  });

  it("refuses three PDFs, which are no pictures at all", async () => {
    const lines = await findingMediaRefusals({
      artifact: finding,
      env: {},
      formKind: "finding",
      home,
      uploads: [PDF, PDF, PDF],
    });
    expect(lines[0]).toContain("attaches 0 distinct picture(s)");
  });

  it("refuses no media at all", async () => {
    const lines = await findingMediaRefusals({ artifact: finding, env: {}, formKind: "finding", home, uploads: [] });
    expect(lines[0]).toContain("attaches 0 distinct picture(s)");
  });

  it("waives the floor when a live unshown-graphs grant is held", async () => {
    const env = grantedEnv({ hatchIds: ["unshown-graphs"], home });
    expect(await findingMediaRefusals({ artifact: finding, env, formKind: "finding", home, uploads: [] })).toEqual([]);
  });

  it("does not waive the floor for the retired unshown-graphs variable, which opens nothing", async () => {
    const env = { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_UNSHOWN_GRAPHS: "1" };
    const lines = await findingMediaRefusals({ artifact: finding, env, formKind: "finding", home, uploads: [] });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("attaches 0 distinct picture(s)");
  });

  it("asks nothing of any other form kind", async () => {
    expect(await findingMediaRefusals({ artifact: finding, env: {}, formKind: "update", home, uploads: [] })).toEqual(
      [],
    );
  });
});

const updateFixture = BOT_FORM_KINDS.find((entry) => entry.kind === "update")!.fixtures[0] as Record<string, unknown>;

/** The registry's update card with its primary link pointed at `url`. */
function updateCiting({ url }: { url: string }): SlackBotArtifact {
  return unwrap(parseUpdateForm({ raw: { ...updateFixture, primaryLink: { label: "the logs", url } } })).artifact;
}

const DATADOG_LOGS = "https://ap1.datadoghq.com/logs?query=service%3Aapi";

describe("findingMediaFloor on a composed card citing Datadog", () => {
  it("refuses an update card with no picture, naming --media", async () => {
    const floor = await findingMediaFloor({
      admitted: { artifact: updateCiting({ url: DATADOG_LOGS }), formKind: "update" },
      deps: { readMedia: async () => PDF },
      env: {},
      options: { home, idempotencyKey: undefined, media: ["/m/a.pdf"] },
    });
    expect(floor.refusals[0]).toContain(`media: this message cites Datadog (${DATADOG_LOGS})`);
    expect(floor.refusals[0]).toContain("pass it as `--media`");
    expect(floor.uploads).toEqual([PDF]);
  });

  it("admits an update card carrying one picture and hands its bytes to the send", async () => {
    const red = await png({ color: 0xff0000ff, name: "a.png" });
    const floor = await findingMediaFloor({
      admitted: { artifact: updateCiting({ url: DATADOG_LOGS }), formKind: "update" },
      deps: { readMedia: async () => red },
      env: {},
      options: { home, idempotencyKey: undefined, media: ["/m/a.png"] },
    });
    expect(floor).toEqual({ refusals: [], uploads: [red] });
  });

  it("still refuses a card sent under a delivery id that is not a recipe slot's", async () => {
    const floor = await findingMediaFloor({
      admitted: { artifact: updateCiting({ url: DATADOG_LOGS }), formKind: "update" },
      deps: { readMedia: async () => PDF },
      env: {},
      options: { home, idempotencyKey: "manual-retry-1", media: [] },
    });
    expect(floor.refusals[0]).toContain(`media: this message cites Datadog (${DATADOG_LOGS})`);
  });

  it("reads nothing for a card citing no Datadog page, or a scheduled firing", async () => {
    const reads: string[] = [];
    const deps = {
      readMedia: async ({ path }: { path: string }) => {
        reads.push(path);
        return PDF;
      },
    };
    const plain = await findingMediaFloor({
      admitted: { artifact: updateCiting({ url: "https://example.invalid/pr/1" }), formKind: "update" },
      deps,
      env: {},
      options: { home, idempotencyKey: undefined, media: ["/m/a.pdf"] },
    });
    const scheduled = await findingMediaFloor({
      admitted: { artifact: updateCiting({ url: DATADOG_LOGS }), formKind: "update" },
      deps,
      env: {},
      options: { home, idempotencyKey: "recipe-slot:daily-digest:2026-10-08", media: [] },
    });
    expect(plain).toEqual({ refusals: [], uploads: undefined });
    expect(scheduled).toEqual({ refusals: [], uploads: undefined });
    expect(reads).toEqual([]);
  });
});
