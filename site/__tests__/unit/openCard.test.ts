/*
 * The voice opens the card it is about to talk about, or one the owner asks for, and never reopens the one the owner
 * has open: `read_card` resolves the card and hands every address back to read, moving nothing; `open_card`
 * resolves the same card before anything moves, then opens its panel, ONE linked page and its Slack thread.
 */
import { describe, expect, it } from "vitest";

import { type HandStep } from "../../components/live/read";
import { runOpenCard } from "../../components/voice/openCardRun";
import { slackScreenForCall } from "../../components/voice/slackScreenVerb";
import { cardLinksOf, cardPagePath, openCardPlan, queueCardPath } from "../../lib/openCard";
import { type BriefingCard, whatOf } from "../../lib/queueCard";
import type { QueueRow } from "../../lib/queueRows";
import type { RecentlyLeftCard } from "../../lib/recentQueueDepartures";
import { panelHref } from "../../lib/workContext";
import {
  BARE,
  handRows,
  LEFT,
  LIVE,
  ORB_BRIEFINGS,
  PAGE_ONE,
  PAGE_TWO,
  PR,
  REMOVAL,
  ROWS,
  recording,
  STEP,
  THREAD,
} from "./openCardFixture";

describe("cardLinksOf", () => {
  it("splits a card's links into its pages, its thread, and every address, pages first", () => {
    const links = cardLinksOf({ row: ROWS.find((row) => row.id === STEP.id)! });
    expect(links.pages).toEqual([
      { file: "/Users/someone/.slopweaver/pages/orb-mockup/index.html", slug: "orb-mockup", url: PAGE_ONE },
      { file: "/Users/someone/.slopweaver/pages/orb-notes/index.html", slug: "orb-notes", url: PAGE_TWO },
    ]);
    expect(links.threadUrl).toBe(THREAD);
    expect(links.addresses).toEqual([PAGE_ONE, PAGE_TWO, PR, THREAD]);
  });

  it("keeps a page whose address carries a stray percent, with no file path, rather than throwing", () => {
    const stray: HandStep = {
      ...BARE,
      id: "a-stray-percent",
      what: `See file:///tmp/%/pages/demo/index.html and ${THREAD}`,
    };
    const row = handRows({ steps: [stray] }).find((each) => each.id === stray.id)!;
    expect(cardLinksOf({ row })).toEqual({
      addresses: ["file:///tmp/%/pages/demo/index.html", THREAD],
      briefingFiles: new Map(),
      briefings: [],
      files: [],
      pages: [{ file: undefined, slug: "demo", url: "file:///tmp/%/pages/demo/index.html" }],
      threadUrl: THREAD,
    });
  });

  it("hands over the plan file a card's words place beside its folder, apart from its pages and addresses", () => {
    const tauri: HandStep = {
      ...BARE,
      id: "a-tauri-prototype",
      what: `Want to try it? Folder: ~/dev/acme-desktop-tauri (local git). Plan: PLAN.md in the folder. ${THREAD}`,
    };
    const row = handRows({ steps: [tauri] }).find((each) => each.id === tauri.id)!;
    expect(cardLinksOf({ row })).toEqual({
      addresses: [THREAD],
      briefingFiles: new Map(),
      briefings: [],
      files: ["~/dev/acme-desktop-tauri/PLAN.md"],
      pages: [],
      threadUrl: THREAD,
    });
  });

  // On the real briefing card the plan sentence sits below the fold, past what the card draws.
  it("hands over a plan file a briefing card's words name below its fold", () => {
    const what = whatOf({
      text:
        "Folder: ~/dev/acme-desktop-tauri (local git, nothing pushed). Run: npm run broker, then npm run app. " +
        "Built app: src-tauri/target/release/bundle/macos/acme.com, unsigned. " +
        "Tauri's updater reads latest.json from the GCS bucket. The endpoint reads GET /v1/people/{id}. " +
        "Plan: PLAN.md in the folder.",
    })!;
    const card = {
      commands: [],
      examples: undefined,
      ifSilent: undefined,
      kind: "briefing",
      lean: undefined,
      options: [],
      pages: [],
      problem: undefined,
      question: "The prototype is ready: do you want to try it?",
      stakes: undefined,
      subject: "a Tauri prototype",
      what,
    } as unknown as BriefingCard;
    const row: QueueRow = { ...handRows({ steps: [BARE] })[0], card };
    expect(what.aboveFold.includes("PLAN.md")).toBe(false);
    expect(cardLinksOf({ row }).files).toEqual(["~/dev/acme-desktop-tauri/PLAN.md"]);
  });

  it("carries nothing for a card that links nothing", () => {
    expect(cardLinksOf({ row: ROWS.find((row) => row.id === BARE.id)! })).toEqual({
      addresses: [],
      briefingFiles: new Map(),
      briefings: [],
      files: [],
      pages: [],
      threadUrl: undefined,
    });
  });

  it("names every briefing a card links, its file:// pages first, and the file each is read at", () => {
    const links = cardLinksOf({ row: ROWS.find((row) => row.id === STEP.id)! });
    expect(links.briefings).toEqual(["orb-mockup", "orb-notes"]);
    expect([...links.briefingFiles]).toEqual([
      ["orb-mockup", "/Users/someone/.slopweaver/pages/orb-mockup/index.html"],
      ["orb-notes", "/Users/someone/.slopweaver/pages/orb-notes/index.html"],
    ]);
  });

  // A post's inherited source quote is drawn as card prose, so it is searched too.
  it("names a briefing the card's source alone links", () => {
    const bare = ROWS.find((row) => row.id === BARE.id)!;
    const row: QueueRow = {
      ...bare,
      source: { ...bare.source, subject: "Read http://localhost:3000/api/page/plan/index.html first" },
    };
    expect([cardLinksOf({ row: bare }).briefings, cardLinksOf({ row }).briefings]).toEqual([[], ["plan"]]);
  });

  // A briefing named only by the console's route has no page at all; the Queue draws a chip for every briefing the
  // voice reads, and `open_card` opens it.
  it("names, draws and opens a briefing the card's words link only by the console's own page route", () => {
    const routed = "http://localhost:3000/api/page/consolidated-briefing/index.html";
    const consoleOnly: HandStep = {
      ...BARE,
      id: "a-console-route",
      what: `Briefing: ${routed}. Then 127.0.0.1 is not one.`,
    };
    const row = handRows({ steps: [consoleOnly] }).find((each) => each.id === consoleOnly.id)!;
    const links = cardLinksOf({ row });
    // Drawn as the relative route, so it opens on whichever port the console serves now, not the :3000 it was written on.
    const page = { file: undefined, slug: "consolidated-briefing", url: "/api/page/consolidated-briefing/index.html" };
    expect([links.pages, links.briefings]).toEqual([[page], ["consolidated-briefing"]]);
    expect(openCardPlan({ fromPath: "/queue", key: row.key, recentlyLeft: [], rows: [row] })!.firstPage).toEqual(page);
  });
});

describe("queueCardPath", () => {
  it("opens the card on the Queue from any page, keeping the context, sidebar and tags and dropping the rest", () => {
    expect(
      queueCardPath({
        fromPath: "/pull-requests?context=work&rail=icons&tag=kind%3Aask&tag=from%3Afleet&open=pr%3Aold&x=1",
        key: "hand:react-to-the-orb-mockup",
      }),
    ).toBe(
      "/queue?open=hand%3Areact-to-the-orb-mockup&context=work&rail=icons&tag=kind%3Aask&tag=from%3Afleet&by=voice",
    );
  });

  // The Pull requests page's and the Queue's own `view` ride onto the address, and the desktop shell refuses a card address carrying one
  // (`desktop/src/consoleCardAddress.ts` `consoleCardPathFromMessage`; its test holds this exact address accepted).
  it("drops a view from any page, so the desktop shell takes the address", () => {
    expect(
      [
        "/pull-requests?view=press&context=work&tag=kind%3Aask",
        "/queue?view=urgent&context=work&tag=kind%3Aask",
        "/fleet?context=work&view=past&tag=kind%3Aask",
      ].map((fromPath) => queueCardPath({ fromPath, key: "ask:some-slug" })),
    ).toEqual([
      "/queue?open=ask%3Asome-slug&context=work&tag=kind%3Aask&by=voice",
      "/queue?open=ask%3Asome-slug&context=work&tag=kind%3Aask&by=voice",
      "/queue?open=ask%3Asome-slug&context=work&tag=kind%3Aask&by=voice",
    ]);
  });

  it("opens the card on a bare address with nothing else but the voice's marker", () => {
    expect(queueCardPath({ fromPath: "/voice", key: "ask:some-slug" })).toBe("/queue?open=ask%3Asome-slug&by=voice");
  });

  it("carries one by=voice when the voice opens a card over one it already opened", () => {
    expect(queueCardPath({ fromPath: "/queue?open=ask%3Aa&by=voice&context=work", key: "ask:b" })).toBe(
      "/queue?open=ask%3Ab&context=work&by=voice",
    );
  });
});

describe("cardPagePath", () => {
  it("opens an Alignment card on the Alignment page with the same choices kept, and the Queue path unchanged", () => {
    const fromPath = "/queue?view=urgent&context=work&tag=kind%3Aask";
    expect([
      cardPagePath({ fromPath, key: "act:acme-act-1", pathname: "/alignment" }),
      cardPagePath({ fromPath, key: "ask:some-slug", pathname: "/queue" }),
    ]).toEqual([
      "/alignment?open=act%3Aacme-act-1&context=work&tag=kind%3Aask&by=voice",
      queueCardPath({ fromPath, key: "ask:some-slug" }),
    ]);
  });
});

describe("panelHref after the voice opened a card", () => {
  it("drops by=voice when the owner opens a row themselves, the same one included, or closes it, keeping their view", () => {
    const search = "?open=ask%3Aa&context=work&rail=icons&tag=kind%3Aask&by=voice";
    expect(
      [{ open: "ask:b" }, { open: "ask:a" }, { open: null }].map(({ open }) =>
        panelHref({ open, pathname: "/queue", search }),
      ),
    ).toEqual([
      "/queue?open=ask%3Ab&context=work&rail=icons&tag=kind%3Aask",
      "/queue?open=ask%3Aa&context=work&rail=icons&tag=kind%3Aask",
      "/queue?context=work&rail=icons&tag=kind%3Aask",
    ]);
  });
});

describe("openCardPlan", () => {
  it("resolves the key to its row, the panel's address and the one page opened beside it", () => {
    const plan = openCardPlan({
      fromPath: "/queue?context=slopweaver",
      key: "hand:react-to-the-orb-mockup",
      recentlyLeft: [],
      rows: ROWS,
    })!;
    expect(plan.row.id).toBe(STEP.id);
    expect(plan.path).toBe("/queue?open=hand%3Areact-to-the-orb-mockup&context=slopweaver&by=voice");
    expect(plan.firstPage!.slug).toBe("orb-mockup");
  });

  it("resolves nothing for a padded key, as the Queue's own ?open= would not", () => {
    expect(
      openCardPlan({ fromPath: "/queue", key: " hand:react-to-the-orb-mockup ", recentlyLeft: [], rows: ROWS }),
    ).toBe(undefined);
  });

  it("opens a row whose own key ends in whitespace by that exact key", () => {
    const padded: HandStep = { ...BARE, id: "x " };
    const plan = openCardPlan({
      fromPath: "/queue",
      key: "hand:x ",
      recentlyLeft: [],
      rows: handRows({ steps: [padded] }),
    })!;
    expect(plan.row.key).toBe("hand:x ");
    expect(plan.path).toBe("/queue?open=hand%3Ax+&by=voice");
  });

  it("resolves nothing for a key no row answers to", () => {
    expect(openCardPlan({ fromPath: "/queue", key: "hand:gone", recentlyLeft: [], rows: ROWS })).toBe(undefined);
  });

  // A card that left the owner's Queue is still found, marked removed.
  it("finds a card that recently left the Queue, marked removed, when no row on it answers", () => {
    const plan = openCardPlan({ fromPath: "/queue", key: "hand:a-bare-step", recentlyLeft: LEFT, rows: LIVE })!;
    expect(plan.row.id).toBe(BARE.id);
    expect(plan.removed).toEqual(REMOVAL);
  });

  it("resolves a key on the Queue to the live card before one that left, so a card back on it is never read as gone", () => {
    const plan = openCardPlan({ fromPath: "/queue", key: "hand:a-bare-step", recentlyLeft: LEFT, rows: ROWS })!;
    expect(plan.removed).toBe(undefined);
  });
});

describe("runOpenCard", () => {
  it("opens the panel, then the first page, then the thread, and answers with every address to read", async () => {
    const { seams, moves, presents } = recording({ moved: { kind: "opened" }, on: true });
    const ran = await runOpenCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams });
    expect(moves).toEqual(["/queue?open=hand%3Areact-to-the-orb-mockup&context=slopweaver&by=voice"]);
    expect(presents).toEqual([
      { args: { page: "orb-mockup" }, name: "browser_open" },
      { args: { url: THREAD }, name: "browser_open" },
    ]);
    expect(ran.refused).toBe(false);
    expect(ran.readText).toBe(true);
    expect(ran.detail).toBe(
      "hand:react-to-the-orb-mockup, card opened, page opened, thread opened, briefings 2/2 read whole",
    );
    expect(ran.walk).toEqual({ cardKey: "hand:react-to-the-orb-mockup", opened: true });
    const answer = ran.answer as { links: unknown; opened: unknown; card: { key: string }; briefings: unknown };
    expect(answer.card.key).toBe("hand:react-to-the-orb-mockup");
    expect(answer.briefings).toEqual(ORB_BRIEFINGS);
    expect(answer.opened).toEqual({
      card: { outcome: "opened" },
      page: { outcome: "opened", slug: "orb-mockup" },
      thread: { outcome: "opened" },
    });
    expect(answer.links).toEqual({
      addresses: [PAGE_ONE, PAGE_TWO, PR, THREAD],
      files: [],
      pages: [
        { file: "/Users/someone/.slopweaver/pages/orb-mockup/index.html", slug: "orb-mockup" },
        { file: "/Users/someone/.slopweaver/pages/orb-notes/index.html", slug: "orb-notes" },
      ],
      threadUrl: THREAD,
    });
  });

  it("still opens the page and thread when the console would not move, and names each refusal", async () => {
    const { seams, presents } = recording({
      moved: { kind: "refused", why: "this desktop app predates opening cards" },
      on: true,
      refuse: ["orb-mockup"],
    });
    const ran = await runOpenCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams });
    expect(presents.length).toBe(2);
    expect((ran.answer as { opened: unknown }).opened).toEqual({
      card: { outcome: "refused", why: "this desktop app predates opening cards" },
      page: { outcome: "refused", slug: "orb-mockup", why: "refused orb-mockup" },
      thread: { outcome: "opened" },
    });
    expect(ran.readText).toBe(true);
    // The call answers, so it is not refused — and the console window still hears what it failed to open, with the
    // resolved card's key for the toast's "Open in new tab".
    expect([ran.refused, ran.partialFailures]).toEqual([
      false,
      [
        { cardKey: "hand:react-to-the-orb-mockup", part: "card", why: "this desktop app predates opening cards" },
        { cardKey: "hand:react-to-the-orb-mockup", part: "page", why: "refused orb-mockup" },
      ],
    ]);
  });

  it("names no partial failure when every opening ran", async () => {
    const { seams } = recording({ moved: { kind: "opened" }, on: true });
    const ran = await runOpenCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams });
    expect(ran.partialFailures).toEqual([]);
  });

  it("reads a card the screen has not drawn and never moves the console to it", async () => {
    const why =
      "hand:react-to-the-orb-mockup is on the record, read just now, but the console on screen has not drawn it";
    const { seams, moves } = recording({
      moved: { kind: "opened" },
      on: true,
      undrawn: { "hand:react-to-the-orb-mockup": why },
    });
    const ran = await runOpenCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams });
    expect(moves).toEqual([]);
    expect((ran.answer as { opened: { card: unknown } }).opened.card).toEqual({ outcome: "skipped", why });
    expect([ran.refused, ran.walk]).toEqual([false, { cardKey: "hand:react-to-the-orb-mockup", opened: false }]);
  });

  it("opens nothing with the owner's switch off, and still answers with the card and its links", async () => {
    const { seams, moves, presents } = recording({ moved: { kind: "opened" }, on: false });
    const ran = await runOpenCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams });
    expect(moves).toEqual([]);
    expect(presents).toEqual([]);
    const skipped = { outcome: "skipped", why: "the owner's openCards switch is off" };
    expect((ran.answer as { opened: unknown }).opened).toEqual({
      card: skipped,
      page: { ...skipped, slug: "orb-mockup" },
      thread: skipped,
    });
    expect(ran.readText).toBe(true);
    // A skip is the owner's switch, not a failure.
    expect(ran.partialFailures).toEqual([]);
  });

  it("opens only the panel of a card that links nothing", async () => {
    const { seams, moves, presents } = recording({ moved: { kind: "opened" }, on: true });
    const ran = await runOpenCard({ args: { key: "hand:a-bare-step" }, seams });
    expect(moves).toEqual(["/queue?open=hand%3Aa-bare-step&context=slopweaver&by=voice"]);
    expect(presents).toEqual([]);
    expect(ran.detail).toBe("hand:a-bare-step, card opened, page none, thread none");
  });

  it("moves nothing for a key no card answers to, and names what has not loaded rather than saying none exists", async () => {
    const { seams, moves, presents } = recording({
      moved: { kind: "opened" },
      on: true,
      unread: [{ source: "the board", why: "still loading" }],
    });
    const ran = await runOpenCard({ args: { key: "ask:not-loaded-yet" }, seams });
    expect(moves).toEqual([]);
    expect(presents).toEqual([]);
    expect(ran.refused).toBe(true);
    expect(ran.readText).toBe(false);
    expect(ran.answer).toEqual({
      refused: "ask:not-loaded-yet is not among what has loaded; still unread: the board (still loading)",
    });
  });

  it("says no card answers to a key once every register has loaded", async () => {
    const { seams } = recording({ moved: { kind: "opened" }, on: true });
    const ran = await runOpenCard({ args: { key: "hand:gone" }, seams });
    expect(ran.answer).toEqual({
      refused: "no card on the owner's Queue or Alignment page, nor recently off it, answers to hand:gone",
    });
  });

  it("opens nothing for a card that left the owner's Queue, even with their switch on, and answers with it marked removed", async () => {
    const departed: readonly RecentlyLeftCard[] = [{ removed: REMOVAL, row: ROWS.find((row) => row.id === STEP.id)! }];
    const rows = ROWS.filter((row) => row.id !== STEP.id);
    const { seams, moves, presents } = recording({ moved: { kind: "opened" }, on: true, recentlyLeft: departed, rows });
    const ran = await runOpenCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams });
    expect([moves, presents]).toEqual([[], []]);
    expect([ran.refused, ran.readText, ran.detail]).toEqual([
      false,
      true,
      "hand:react-to-the-orb-mockup, off the owner's Queue, nothing opened, briefings 2/2 read whole",
    ]);
    const off = { outcome: "skipped", why: `hand:react-to-the-orb-mockup left the owner's Queue at ${REMOVAL.atIso}` };
    const answer = ran.answer as { opened: unknown; removed: unknown; briefings: unknown };
    expect(answer.opened).toEqual({ card: off, page: { ...off, slug: "orb-mockup" }, thread: off });
    expect(answer.briefings).toEqual(ORB_BRIEFINGS);
    expect(answer.removed).toEqual({ ...REMOVAL, onQueue: false });
    expect(ran.partialFailures).toEqual([]);
  });

  it("refuses a missing or blank key before reading a single row", async () => {
    const { seams, moves } = recording({ moved: { kind: "opened" }, on: true });
    const ran = await runOpenCard({ args: { key: "  " }, seams });
    expect(moves).toEqual([]);
    expect(ran.answer).toEqual({
      refused: "key must be the item's key from action_items or read_page, such as ask:<slug>",
    });
    expect(ran.readText).toBe(false);
    // Refused whole: the toast reads `refused`, so no opening is named beside it.
    expect([ran.refused, ran.partialFailures]).toEqual([true, []]);
  });

  // Opening the same Slack thread over and over is a defect: the thread is skipped once it is in front of the owner.
  it("skips a thread this call already put in front of the owner, naming why, with no failure toast", async () => {
    const { seams, presents } = recording({ moved: { kind: "opened" }, on: true });
    const { verb } = slackScreenForCall({ nowIso: () => "2026-10-06T07:54:22.000Z", verb: seams.verb });
    const guarded = { ...seams, verb };
    await runOpenCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams: guarded });
    const again = await runOpenCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams: guarded });
    expect(presents.filter((one) => one.args["url"] === THREAD).length).toBe(1);
    expect(again.detail).toBe(
      "hand:react-to-the-orb-mockup, card opened, page opened, thread skipped, briefings 2/2 read whole",
    );
    expect((again.answer as { opened: { thread: unknown } }).opened.thread).toEqual({
      outcome: "skipped",
      why:
        "that Slack thread is already on the owner's screen from earlier in this call, so nothing was opened again; walk them " +
        "through it (read it whole with slack_open if you have not), and never open it again",
    });
    expect(again.partialFailures).toEqual([]);
  });
});
