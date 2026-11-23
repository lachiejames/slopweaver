/** A page's weight with every `data:` URI removed: what is cut, what is kept, and how bytes are counted. */
import { describe, expect, it } from "vitest";

import { pageTextBytes } from "../../../briefing/pageBudget.js";

describe("pageTextBytes", () => {
  it("counts a page with no data: URI whole", () => {
    expect(pageTextBytes({ html: "<p>hello</p>" })).toBe(12);
  });

  it("cuts a data: URI's header and its whole base64 run, keeping the markup around it", () => {
    expect(pageTextBytes({ html: '<img src="data:image/png;base64,QUJD==">' })).toBe(12);
  });

  it("cuts every data: URI on the page, adjacent ones included", () => {
    expect(pageTextBytes({ html: 'data:image/png;base64,QUJD"data:font/woff2;base64,AAAA|' })).toBe(2);
  });

  it("lets a run with no separator after it swallow the next header's letters, exactly as the alphabet says", () => {
    expect(pageTextBytes({ html: "data:image/png;base64,QUJDdata:font/woff2;base64,AAAA|" })).toBe(24);
  });

  it("cuts a `=` anywhere in the run, not only as trailing padding", () => {
    expect(pageTextBytes({ html: "data:image/png;base64,AA=AA=|" })).toBe(1);
  });

  it("ends the run at a character outside the alphabet and keeps everything after it", () => {
    expect(pageTextBytes({ html: "data:image/png;base64,QUJD-QUJD" })).toBe(5);
  });

  it("keeps a header whose base64 run is empty", () => {
    expect(pageTextBytes({ html: '"data:image/png;base64,"' })).toBe(24);
  });

  it.each([
    { html: "data:image/svg+xml;base64,QUJD|", bytes: 1, why: "a subtype carrying `+` is a header" },
    { html: "data:imagepng;base64,QUJD", bytes: 25, why: "a type with no `/` is not" },
    { html: "data:/png;base64,QUJD", bytes: 21, why: "an empty type is not" },
    { html: "data:image/;base64,QUJD", bytes: 23, why: "an empty subtype is not" },
    { html: "data:Image/png;base64,QUJD", bytes: 26, why: "an uppercase type is not" },
    { html: "data:data:image/png;base64,QUJD|", bytes: 6, why: "a failed header leaves the next `data:` to match" },
  ])("reads the header exactly as the old pattern did: $why", ({ html, bytes }) => {
    expect(pageTextBytes({ html })).toBe(bytes);
  });

  it("rejoins a surrogate pair a cut URI separated, counting one four-byte character", () => {
    expect(pageTextBytes({ html: "\uD83Ddata:image/png;base64,A\uDE00" })).toBe(4);
  });

  it("counts UTF-8 bytes rather than characters on either side of a cut", () => {
    expect(pageTextBytes({ html: "é data:image/gif;base64,R0lG é" })).toBe(6);
  });

  it("cuts an image at the per-image cap down to the markup around it", () => {
    const payload = Buffer.alloc(4 * 1024 * 1024).toString("base64");

    expect(pageTextBytes({ html: `<img src="data:image/png;base64,${payload}">` })).toBe(12);
  });
});
