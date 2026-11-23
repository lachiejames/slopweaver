/**
 * A published page open in the viewer is read for `read_page` as its own words, fresh at every read: the reference is
 * recognised only in its exact shape, crosses the desktop carry, and resolves through the masked briefing read.
 */
import { describe, expect, it } from "vitest";

import type { BriefingRead } from "../../lib/briefingRead";
import { carriedPageView, identityForShell, pageReadingForShell } from "../../lib/desktopPageReading";
import { PAGE_READ_MAX_BYTES, type PageView } from "../../lib/pageVoice";
import {
  publishedPageReference,
  publishedPageSlugOf,
  resolvedPageView,
  withPublishedPageRead,
} from "../../lib/publishedPageVoice";

const SLUG = "acme-briefing";

/** The viewer on a published page, registered in this window. */
const VIEWER: PageView = {
  open: undefined,
  openBy: undefined,
  path: "/view",
  shows: publishedPageReference({ slug: SLUG }),
  title: "Acme briefing",
};

const WHOLE: BriefingRead = {
  masked: false,
  nextFrom: null,
  ok: true,
  path: `/home/pages/${SLUG}/index.html`,
  text: "1 Why. 2 What. 3 What can leave the machine.",
  whole: true,
};

describe("publishedPageSlugOf", () => {
  it("names the slug of an exact reference registered in this window", () => {
    expect(publishedPageSlugOf({ view: VIEWER })).toBe(SLUG);
  });

  it("names the slug of a reference the console window carried to the voice's window", () => {
    const carried: PageView = { ...VIEWER, carried: { kind: "carried", shows: VIEWER.shows, truncated: undefined } };
    expect(publishedPageSlugOf({ view: { ...carried, shows: undefined } })).toBe(SLUG);
  });

  it("refuses another kind, an extra field, a slug the store would refuse, and an ordinary reading", () => {
    const of = ({ shows }: { shows: unknown }): string | undefined =>
      publishedPageSlugOf({ view: { ...VIEWER, shows } });
    expect(of({ shows: { kind: "queue", slug: SLUG } })).toBe(undefined);
    expect(of({ shows: { kind: "published-page", slug: SLUG, words: "x" } })).toBe(undefined);
    expect(of({ shows: { kind: "published-page", slug: "../etc" } })).toBe(undefined);
    expect(of({ shows: { drawnMore: 0, rows: [] } })).toBe(undefined);
    expect(of({ shows: undefined })).toBe(undefined);
  });
});

describe("withPublishedPageRead", () => {
  it("replaces the reference with the page's words, read whole", () => {
    const view = withPublishedPageRead({ read: WHOLE, slug: SLUG, view: VIEWER });
    expect(view.shows).toEqual({
      publishedPage: { read: true, slug: SLUG, source: { masked: false, path: WHOLE.path }, text: WHOLE.text },
    });
  });

  it("carries where the rest starts for a page read in part", () => {
    const part: BriefingRead = { ...WHOLE, nextFrom: 9, whole: false };
    const view = withPublishedPageRead({ read: part, slug: SLUG, view: VIEWER });
    expect(view.shows).toEqual({
      publishedPage: {
        read: "partial",
        rest: { from: 9, path: WHOLE.path },
        say: `I could only read the first part of the ${SLUG} briefing.`,
        slug: SLUG,
        source: { masked: false, path: WHOLE.path },
        text: WHOLE.text,
      },
    });
  });

  it("says why a page that would not read did not", () => {
    const view = withPublishedPageRead({ read: { ok: false, why: "it is gone" }, slug: SLUG, view: VIEWER });
    expect(view.shows).toEqual({
      publishedPage: {
        read: false,
        say: `I couldn't open the ${SLUG} briefing, so I can't read that to you.`,
        slug: SLUG,
        why: "it is gone",
      },
    });
  });

  it("drops the carried state, so a page read in the voice's window reads on as its own", () => {
    const carried: PageView = { ...VIEWER, carried: { kind: "carried", shows: VIEWER.shows, truncated: undefined } };
    const view = withPublishedPageRead({ read: WHOLE, slug: SLUG, view: carried });
    expect("carried" in view).toBe(false);
  });
});

describe("resolvedPageView", () => {
  it("reads the page again on every call, so a republish is what the next read answers", async () => {
    const cuts = ["the first cut", "the second cut"];
    const asked: string[] = [];
    const readBriefing = async ({ slug }: { readonly slug: string }): Promise<BriefingRead> => {
      asked.push(slug);
      return { ...WHOLE, text: cuts[asked.length - 1] };
    };
    const first = await resolvedPageView({ readBriefing, view: VIEWER });
    const second = await resolvedPageView({ readBriefing, view: VIEWER });
    expect(asked).toEqual([SLUG, SLUG]);
    expect(first.shows).toEqual({
      publishedPage: { read: true, slug: SLUG, source: { masked: false, path: WHOLE.path }, text: "the first cut" },
    });
    expect(second.shows).toEqual({
      publishedPage: { read: true, slug: SLUG, source: { masked: false, path: WHOLE.path }, text: "the second cut" },
    });
  });

  it("reads nothing for a page that is not a published page in the viewer", async () => {
    const asked: string[] = [];
    const readBriefing = async ({ slug }: { readonly slug: string }): Promise<BriefingRead> => {
      asked.push(slug);
      return WHOLE;
    };
    const queue: PageView = { ...VIEWER, path: "/queue", shows: { rows: [] }, title: "Queue" };
    const view = await resolvedPageView({ readBriefing, view: queue });
    expect(view).toBe(queue);
    expect(asked).toEqual([]);
  });
});

describe("the desktop carry", () => {
  it("carries the reference, never the page's words, and recovers it whole on the voice's side", () => {
    const carried = pageReadingForShell({ maxBytes: PAGE_READ_MAX_BYTES, view: VIEWER });
    const wire = identityForShell({
      carriesOpenCard: true,
      carriesOpenTitle: true,
      carriesPageReading: true,
      identity: { path: "/view", reading: carried, title: VIEWER.title },
    });
    expect(wire.reading).toBe(JSON.stringify({ shows: { kind: "published-page", slug: SLUG } }));
    const view = carriedPageView({ identity: { path: "/view", reading: carried, title: VIEWER.title } });
    expect(publishedPageSlugOf({ view })).toBe(SLUG);
  });
});
