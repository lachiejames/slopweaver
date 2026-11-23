/**
 * The console's floating note: what failed, in which build, what to do, links that name the failure they were drawn
 * for, no script, and a place under the fleet's note.
 */
import { describe, expect, it } from "vitest";

import { buildIdentity } from "../../src/buildIdentity";
import { consoleNoteLinkOf, consoleNotePosition, consoleNoteUrl, consoleNoteView } from "../../src/consoleNote";
import { CheckoutErrors, ConsoleErrors } from "../../src/errors";

const PACKAGED = buildIdentity({ checkout: "/c/slopweaver", packaged: true });
const DEV = buildIdentity({ checkout: "/c/wt/fix-the-orb", packaged: false });
const SERVE_FAILED = ConsoleErrors.processFailed({
  command: "docs-site.sh --serve",
  detail: "next build\nError: <port> in use",
});

/** The document inside a note's data URL. */
const documentOf = ({ url }: { url: string }): string =>
  decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));

describe("consoleNoteLinkOf", () => {
  it("reads each of the four links", () => {
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://choose-checkout/9" })).toEqual({
      kind: "choose-checkout",
      serial: 9,
    });
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://retry/3" })).toEqual({ kind: "retry", serial: 3 });
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://dismiss/12" })).toEqual({ kind: "dismiss", serial: 12 });
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://quit/1" })).toEqual({ kind: "quit", serial: 1 });
  });

  it("refuses anything else", () => {
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://reload/3" })).toBe(undefined);
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://retry/x" })).toBe(undefined);
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://retry/3/more" })).toBe(undefined);
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://choose-checkout/x" })).toBe(undefined);
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://choose-checkout/9/more" })).toBe(undefined);
    expect(consoleNoteLinkOf({ url: "slopweaver-shell://choose/9" })).toBe(undefined);
    expect(consoleNoteLinkOf({ url: "slopweaver-fleet://act/3" })).toBe(undefined);
    expect(consoleNoteLinkOf({ url: "https://example.com/" })).toBe(undefined);
  });
});

describe("consoleNoteView", () => {
  it("offers Retry for a console that failed to start, in the packaged app", () => {
    const view = consoleNoteView({ failure: SERVE_FAILED, identity: PACKAGED, serial: 4 });
    expect(view.headline).toBe("Slopweaver could not start its console.");
    expect(view.problem).toBe("docs-site.sh --serve failed: Error: <port> in use");
    expect(view.todo).toBe(
      "Retry runs scripts/docs-site.sh --serve once more; Retry Console in the menu bar does the same.",
    );
    expect(view.actions).toEqual([
      { label: "Retry", link: { kind: "retry", serial: 4 } },
      { label: "Not now", link: { kind: "dismiss", serial: 4 } },
    ]);
  });

  it("offers the clone picker, never Retry, for a clone that is no longer one", () => {
    const view = consoleNoteView({
      failure: CheckoutErrors.invalid({ path: "/c/gone" }),
      identity: PACKAGED,
      serial: 1,
    });
    expect(view.problem).toBe("/c/gone is not a Slopweaver clone (no scripts/docs-site.sh and site/)");
    expect(view.todo).toBe(
      "Choose the folder you cloned Slopweaver into. The app remembers it, and serves the console from it.",
    );
    expect(view.actions).toEqual([
      { label: "Choose a Slopweaver clone…", link: { kind: "choose-checkout", serial: 1 } },
      { label: "Not now", link: { kind: "dismiss", serial: 1 } },
    ]);
  });

  it("offers the clone picker to a downloaded app that has never had one", () => {
    const view = consoleNoteView({ failure: CheckoutErrors.unset(), identity: PACKAGED, serial: 7 });
    expect(view.problem).toBe("no Slopweaver clone is chosen yet");
    expect(view.actions).toEqual([
      { label: "Choose a Slopweaver clone…", link: { kind: "choose-checkout", serial: 7 } },
      { label: "Not now", link: { kind: "dismiss", serial: 7 } },
    ]);
  });

  it("offers the picker again when the picker itself failed", () => {
    const failure = CheckoutErrors.selectionFailed({ cause: new Error("no window to attach to") });
    const view = consoleNoteView({ failure, identity: PACKAGED, serial: 8 });
    expect(view.problem).toBe("the folder picker failed: no window to attach to");
    expect(view.actions.map(({ link }) => link.kind)).toEqual(["choose-checkout", "dismiss"]);
  });

  it("names the dev build and offers to quit it", () => {
    const view = consoleNoteView({ failure: SERVE_FAILED, identity: DEV, serial: 2 });
    expect(view.headline).toBe("Slopweaver (dev build · fix-the-orb) could not start its console.");
    expect(view.todo).toBe(
      "Retry runs scripts/docs-site.sh --serve once more; Retry Console in the menu bar does the same. This is a dev build run from source; if nobody is working on it, quit it.",
    );
    expect(view.actions.map(({ label }) => label)).toEqual(["Retry", "Quit this dev build", "Not now"]);
  });

  it("puts the clone picker before quitting the dev build when Retry cannot help", () => {
    const view = consoleNoteView({ failure: CheckoutErrors.unset(), identity: DEV, serial: 5 });
    expect(view.actions).toEqual([
      { label: "Choose a Slopweaver clone…", link: { kind: "choose-checkout", serial: 5 } },
      { label: "Quit this dev build", link: { kind: "quit", serial: 5 } },
      { label: "Not now", link: { kind: "dismiss", serial: 5 } },
    ]);
  });
});

describe("consoleNoteUrl", () => {
  it("draws a script-free document with every value escaped and the first link as the button", () => {
    const view = consoleNoteView({ failure: SERVE_FAILED, identity: PACKAGED, serial: 4 });
    const html = documentOf({ url: consoleNoteUrl({ title: "Slopweaver needs you", view }) });
    expect(html).toContain("content=\"default-src 'none'; style-src 'unsafe-inline'\"");
    expect(html).not.toContain("<script");
    expect(html).toContain("<title>Slopweaver needs you</title>");
    expect(html).toContain("Error: &lt;port&gt; in use");
    expect(html).not.toContain("<port>");
    expect(html).toContain('<a class="act" href="slopweaver-shell://retry/4">Retry</a>');
    expect(html).toContain('<a class="detail" href="slopweaver-shell://dismiss/4">Not now</a>');
  });
});

describe("consoleNotePosition", () => {
  const workArea = { height: 1000, width: 1600, x: 0, y: 25 };

  it("sits in the top-right corner while no fleet note is up", () => {
    expect(consoleNotePosition({ above: undefined, workArea })).toEqual({ x: 1204, y: 41 });
  });

  it("sits under the fleet note when it is up", () => {
    expect(consoleNotePosition({ above: { height: 268, y: 41 }, workArea })).toEqual({ x: 1204, y: 321 });
  });
});
