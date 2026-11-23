/**
 * Which screenshots and run links a description write would lose, and whether a settled ask of the owner's named this
 * pull request — the pure half of the settled-evidence gate (`./settledEvidenceGate.ts`).
 *
 * MEASURED, the incident it holds down: the body of an acme/acme-admin pull request held five
 * inline `user-attachments` screenshots in its visible Proof row, the before-and-after proof the owner had asked
 * for in a settled `answered` row whose witness was the pull request. A description rollout then replaced that
 * body whole under `SLOPWEAVER_ALLOW_PR_REPLACE=1`, turned all five into
 * `its screenshot` links because the authoring grammar refused an image outside Before and after, and the owner
 * saw zero images. Nothing in the write path knew a ruling of the owner's was attached to those bytes.
 *
 * Both bodies are read off a real RENDERING by `./settledEvidenceReading.ts`, never their source; what a closed
 * `<details>` folds away is read apart from what is drawn open, so evidence the live body shows open is kept only by
 * showing it open. Two evidence classes, and the class is part of the identity:
 *
 * - **A screenshot** is anything an image, a video or a `<source>` that draws through one takes from its `src`,
 *   `srcset` or `poster`, whatever the markdown spelled — and any GitHub attachment URL (`src/live/github/media.ts`'s
 *   hosts, plus anything under `github.com/user-attachments/`, a file upload such as a log included) that appears
 *   outside a link with its own text: a bare one GitHub autolinks, which it draws as media alone on a line, or one in
 *   text or an attribute it does not draw from, so an unknown shape fails closed. Rewriting one as a plain link keeps
 *   the URL and loses the picture, which is exactly the incident, so a screenshot is kept only by the new body
 *   carrying it at least as strongly (`imageRanks`). An attachment the live body carries ONLY as links with their own
 *   text draws nothing, so it is kept by the same URL anywhere. The badge row every reading-order body renders is
 *   `img.shields.io` and derived, never evidence, so that host is excluded.
 * - **A run link** is a GitHub Actions run or a Datadog CI Visibility / Test Optimization view
 *   (`src/atlas/datadog/consolePages.ts`'s `/ci/pipeline-executions` and `/ci/test/runs`, nothing else under
 *   `/ci`). It is kept by the same URL anywhere the new body renders it, a bare one GitHub autolinks included; one
 *   moved into an HTML comment is gone.
 *
 * A row NAMES a pull request only by its full `https://github.com/<owner>/<repo>/pull/<n>` URL — never `#n`, which
 * is ambiguous across repositories — in its settlement witness or in the owner's own stored words, and only an ask the owner
 * spoke (held words) that ended `answered` or `filed` counts. `declined` is the owner's no; `anchor:` alone is provenance,
 * never the requirement.
 */
import { isDatadogConsoleHost } from "../../../datadog/config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { HisWordsGroup } from "../../../handover/hisWords.js";
import { GITHUB_ATTACHMENT_HOSTS } from "../../../live/github/media.js";
import { parsedUrl, type Reading, type ReadingSide, renderingsOf, urlsInText } from "./settledEvidenceReading.js";

/** The pull request a write targets. */
export interface PullRequestCoordinates {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** What a body carries that a settled ask may protect, each list without repeats. */
export interface ProtectedEvidence {
  /** Screenshots the body draws, then attachments outside a link, which a write keeps only by drawing them alike. */
  readonly images: readonly string[];
  /** GitHub attachment URLs the body shows as a link or its text without drawing, kept by showing them at all. */
  readonly attachmentLinks: readonly string[];
  /** Run links, kept by the same URL anywhere. */
  readonly runs: readonly string[];
}

/** What a write would lose that a settled ask of the owner's named this pull request for. */
export interface SettledEvidenceLoss {
  readonly rowSlugs: readonly string[];
  readonly lostUrls: readonly string[];
}

/** The badge host every reading-order body draws its derived badge row from — rendered, never evidence. */
const BADGE_HOST = "img.shields.io";

/** `imageRanks`' rank for a bare attachment GitHub autolinked, the weakest way of carrying one that draws it. */
const AUTOLINKED = 2;

/** `imageRanks`' rank for an attachment in visible text outside a link. */
const LOOSE = 1;

/** Punctuation a sentence puts after a bare URL, which is never part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;

/**
 * A GitHub pull-request page's path, its number bounded by a non-digit so `/pull/<n>` never matches
 * `/pull/<n>0`, while `/pull/<n>]` — prose wrapped round the URL — still does.
 */
const PULL_PATH = /^\/[^/]+\/[^/]+\/pull\/(\d+)(?!\d)/u;

/** The Datadog console paths that ARE a CI run or a test run, rather than a setting about them. */
const DATADOG_RUN_PATHS = ["/ci/pipeline-executions", "/ci/test/runs"] as const;

/** The hosts GitHub serves its own pages on — `www.` redirects to the bare one (the twenty-first review pass). */
const GITHUB_WEB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);

/**
 * GitHub's repository-scoped upload paths from before `user-attachments`: `/<owner>/<repo>/files/<id>/<name>` for a
 * file (the twentieth review pass) and `/<owner>/<repo>/assets/<user-id>/<uuid>` for media (the twenty-third).
 */
const REPOSITORY_UPLOAD_PATH = /^\/[^/]+\/[^/]+\/(?:assets|files)\/\d+\//u;

/**
 * Whether a URL is a GitHub attachment: a media host, any upload under `github.com/user-attachments/` — `assets/`
 * for media and `files/` for a log or archive, which is evidence too (the sixteenth review pass) — or one under a
 * repository's own upload paths.
 */
function isAttachmentUrl({ url }: { url: string }): boolean {
  const parsed = parsedUrl({ url });
  if (parsed === undefined) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = decodedPath({ pathname: parsed.pathname });
  const upload = path.startsWith("/user-attachments/") || REPOSITORY_UPLOAD_PATH.test(path);
  return GITHUB_ATTACHMENT_HOSTS.has(host) || (GITHUB_WEB_HOSTS.has(host) && upload);
}

/** Whether an image is evidence rather than the derived badge row. */
function isEvidenceImage({ url }: { url: string }): boolean {
  return parsedUrl({ url })?.hostname.toLowerCase() !== BADGE_HOST;
}

/** Whether a URL is a GitHub Actions workflow run or check run, or a Datadog CI or test run. */
function isRunLink({ url }: { url: string }): boolean {
  const parsed = parsedUrl({ url });
  if (parsed === undefined) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const pathname = decodedPath({ pathname: parsed.pathname });
  if (GITHUB_WEB_HOSTS.has(host)) {
    return /^\/[^/]+\/[^/]+\/(?:actions\/)?runs\/[1-9]\d*(?:\/|$)/u.test(pathname);
  }
  if (!isDatadogConsoleHost({ hostname: host })) {
    return false;
  }
  return DATADOG_RUN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** The values in first-seen order, each once. */
function unique({ values }: { values: readonly string[] }): readonly string[] {
  return [...new Set(values)];
}

/**
 * A URL with what a sentence may have put after it dropped, as GFM's autolink rule does: trailing punctuation, and
 * a closing parenthesis the URL never opened. Used only to ask WHETHER text names a run, never as its identity —
 * trimming as identity let `…?name=proof)` and `…?name=proof` stand in for each other (the tenth review pass).
 */
function proseTrimmed({ url }: { url: string }): string {
  let trimmed = url.replace(TRAILING_PUNCTUATION, "");
  while (trimmed.endsWith(")") && trimmed.split("(").length < trimmed.split(")").length) {
    trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  }
  return trimmed;
}

/** The page a pull request's description is shown on, which its relative links resolve against. */
function pageOf({ pull }: { pull: PullRequestCoordinates }): string {
  return `https://github.com/${pull.owner}/${pull.repo}/pull/${String(pull.number)}`;
}

/**
 * Each screenshot at the strongest way a reading carries it: 3 drawn from an attribute, 2 a bare attachment GitHub
 * autolinked (alone on a line it draws as media), 1 an attachment in other visible text outside a link, 0 one held
 * only in an attribute nothing draws from. A write keeps one only at the same rank or higher, so neither text nor an
 * `alt` naming a URL stands in for the picture it drew, and an `alt` never stands in for visible text.
 */
function imageRanks({ reading }: { reading: Reading }): ReadonlyMap<string, number> {
  const ranked: (readonly [string, number])[] = [
    ...reading.drawn.filter((url) => isEvidenceImage({ url })).map((url) => [url, 3] as const),
    ...reading.autolinked.filter((url) => isAttachmentUrl({ url })).map((url) => [url, AUTOLINKED] as const),
    ...reading.loose.filter((url) => isAttachmentUrl({ url })).map((url) => [url, LOOSE] as const),
    ...reading.held.filter((url) => isAttachmentUrl({ url })).map((url) => [url, 0] as const),
  ];
  const ranks = new Map<string, number>();
  for (const [url, rank] of ranked) {
    const held = ranks.get(url);
    if (held === undefined || rank > held) {
      ranks.set(url, rank);
    }
  }
  return ranks;
}

/**
 * Each screenshot's rank with whether it is drawn open folded in: twice the way it is carried, plus one when a reader
 * sees it without opening a closed `<details>`. So a picture folded away ranks below the same picture shown, and above
 * anything weaker shown (the twelfth review pass).
 */
function foldedRanks({ shown, whole }: { shown: Reading; whole: Reading }): ReadonlyMap<string, number> {
  const ranks = new Map<string, number>();
  for (const [url, rank] of imageRanks({ reading: whole })) {
    ranks.set(url, foldedRank({ open: false, rank }));
  }
  for (const [url, rank] of imageRanks({ reading: shown })) {
    // The whole reading walks a superset of the shown one, so it carries every URL this does.
    ranks.set(url, Math.max(foldedRank({ open: true, rank }), ranks.get(url)!));
  }
  return ranks;
}

/** One way of carrying a screenshot (`imageRanks`' scale) as a folded rank, drawn open or folded away. */
function foldedRank({ rank, open }: { rank: number; open: boolean }): number {
  return rank * 2 + (open ? 1 : 0);
}

/** Whether a body carries a screenshot at a rank at least this strong; one it does not carry ranks below all. */
function rankAtLeast({ ranks, url, rank }: { ranks: ReadonlyMap<string, number>; url: string; rank: number }): boolean {
  const held = ranks.get(url);
  return held !== undefined && held >= rank;
}

/** What a reader can follow or read in a reading: a link's target and visible text. */
function presentIn({ reading }: { reading: Reading }): readonly string[] {
  // A URL held only in an attribute nothing draws from (`alt`, `title`) is not, so it never keeps a run link (the
  // sixth review pass).
  return [...reading.autolinked, ...reading.linked, ...reading.present];
}

/** What a reader can click through to in a reading: a link's target, never a URL that is only text. */
function followableIn({ reading }: { reading: Reading }): ReadonlySet<string> {
  return new Set([...reading.autolinked, ...reading.linked]);
}

/**
 * The URL sets a write must keep: what a body renders and what it links, each whole and shown open. A URL in one of
 * these on the live body stays in the same one on the new body, so a link is never kept by its own URL left as
 * unlinked text (the twenty-second review pass), nor one shown open by a copy folded away (the twelfth).
 */
const KEPT_SETS = ["followable", "present", "shownFollowable", "shownPresent"] as const;

/**
 * A body read off its rendering: its protected evidence, each screenshot's folded rank, every URL it renders and
 * links, and those a reader sees without opening a closed `<details>`.
 */
function readBody({
  body,
  pull,
  side,
}: {
  body: string;
  pull: PullRequestCoordinates;
  side: ReadingSide;
}): ProtectedEvidence &
  Record<(typeof KEPT_SETS)[number], ReadonlySet<string>> & { ranks: ReadonlyMap<string, number> } {
  const { shown, whole } = renderingsOf({ body, page: pageOf({ pull }), side });
  const ranks = foldedRanks({ shown, whole });
  const present = presentIn({ reading: whole });
  return {
    // Every attachment a reader can follow or read that is not already a screenshot, folded or not: a link's target,
    // or a link's own text (the seventh review pass). One also held in an `alt` is still a link.
    attachmentLinks: unique({
      values: present.filter(
        (url) =>
          isAttachmentUrl({ url }) && !rankAtLeast({ rank: foldedRank({ open: false, rank: LOOSE }), ranks, url }),
      ),
    }),
    followable: followableIn({ reading: whole }),
    images: [...ranks.keys()],
    present: new Set(present),
    ranks,
    runs: unique({ values: present.filter((url) => isRunLink({ url: proseTrimmed({ url }) })) }),
    shownFollowable: followableIn({ reading: shown }),
    shownPresent: new Set(presentIn({ reading: shown })),
  };
}

/**
 * The screenshots and run links a body carries, read off its rendering.
 *
 * @param body the description, undefined when the pull request has none
 * @param pull the pull request whose page its relative links resolve against
 * @returns the screenshots it draws or may draw (the badge row excluded), the attachments it carries only as
 *   links, and its run links, each in first-seen order once and resolved to an absolute URL where it parses
 */
export function protectedEvidenceOf({
  body,
  pull,
}: {
  body: string | undefined;
  pull: PullRequestCoordinates;
}): ProtectedEvidence {
  if (body === undefined) {
    return { attachmentLinks: [], images: [], runs: [] };
  }
  const { attachmentLinks, images, runs } = readBody({ body, pull, side: "live" });
  return { attachmentLinks, images, runs };
}

/**
 * The evidence the live body carries that the new one would not: a screenshot no longer drawn (a link to it is not
 * enough), and an attachment link or run link no longer rendered as it was — a link left as bare text, or a URL
 * shown open moved behind a click.
 *
 * @param liveBody the description as it stands, undefined when there is none
 * @param newBody the exact bytes the write would send
 * @param pull the pull request whose page both bodies' relative links resolve against
 * @returns every lost URL once, screenshots first in live order, then attachment links, then run links
 */
export function lostProtectedEvidence({
  liveBody,
  newBody,
  pull,
}: {
  liveBody: string | undefined;
  newBody: string;
  pull: PullRequestCoordinates;
}): readonly string[] {
  if (liveBody === undefined) {
    return [];
  }
  const live = readBody({ body: liveBody, pull, side: "live" });
  const kept = readBody({ body: newBody, pull, side: "kept" });
  const lostImages = [...live.ranks]
    .filter(([url, rank]) => !rankAtLeast({ rank, ranks: kept.ranks, url }))
    .map(([url]) => url);
  const lostLinks = [...live.attachmentLinks, ...live.runs].filter((url) => {
    // Kept where it was carried: shown open stays shown open, a link stays a link. A link redrawn as the picture
    // (autolinked or drawn, as open as it was) is kept too — the restoration this guard exists to allow.
    const keptEverywhere = KEPT_SETS.every((set) => !live[set].has(url) || kept[set].has(url));
    const open = live.shownPresent.has(url);
    const redrawn = rankAtLeast({ rank: foldedRank({ open, rank: AUTOLINKED }), ranks: kept.ranks, url });
    return !keptEverywhere && !redrawn && !lostImages.includes(url);
  });
  return unique({ values: [...lostImages, ...lostLinks] });
}

/**
 * A URL path percent-decoded, as GitHub routes it: `Hello%2DWorld` is the `Hello-World` repository (the
 * twenty-sixth review pass). A malformed escape stays as written, which can only fail to name a pull request.
 */
function decodedPath({ pathname }: { pathname: string }): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** Whether a text names this pull request by its full URL. */
function namesPull({ text, pull }: { text: string | undefined; pull: PullRequestCoordinates }): boolean {
  if (text === undefined) {
    return false;
  }
  // Every URL parsed rather than matched as text, so any spelling GitHub opens as this pull request names it —
  // `github.com:443`, an upper-case host (the eighteenth review pass), `www.github.com` (the twenty-first), and a
  // percent-encoded path (the twenty-sixth). The repository is deliberately NOT compared (the twenty-ninth): a
  // renamed or transferred repository's old URL still opens this pull request, and nothing the guard reads can
  // tell a former name from another repository, so a same-numbered pull anywhere on GitHub counts — a rare false
  // refusal the grant releases, never a loss let through.
  return urlsInText({ text }).some((url) => {
    const parsed = parsedUrl({ url: proseTrimmed({ url }) });
    const onGithub = parsed !== undefined && GITHUB_WEB_HOSTS.has(parsed.hostname);
    const match = onGithub ? PULL_PATH.exec(decodedPath({ pathname: parsed.pathname })) : null;
    return match !== null && Number(match[1]) === pull.number;
  });
}

/** The owner's words a group holds, or undefined when it holds none readable. */
function heldWords({ group }: { group: HisWordsGroup }): string | undefined {
  return group.kind === "held" ? group.hisWords.words : undefined;
}

/**
 * Whether a board row is a settled ask of the owner's that names this pull request.
 *
 * @param doc the row as the board parsed it
 * @param pull the pull request a write targets
 * @returns true for an ask with the owner's words held, settled `answered` or `filed`, whose witness or words carry a
 *   GitHub pull URL with this number, under any repository name a rename or transfer may have left behind
 */
export function rowNamesPullRequest({ doc, pull }: { doc: HandoverDoc; pull: PullRequestCoordinates }): boolean {
  const settled = doc.settlement === "answered" || doc.settlement === "filed";
  const words = [doc.hisWords, ...doc.hisWordsSteers.map((steer) => steer.group)]
    .map((group) => heldWords({ group }))
    .filter((held): held is string => held !== undefined);
  if (doc.kind !== "ask" || !settled || words.length === 0) {
    return false;
  }
  return [doc.settlementWitness, ...words].some((text) => namesPull({ pull, text }));
}

/**
 * What a write would lose that a settled ask of the owner's named this pull request for.
 *
 * @param docs every board row, live and archived
 * @param liveBody the description as it stands
 * @param newBody the exact bytes the write would send
 * @param pull the pull request the write targets
 * @returns the naming rows and the lost URLs, or undefined when nothing is lost or no settled ask names the pull
 *   request
 */
export function settledEvidenceLoss({
  docs,
  liveBody,
  newBody,
  pull,
}: {
  docs: readonly HandoverDoc[];
  liveBody: string | undefined;
  newBody: string;
  pull: PullRequestCoordinates;
}): SettledEvidenceLoss | undefined {
  const lostUrls = lostProtectedEvidence({ liveBody, newBody, pull });
  if (lostUrls.length === 0) {
    return undefined;
  }
  const rowSlugs = unique({ values: docs.filter((doc) => rowNamesPullRequest({ doc, pull })).map((doc) => doc.slug) });
  return rowSlugs.length === 0 ? undefined : { lostUrls, rowSlugs };
}
