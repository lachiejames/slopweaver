/**
 * A Queue card whose board row has an ARTIFACT cites it as its first chip, and is refused when it does not.
 *
 * The voice must never read the owner a link the card does not show: a link the owner can open in a browser belongs on
 * the card, not held somewhere only the voice sees. Measured: a row carried its page as an artifact for two days, the
 * voice read it to the owner, and the card drew no link. A row records where its answer lives with `handover artifact`, and
 * its prose rarely repeats the address — the recording verbs refuse a `file://` page in a question
 * (`src/handover/cardHtml.ts`) — so a card that read prose alone linked nowhere.
 *
 * {@link withArtifactPage} is the builders' half; {@link artifactCitedForm} is the schema half of `AGENTS.md` rule 7,
 * so a later builder that drops the chip draws a refusal naming the missing address rather than a linkless card.
 *
 * Apart from `./queueCard.ts` because that module imports nothing and sits at its line cap.
 */
import type { BoardRow, HandStep } from "../components/live/read";
import type { QueueCardForm } from "./briefingCardForm";
import { localPageSlugOf } from "./localPageHref";
import { type CardPage, subjectLabel } from "./queueCard";
import { queueLinkTarget } from "./queueLink";

/**
 * The shape an address a chip may link to starts with: a web page or a local file, with no whitespace. The artifact
 * verbs accept any non-blank text, so a `javascript:` or `data:` artifact, a bare path or a `codex://` thread never
 * becomes a link.
 */
const LINKABLE_ADDRESS = /^(?:https?|file):\/\/\S+$/iu;

/**
 * Whether a chip may link to an address: its scheme is web or file AND the URL parser accepts it. The shape alone
 * passed `https://%`, `https://[::1` and `http://?x`, which then drew as a link that opens nothing.
 */
function linkable({ address }: { address: string }): boolean {
  return LINKABLE_ADDRESS.test(address) && URL.canParse(address);
}

/**
 * The chip one artifact draws: a published page under its own slug, a web address — a pull request, say — named as
 * {@link subjectLabel} names a subject, less any scheme it leaves. A `file:` address that is no published page draws
 * none, since the console routes only those. The chip's address is the artifact's own,
 * byte for byte: prose scanning trims trailing punctuation a recorded address may really end in.
 *
 * @param artifact the row's published artifact, absent on a row with none
 * @returns the chip, or `undefined` for an absent artifact or one that is no web or file address
 */
export function artifactPage({ artifact }: { artifact: string | undefined }): CardPage | undefined {
  const address = artifact?.trim();
  if (address === undefined || !linkable({ address })) {
    return undefined;
  }
  if (/^file:/iu.test(address)) {
    // The console routes only a published page; any other `file:` address draws a link Chrome refuses.
    const slug = localPageSlugOf({ url: address });
    return slug === undefined ? undefined : { slug, url: address };
  }
  return { slug: subjectLabel({ subject: address }).replace(/^[a-z]+:\/\//iu, ""), url: address };
}

/**
 * The page the ask a hand step opens published, read off its board row RAW like `./handStepAsk.ts`'s `openedAskAction`:
 * an unshaped ask joins no decision, yet the step still points at its page. Of two rows sharing
 * the slug, the FIRST is read — the row `linkedHandDecision` joins — so a card never pairs one row's decision with
 * another row's page.
 *
 * @param step the hand step
 * @param rows every board row, unfiltered
 * @returns the artifact, or `undefined` when the step opens no ask or its ask published none
 */
export function openedAskArtifact({ step, rows }: { step: HandStep; rows: readonly BoardRow[] }): string | undefined {
  const target = queueLinkTarget({ url: step.url });
  if (target?.kind !== "ask") {
    return undefined;
  }
  return rows.find((row) => row.slug === target.id)?.artifact;
}

/**
 * The card with its row's artifact cited first, ahead of the pages its prose named, each once.
 *
 * @param artifact the row's published artifact, absent on a row with none
 * @param card the built card, whose pages its prose named
 * @returns the card, its pages led by the artifact's
 */
export function withArtifactPage<Card extends { readonly pages: readonly CardPage[] }>({
  artifact,
  card,
}: {
  artifact: string | undefined;
  card: Card;
}): Card {
  const cited = artifactPage({ artifact });
  if (cited === undefined) {
    return card;
  }
  return { ...card, pages: [cited, ...card.pages.filter((page) => page.url !== cited.url)] };
}

/**
 * Whether a card may be drawn given its row's artifact: refused, naming the address, when its first chip is not it — or
 * when the address is no web or file address a chip could open. That refusal never quotes the text: a refusal draws
 * through the card's sentence linker, so `see https://example.com/a` or `https://%` quoted there became a link after
 * all.
 *
 * @param artifact the row's published artifact, absent on a row with none
 * @param pages the citation chips the built card draws
 * @returns `drawn`, or the refusal
 */
export function artifactCitedForm({
  artifact,
  pages,
}: {
  artifact: string | undefined;
  pages: readonly CardPage[];
}): QueueCardForm {
  // Only an ABSENT artifact is none: a published blank one (`artifact: "   "`) is text no chip opens.
  if (artifact === undefined) {
    return { kind: "drawn" };
  }
  const cited = artifactPage({ artifact });
  if (cited === undefined) {
    return {
      kind: "refused",
      why:
        "This card's row records its answer at no web or file address a chip can open, so it is refused rather " +
        "than drawn with the voice reading a place the owner cannot follow.",
    };
  }
  if (pages.at(0)?.url === cited.url) {
    return { kind: "drawn" };
  }
  return {
    kind: "refused",
    why:
      `This card's row publishes its answer at ${cited.url}, and the card does not cite it first; the voice could ` +
      "read a page the owner could not find, so it is refused rather than drawn without its link leading.",
  };
}
