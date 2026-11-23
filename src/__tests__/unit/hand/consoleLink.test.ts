import { describe, expect, it } from "vitest";

import { consoleBaseFrom, consoleQueueLink, siblingQueueLink, withQueueContext } from "../../../hand/consoleLink.js";
import { isLinkContext } from "../../../hand/consoleLinkNames.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const BASE = "http://localhost:3000";
/** The link the owner's floating note opened, which carried no context. */
const HIS_LINK = "http://localhost:3000/queue?open=ask%3Aa-round-two-row-is-seated-and-opens";

describe("consoleBaseFrom", () => {
  it("is the port `yarn console` binds when nothing overrides it", () => {
    expect(consoleBaseFrom({ configured: undefined })).toBe("http://localhost:3000");
    expect(consoleBaseFrom({ configured: "  " })).toBe("http://localhost:3000");
  });

  it("takes another checkout's console, without its trailing slash", () => {
    expect(consoleBaseFrom({ configured: "http://localhost:3100/" })).toBe("http://localhost:3100");
  });
});

describe("siblingQueueLink", () => {
  it("opens another card on the same console origin and path, dropping the context the console switches itself", () => {
    expect(
      siblingQueueLink({
        id: "mon-signin-go-xero-com.2",
        url: "http://localhost:3100/queue?open=hand%3Amon-health-syncs.4&context=slopweaver",
      }),
    ).toBe("http://localhost:3100/queue?open=hand%3Amon-signin-go-xero-com.2");
    expect(siblingQueueLink({ id: "adc-signin-row", url: "https://console.example/console/queue?open=hand%3Aa" })).toBe(
      "https://console.example/console/queue?open=hand%3Aadc-signin-row",
    );
  });

  it("follows no link that is not a queue link opening a row — a page, a file, a fragment, no open", () => {
    expect(
      [
        "file:///Users/x/pages/a/index.html",
        "http://localhost:3000/briefing?open=hand%3Aa",
        "http://localhost:3000/queue",
        "http://localhost:3000/queue?open=hand%3Aa#top",
        "not a url",
      ].map((url) => siblingQueueLink({ id: "b", url })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("consoleQueueLink", () => {
  it("mints the row's deep link carrying its context", () => {
    expect(
      unwrap(consoleQueueLink({ base: BASE, context: "slopweaver", key: "ask:a-round-two-row-is-seated-and-opens" })),
    ).toBe(`${HIS_LINK}&context=slopweaver`);
  });

  it("mints it without a context when none is known, which the console then switches for itself", () => {
    expect(unwrap(consoleQueueLink({ base: BASE, context: undefined, key: "hand:gcloud-signin" }))).toBe(
      "http://localhost:3000/queue?open=hand%3Agcloud-signin",
    );
  });

  it("refuses a key naming no kind the queue draws, or no id", () => {
    expect(unwrapErr(consoleQueueLink({ base: BASE, context: "work", key: "board:x" }))[0]).toContain('got "board:x"');
    expect(unwrapErr(consoleQueueLink({ base: BASE, context: "work", key: "ask:" }))[0]).toContain('got "ask:"');
    expect(unwrapErr(consoleQueueLink({ base: BASE, context: "work", key: "ask" }))[0]).toContain('got "ask"');
  });

  it("opens a pull request's row only by repository and number, refusing a bare number", () => {
    expect(unwrap(consoleQueueLink({ base: BASE, context: undefined, key: "pr:acme.widgets.42" }))).toBe(
      "http://localhost:3000/queue?open=pr%3Aacme.widgets.42",
    );
    expect(unwrapErr(consoleQueueLink({ base: BASE, context: undefined, key: "pr:42" }))[0]).toContain(
      'pr:<owner>.<repo>.<n>) — got "pr:42"',
    );
  });
});

describe("withQueueContext", () => {
  it("adds the step's context to a queue link on this console that names none", () => {
    expect(withQueueContext({ base: BASE, context: "slopweaver", url: HIS_LINK })).toBe(
      `${HIS_LINK}&context=slopweaver`,
    );
  });

  it("leaves a link that already names a context exactly as it came", () => {
    const named = `${HIS_LINK}&context=work`;
    expect(withQueueContext({ base: BASE, context: "slopweaver", url: named })).toBe(named);
  });

  it("leaves every other address alone — another page, another origin, a file page", () => {
    expect(withQueueContext({ base: BASE, context: "work", url: "http://localhost:3000/alignment?open=act%3Ax" })).toBe(
      "http://localhost:3000/alignment?open=act%3Ax",
    );
    expect(withQueueContext({ base: BASE, context: "work", url: "https://example.com/queue?open=ask%3Ax" })).toBe(
      "https://example.com/queue?open=ask%3Ax",
    );
    expect(withQueueContext({ base: BASE, context: "work", url: "file:///Users/x/page/index.html" })).toBe(
      "file:///Users/x/page/index.html",
    );
  });

  it("changes nothing when the step states no context", () => {
    expect(withQueueContext({ base: BASE, context: undefined, url: HIS_LINK })).toBe(HIS_LINK);
  });
});

describe("isLinkContext", () => {
  it("accepts the console's two context ids and refuses the switcher's LABEL for one", () => {
    expect(["slopweaver", "work", "acme", undefined].map((value) => isLinkContext(value))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
