/**
 * The card address the shell loads for the voice: exactly one Queue or Alignment card, rebuilt parameter by
 * parameter, with the view choices the console window holds now.
 */
import { describe, expect, it } from "vitest";

import { consoleCardPathFromMessage, consoleCardPathOnConsole } from "../../src/consoleCardAddress";

// The voice puts a Queue card on your screen when you ask. Only the voice's window
// may ask, and only for exactly a card's address, so a page cannot steer the console window anywhere else.
describe("consoleCardPathFromMessage", () => {
  it("accepts a card's address from the voice's window, its view choices kept and re-encoded", () => {
    expect(
      consoleCardPathFromMessage({
        role: "overlay",
        value: "/queue?open=hand%3Areact-to-the-orb&context=work&rail=icons&tag=kind%3Aask&tag=from%3Afleet",
      }),
    ).toBe("/queue?open=hand%3Areact-to-the-orb&context=work&rail=icons&tag=kind%3Aask&tag=from%3Afleet&by=voice");
    expect(consoleCardPathFromMessage({ role: "overlay", value: "/queue?open=ask:a-slug" })).toBe(
      "/queue?open=ask%3Aa-slug&by=voice",
    );
  });

  it("marks every card it loads for the voice with exactly one by=voice, whether the renderer sent one or not", () => {
    expect(consoleCardPathFromMessage({ role: "overlay", value: "/queue?open=ask%3Aa&by=voice" })).toBe(
      "/queue?open=ask%3Aa&by=voice",
    );
    expect(consoleCardPathFromMessage({ role: "overlay", value: "/queue?by=voice&open=ask%3Aa" })).toBe(
      "/queue?by=voice&open=ask%3Aa",
    );
  });

  it("accepts every tag the Queue's own click link carries, past a page identity's 512", () => {
    const value = `/queue?open=hand%3Aaa${"&tag=kind%3Aask".repeat(33)}`;
    expect(value.length).toBe(516);
    expect(consoleCardPathFromMessage({ role: "overlay", value })).toBe(`${value}&by=voice`);
  });

  // A request at the bound, once marked, would load a page whose address the overlay cannot carry back.
  it("refuses an address the marker would take past 8192, and keeps one it leaves at exactly 8192", () => {
    const head = "/queue?open=ask%3Aa&tag=";
    const atBound = `${head}${"x".repeat(8192 - head.length - "&by=voice".length)}`;
    expect(consoleCardPathFromMessage({ role: "overlay", value: atBound })).toBe(`${atBound}&by=voice`);
    expect(consoleCardPathFromMessage({ role: "overlay", value: `${atBound}x` })).toBe(undefined);
  });

  // A `view` riding on the address is refused, so an open from a page with a
  // view chosen would fail. The console never sends one (`site/lib/openCard.ts` `cardPagePath`, whose test builds
  // this exact address from `/pull-requests?view=press&context=work&tag=kind%3Aask`), and the shell still refuses it.
  it("accepts the address the console builds from a page with a view, and still refuses one carrying the view", () => {
    expect(
      ["/queue?open=ask%3Asome-slug&context=work&tag=kind%3Aask&by=voice", "/queue?open=ask%3Aa&view=press"].map(
        (value) => consoleCardPathFromMessage({ role: "overlay", value }),
      ),
    ).toEqual(["/queue?open=ask%3Asome-slug&context=work&tag=kind%3Aask&by=voice", undefined]);
  });

  it("refuses the same address from the console window or an unknown sender", () => {
    expect(consoleCardPathFromMessage({ role: "main", value: "/queue?open=ask%3Aa" })).toBe(undefined);
    expect(consoleCardPathFromMessage({ role: undefined, value: "/queue?open=ask%3Aa" })).toBe(undefined);
  });

  it("refuses anything that is not exactly one card on the Queue or the Alignment page", () => {
    const refused = [
      undefined,
      1,
      "/queue",
      "/queue?",
      "/queue?open=",
      "/queue?open=%20",
      "/queue?open=ask%3Aa&open=ask%3Ab",
      "/queue?context=work",
      "/queue?open=ask%3Aa&context=work&context=slopweaver",
      "/queue?open=ask%3Aa&next=https%3A%2F%2Fevil.example",
      "/queue?open=ask%3Aa#frag",
      "/queue?open=ask a",
      "/queues?open=ask%3Aa",
      "/pull-requests?open=ask%3Aa",
      "/alignment",
      "/alignment?",
      "/alignment?open=act%3Aa&open=act%3Ab",
      "/alignment?open=act%3Aa&view=past",
      "/alignments?open=act%3Aa",
      "/alignment/x?open=act%3Aa",
      "//evil.example/queue?open=ask%3Aa",
      "https://evil.example/queue?open=ask%3Aa",
      "/queue\\?open=ask%3Aa",
      `/queue?open=${"a".repeat(8200)}`,
      "/queue?open=ask%3Aa&by=other",
      "/queue?open=ask%3Aa&by=voice&by=voice",
    ];
    expect(refused.map((value) => consoleCardPathFromMessage({ role: "overlay", value }))).toEqual(
      refused.map(() => undefined),
    );
  });
});

describe("consoleCardPathOnConsole", () => {
  const ORIGIN = "http://127.0.0.1:4321";
  const SENT = "/queue?open=hand%3Ax&context=work&rail=full&tag=kind%3Aask";

  it("keeps the card and takes the view choices the console window holds now, not the ones the voice last saw", () => {
    const liveUrl = `${ORIGIN}/fleet?context=work&rail=icons&tag=from%3Afleet&tag=kind%3Aask&sw-surface=native&x=1`;
    expect(consoleCardPathOnConsole({ liveUrl, path: SENT })).toBe(
      "/queue?open=hand%3Ax&context=work&rail=icons&tag=from%3Afleet&tag=kind%3Aask&by=voice",
    );
  });

  it("keeps the first context and sidebar and every tag, as the Queue's own click does", () => {
    const liveUrl = `${ORIGIN}/queue?context=work&context=slopweaver&rail=icons&rail=full&tag=a&tag=b`;
    expect(consoleCardPathOnConsole({ liveUrl, path: SENT })).toBe(
      "/queue?open=hand%3Ax&context=work&rail=icons&tag=a&tag=b&by=voice",
    );
  });

  it("drops a view choice the console window no longer holds", () => {
    expect(consoleCardPathOnConsole({ liveUrl: `${ORIGIN}/queue`, path: SENT })).toBe("/queue?open=hand%3Ax&by=voice");
  });

  it("copies only the three view choices, re-encoded, so a live address cannot widen what loads", () => {
    const liveUrl = `${ORIGIN}/queue?open=pr%3A9&rail=icons%26open%3Dx&next=%2F%2Fevil`;
    expect(consoleCardPathOnConsole({ liveUrl, path: SENT })).toBe(
      "/queue?open=hand%3Ax&rail=icons%26open%3Dx&by=voice",
    );
  });

  it("marks the card by=voice once, never taking a marker off the live address", () => {
    const liveUrl = `${ORIGIN}/queue?open=pr%3A9&by=voice&by=other`;
    expect(consoleCardPathOnConsole({ liveUrl, path: `${SENT}&by=voice` })).toBe("/queue?open=hand%3Ax&by=voice");
  });

  it("keeps the voice's address when the live view choices would take it past 8192", () => {
    const liveUrl = `${ORIGIN}/queue?tag=${"x".repeat(8200)}`;
    expect(consoleCardPathOnConsole({ liveUrl, path: `${SENT}&by=voice` })).toBe(`${SENT}&by=voice`);
  });

  it("keeps the voice's address when the console window is closed or on a holding page", () => {
    const off = [undefined, "data:text/html;charset=utf-8,holding", "not a url"];
    expect(off.map((liveUrl) => consoleCardPathOnConsole({ liveUrl, path: SENT }))).toEqual(off.map(() => SENT));
  });
});

// The voice is tested against every Alignment card too, which the shell must load.
describe("consoleCardPathFromMessage on the Alignment page", () => {
  it("accepts an act and a voice question from the voice's window, marked by=voice, its page kept", () => {
    expect(
      [
        "/alignment?open=act%3Aacme-act-1&context=work&tag=kind%3Aask",
        "/alignment?open=align%3Avoice-tagging&by=voice",
      ].map((value) => consoleCardPathFromMessage({ role: "overlay", value })),
    ).toEqual([
      "/alignment?open=act%3Aacme-act-1&context=work&tag=kind%3Aask&by=voice",
      "/alignment?open=align%3Avoice-tagging&by=voice",
    ]);
  });

  it("refuses it from the console window", () => {
    expect(consoleCardPathFromMessage({ role: "main", value: "/alignment?open=act%3Aa" })).toBe(undefined);
  });
});

describe("consoleCardPathOnConsole on the Alignment page", () => {
  it("keeps the Alignment page while taking the console window's live view choices", () => {
    expect(
      consoleCardPathOnConsole({
        liveUrl: "http://127.0.0.1:4321/queue?context=work&rail=icons&tag=from%3Afleet",
        path: "/alignment?open=act%3Aacme-act-1&by=voice",
      }),
    ).toBe("/alignment?open=act%3Aacme-act-1&context=work&rail=icons&tag=from%3Afleet&by=voice");
  });

  // The voice switches an act's address to the context that draws it; your live one would hide it.
  it("keeps the context the voice chose for an Alignment card over your live one, and the Queue's live one", () => {
    const liveUrl = "http://127.0.0.1:4321/queue?context=work&rail=icons";
    expect([
      consoleCardPathOnConsole({ liveUrl, path: "/alignment?open=act%3Aacme-act-2&context=slopweaver&by=voice" }),
      consoleCardPathOnConsole({ liveUrl, path: "/queue?open=ask%3Aa&context=slopweaver&by=voice" }),
    ]).toEqual([
      "/alignment?open=act%3Aacme-act-2&context=slopweaver&rail=icons&by=voice",
      "/queue?open=ask%3Aa&context=work&rail=icons&by=voice",
    ]);
  });
});
