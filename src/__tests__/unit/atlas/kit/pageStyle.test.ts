import { describe, expect, it } from "vitest";

import { atlasPageStyle } from "../../../../atlas/kit/pageStyle.js";

describe("atlasPageStyle", () => {
  const style = atlasPageStyle();

  it("opens with the font host's links and closes the one stylesheet it opens", () => {
    const links =
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&' +
      'family=IBM+Plex+Sans:wght@400;500;600&display=swap"><style>:root{';

    expect(style.slice(0, links.length)).toBe(links);
    expect(style.split("<style>").length).toBe(2);
    expect(style.slice(-"</style>".length)).toBe("</style>");
  });

  it("reaches no host but the font host, so the page renders offline", () => {
    const hosts = [...style.matchAll(/https:\/\/([^/"]+)/g)].map((match) => match[1]);

    expect(hosts).toEqual(["fonts.googleapis.com", "fonts.gstatic.com", "fonts.googleapis.com"]);
  });

  it("declares every colour token on bare :root before either dark block redefines it", () => {
    const light = style.indexOf(":root{--bg:#f7f8fa;");
    const darkByPreference = style.indexOf("@media(prefers-color-scheme:dark)");
    const darkByChoice = style.indexOf('[data-theme="dark"]{--bg:#111318;');

    expect(light).toBeGreaterThan(0);
    expect(darkByPreference).toBeGreaterThan(light);
    expect(darkByChoice).toBeGreaterThan(darkByPreference);
  });
});
