/**
 * The Datadog screenshot floor on the as-me lane: a send counts the pictures among the very bytes it will attach,
 * and a recording counts what admission returned. Real PNGs minted by Jimp, so the decode is the real one.
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  admittedDatadogMediaRefusals,
  asMeDatadogMediaFloor,
} from "../../../../../cli/commands/slack/datadogMediaFloor.js";
import type { SlackUpload } from "../../../../../corpus/slack/writeTransport.js";
import { grantedEnv, grantSessionEnv } from "../../../../hatchGrantFixture.js";

/** The journalled register row that waives the Datadog screenshot floor. */
const UNSHOWN_GRAPHS_HATCH = "unshown-graphs";

const CITING = { messages: [{ runs: [{ label: "the logs", type: "link", url: "https://ap1.datadoghq.com/logs" }] }] };
const PLAIN = { messages: [{ runs: [{ text: "the pool exhausted at 09:12", type: "text" }] }] };
const PDF: SlackUpload = { bytes: new TextEncoder().encode("%PDF-1.7\n%\n1 0 obj\n<<>>\nendobj\n"), filename: "a.pdf" };

/** One solid-colour PNG. */
async function png({ name }: { name: string }): Promise<SlackUpload> {
  const image = new Jimp({ color: 0xff0000ff, height: 8, width: 8 });
  return { bytes: new Uint8Array(await image.getBuffer("image/png")), filename: name };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dd-media-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("asMeDatadogMediaFloor", () => {
  it("reads nothing for a message citing no Datadog page", async () => {
    const reads: string[] = [];
    const floor = await asMeDatadogMediaFloor({
      artifact: PLAIN,
      env: {},
      home,
      paths: ["/m/a.png"],
      readMedia: async ({ path }) => {
        reads.push(path);
        return png({ name: path });
      },
    });
    expect(floor).toEqual({ refusals: [], uploads: undefined });
    expect(reads).toEqual([]);
  });

  it("admits a citation carrying one picture and hands back the bytes it counted, keyed by path", async () => {
    const picture = await png({ name: "a.png" });
    const floor = await asMeDatadogMediaFloor({
      artifact: CITING,
      env: {},
      home,
      paths: ["/m/a.png"],
      readMedia: async () => picture,
    });
    expect(floor.refusals).toEqual([]);
    expect([...floor.uploads!.entries()]).toEqual([["/m/a.png", picture]]);
  });

  it("refuses a citation whose only attachment is a PDF, naming the hatch", async () => {
    const floor = await asMeDatadogMediaFloor({
      artifact: CITING,
      env: {},
      home,
      paths: ["/m/a.pdf"],
      readMedia: async () => PDF,
    });
    expect(floor.refusals).toHaveLength(2);
    expect(floor.refusals[0]).toContain("media: this message cites Datadog (https://ap1.datadoghq.com/logs)");
    expect(floor.refusals[0]).toContain("pass it as `--media`");
    expect(floor.refusals[1]).toBe(
      'For one deliberate exception open the journalled hatch: `slopweaver hatch open unshown-graphs --reason "<why>"`.',
    );
  });

  it("refuses a plain --body citing Datadog with no media, since the ruling names every draft", async () => {
    const floor = await asMeDatadogMediaFloor({
      artifact: { kind: "plain", text: "Logs: https://app.datadoghq.com/logs" },
      env: {},
      home,
      paths: [],
      readMedia: async () => PDF,
    });
    expect(floor.refusals[0]).toContain("media: this message cites Datadog (https://app.datadoghq.com/logs)");
  });

  it("is waived by a live unshown-graphs grant", async () => {
    const floor = await asMeDatadogMediaFloor({
      artifact: CITING,
      env: grantedEnv({ hatchIds: [UNSHOWN_GRAPHS_HATCH], home }),
      home,
      paths: [],
      readMedia: async () => PDF,
    });
    expect(floor.refusals).toEqual([]);
  });

  it("is NOT waived by the retired unshown-graphs variable, which opens nothing", async () => {
    const floor = await asMeDatadogMediaFloor({
      artifact: CITING,
      env: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_UNSHOWN_GRAPHS: "1" },
      home,
      paths: [],
      readMedia: async () => PDF,
    });
    expect(floor.refusals).toHaveLength(2);
    expect(floor.refusals[0]).toContain("media: this message cites Datadog (https://ap1.datadoghq.com/logs)");
  });
});

describe("admittedDatadogMediaRefusals", () => {
  it("refuses a recording citing Datadog with no media at all", async () => {
    const lines = await admittedDatadogMediaRefusals({ artifact: CITING, env: {}, home, uploads: [] });
    expect(lines[0]).toContain("attaches no picture");
  });

  it("admits a recording carrying a picture, and one citing nothing", async () => {
    const picture = await png({ name: "a.png" });
    expect(await admittedDatadogMediaRefusals({ artifact: CITING, env: {}, home, uploads: [picture] })).toEqual([]);
    expect(await admittedDatadogMediaRefusals({ artifact: PLAIN, env: {}, home, uploads: [] })).toEqual([]);
  });
});
