/*
 * `chooseView` — which of the three sources a console view choice comes from — and the view helpers beside it.
 *
 * Where a ROW belongs is `workspacePlacement/`'s subject, not this file's.
 *
 * The order is the whole contract: the URL addresses a view, storage remembers one, and the default
 * catches a first visit. This file sits under `site/__tests__/unit/` rather than `src/__tests__/unit/`
 * because a file under `src/` may not import one outside it: `tsconfig.build.json` sets `rootDir: ./src`
 * and the CI `compile` job exists to catch exactly that (TS6059). The unit lane reaches both roots.
 */

import { describe, expect, it } from "vitest";

import {
  CONTEXT_PARAM,
  canonicalSearch,
  chooseView,
  contextAddressedBy,
  contextEntries,
  DEFAULT_CONTEXT,
  entryOf,
  hiddenNoteParts,
  isSidebarMode,
  isWorkContext,
  navHref,
  OPEN_PARAM,
  otherContextLabel,
  otherWorkContext,
  panelHref,
  pathWithContextShown,
  SIDEBAR_PARAM,
  uncountedNoteParts,
  withParamReplaced,
  withParamSet,
} from "../../lib/workContext";

describe("otherWorkContext", () => {
  it("is the context not being looked at, both ways, and its count's label names it", () => {
    expect([otherWorkContext({ context: "work" }), otherWorkContext({ context: "slopweaver" })]).toEqual([
      "slopweaver",
      "work",
    ]);
    expect([otherContextLabel({ context: "slopweaver" }), otherContextLabel({ context: "work" })]).toEqual([
      "In the Slopweaver context",
      "In the work context",
    ]);
  });
});

describe("chooseView", () => {
  it("takes the URL over the stored choice, because a link addresses the view it points at", () => {
    expect(
      chooseView({ accept: isWorkContext, fallback: DEFAULT_CONTEXT, fromUrl: "slopweaver", stored: "work" }),
    ).toBe("slopweaver");
  });

  it("takes the stored choice when the URL does not carry the parameter", () => {
    expect(chooseView({ accept: isWorkContext, fallback: DEFAULT_CONTEXT, fromUrl: null, stored: "slopweaver" })).toBe(
      "slopweaver",
    );
  });

  it("falls to the default on a first visit, where neither source has anything", () => {
    expect(chooseView({ accept: isWorkContext, fallback: DEFAULT_CONTEXT, fromUrl: null, stored: null })).toBe("work");
  });

  it("passes over a URL value the guard refuses rather than showing it, and keeps the stored choice", () => {
    expect(
      chooseView({ accept: isWorkContext, fallback: DEFAULT_CONTEXT, fromUrl: "acme", stored: "slopweaver" }),
    ).toBe("slopweaver");
  });

  it("passes over a stored value the guard refuses and lands on the default", () => {
    expect(chooseView({ accept: isWorkContext, fallback: DEFAULT_CONTEXT, fromUrl: null, stored: "{}" })).toBe("work");
  });

  it("refuses the empty string from either source — a bare `?context=` addresses nothing", () => {
    expect(chooseView({ accept: isWorkContext, fallback: DEFAULT_CONTEXT, fromUrl: "", stored: "" })).toBe("work");
  });

  it("carries the sidebar's own choice on the same three rules", () => {
    expect(chooseView({ accept: isSidebarMode, fallback: "full", fromUrl: "icons", stored: "full" })).toBe("icons");
    expect(chooseView({ accept: isSidebarMode, fallback: "full", fromUrl: null, stored: "icons" })).toBe("icons");
    expect(chooseView({ accept: isSidebarMode, fallback: "full", fromUrl: "rail", stored: null })).toBe("full");
  });
});

describe("the parameter names", () => {
  it("are the ones a screenshot pass types, so a rename cannot land silently", () => {
    expect(CONTEXT_PARAM).toBe("context");
    expect(SIDEBAR_PARAM).toBe("rail");
  });
});

describe("hiddenNoteParts", () => {
  it("agrees with itself on one row — the defect this closes printed `1 pull requests … are not shown`", () => {
    const parts = hiddenNoteParts({
      context: "work",
      hidden: 1,
      one: "pull request",
      teamLabel: "Acme",
      what: "pull requests",
    })!;
    expect(parts.count).toBe("1");
    expect(parts.name).toBe("pull request");
    expect(parts.verb).toBe("is");
  });

  it("stays plural past one", () => {
    const parts = hiddenNoteParts({
      context: "work",
      hidden: 27,
      one: "pull request",
      teamLabel: "Acme",
      what: "pull requests",
    })!;
    expect(parts.count).toBe("27");
    expect(parts.name).toBe("pull requests");
    expect(parts.verb).toBe("are");
  });

  it("names the OTHER context, never the one being looked at — the work context by the organisation's name", () => {
    expect(
      hiddenNoteParts({ context: "work", hidden: 2, one: "row", teamLabel: "Acme", what: "rows" })!.otherLabel,
    ).toBe("Slopweaver");
    expect(
      hiddenNoteParts({ context: "slopweaver", hidden: 2, one: "row", teamLabel: "Acme", what: "rows" })!.otherLabel,
    ).toBe("Acme");
  });

  it("draws no line at all when the context hid nothing", () => {
    expect(
      hiddenNoteParts({ context: "work", hidden: 0, one: "row", teamLabel: "Acme", what: "rows" }),
    ).toBeUndefined();
  });
});

describe("uncountedNoteParts", () => {
  it("names the OTHER context and the rows, so an unread count is said in words rather than drawn as nothing", () => {
    expect([
      uncountedNoteParts({ context: "work", teamLabel: "Acme", what: "cards" }),
      uncountedNoteParts({ context: "slopweaver", teamLabel: "Acme", what: "pull requests" }),
    ]).toEqual([
      { name: "Cards", otherLabel: "Slopweaver" },
      { name: "Pull requests", otherLabel: "Acme" },
    ]);
  });
});

describe("the switcher's entries", () => {
  it("lists work first, named by the organisation, then Slopweaver", () => {
    expect(contextEntries({ teamLabel: "Acme" })).toEqual([
      { id: "work", label: "Acme", sub: "the organisation's work: its repositories, Slack, Linear and Vanta" },
      { id: "slopweaver", label: "Slopweaver", sub: "this instance's own template repository" },
    ]);
  });

  it("keeps Slopweaver's name whatever the organisation is", () => {
    expect(entryOf({ context: "slopweaver", teamLabel: "Globex" }).label).toBe("Slopweaver");
  });
});

describe("withParamReplaced — a choice outranks the link that opened the page", () => {
  it("replaces the context an address carries, keeping every other parameter", () => {
    expect(withParamReplaced({ param: CONTEXT_PARAM, search: "?open=ask%3Aa&context=work", value: "slopweaver" })).toBe(
      "?open=ask%3Aa&context=slopweaver",
    );
  });

  it("leaves a URL that never named the choice alone", () => {
    expect(withParamReplaced({ param: CONTEXT_PARAM, search: "?open=ask%3Aa", value: "slopweaver" })).toBeUndefined();
    expect(withParamReplaced({ param: CONTEXT_PARAM, search: "", value: "slopweaver" })).toBeUndefined();
  });
});

describe("withParamSet — a context choice always lands in the address", () => {
  it("writes the context into a URL that never named it, keeping every other parameter in order", () => {
    expect(withParamSet({ param: CONTEXT_PARAM, search: "?open=ask%3Aa&tag=area%3Aiso", value: "slopweaver" })).toBe(
      "?open=ask%3Aa&tag=area%3Aiso&context=slopweaver",
    );
  });

  it("replaces the context a URL already carries, in place", () => {
    expect(withParamSet({ param: CONTEXT_PARAM, search: "context=work&open=ask%3Aa", value: "slopweaver" })).toBe(
      "?context=slopweaver&open=ask%3Aa",
    );
  });

  it("addresses a bare page", () => {
    expect(withParamSet({ param: CONTEXT_PARAM, search: "", value: "work" })).toBe("?context=work");
  });
});

describe("canonicalSearch — a page's address names the context it shows, so a bookmark pins it", () => {
  it("writes the shown context into a plain visit", () => {
    expect(canonicalSearch({ search: "", shown: "slopweaver" })).toBe("?context=slopweaver");
  });

  it("keeps a deep link's other parameters when it adds the context", () => {
    expect(canonicalSearch({ search: "?open=ask%3Aa&rail=icons", shown: "work" })).toBe(
      "?open=ask%3Aa&rail=icons&context=work",
    );
  });

  it("leaves an address that already names a known context exactly as it is", () => {
    expect(canonicalSearch({ search: "?context=slopweaver&open=ask%3Aa", shown: "slopweaver" })).toBeUndefined();
  });

  it("replaces a context this console does not know with the one the page actually shows", () => {
    expect(canonicalSearch({ search: "?context=acme", shown: "work" })).toBe("?context=work");
    expect(canonicalSearch({ search: "?context=", shown: "slopweaver" })).toBe("?context=slopweaver");
  });
});

describe("pathWithContextShown — the voice reads a bare path as the view the page draws", () => {
  it("writes the stored view into a bare path, keeping its other parameters, and the default with nothing stored", () => {
    expect(pathWithContextShown({ path: "/queue", stored: "slopweaver" })).toBe("/queue?context=slopweaver");
    expect(pathWithContextShown({ path: "/queue?open=ask%3Aa", stored: "slopweaver" })).toBe(
      "/queue?open=ask%3Aa&context=slopweaver",
    );
    expect(pathWithContextShown({ path: "/queue", stored: null })).toBe(`/queue?context=${DEFAULT_CONTEXT}`);
  });

  it("leaves a path naming a known view exactly as it is, whatever is stored", () => {
    expect(pathWithContextShown({ path: "/queue?context=work", stored: "slopweaver" })).toBe("/queue?context=work");
  });
});

describe("contextAddressedBy — the voice window counts in the console window's context, not its own", () => {
  it("takes the context the carried page's address names over the stored choice", () => {
    expect(contextAddressedBy({ path: "/queue?tag=area%3Aiso&context=slopweaver", stored: "work" })).toBe("slopweaver");
  });

  it("resolves an address naming none, or one this console does not know, as that window does: stored, else default", () => {
    expect(contextAddressedBy({ path: "/queue", stored: "slopweaver" })).toBe("slopweaver");
    expect(contextAddressedBy({ path: "/queue?view=fleet", stored: "slopweaver" })).toBe("slopweaver");
    expect(contextAddressedBy({ path: "/queue?context=acme", stored: null })).toBe("work");
  });
});

describe("navHref — a sidebar link carries the context to the next page", () => {
  it("addresses the page in the context being looked at", () => {
    expect(navHref({ context: "slopweaver", href: "/pull-requests" })).toBe("/pull-requests?context=slopweaver");
    expect(navHref({ context: "work", href: "/queue" })).toBe("/queue?context=work");
  });

  it("keeps a link's own query, so a panel's link to another page opens its row in the same context", () => {
    expect(navHref({ context: "slopweaver", href: "/pull-requests?open=1618" })).toBe(
      "/pull-requests?open=1618&context=slopweaver",
    );
  });
});

describe("panelHref — opening and closing a panel keeps the view the link addressed", () => {
  it("keeps the context a floating note's link carried when the panel closes", () => {
    expect(panelHref({ open: null, pathname: "/queue", search: "open=ask%3Aa&context=slopweaver" })).toBe(
      "/queue?context=slopweaver",
    );
  });

  it("keeps both view choices when another row opens, and drops a one-shot instruction", () => {
    expect(
      panelHref({ open: "hand:b", pathname: "/queue", search: "open=ask%3Aa&seat=w&rail=icons&context=work" }),
    ).toBe("/queue?open=hand%3Ab&context=work&rail=icons");
  });

  it("is the bare path when nothing is open and no view is addressed", () => {
    expect(panelHref({ open: null, pathname: "/alignment", search: "open=act%3Aa" })).toBe("/alignment");
  });

  it("keeps every repeated tag selector verbatim and in order, a malformed one included", () => {
    expect(
      panelHref({
        open: "ask:a",
        pathname: "/queue",
        search: "tag=workstream%3Aconsole&seat=w&tag=%21area&tag=nonsense&context=work",
      }),
    ).toBe("/queue?open=ask%3Aa&context=work&tag=workstream%3Aconsole&tag=%21area&tag=nonsense");
  });

  it("keeps the tag selectors when the panel closes", () => {
    expect(panelHref({ open: null, pathname: "/queue", search: "open=ask%3Aa&tag=area%3Aiso" })).toBe(
      "/queue?tag=area%3Aiso",
    );
  });

  it("keeps the Queue's view when a card opens and when it closes", () => {
    const opened = panelHref({
      open: "ask:x",
      pathname: "/queue",
      search: "context=work&view=urgent&tag=priority%3Ap1",
    });
    expect(opened).toBe("/queue?open=ask%3Ax&context=work&view=urgent&tag=priority%3Ap1");
    expect(panelHref({ open: null, pathname: "/queue", search: opened.slice("/queue?".length) })).toBe(
      "/queue?context=work&view=urgent&tag=priority%3Ap1",
    );
  });

  it("encodes the key the way a note's link does", () => {
    expect(OPEN_PARAM).toBe("open");
    expect(panelHref({ open: "ask:a-round-two-row", pathname: "/queue", search: "" })).toBe(
      "/queue?open=ask%3Aa-round-two-row",
    );
  });
});
