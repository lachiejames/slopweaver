/*
 * The queue link `hand post` checks and the item the console reads out of it are one grammar.
 *
 * `site/lib/queueLink.ts` restates `src/hand/queueLink.ts`'s `consoleQueueTarget` because a file under `site/`
 * may not import one under `src/`; this file, in the lane that reaches both roots, drives one table through both
 * so a change to either that the other misses fails here.
 */

import { describe, expect, it } from "vitest";

import { consoleQueueTarget, opensOwnHandStep as opensOwnHandStepSrc } from "../../../src/hand/queueLink";
import { opensOwnHandStep, queueLinkTarget } from "../../lib/queueLink";

const URLS = [
  "http://localhost:3000/queue?open=ask%3Aacme-post-16676-description-form",
  "http://localhost:3000/queue?context=work&open=ask%3Aiso-word",
  "http://127.0.0.1:3100/queue/?open=hand:gcloud-signin",
  "http://localhost:3000/queue?open=pr%3A1273&context=slopweaver",
  "http://localhost.:3000/queue?open=ask%3Aa",
  "http://[::1]:3000/queue?open=ask%3Aa",
  "http://127.0.0.2:3000/queue?open=ask%3Aa",
  "http://128.0.0.1:3000/queue?open=ask%3Aa",
  "http://localhost:3000/%71ueue?open=ask%3Aa",
  "http://localhost:3000/%E0%A4%A/queue?open=ask%3Aa",
  "http://localhost:3000/que%2Fue?open=ask%3Aa",
  "http://localhost:3000/queue?open=ask:ever&open=ask:slop",
  "http://localhost:3000/queue?open=ask%3Aa#",
  "http://localhost:3000/queue?open=ask:ever&context=work&context=slopweaver",
  "http://localhost:3000/queue",
  "http://localhost:3000/queue?open=row%3Ax",
  "http://localhost:3000/queue?open=ask%3A",
  "http://localhost:3000/queue?open=ask%3Ax&context=acme",
  "http://localhost:3000/queue?open=pr:owner/repo#12",
  "https://example.com/queue?open=ask%3Ax",
  "http://localhost:3000/talk?open=ask%3Ax",
  "the queue",
];

describe("queueLinkTarget", () => {
  it("reads the kind and id out of the link a decision step carries", () => {
    expect(queueLinkTarget({ url: URLS[0] })).toEqual({ id: "acme-post-16676-description-form", kind: "ask" });
    expect(queueLinkTarget({ url: URLS[2] })).toEqual({ id: "gcloud-signin", kind: "hand" });
  });

  it("reads nothing out of an absent address", () => {
    expect(queueLinkTarget({ url: undefined })).toBe(undefined);
  });

  it("agrees with the grammar hand post checks, on every accepted and refused shape", () => {
    expect(URLS.length).toBeGreaterThan(0);
    expect(URLS.map((url) => queueLinkTarget({ url }))).toEqual(URLS.map((url) => consoleQueueTarget({ url })));
    expect(URLS.filter((url) => queueLinkTarget({ url }) !== undefined).length).toBe(8);
  });
});

const SELF_LINKS = [
  "http://localhost:3000/queue?open=hand%3Amon-x&context=work",
  "https://console.example.org/queue?open=hand:mon-x",
  "https://host.example/console/queue/?context=slopweaver&open=hand%3Amon-x",
  "http://localhost:3000/queue?open=hand%3Amon-y",
  "http://localhost:3000/queue?open=ask%3Amon-x",
  "http://localhost:3000/queue?open=hand%3Amon-x#top",
  "http://localhost:3000/queue?open=hand%3Amon-x#",
  "https://console.example.org/queue?open=hand%3Amon-x&/queue?open=hand%3Amon-x&context=work",
  "https://console.example.org/queue?open=hand%3Amon-x&open=hand%3Amon-x",
  "http://localhost:3000/queue?open=hand%3Amon-x&open=hand%3Amon-y",
  "http://localhost:3000/fleet?open=hand%3Amon-x",
  "file:///queue?open=hand%3Amon-x",
  "not a url",
];

describe("opensOwnHandStep", () => {
  it("agrees with the self-link the posting gate admits a carried decision beside, on any console base", () => {
    expect(SELF_LINKS.map((url) => opensOwnHandStep({ id: "mon-x", url }))).toEqual(
      SELF_LINKS.map((url) => opensOwnHandStepSrc({ id: "mon-x", url })),
    );
    expect(SELF_LINKS.filter((url) => opensOwnHandStep({ id: "mon-x", url })).length).toBe(6);
  });
});
