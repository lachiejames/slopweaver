/**
 * Read every briefing a card links for the voice, before it says a word on the card (`../../lib/cardBriefings.ts`):
 * all at once, each read on its own, so one that will not open never stops the rest and comes back carrying the
 * sentence the voice says instead. The route reads it masked (`../../app/api/talk/briefing/[slug]/route.ts`).
 */
import type { BriefingRead } from "../../lib/briefingRead";
import { briefingReadFromBody, cardBriefingOf, type ReadCardBriefing } from "../../lib/cardBriefings";

/** One briefing's read, by slug — the route in the console, a plain fake in a test. */
export type ReadBriefing = (input: { readonly slug: string }) => Promise<BriefingRead>;

/**
 * Read one briefing through the console's briefing route, never a rejection.
 *
 * @param slug the briefing's page name
 * @returns what reading it came to
 */
export async function fetchBriefing({ slug }: { slug: string }): Promise<BriefingRead> {
  try {
    const response = await fetch(`/api/talk/briefing/${encodeURIComponent(slug)}`, {
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json();
    return briefingReadFromBody({ body });
  } catch (cause) {
    return { ok: false, why: cause instanceof Error ? cause.message : "the briefing route did not answer" };
  }
}

/**
 * Every briefing a card links, read, in the card's order.
 *
 * @param slugs the briefings' page names
 * @param files each briefing's file off the card's own addresses (`../../lib/openCard.ts` `briefingFilesOf`): a read
 *   that fails for one named here is handed on for the voice to read through `file_read`
 * @param readBriefing the masked route in the console, a plain fake in a test
 * @returns each briefing as the voice is handed it
 */
export async function readCardBriefings({
  slugs,
  files,
  readBriefing,
}: {
  slugs: readonly string[];
  files: ReadonlyMap<string, string>;
  readBriefing: ReadBriefing;
}): Promise<readonly ReadCardBriefing[]> {
  return Promise.all(
    slugs.map(async (slug) => {
      const file = files.get(slug);
      try {
        return cardBriefingOf({ file, read: await readBriefing({ slug }), slug });
      } catch (cause) {
        const why = cause instanceof Error ? cause.message : "the briefing could not be read";
        return cardBriefingOf({ file, read: { ok: false, why }, slug });
      }
    }),
  );
}
