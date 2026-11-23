/*
 * The published-page check an incident card's Open button rests on, asked of a plain fake store: a page the store
 * serves passes, one it holds no document for is refused as unpublished, and a store that could not say is refused
 * as unchecked, never as unpublished. The store's own `fileExists` is proven in
 * `src/__tests__/integration/publishedPagesRead.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { proofPageRefusal } from "../../../../../cli/commands/incident/cardPost.js";
import { err, ok } from "../../../../../lib/result.js";
import type { PagePublished } from "../../../../../pages/published.js";
import { PublishedPagesReadErrors } from "../../../../../store/publishedPages/readErrors.js";

/**
 * Ask for the refusal over a store answering `answer`, recording what it was asked.
 *
 * @param answer what the fake store says
 * @returns the refusal and every page asked about
 */
async function refusalOver({
  answer,
}: {
  answer: Awaited<ReturnType<PagePublished>>;
}): Promise<{ refusal: string | undefined; asked: string[] }> {
  const asked: string[] = [];
  const refusal = await proofPageRefusal({
    home: "/acme/home",
    opens: "the note opens them",
    pagePublished: async ({ home, slug }) => {
      asked.push(`${home}:${slug}`);
      return answer;
    },
    slug: "inc-98-receipts",
    verb: "incident note",
    what: "the receipts",
  });
  return { asked, refusal };
}

describe("proofPageRefusal", () => {
  it("passes a page the store serves, asking once for that page under that home", async () => {
    const { refusal, asked } = await refusalOver({ answer: ok(true) });

    expect(refusal).toBe(undefined);
    expect(asked).toEqual(["/acme/home:inc-98-receipts"]);
  });

  it("refuses a page the store holds no document for, naming how to publish it", async () => {
    const { refusal } = await refusalOver({ answer: ok(false) });

    expect(refusal).toBe(
      'incident note: proof "inc-98-receipts" is no published page (the store holds none by that name) — publish ' +
        "the receipts with `slopweaver page publish inc-98-receipts --page <file> --review <id>` (the review from " +
        "`slopweaver page review-prepare`) first, so the note opens them",
    );
  });

  it("refuses a store it could not read as unchecked, never as an unpublished page", async () => {
    const { refusal } = await refusalOver({
      answer: err(PublishedPagesReadErrors.unavailable({ cause: new Error("connection refused"), doing: "be opened" })),
    });

    expect(refusal).toBe(
      'incident note: could not check that proof "inc-98-receipts" is published, so nothing was posted: ' +
        "the published-page store did not be opened: connection refused",
    );
  });
});
