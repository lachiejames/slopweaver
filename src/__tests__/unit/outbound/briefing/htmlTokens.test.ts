import { describe, expect, it } from "vitest";

import {
  declaredIds,
  htmlParts,
  maskNonMarkup,
  tagAttributes,
  tagEnd,
} from "../../../../outbound/briefing/htmlTokens.js";

/** Each part's own source, which is what every reader of the scan actually slices. */
const sources = ({ html }: { html: string }): readonly string[] =>
  htmlParts({ html }).map((part) => html.slice(part.start, part.end));

/** Each part's kind, in order. */
const kinds = ({ html }: { html: string }): readonly string[] => htmlParts({ html }).map((part) => part.kind);

/** As many spaces as `text` has bytes — what the mask puts in a hidden part's place. */
const blank = ({ text }: { text: string }): string => " ".repeat(text.length);

describe("htmlParts", () => {
  it("covers every byte exactly once, so joining the parts reproduces the page", () => {
    const html = `<!doctype html><p id="p1">a &amp; b</p><!-- note --><script>let x = 1;</script>tail`;

    expect(sources({ html }).join("")).toBe(html);
  });

  it("names each run for what it is", () => {
    const html = `<p id="p1">text</p><!-- note --><style>.a{}</style>`;

    expect(kinds({ html })).toEqual(["tag", "text", "tag", "comment", "inert"]);
  });

  it("closes a tag on the bracket that closes IT, not on one inside a quoted value", () => {
    const html = `<a title="1 > 0" href='x'>link</a>`;

    expect(sources({ html })[0]).toBe(`<a title="1 > 0" href='x'>`);
  });

  it("takes a script's whole element, body included, as one inert part", () => {
    const script = `<script>const x = '<div class="corr">no</div>';</script>`;

    expect(sources({ html: `<p>a</p>${script}` })).toEqual(["<p>", "a", "</p>", script]);
  });

  it("runs an unclosed script to the end of the page, which is what a browser does with one", () => {
    const html = `<p>a</p><script>const x = '<div class="corr">no</div>';`;

    expect(sources({ html }).at(-1)).toBe(`<script>const x = '<div class="corr">no</div>';`);
  });

  it("closes a script on an end tag carrying whitespace, which HTML permits", () => {
    const html = `<script>let y = 1;</script ><p>after</p>`;

    expect(kinds({ html })).toEqual(["inert", "tag", "text", "tag"]);
    expect(sources({ html })[0]).toBe(`<script>let y = 1;</script >`);
  });

  it("takes a textarea's whole element as inert, because what a reader types into it is text", () => {
    const area = `<textarea><p id="ghost" data-corr="changed">example</p></textarea>`;

    expect(sources({ html: `<p>a</p>${area}` })).toEqual(["<p>", "a", "</p>", area]);
  });

  it("takes every element HTML's tokenizer reads as raw text, not the two a page obviously carries", () => {
    const rawText = ["iframe", "noembed", "noframes", "noscript", "textarea", "title", "xmp"];
    // The trailing `<p>` is the falsifiable half: it is markup, so a name whose element ends EARLY would
    // hand back more parts than these two and a name never read as inert would hand back more still.
    const taken = rawText.filter((name) => {
      const element = `<${name}><p id="ghost">text</p></${name}>`;
      const read = sources({ html: `${element}<p>after</p>` });
      return kinds({ html: element })[0] === "inert" && read[0] === element && read.length === 4;
    });

    expect(rawText.length).toBeGreaterThan(0);
    expect(taken).toEqual(rawText);
  });

  it("runs a plaintext element to the LAST byte, because HTML gives it no end tag to find", () => {
    const html = `<plaintext></plaintext><p id="ghost" data-corr="changed">example</p>`;

    expect(kinds({ html })).toEqual(["inert"]);
    expect(sources({ html })[0]).toBe(html);
    expect(declaredIds({ html }).size).toBe(0);
  });

  it("takes a comment whole, however much markup its body spells", () => {
    const comment = `<!-- <div class="corr" data-corr="changed">keep</div> -->`;

    expect(sources({ html: `${comment}<p>a</p>` })[0]).toBe(comment);
  });

  it("runs an unterminated comment to the end of the page rather than reading its body as markup", () => {
    const html = `<p>a</p><!-- <div>never closed`;

    expect(sources({ html }).at(-1)).toBe(`<!-- <div>never closed`);
  });

  it("reads a stray bracket that opens no tag as ordinary text", () => {
    const html = `<p>5 < 6 and 7 > 6</p>`;

    expect(kinds({ html })).toEqual(["tag", "text", "tag"]);
    expect(sources({ html })[1]).toBe("5 < 6 and 7 > 6");
  });

  it("reads a closing tag as a tag of its own", () => {
    expect(kinds({ html: `</p>` })).toEqual(["tag"]);
  });

  it("hands back nothing at all for the empty page", () => {
    expect(htmlParts({ html: "" })).toEqual([]);
  });
});

describe("tagAttributes", () => {
  it("reads all three of HTML's quotings, and whitespace around the equals", () => {
    const read = tagAttributes({ tag: `<p id="one" class='two' data-three = four>` });

    expect(read.map((attribute) => attribute.name)).toEqual(["id", "class", "data-three"]);
    expect(read.map((attribute) => attribute.value)).toEqual(["one", "two", "four"]);
  });

  it("gives a bare attribute the empty string rather than swallowing the next one", () => {
    const read = tagAttributes({ tag: `<details open id="history">` });

    expect(read.map((attribute) => attribute.name)).toEqual(["open", "id"]);
    expect(read.map((attribute) => attribute.value)).toEqual(["", "history"]);
  });

  it("lowercases a name, because HTML says the two spellings are the same attribute", () => {
    expect(tagAttributes({ tag: `<p ID="x">` }).map((attribute) => attribute.name)).toEqual(["id"]);
  });

  it("reads a value that quotes another attribute as one value, not as two attributes", () => {
    const read = tagAttributes({ tag: `<p title='example data-corr="changed"'>` });

    expect(read.map((attribute) => attribute.name)).toEqual(["title"]);
    expect(read[0]!.value).toBe(`example data-corr="changed"`);
  });

  it("carries the range each attribute occupies, so a caller can cut it out by index", () => {
    const tag = `<p id="p1" data-corr="changed">`;
    const mark = tagAttributes({ tag }).find((attribute) => attribute.name === "data-corr")!;

    expect(tag.slice(mark.start, mark.end)).toBe(`data-corr="changed"`);
    expect(tag.slice(0, mark.start - 1) + tag.slice(mark.end)).toBe(`<p id="p1">`);
  });

  it("finds no attributes on an END tag, which HTML parses and then throws away", () => {
    expect(tagAttributes({ tag: `</p id="ghost" data-corr="changed">` })).toEqual([]);
  });

  it("finds no attributes on a tag that declares none", () => {
    expect(tagAttributes({ tag: "<p>" })).toEqual([]);
  });
});

describe("declaredIds", () => {
  it("reads every id a tag declares, in all three of HTML's spellings", () => {
    const html = `<h2 id="one">a</h2><p id='two'>b</p><li id = three>c</li>`;

    expect([...declaredIds({ html })].toSorted()).toEqual(["one", "three", "two"]);
  });

  it("counts no id a comment or a script merely quotes, because an anchor cannot reach one", () => {
    const html = `<h2 id="real">a</h2><!-- <p id="commented"> --><script>'<p id="quoted">'</script>`;

    expect([...declaredIds({ html })]).toEqual(["real"]);
  });

  it("reads an id off a raw-text element's OWN tag, which is an anchor like any other", () => {
    const html = `<textarea id="corr-0">notes</textarea><script id="boot">let x = 1;</script>`;

    expect([...declaredIds({ html })]).toEqual(["corr-0", "boot"]);
  });

  it("finds nothing on a page whose elements declare none", () => {
    expect(declaredIds({ html: "<p>a</p><h2>b</h2>" }).size).toBe(0);
  });
});

describe("tagEnd", () => {
  it("walks past a bracket inside a quoted value to the one that really closes the tag", () => {
    const html = `<a title="1 > 0">link</a>`;

    expect(tagEnd({ from: 0, html })).toBe(`<a title="1 > 0">`.length);
  });

  it("hands back the page's length when the tag never closes", () => {
    const html = `<a title="unclosed`;

    expect(tagEnd({ from: 0, html })).toBe(html.length);
  });
});

describe("maskNonMarkup", () => {
  it("blanks a comment and an inert element while leaving the markup around them byte for byte", () => {
    const comment = `<!-- <div class="corr">no</div> -->`;
    const script = `<script>let y = 1;</script>`;
    const html = `<p id="p1">kept</p>${comment}${script}<p id="p2">kept</p>`;

    expect(maskNonMarkup({ html })).toBe(
      `<p id="p1">kept</p>${blank({ text: comment })}${blank({ text: script })}<p id="p2">kept</p>`,
    );
  });

  it("hands back a string of exactly the input's length, so an index into it indexes the page", () => {
    const html = `<style>.a { color: red; }</style><h2 id="s1">a section</h2><script>let y = 1;</script>`;
    const masked = maskNonMarkup({ html });

    expect(masked.length).toBe(html.length);
    expect(masked.indexOf(`<h2 id="s1">`)).toBe(html.indexOf(`<h2 id="s1">`));
  });

  it("blanks the brackets inside a quoted attribute value, so no pattern reads one as an element", () => {
    const html = `<span title='<p id="p1">old</p>'>visible</span>`;

    expect(maskNonMarkup({ html })).toBe(`<span title=' p id="p1" old /p '>visible</span>`);
  });

  it("keeps a class readable through that blanking, because a mask reader still has to tell a card apart", () => {
    const html = `<div class="need" title="1 > 0"><p>a</p></div>`;

    expect(maskNonMarkup({ html })).toBe(`<div class="need" title="1   0"><p>a</p></div>`);
  });

  it("leaves a page with neither exactly as it was given", () => {
    const html = `<h2 id="s1">a section</h2><p id="p1">markup</p>`;

    expect(maskNonMarkup({ html })).toBe(html);
  });
});
