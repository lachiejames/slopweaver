/**
 * Whether a `pr:<owner>.<repo>.<n>` card's pull request is the OWNER'S — the one console card kind whose subject
 * somebody else can own.
 *
 * The standing rule lands every word the owner says while a card is open on that card, which is right only when the
 * card is the owner's to answer. A bump seat's every-author landing reading once put a colleague's pull request on the
 * owner's Queue as a name-the-reviewer card, and each of the twenty-three utterances spoken with it open landed on it
 * as a `talk-card-*` row — twenty-one of them about other work entirely. So a `pr:` card landing is refused only when
 * the newest landing reading says somebody else opened its pull request.
 *
 * Only POSITIVE evidence refuses. The census is GitHub's own open list, every author, carrying the login the token
 * read as (`viewer`), so even an `@me` reading answers whose an OPEN pull request is. A pull request the reading
 * does not list at all — the owner's, merged since, or closed — is not refused: the reading lists open ones only, and
 * a rule-1 landing merges the owner's own within minutes, while `talk land` still has to close the owner's steer on it
 * afterwards. Only the card's OWN repository is consulted: a colleague's pull request in another repository says
 * nothing about the owner's. Pure: the caller reads the ledger.
 */
import { isRecord } from "#lib/parsers.js";

import { prCardKeyParts } from "./prCardKey.js";

/** What the newest landing reading says about one `pr:` card's pull request. */
export type CardSubject = { readonly kind: "owner" } | { readonly kind: "not-owner"; readonly why: string };

/** One census listing of the card's pull request: who opened it, and who the read was taken as. */
interface CensusListing {
  readonly author: string | undefined;
  readonly viewer: string;
}

/**
 * Decide whether the pull request a `pr:` card names is the owner's, from the newest landing document.
 *
 * @param cardKey the whole card key, repository and number, as the console mints it (`./prCardKey.ts`)
 * @param document the newest landing reading's document, as parsed off the ledger
 * @param observedAtIso when that reading was true of GitHub, named in every refusal
 * @returns the owner-subject verdict, or the not-owner verdict with the sentence a refusal prints
 */
export function prCardSubject({
  cardKey,
  document,
  observedAtIso,
}: {
  cardKey: string;
  document: unknown;
  observedAtIso: string;
}): CardSubject {
  const subject = prCardKeyParts({ key: cardKey });
  if (subject === undefined) {
    return { kind: "not-owner", why: `"${cardKey}" names no pull request by repository and number` };
  }
  if (!isRecord(document)) {
    return { kind: "owner" };
  }
  const listings = censusListings({ document, ...subject });
  const first = listings[0];
  const ownerListed = listings.some((listing) => listing.author?.toLowerCase() === listing.viewer.toLowerCase());
  if (first === undefined || ownerListed) {
    return { kind: "owner" };
  }
  const named = `${subject.repoSlug}#${String(subject.number)}`;
  return {
    kind: "not-owner",
    why: `${named} was opened by ${authorName({ author: first.author })}, not ${first.viewer} (the landing reading of ${observedAtIso})`,
  };
}

/**
 * Every census entry of the card's own repository that lists the pull request — the repository compared without case,
 * as GitHub resolves it.
 *
 * @returns each listing with its repository's viewer; an `unread` repository lists nothing
 */
function censusListings({
  document,
  number,
  repoSlug,
}: {
  document: Readonly<Record<string, unknown>>;
  number: number;
  repoSlug: string;
}): readonly CensusListing[] {
  const census = document["census"];
  if (!Array.isArray(census)) {
    return [];
  }
  return census.flatMap((entry: unknown): CensusListing[] => {
    if (!isRecord(entry) || entry["kind"] !== "read") {
      return [];
    }
    const { pullRequests, repo, viewer } = entry;
    if (typeof viewer !== "string" || typeof repo !== "string" || !Array.isArray(pullRequests)) {
      return [];
    }
    if (repo.toLowerCase() !== repoSlug.toLowerCase()) {
      return [];
    }
    const listed: readonly unknown[] = pullRequests;
    return listed
      .filter((pr): pr is Record<string, unknown> => isRecord(pr) && pr["number"] === number)
      .map((pr) => {
        const author = pr["author"];
        return { author: typeof author === "string" ? author : undefined, viewer };
      });
  });
}

/** How a refusal names who opened it; GitHub lists a deleted account with no author. */
function authorName({ author }: { author: string | undefined }): string {
  if (author === undefined) {
    return "a deleted account";
  }
  return author;
}
