/*
 * The link script a served page carries, run as the exact string served, against a fake document: a link leaving the
 * page opens in a new tab, and everything the page or the reader already decided is left alone. Every Datadog host
 * in this file reads a synthetic site rather than the install's own.
 */

import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { FRAMED_LINK_LISTENER, FRAMED_LINK_SCRIPT, withFramedLinks } from "../../lib/framedLinks";

/** Where the page under test is served from. */
const PAGE = "http://localhost:3000/api/page/example-finding-proof/index.html";

/** A fake element: its local name and its attributes, read and written the way the script does. */
interface FakeLink {
  readonly localName: string;
  readonly attributes: Map<string, string>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(...pair: [string, string]): void;
}

/**
 * A fake element carrying the given attributes.
 *
 * @returns the element
 */
function element({
  localName = "a",
  attributes,
}: {
  localName?: string;
  attributes: Record<string, string>;
}): FakeLink {
  const held = new Map(Object.entries(attributes));
  return {
    attributes: held,
    getAttribute: (name) => {
      const value = held.get(name);
      if (value === undefined) {
        return null;
      }
      return value;
    },
    hasAttribute: (name) => held.has(name),
    localName,
    setAttribute: (...pair) => {
      const [name, value] = pair;
      held.set(name, value);
    },
  };
}

/**
 * Run the served listener once over one click and hand back the attributes of the element clicked.
 *
 * @param path what the click's `composedPath()` returns, innermost first
 * @param click the event's own fields that differ from a plain primary click
 * @param activation which event the browser fires: `click`, or `auxclick` for a middle click
 * @param topLevel the page is a tab of its own rather than inside a frame
 * @param base the document's base address, which a page's own `<base href>` sets
 * @returns the clicked link's attributes after the listener ran
 */
function clickOn({
  link,
  path = [link],
  click = {},
  activation = "click",
  topLevel = false,
  base = PAGE,
}: {
  link: FakeLink;
  path?: readonly object[];
  click?: Record<string, unknown>;
  activation?: "click" | "auxclick";
  topLevel?: boolean;
  base?: string;
}): Record<string, string> {
  const listeners: ((event: object) => void)[] = [];
  const document = {
    addEventListener: (...registered: [string, (event: object) => void]) => {
      if (registered[0] === activation) {
        listeners.push(registered[1]);
      }
    },
    baseURI: base,
  };
  const window: { top: object } = { top: { name: "the viewer" } };
  if (topLevel) {
    window.top = window;
  }
  runInNewContext(FRAMED_LINK_LISTENER, { URL, document, location: { href: PAGE }, window });
  const event = {
    altKey: false,
    button: 0,
    composedPath: () => [...path, { nodeName: "BODY" }, document],
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    shiftKey: false,
    ...click,
  };
  for (const listener of listeners) {
    listener(event);
  }
  return Object.fromEntries(link.attributes);
}

const DATADOG = "https://ap1.datadoghq.com/metric/explorer?paused=true#N4Ig";

describe("FRAMED_LINK_LISTENER", () => {
  it("opens a link off the console in a new tab, a Datadog link", () => {
    expect(clickOn({ link: element({ attributes: { href: DATADOG } }) })).toEqual({
      href: DATADOG,
      rel: "noopener",
      target: "_blank",
    });
  });

  it("opens a console page, a look-alike of the page route and another port in a new tab", () => {
    const hrefs = [
      "http://localhost:3000/queue?open=post%3Asd-2290cbcd",
      "/api/page-evil/index.html",
      "http://localhost:3001/api/page/other/index.html",
      "//ap1.datadoghq.com/dashboard",
    ];
    expect(hrefs.map((href) => clickOn({ link: element({ attributes: { href } }) }).target)).toEqual([
      "_blank",
      "_blank",
      "_blank",
      "_blank",
    ]);
  });

  it("leaves every link alone on a page opened as a tab of its own, where there is no frame to keep", () => {
    expect(clickOn({ link: element({ attributes: { href: DATADOG } }), topLevel: true })).toEqual({ href: DATADOG });
  });

  it("keeps the author's rel words beside noopener", () => {
    expect(clickOn({ link: element({ attributes: { href: DATADOG, rel: "external" } }) }).rel).toBe(
      "external noopener",
    );
  });

  it("finds the link from a click on text inside it, and an image map's area", () => {
    const link = element({ attributes: { href: DATADOG } });
    const area = element({ attributes: { href: DATADOG }, localName: "area" });
    expect([
      clickOn({ link, path: [{ nodeName: "#text" }, element({ attributes: {}, localName: "strong" }), link] }).target,
      clickOn({ link: area }).target,
    ]).toEqual(["_blank", "_blank"]);
  });

  it("leaves the page's own jumps, a file beside it and another local page in the frame", () => {
    const hrefs = ["#evidence", "", "shot.png", "/api/page/other-page/index.html", `${PAGE}#top`];
    expect(hrefs.map((href) => clickOn({ link: element({ attributes: { href } }) }))).toEqual(
      hrefs.map((href) => ({ href })),
    );
  });

  it("leaves what the author or the reader already decided alone", () => {
    const untouched = [
      clickOn({ link: element({ attributes: { href: DATADOG, target: "" } }) }),
      clickOn({ link: element({ attributes: { download: "", href: DATADOG } }) }),
      clickOn({ click: { metaKey: true }, link: element({ attributes: { href: DATADOG } }) }),
      clickOn({ click: { shiftKey: true }, link: element({ attributes: { href: DATADOG } }) }),
      clickOn({ click: { defaultPrevented: true }, link: element({ attributes: { href: DATADOG } }) }),
      clickOn({ click: { button: 1 }, link: element({ attributes: { href: DATADOG } }) }),
    ];
    expect(untouched).toEqual([
      { href: DATADOG, target: "" },
      { download: "", href: DATADOG },
      { href: DATADOG },
      { href: DATADOG },
      { href: DATADOG },
      { href: DATADOG },
    ]);
  });

  it("leaves a non-http scheme, an unparseable address and an anchor with no href alone", () => {
    const named = element({ attributes: { name: "top" } });
    expect([
      clickOn({ link: element({ attributes: { href: "mailto:someone@example.com" } }) }),
      clickOn({ link: element({ attributes: { href: "http://[" } }) }),
      clickOn({ link: named }),
    ]).toEqual([{ href: "mailto:someone@example.com" }, { href: "http://[" }, { name: "top" }]);
  });
});

/** The off-cmux briefing's own dead link, its home path made synthetic. */
const INCIDENT_PAGE = "file:///Users/acme/.slopweaver/pages/acme-chair-route-incident/index.html";

/** Where {@link INCIDENT_PAGE} is served on the console. */
const INCIDENT_ROUTE = "/api/page/acme-chair-route-incident/index.html";

describe("FRAMED_LINK_LISTENER on a link to another local page by its file:// address", () => {
  it("sends a plain click to the console's route, which stays in the frame, an incident page link", () => {
    expect(clickOn({ link: element({ attributes: { href: INCIDENT_PAGE } }) })).toEqual({ href: INCIDENT_ROUTE });
  });

  it("rewrites it on a Command-click, a Control-click, a middle click and a page opened as its own tab", () => {
    const rewritten = [
      clickOn({ click: { metaKey: true }, link: element({ attributes: { href: INCIDENT_PAGE } }) }),
      clickOn({ click: { ctrlKey: true }, link: element({ attributes: { href: INCIDENT_PAGE } }) }),
      clickOn({ activation: "auxclick", click: { button: 1 }, link: element({ attributes: { href: INCIDENT_PAGE } }) }),
      clickOn({ link: element({ attributes: { href: INCIDENT_PAGE } }), topLevel: true }),
    ];
    expect(rewritten).toEqual([
      { href: INCIDENT_ROUTE },
      { href: INCIDENT_ROUTE },
      { href: INCIDENT_ROUTE },
      { href: INCIDENT_ROUTE },
    ]);
  });

  it("keeps the query and fragment as written, an empty query included", () => {
    const hrefs = [`${INCIDENT_PAGE}?#finding`, `${INCIDENT_PAGE}?at=3#finding`, `${INCIDENT_PAGE}#top`];
    expect(hrefs.map((href) => clickOn({ link: element({ attributes: { href } }) }).href)).toEqual([
      `${INCIDENT_ROUTE}?#finding`,
      `${INCIDENT_ROUTE}?at=3#finding`,
      `${INCIDENT_ROUTE}#top`,
    ]);
  });

  it("reads a localhost host and encoded final segments decoded, as the card mapper does", () => {
    const hrefs = [
      "file://localhost/Users/acme/.slopweaver/pages/a.b_c-1/index.html",
      "file:///Users/acme/.slopweaver/%70ages/%41lpha/index%2Ehtml",
    ];
    expect(hrefs.map((href) => clickOn({ link: element({ attributes: { href } }) }).href)).toEqual([
      "/api/page/a.b_c-1/index.html",
      "/api/page/Alpha/index.html",
    ]);
  });

  it("leaves a file that is not a page, a bad slug, a foreign host and an unopenable path alone", () => {
    const hrefs = [
      "file:///tmp/x.log",
      "file:///Users/acme/.slopweaver/pages/.hidden/index.html",
      "file:///Users/acme/.slopweaver/pages/-leading/index.html",
      `file:///Users/acme/.slopweaver/pages/${"a".repeat(129)}/index.html`,
      "file:///Users/acme/.slopweaver/pages/alpha/other.html",
      "file://fileserver/Users/acme/.slopweaver/pages/alpha/index.html",
      "file:///Users/acme/.slopweaver/pages%2Falpha/index.html",
      "file:///Users/acme%00/.slopweaver/pages/alpha/index.html",
      "file:///Users/acme%80/.slopweaver/pages/alpha/index.html",
    ];
    expect(hrefs.map((href) => clickOn({ link: element({ attributes: { href } }) }))).toEqual(
      hrefs.map((href) => ({ href })),
    );
  });

  it("never reads a relative link as a page address, even under a page whose base is the pages directory", () => {
    const hrefs = ["alpha/index.html?x=1#f", "../pages/alpha/index.html"];
    expect(
      hrefs.map((href) =>
        clickOn({ base: "file:///Users/acme/.slopweaver/pages/", link: element({ attributes: { href } }) }),
      ),
    ).toEqual(hrefs.map((href) => ({ href })));
  });
});

describe("withFramedLinks", () => {
  it("puts the script after the document's last byte, so whatever leads the doctype is parsed as before", () => {
    const pages = [
      "<!doctype html><html><body><p>hi</p></body></html>",
      "<!--foo--!><!doctype html><p>hi</p>",
      '<?xml version="1.0"?>\n<!x><!DOCTYPE html><p>hi</p>',
      "<h1>alpha</h1>",
    ];
    expect(pages.map((html) => withFramedLinks({ body: Buffer.from(html, "utf8") }).toString("utf8"))).toEqual(
      pages.map((html) => `${html}${FRAMED_LINK_SCRIPT}`),
    );
  });

  it("keeps a byte that is not valid UTF-8 as it was, rather than re-encoding it", () => {
    const body = Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0x3c, 0x2f, 0x70, 0x3e]);
    expect(withFramedLinks({ body })).toEqual(Buffer.concat([body, Buffer.from(FRAMED_LINK_SCRIPT, "utf8")]));
  });

  it("carries the listener inside one marked inline script element", () => {
    expect(FRAMED_LINK_SCRIPT).toBe(`<script data-sw-framed-links>${FRAMED_LINK_LISTENER}</script>`);
  });
});
