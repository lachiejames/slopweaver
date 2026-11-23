/**
 * The bare-reference half of the briefing gate: a `#N`, `owner/repo#N` or `SUP-N` sitting in the page
 * as plain text rather than a real link.
 *
 * Owner ruling: a bare `#N`/`SUP-N` must never reach an outbound surface as plaintext, even when the same
 * message links some references and leaves others bare. `skills/supervisor/
 * reference/fleet-briefing-shape.md` extends that ruling to a fleet-briefing
 * react-now draft — a card proposing a Slack post is exactly the kind of composed prose the original ruling
 * is about, and without this file `briefing check` would never look for one at all.
 *
 * ## Reusing the door, not reinventing it
 *
 * `../outbound/linkify/bareRefs.ts` already does the actual finding and resolving — the same module every
 * other outbound door (`../outbound/github/bareRefLinks.ts`, `../outbound/notion/bareRefLinks.ts`, `../
 * outbound/linear/bareRefLinks.ts`, `../outbound/artifact/bareRefRuns.ts`) calls. This file's only job is
 * supplying it a {@link BareRefContext} built from the PAGE ITSELF and running it over the page's own text.
 *
 * ## "Resolving owner/repo from the surrounding link" means the reference's own ENTRY first
 *
 * A bare `#N` inside one entry — a react-now card, or one note below the line — resolves against the
 * repository of the NEAREST full GitHub link in that same entry (`./entryBareRefContext.ts`, placed by
 * `./placedBareRefs.ts`; the form writer `./qualifyBareRefs.ts` asks {@link resolvedGithubRefsOf} rather than
 * applying it). Only an entry linking nothing falls back to the PAGE context, which
 * reads every `<a href="https://github.com/…">` on the page into `context.repos` and resolves by the same
 * "sole repo" rule `resolveBareRef` applies for every other door. Two distinct repos there is a real
 * ambiguity this module does not guess through. One unrelated row
 * linking a second repository would turn every note below it that cites a bare number into a refusal, which
 * is why the entry comes first.
 *
 * Those same links also carry the page's MAGNITUDE evidence — the object numbers they prove exist in each
 * repo — because naming one repo is not the same as a number being able to belong to it. A page whose only
 * repo link names a pull request with a small number and whose prose carries a bare five-digit number is citing a second repository
 * without saying so, and the resolver refuses rather than pointing at an unrelated object. See
 * `../outbound/linkify/bareRefs.ts`'s "a number that CANNOT be one of this repo's own" section.
 *
 * ## Why an anchor and a code span are excluded before scanning
 *
 * An `<a>…</a>` is removed WHOLESALE (tag and label both) before the text is read, so a reference that is
 * already a real link is never re-flagged as its own residue — a card that reads "see #N" as a hyperlink
 * has nothing left to find once the anchor is gone. A `<code>…</code>` span is removed the same way `../
 * outbound/linkify/bareRefs.ts`'s own markdown path skips a fenced or inline code span: a `#N` a composer
 * meant literally (documenting the syntax itself, say) is not a reference to resolve.
 */
import {
  type AttestedNumber,
  attestedNumbersInText,
  type BareRefContext,
  bareRefRefusalMessage,
  type RepoRef,
  resolveBareRef,
} from "../outbound/linkify/bareRefs.js";
import { isLocalPageUrl } from "../pages/url.js";
import { type PagePlace, placesOfReactNow, placesOfRegion } from "./pagePlaces.js";
import {
  ANY_SCAN_MARK_CHARACTER,
  type BareRefRegion,
  ENTRY_OR_LINK_MARK_CHARACTER,
  GITHUB_LINK,
  type MarkedAnchor,
  PAGE_MARK_STAND_IN,
  placedRefs,
  type ReadPlace,
  withEntryMarks,
  withLinkMarks,
} from "./placedBareRefs.js";
import { reactNowRegion } from "./reactNowCard.js";
import { withoutQuoted } from "./text.js";

/** One bare reference the page still carries as plain text. */
interface BareRefDefect {
  readonly region: BareRefRegion;
  /** The card, or the section heading and folds, it sits in — see `./pagePlaces.ts`. */
  readonly where: string;
  readonly reason: string;
}

/** What scanning one fleet-briefing artifact for bare references found. */
export interface BareRefPageCheck {
  readonly defects: readonly BareRefDefect[];
}

const LINEAR_LINK = /<a href="https:\/\/linear\.app\/([^"/]+)\/issue\/([A-Z]{2,6}-\d{1,6})">/g;

/**
 * An anchor (tag and label both), a code span, or a `<style>`/`<script>` block, removed wholesale before
 * scanning for residue.
 *
 * The chrome's own CSS carries hex colours shaped exactly like a bare digit reference — `--ground: #131619;`
 * matched {@link GITHUB_HASH_REF}'s bare-`#` arm before this was added, refusing every rendered page over a
 * custom property nobody wrote as prose. `../../briefing/pageBudget.ts`'s own `STYLE_OR_SCRIPT` strips the
 * same two elements before it measures anything, for the same reason.
 */
const ANCHOR_OR_CODE =
  /<!--[\s\S]*?-->|<a\b[^>]*>[\s\S]*?<\/a>|<code>[\s\S]*?<\/code>|<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Strip every excluded element, repeating the pass until none remain — the same fixed-point loop
 * `./text.ts`'s own `stripTags` uses, and for the same reason: a single pass over `<a<a href="x">y</a>href="z">`
 * leaves an opening `<a href="z">` behind, because the nested delimiters only become adjacent once the inner
 * element is gone. This text is only ever scanned for bare references, never re-emitted as markup, but a
 * single-pass strip is still the wrong tool — it is what a scanner reads as "sanitized" without the property
 * actually holding.
 *
 * @param html the region's markup
 * @returns the markup with every comment, anchor, code span and style/script block removed
 */
function withoutAnchorsAndCode({ html }: { html: string }): string {
  let current = html;
  let previous: string;
  do {
    previous = current;
    current = current.replace(ANCHOR_OR_CODE, "");
  } while (current !== previous);
  return current;
}

/**
 * The {@link BareRefContext} this page's own links supply: every distinct repo a GitHub link on the page
 * names, the object numbers those links prove exist in each of them, and the Linear workspace slug plus
 * team-key prefixes every Linear link on the page names.
 *
 * The numbers are the page's own magnitude evidence — a page that links a pull request with a small number and carries a
 * bare five-digit reference is citing a second repository without saying so, and the resolver refuses rather than
 * pointing the reader at an unrelated object. See `../outbound/linkify/bareRefs.ts`'s "a number that CANNOT
 * be one of this repo's own" section.
 *
 * @param html the whole artifact file
 * @returns the context every bare reference on the page resolves against
 */
export function bareRefContextOfPage({ html }: { html: string }): BareRefContext {
  const repos = new Map<string, RepoRef>();
  const attested: AttestedNumber[] = [];
  for (const match of html.matchAll(GITHUB_LINK)) {
    const [, owner, repo] = match;
    if (owner !== undefined && repo !== undefined) {
      repos.set(`${owner}/${repo}`, { owner, repo });
    }
    attested.push(...attestedNumbersInText({ text: match[0] }));
  }
  const linearTeamKeys = new Set<string>();
  for (const match of html.matchAll(LINEAR_LINK)) {
    const [, , key] = match;
    if (key !== undefined) {
      linearTeamKeys.add(key.slice(0, key.lastIndexOf("-")));
    }
  }
  const linearWorkspaceSlug = firstLinearWorkspace({ html });
  return { attested, linearTeamKeys: [...linearTeamKeys], linearWorkspaceSlug, repos: [...repos.values()] };
}

/**
 * The workspace slug the page's FIRST Linear link names. A page that links no Linear issue names no workspace
 * at all, so there is nothing for a bare `TEAM-123` on it to resolve into.
 */
function firstLinearWorkspace({ html }: { html: string }): string | undefined {
  const first = html.matchAll(LINEAR_LINK).next();
  if (first.done === true) {
    return undefined;
  }
  // The slug group is not optional, so every match carries it.
  return first.value[1]!;
}

/**
 * A URL sitting in the page's own text, after every anchor and code span has been removed.
 *
 * By construction this can only match a URL that rendered as INERT text — an `<a href="…">…</a>` is stripped
 * wholesale before the scan, so a link that works leaves nothing to find. That is the whole test, and it is
 * why this belongs beside the bare-reference scan rather than in its own leg: both answer "is a reference
 * sitting here as plaintext", and a URL is the reference class the original rule never named.
 *
 * The `file:` arm spells a local page's whole shape rather than matching the scheme loosely, for the reason
 * `../outbound/briefing/render.ts`'s `BARE_URL` gives: a loose match CONSUMES a non-page address before
 * anything can reject it, so an http URL written straight after one is swallowed with it and never seen.
 * The two have to agree in any case — this gate exists to catch what that renderer could not reach, so a
 * scheme one links and the other does not flag is a hole, and one it flags and the renderer cannot link is a
 * page refused with no way to fix it.
 */
const BARE_URL_IN_TEXT = /https?:\/\/\S+|file:\/\/\/[^\s<>"':,]*\/pages\/[A-Za-z0-9][A-Za-z0-9._-]*\/index\.html/g;

/**
 * Every URL still sitting in one region as inert text a reader has to select and copy.
 *
 * A URL that is not a link makes the owner double-click to highlight it, copy it, open a new tab and paste
 * it, which is a bad experience. A live fleet briefing carried twenty-three of them, nineteen
 * inside react-now card folds. Reproduce the class over any rendered page with `slopweaver briefing check <html>`.
 *
 * `../outbound/briefing/render.ts` now links every one of these as it renders, so a page that came through
 * `briefing render` cannot trip this. It fires for the pages that gate cannot reach: one a session
 * hand-wrote, and one an older renderer produced. That is the same division of labour every other half of
 * this gate already has.
 */
function bareUrlDefectsOfPlace({ place, region, text }: ReadPlace): readonly BareRefDefect[] {
  // A page-SHAPED `file:` address whose path cannot name a real file — an encoded NUL in an ancestor, say —
  // is dropped rather than flagged: the renderer does not link one either, so flagging it would refuse a page
  // over text that is already as good as that text can be. Dropping is safe HERE and is not in the renderer,
  // because this only loses a finding, where the renderer would lose the characters themselves.
  const found = [...new Set(Array.from(text.matchAll(BARE_URL_IN_TEXT), ([url]) => url))].filter(
    (url) => !url.startsWith("file:") || isLocalPageUrl({ url }),
  );
  return found.map((url) => ({
    reason:
      `\`${url}\` sits in the text as plain characters rather than a link, so reading it costs the owner a ` +
      "select, a copy and a new tab. Write it as a `link` run carrying the title beside it.",
    region,
    where: place.where,
  }));
}

/**
 * The page's places in the order {@link checkBareRefs} reads them, marked, stripped and cut, with every GitHub
 * link they hold.
 *
 * @param html the whole artifact file
 * @returns the places of the react-now block, then the rest of the page, and the links the marks index
 */
function markedPlacesOfPage({ html }: { html: string }): {
  places: readonly { place: PagePlace; region: BareRefRegion }[];
  anchors: readonly MarkedAnchor[];
} {
  const anchors: MarkedAnchor[] = [];
  // Annotated so the arrow INHERITS `placesOfReactNow`'s `strip` seam rather than restating it.
  const strip: (html: string) => string = (region) =>
    withoutAnchorsAndCode({ html: withLinkMarks({ anchors, html: withoutQuoted({ html: region }) }) });
  const { block, outside } = reactNowRegion({ html: html.replace(ANY_SCAN_MARK_CHARACTER, PAGE_MARK_STAND_IN) });
  const inBlock = block === undefined ? [] : placesOfReactNow({ block: withEntryMarks({ html: block }), strip });
  const outsidePlaces = placesOfRegion({ html: strip(withEntryMarks({ html: outside })), section: undefined });
  return {
    anchors,
    places: [
      ...inBlock.map((place) => ({ place, region: "react-now" as const })),
      ...outsidePlaces.map((place) => ({ place, region: "page" as const })),
    ],
  };
}

/**
 * A rendered fragment's places, read exactly as {@link checkBareRefs} reads the page outside its react-now
 * block, with every GitHub link they hold.
 *
 * @param marked the fragment, with every page-supplied mark character already swapped for the stand-in
 * @returns the fragment's places and the links the marks index
 */
function markedPlacesOfFragment({ marked }: { marked: string }): {
  places: readonly { place: PagePlace; region: BareRefRegion }[];
  anchors: readonly MarkedAnchor[];
} {
  const anchors: MarkedAnchor[] = [];
  const entries = withEntryMarks({ html: marked });
  const stripped = withoutAnchorsAndCode({ html: withLinkMarks({ anchors, html: withoutQuoted({ html: entries }) }) });
  const places = placesOfRegion({ html: stripped, section: undefined }).map((place) => ({
    place,
    region: "page" as const,
  }));
  return { anchors, places };
}

/** One reference a rendered fragment carries as plain text. */
export interface PlainTextRef {
  readonly raw: string;
  /** The card, or the heading and folds, it sits in. */
  readonly where: string;
  /** This check's own refusal when the fragment's links cannot resolve it; undefined when they can. */
  readonly refusal: string | undefined;
}

/**
 * Every bare reference a rendered FRAGMENT leaves as plain text, read exactly as {@link checkBareRefs} reads
 * the page outside its react-now block — quoted folds, anchors and code removed whole, then each card, heading
 * and fold scanned on its own — keeping the ones the fragment's own links resolve as well as the ones they
 * cannot. A writer judging one piece of a page before the page exists needs both: the page it lands on may
 * link a second repository, and then nothing resolves a bare `#N` at all.
 *
 * @param html the rendered fragment
 * @returns one entry per reference left as text, in page order
 */
export function plainTextRefsOf({ html }: { html: string }): readonly PlainTextRef[] {
  const { anchors, places } = markedPlacesOfFragment({
    marked: html.replace(ANY_SCAN_MARK_CHARACTER, PAGE_MARK_STAND_IN),
  });
  const { refs } = placedRefs({ anchors, fallback: bareRefContextOfPage({ html }), places });
  return refs.map(({ context, place, span }) => ({
    raw: span.raw,
    refusal: resolveBareRef({ context, span }) === undefined ? bareRefRefusalMessage({ context, span }) : undefined,
    where: place.where,
  }));
}

/** One bare `#N` a rendered fragment carries, and the one repository this check resolves it against. */
export interface ResolvedGithubRef {
  readonly raw: string;
  /** The repository its entry resolves it to; undefined when this check would refuse it. */
  readonly repo: RepoRef | undefined;
  /** The `spanMarked` reference of the writer's this one exactly is, or undefined. */
  readonly writerSpan: number | undefined;
}

/**
 * Every bare GitHub reference — `#N`, or a PR-list number, never one already spelled `owner/repo#N` — a
 * rendered fragment leaves as plain text, with the repository {@link checkBareRefs} resolves it against when
 * the fragment sits on a page whose own context is `fallback`. This is the form writer's ONE source of truth
 * (`./qualifyBareRefs.ts`): a repository it writes down is one this check read off the same rendered bytes,
 * never one it measured its own way. A fragment whose references were fenced with `./placedBareRefs.ts`'s
 * `spanMarked` keeps those marks, so each reference also says which of the writer's it exactly is — the
 * identity the writer rewrites by.
 *
 * @param html the rendered fragment, one entry or several
 * @param fallback the context of the page the fragment passed on, which an entry linking nothing resolves against
 * @returns one entry per bare GitHub reference, in the order this check reads them
 */
export function resolvedGithubRefsOf({
  html,
  fallback,
}: {
  html: string;
  fallback: BareRefContext;
}): readonly ResolvedGithubRef[] {
  const { anchors, places } = markedPlacesOfFragment({
    marked: html.replace(ENTRY_OR_LINK_MARK_CHARACTER, PAGE_MARK_STAND_IN),
  });
  const { refs } = placedRefs({ anchors, fallback, places });
  return refs
    .filter(({ span }) => span.kind === "githubRef" && span.owner === undefined)
    .map(({ context, span, writerSpan }) => {
      const resolves = resolveBareRef({ context, span }) !== undefined && context.repos.length === 1;
      return { raw: span.raw, repo: resolves ? context.repos[0] : undefined, writerSpan };
    });
}

/**
 * Check one fleet-briefing artifact for a reference sitting in its text as plaintext — a bare `#N`-shaped
 * key, or a bare URL — across the react-now block and everything else, each defect naming the card or the
 * section and fold it sits in, so the chair edits the one source that wrote it.
 *
 * @param html the whole artifact file
 * @returns one defect per unresolved bare reference and per URL rendered as inert text
 */
export function checkBareRefs({ html }: { html: string }): BareRefPageCheck {
  const context = bareRefContextOfPage({ html });
  // The scan runs over the page with every QUOTED fold removed. "Put the title beside the key" is an
  // instruction to a session citing evidence, and there is nobody to instruct on a projection of the owner's own
  // recorded words — the only way to satisfy it there would be to rewrite them, which is the one thing a
  // projection must never do. `../outbound/briefing/vocabulary.ts`'s `quotedFoldSchema` already scopes the
  // writer's half of this exact rule the same way; see `./text.ts`'s `withoutQuoted` for the rest.
  // The page CONTEXT is still built from the whole page, so a repository the owner's own words name still resolves
  // anything its own entry links nothing for. The page is cut into its regions, and its cards numbered, RAW,
  // exactly as the card checks cut it, so a card is named by the number they give it. Everything excluded is
  // stripped from each region whole before it is split at its cards, headings and folds: an anchor straddling a
  // fold's summary would otherwise be cut in two, and neither half would match the strip.
  const { places, anchors } = markedPlacesOfPage({ html });
  const { refs, read } = placedRefs({ anchors, fallback: context, places });
  return {
    defects: read.flatMap((readPlace) => [
      ...refs
        .filter(
          (ref) =>
            ref.place === readPlace.place && resolveBareRef({ context: ref.context, span: ref.span }) === undefined,
        )
        .map((ref) => ({
          reason: bareRefRefusalMessage({ context: ref.context, span: ref.span }),
          region: ref.region,
          where: ref.place.where,
        })),
      ...bareUrlDefectsOfPlace(readPlace),
    ]),
  };
}
