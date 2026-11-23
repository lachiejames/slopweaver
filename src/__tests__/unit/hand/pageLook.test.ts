import { describe, expect, it } from "vitest";

import { lookAddress, pageLookProblem, readPageLook } from "../../../hand/pageLook.js";

const PAGE = "http://localhost:3000/api/page/talk-stage-looks/index.html";

describe("lookAddress", () => {
  it("looks at the document a console viewer address frames, not the viewer's own bar", () => {
    const viewer = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Ftalk-stage-looks%2Findex.html&back=%2Fqueue";
    expect(lookAddress({ url: viewer })).toBe(PAGE);
  });

  it("looks at any other address as given", () => {
    expect(lookAddress({ url: PAGE })).toBe(PAGE);
    expect(lookAddress({ url: "https://github.com/lachiejames/slopweaver/pull/1919" })).toBe(
      "https://github.com/lachiejames/slopweaver/pull/1919",
    );
  });

  it("leaves a viewer address whose src is not a same-origin path to the viewer", () => {
    const offsite = "http://localhost:3000/view?src=%2F%2Fevil.example%2Fx";
    const absolute = "http://localhost:3000/view?src=https%3A%2F%2Fevil.example%2Fx";
    const bare = "http://localhost:3000/view?back=%2Fqueue";
    expect(lookAddress({ url: offsite })).toBe(offsite);
    expect(lookAddress({ url: absolute })).toBe(absolute);
    expect(lookAddress({ url: bare })).toBe(bare);
  });
});

describe("readPageLook", () => {
  it("reads the probe's own shape", () => {
    expect(readPageLook({ value: { href: PAGE, media: 2, status: 200, textChars: 512 } })).toEqual({
      href: PAGE,
      media: 2,
      status: 200,
      textChars: 512,
    });
  });

  it("refuses a reply that is not the probe's shape", () => {
    expect(readPageLook({ value: "ok" })).toBe(undefined);
    expect(readPageLook({ value: { href: PAGE, media: 0, status: "200", textChars: 1 } })).toBe(undefined);
    expect(readPageLook({ value: { href: PAGE, media: -1, status: 200, textChars: 1 } })).toBe(undefined);
    expect(readPageLook({ value: { href: PAGE, media: 0, status: 200, textChars: 1.5 } })).toBe(undefined);
  });
});

describe("pageLookProblem", () => {
  it("passes a page that drew text, and one that drew only a picture", () => {
    expect(pageLookProblem({ reading: { href: PAGE, media: 0, status: 200, textChars: 40 } })).toBe(undefined);
    expect(pageLookProblem({ reading: { href: PAGE, media: 1, status: 200, textChars: 0 } })).toBe(undefined);
  });

  it("passes a page whose status the browser did not expose, when it draws something", () => {
    expect(pageLookProblem({ reading: { href: PAGE, media: 0, status: 0, textChars: 12 } })).toBe(undefined);
  });

  it("refuses the console's own 404, though its body carries one line of text", () => {
    expect(pageLookProblem({ reading: { href: PAGE, media: 0, status: 404, textChars: 60 } })).toBe(
      `answered HTTP 404 at ${PAGE}`,
    );
  });

  it("refuses a page Chrome could not load", () => {
    const reading = { href: "chrome-error://chromewebdata/", media: 0, status: 0, textChars: 300 };
    expect(pageLookProblem({ reading })).toBe("did not load — the browser landed on chrome-error://chromewebdata/");
  });

  it("refuses a page that draws nothing", () => {
    expect(pageLookProblem({ reading: { href: PAGE, media: 0, status: 200, textChars: 0 } })).toBe(
      `is empty at ${PAGE} — no text and no picture`,
    );
  });
});
