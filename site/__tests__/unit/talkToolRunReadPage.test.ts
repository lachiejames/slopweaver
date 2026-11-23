/**
 * `read_page` through the tool runner: a call naming any of a read on's fields is a read on, so one missing `from` is
 * refused rather than read afresh — a fresh read carrying an old window's `reading` would close that window's cut in
 * the coverage hold.
 */
import { describe, expect, it } from "vitest";

import { runTalkTool } from "../../components/voice/talkToolRun";
import type { ToolRan, ToolSeams } from "../../components/voice/talkToolRunTypes";
import type { BriefingRead } from "../../lib/briefingRead";
import type { PageView } from "../../lib/pageVoice";
import { publishedPageReference } from "../../lib/publishedPageVoice";
import { seams, TOKEN } from "../talkToolSeams";

const ON_QUEUE: ToolSeams = {
  ...seams({ relayed: { answer: undefined, detail: "", refused: false } }),
  view: () => ({ open: undefined, openBy: undefined, path: "/queue", shows: undefined, title: "Queue" }),
};

const NAMES_ITS_WINDOW =
  "a read on names the window it continues: path, reading and from, exactly as the cut read gave them";

describe("runTalkTool, read_page", () => {
  it("refuses a call naming a path or a reading but no from, rather than reading the page afresh", async () => {
    const pathOnly = await runTalkTool({
      answerId: undefined,
      name: "read_page",
      rawArguments: JSON.stringify({ path: "/queue" }),
      requestId: TOKEN,
      seams: ON_QUEUE,
    });
    const readingOnly = await runTalkTool({
      answerId: undefined,
      name: "read_page",
      rawArguments: JSON.stringify({ path: "/queue", reading: "a-1" }),
      requestId: TOKEN,
      seams: ON_QUEUE,
    });
    expect([pathOnly.refused, pathOnly.answer]).toEqual([true, { refused: NAMES_ITS_WINDOW }]);
    expect([readingOnly.refused, readingOnly.answer]).toEqual([true, { refused: NAMES_ITS_WINDOW }]);
  });

  it("reads the page afresh when the call names none of them", async () => {
    const fresh = await runTalkTool({
      answerId: undefined,
      name: "read_page",
      rawArguments: "{}",
      requestId: TOKEN,
      seams: ON_QUEUE,
    });
    expect([fresh.refused, fresh.detail]).toEqual([false, "Queue"]);
  });
});

describe("runTalkTool, read_page on a published page in the viewer", () => {
  const SLUG = "acme-briefing";
  const PATH = `/home/pages/${SLUG}/index.html`;

  /** A viewer whose page reads as each text in turn, one per read. */
  const viewerReading = ({ texts }: { texts: readonly string[] }): { seams: ToolSeams; asked: string[] } => {
    const asked: string[] = [];
    const readBriefing = async ({ slug }: { readonly slug: string }): Promise<BriefingRead> => {
      asked.push(slug);
      const text = texts[Math.min(asked.length, texts.length) - 1];
      return { masked: false, nextFrom: null, ok: true, path: PATH, text, whole: true };
    };
    const view = (): PageView => ({
      open: undefined,
      openBy: undefined,
      path: "/view",
      shows: publishedPageReference({ slug: SLUG }),
      title: "Acme briefing",
    });
    return { asked, seams: { ...ON_QUEUE, readBriefing, view } };
  };

  const readPage = async ({ seams: given, args }: { seams: ToolSeams; args: object }): Promise<ToolRan> =>
    runTalkTool({
      answerId: undefined,
      name: "read_page",
      rawArguments: JSON.stringify(args),
      requestId: TOKEN,
      seams: given,
    });

  it("answers with the page's words as they stand at each read, never the first read's", async () => {
    const { asked, seams: given } = viewerReading({ texts: ["the first cut", "the second cut"] });
    const first = await readPage({ args: {}, seams: given });
    const second = await readPage({ args: {}, seams: given });
    const words = ({ ran }: { ran: ToolRan }): unknown =>
      JSON.parse(JSON.stringify(ran.answer)).shows.publishedPage.text;
    expect(asked).toEqual([SLUG, SLUG]);
    expect([words({ ran: first }), words({ ran: second })]).toEqual(["the first cut", "the second cut"]);
  });

  it("reads a long page on in windows, and refuses the read on once the page was republished", async () => {
    const long = "word ".repeat(8000);
    const { seams: given } = viewerReading({ texts: [long, long, `${long}more`] });
    const cut: { nextFrom: number; reading: string; path: string } = JSON.parse(
      JSON.stringify((await readPage({ args: {}, seams: given })).answer),
    );
    const on = await readPage({ args: { from: cut.nextFrom, path: cut.path, reading: cut.reading }, seams: given });
    const moved = await readPage({ args: { from: cut.nextFrom, path: cut.path, reading: cut.reading }, seams: given });
    expect(cut.nextFrom).toBeGreaterThan(0);
    expect(on.refused).toBe(false);
    expect(moved.refused).toBe(true);
  });
});
