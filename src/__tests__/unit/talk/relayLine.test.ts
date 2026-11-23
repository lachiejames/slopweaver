import { describe, expect, it } from "vitest";

import { relayLineHead, relayLineSlug, relayLineVerify, unwrapPaste } from "../../../talk/relayLine.js";

const LINE =
  '[voice relay talk-a00000260000] the owner said: "ship it" — full row talk-a00000260000; verify with slopweaver talk log.';

describe("relayLineSlug", () => {
  it("reads the slug off a bare delivery line", () => {
    expect(relayLineSlug({ text: LINE })).toBe("talk-a00000260000");
  });

  it("reads it through a paste wrapper whose quoted attributes carry a >", () => {
    expect(relayLineSlug({ text: `  <pasted_content id="a>b" note='c>d'>  ${LINE}` })).toBe("talk-a00000260000");
  });

  it("refuses a slug not in the minted shape, upper case, or with no space after the bracket", () => {
    const line = ({ slug, gap }: { slug: string; gap: string }): string =>
      `[voice relay ${slug}]${gap}the owner said: "x"${relayLineVerify({ slug })}`;
    expect(relayLineSlug({ text: line({ gap: " ", slug: "talk-a00000260000" }) })).toBe("talk-a00000260000");
    expect(relayLineSlug({ text: line({ gap: " ", slug: "talk-5d52" }) })).toBeUndefined();
    expect(relayLineSlug({ text: line({ gap: " ", slug: "talk-5D5271328E16" }) })).toBeUndefined();
    expect(relayLineSlug({ text: line({ gap: "", slug: "talk-a00000260000" }) })).toBeUndefined();
  });

  it("refuses a marker anywhere but the start — a turn quoting a relay is not its delivery", () => {
    expect(relayLineSlug({ text: `look at this: ${LINE}` })).toBeUndefined();
  });

  it("refuses a turn opening with the marker that carries no verify phrase for that slug", () => {
    expect(relayLineSlug({ text: "[voice relay talk-a00000260000] why did this not go out?" })).toBeUndefined();
    expect(
      relayLineSlug({ text: LINE.replace("full row talk-a00000260000", "full row talk-000000000000") }),
    ).toBeUndefined();
  });

  it("finds the verify phrase with more text after it — 6 of 204 measured lines", () => {
    expect(relayLineSlug({ text: `${LINE}\n\nand one more thing` })).toBe("talk-a00000260000");
  });
});

describe("relayLineHead and relayLineVerify", () => {
  it("compose a line relayLineSlug reads back", () => {
    const slug = "talk-0757df532003";
    expect(relayLineSlug({ text: `${relayLineHead({ slug })}the owner said: "hi"${relayLineVerify({ slug })}` })).toBe(
      slug,
    );
  });
});

describe("unwrapPaste", () => {
  it("takes off one leading wrapper and the whitespace round it, and leaves plain text alone", () => {
    expect(unwrapPaste({ text: ' <pasted_content id="d0ab">\n hello' })).toBe("hello");
    expect(unwrapPaste({ text: "hello <pasted_content>" })).toBe("hello <pasted_content>");
  });
});
