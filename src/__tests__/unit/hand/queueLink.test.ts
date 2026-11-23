/**
 * Which addresses are a deep link to one queue item — the link a note asking the owner to react must carry. Both
 * orders of the params, both spellings of the colon and any local port are the minting side's own shapes.
 */
import { describe, expect, it } from "vitest";

import {
  consoleQueueTarget,
  isConsoleQueueLink,
  isConsoleQueuePage,
  opensOwnHandStep,
} from "../../../hand/queueLink.js";

describe("isConsoleQueueLink", () => {
  it("accepts the link the console itself draws, with the colon encoded", () => {
    expect(
      isConsoleQueueLink({ url: "http://localhost:3000/queue?open=ask%3Aa-round-two-row-is-seated-and-opens" }),
    ).toBe(true);
  });

  it("accepts a raw colon, a context in either order, and another checkout's port", () => {
    expect(isConsoleQueueLink({ url: "http://localhost:3000/queue?open=hand:gcloud-signin" })).toBe(true);
    expect(isConsoleQueueLink({ url: "http://localhost:3000/queue?open=pr%3A1273&context=slopweaver" })).toBe(true);
    expect(isConsoleQueueLink({ url: "http://localhost:3100/queue?context=work&open=ask%3Aiso-word" })).toBe(true);
  });

  it("accepts the held-review card `github review-draft record` links to", () => {
    expect(isConsoleQueueLink({ url: "http://localhost:3000/queue?open=review%3Ard-0123abcd" })).toBe(true);
  });

  it("refuses a page that is not the queue, a published file page and a remote host", () => {
    expect(isConsoleQueueLink({ url: "http://localhost:3000/talk" })).toBe(false);
    expect(isConsoleQueueLink({ url: "file:///Users/someone/.slopweaver/pages/x/index.html" })).toBe(false);
    expect(isConsoleQueueLink({ url: "https://example.com/queue?open=ask%3Ax" })).toBe(false);
  });

  it("refuses a queue link that opens nothing, an unknown kind, an empty id or a third context", () => {
    expect(isConsoleQueueLink({ url: "http://localhost:3000/queue" })).toBe(false);
    expect(isConsoleQueueLink({ url: "http://localhost:3000/queue?open=row%3Ax" })).toBe(false);
    expect(isConsoleQueueLink({ url: "http://localhost:3000/queue?open=ask%3A" })).toBe(false);
    expect(isConsoleQueueLink({ url: "http://localhost:3000/queue?open=ask%3Ax&context=acme" })).toBe(false);
  });

  it("refuses a fragment, which would cut a raw # in an id short", () => {
    expect(isConsoleQueueLink({ url: "http://localhost:3000/queue?open=pr:owner/repo#12" })).toBe(false);
  });

  it("refuses a string that is not a url at all", () => {
    expect(isConsoleQueueLink({ url: "the queue" })).toBe(false);
  });
});

describe("isConsoleQueuePage", () => {
  it("is the queue page with or without an item open, on any local port", () => {
    expect(isConsoleQueuePage({ url: "http://localhost:3000/queue" })).toBe(true);
    expect(isConsoleQueuePage({ url: "http://localhost:3100/queue?open=ask%3Ax" })).toBe(true);
    expect(isConsoleQueuePage({ url: "http://127.0.0.1:3000/queue/" })).toBe(true);
  });

  it("is not another console page, a remote host or prose", () => {
    expect(isConsoleQueuePage({ url: "http://localhost:3000/talk" })).toBe(false);
    expect(isConsoleQueuePage({ url: "https://example.com/queue" })).toBe(false);
    expect(isConsoleQueuePage({ url: "the queue" })).toBe(false);
  });
});

describe("consoleQueueTarget", () => {
  it("names the kind and id a link opens, decoded, whatever the param order", () => {
    expect(
      consoleQueueTarget({
        url: "http://localhost:3000/queue?context=work&open=ask%3Aacme-post-16676-description-form",
      }),
    ).toEqual({ id: "acme-post-16676-description-form", kind: "ask" });
    expect(consoleQueueTarget({ url: "http://localhost:3000/queue?open=hand:gcloud-signin" })).toEqual({
      id: "gcloud-signin",
      kind: "hand",
    });
  });

  it("names nothing for a link isConsoleQueueLink refuses", () => {
    const refused = [
      "http://localhost:3000/queue",
      "http://localhost:3000/queue?open=row%3Ax",
      "http://localhost:3000/queue?open=ask%3Ax&context=acme",
      "http://localhost:3000/queue?open=pr:owner/repo#12",
      "https://example.com/queue?open=ask%3Ax",
    ];
    expect(refused.map((url) => consoleQueueTarget({ url }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("opensOwnHandStep", () => {
  it.each([
    "http://localhost:3000/queue?open=hand%3Amon-x&context=work",
    "https://console.example.org/queue?open=hand:mon-x",
    "https://host.example/console/queue/?context=slopweaver&open=hand%3Amon-x",
  ])("reads %s as the step's own card, on any configured console base", (url) => {
    expect(opensOwnHandStep({ id: "mon-x", url })).toBe(true);
  });

  it.each([
    "http://localhost:3000/queue?open=hand%3Amon-y",
    "http://localhost:3000/queue?open=ask%3Amon-x",
    "http://localhost:3000/queue?open=hand%3Amon-x#top",
    "http://localhost:3000/fleet?open=hand%3Amon-x",
    "file:///queue?open=hand%3Amon-x",
    "not a url",
  ])("reads %s as some other link", (url) => {
    expect(opensOwnHandStep({ id: "mon-x", url })).toBe(false);
  });
});
