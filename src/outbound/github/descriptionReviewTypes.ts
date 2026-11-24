/**
 * The shapes of the description review: what a fresh reviewer is shown before a pull-request description reaches
 * GitHub, and the receipt that records what it said.
 *
 * ## What one review is bound to
 *
 * A {@link DescriptionReviewManifest} names everything a published description depends on: the exact title and
 * body bytes, every image with the line it proves, the written rules it was judged against, and the change set it
 * describes. The change set is bound by `changeDigest` (`./descriptionChangeDigest.ts`), never by a head commit, so
 * a rebase that leaves every changed file's content alone keeps the review, while any content change needs a new
 * one. The manifest's own digest is the key a receipt is stored under, which is what makes "one pass per distinct
 * description" a file that either exists or does not.
 *
 * ## Why it is its own lane
 *
 * The code's review cap (`../../codex/reviewPassCap.ts`) counts distinct reviewed diffs on the pull request's own
 * branch. A description review runs against a packet repository of its own, so it never reads or spends that
 * count, and its own count is one receipt per manifest: a second pass on unchanged bytes is refused, a pass on
 * changed bytes is a new packet.
 */
import type { SupervisorSession } from "../../supervisor/session.js";

/** One image a description shows, as the write verb will publish it. */
export interface DescriptionImage {
  /** The uploaded address the body embeds. */
  readonly url: string;
  /** sha256 of the exact image bytes, lowercase hex. */
  readonly sha256: string;
  /** The one line saying what this image proves, as the description prints it. */
  readonly proves: string;
  /** The capture or upload receipt the image came from. */
  readonly receiptId: string;
}

/** One inline comment a write will post on the pull request, exactly as GitHub will receive it. */
export interface DescriptionReviewComment {
  readonly path: string;
  readonly line: number;
  readonly body: string;
}

/** A conversation comment already on the pull request. */
export interface ExistingIssueComment {
  readonly kind: "issue-comment";
  readonly id: string;
  /** The author's login; null when GitHub reports the account deleted. */
  readonly authorLogin: string | null;
  readonly body: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly url: string;
}

/**
 * An inline review comment already on the pull request, anchored by its ORIGINAL line only: the live line, hunk,
 * commit and resolution state move on a pure rebase, and a review that a rebase alone invalidated would be noise.
 */
export interface ExistingReviewComment {
  readonly kind: "review-comment";
  readonly id: string;
  readonly authorLogin: string | null;
  readonly body: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly url: string;
  readonly path: string;
  /** null when GitHub reports no original line (a file-level comment). */
  readonly originalLine: number | null;
}

/** Any comment already on the pull request that the description answers to. */
export type ExistingPullRequestComment = ExistingIssueComment | ExistingReviewComment;

/** Everything one description review is bound to. Its digest keys the receipt. */
export interface DescriptionReviewManifest {
  readonly schemaVersion: 2;
  /** `owner/name`. */
  readonly repository: string;
  /** The branch the pull request merges into. */
  readonly baseBranch: string;
  /** sha256 of the exact title's UTF-8 bytes. */
  readonly titleSha256: string;
  /** sha256 of the exact body's UTF-8 bytes. */
  readonly bodySha256: string;
  /** sha256 of the comments this write posts, as `description/comments.json` carries them; `[]` hashes too. */
  readonly commentsSha256: string;
  /** sha256 of the comments already on the pull request, as `evidence/pull-request-comments.json` carries them. */
  readonly existingCommentsSha256: string;
  /** The change set's content digest (`./descriptionChangeDigest.ts`). */
  readonly changeDigest: string;
  /** sha256 over every written rule file the packet carried, by path. */
  readonly rulesSha256: string;
  /** Every image, in canonical order (url, then sha256). */
  readonly images: readonly DescriptionImage[];
}

/** Who took a description review: Codex, or a separate visible Claude session when Codex could not. */
export type DescriptionReviewer = "codex" | "claude-fallback";

/** What `github pr review-prepare` wrote: the packet repository's two commits and the manifest they carry. */
export interface DescriptionReviewPreparation {
  readonly schemaVersion: 2;
  readonly preparationId: string;
  readonly createdAtIso: string;
  readonly manifest: DescriptionReviewManifest;
  readonly manifestSha256: string;
  /** The packet commit holding the evidence: rules, change set, images, records. */
  readonly baseSha: string;
  /** The packet commit adding the description under review. */
  readonly headSha: string;
  /** The visible session that prepared the packet, or null when none could be named. */
  readonly preparedBy: SupervisorSession | null;
}

/** The record of one description review. Only a CLEAN one opens a write. */
export interface DescriptionReviewReceipt {
  readonly schemaVersion: 2;
  readonly receiptId: string;
  readonly preparationId: string;
  readonly manifest: DescriptionReviewManifest;
  readonly manifestSha256: string;
  readonly reviewer: DescriptionReviewer;
  /** The Codex artifact id or Claude fallback receipt id the verdict came from. */
  readonly reviewId: string;
  readonly verdict: "CLEAN" | "BROKEN";
  readonly summary: string;
  readonly preparedBy: SupervisorSession | null;
  /** The visible session that recorded this receipt, or null when none could be named. */
  readonly recordedBy: SupervisorSession | null;
  readonly recordedAtIso: string;
}

/**
 * The written rules a description is judged against, as paths inside this build's own tree. The rules section
 * of the outbound area rule is carried as its whole file: a heading-bounded extract would silently drop a rule
 * the day the section is reorganised.
 */
export const DESCRIPTION_RULE_FILES: readonly string[] = [
  "skills/github/reference/pull-requests.md",
  "skills/github/reference/composing-a-body.md",
  "skills/github/reference/pr-badges.md",
  "skills/github/reference/self-review.md",
  "skills/github/reference/attachments.md",
  ".claude/rules/area-outbound.md",
];

/** The property id every description review must answer, so a narrower property cannot stand in for it. */
export const DESCRIPTION_REVIEW_PROPERTY_ID = "pr-description-review";

/**
 * What a BROKEN description review owes: every violation, not the first one found. Shared word for word by the
 * property and the packet README so neither can drift from the other.
 *
 * Why it exists: the shared review prompt (`../../codex/prompt.ts`) asks for "that concrete counterexample", which
 * is right for a code property and wrong here. A description breaks many small rules at once, and a reviewer that
 * stopped at its first hit cost one pull request nine BROKEN passes, each naming a rule the body had already broken
 * before the pass before it.
 *
 * @internal exported so a unit test can pin the wording both texts carry
 */
export const DESCRIPTION_REVIEW_EVERY_VIOLATION =
  "Read the whole title, body, comment set and image set against all five checks before answering, and never stop " +
  "at the first violation: a BROKEN answer lists EVERY violation found, numbered, in both evidence and " +
  "counterexample, each naming its title or body line, comments.json or images.json entry and the check or rules/ " +
  "ruling it breaks";

/** The one falsifiable claim a description review attacks: the five questions, joined, then what BROKEN owes. */
export const DESCRIPTION_REVIEW_PROPERTY =
  "The description under review (description/title.txt, description/body.md, the inline comments in " +
  "description/comments.json, and description/images.json with the images/ files it names) passes all five checks " +
  "in README.md: every claim matches change/, the image it cites and the pull request's existing comments in " +
  "evidence/pull-request-comments.json; " +
  "no act is credited to the owner without a record in evidence/, and no I, me, my, we, our or us appears in prose; " +
  "nothing in the text or an image identifies a person, an account, this machine or a secret; nothing a reader " +
  "could disagree with sits below the fold; and no ruling in rules/ is broken. A derived badge phrase is read by " +
  "the meaning rules/pr-badges.md gives it. For this property: " +
  DESCRIPTION_REVIEW_EVERY_VIOLATION;

/** The orientation file at a packet's base commit: what the packet is, the five questions, and what BROKEN owes. */
export const DESCRIPTION_REVIEW_PACKET_README = [
  "# A pull-request description review",
  "",
  "The diff under review adds `description/`: the exact title and body a write verb will send to GitHub,",
  "`comments.json`, the inline comments the same write posts on the pull request (`[]` when it posts none), and",
  "`images.json`, which pairs every image the body shows with the one line saying what it proves. The image",
  "bytes are in `images/`, named by their sha256. Everything the description answers to is at the base:",
  "",
  "- `change/diff.patch` and `change/delta.txt`: the change set the pull request makes, as a patch and as the",
  "  exact tree delta its digest hashes. Binary files appear in the delta by blob id.",
  "- `rules/`: the written rules for pull-request descriptions, exactly as this build carries them.",
  "- `evidence/pull-request-comments.json`: every comment already on the pull request, conversation and inline",
  "  (`[]` for a pull request not yet opened). A claim a reviewer's comment there refutes is a check 1 failure.",
  "- `evidence/01-fleet-finding.json`, present when the branch belongs to a problem the fleet found itself: that",
  "  an agent session observed and registered the problem, and its exact `registeredOn` day. For that problem,",
  "  this record is sufficient for `by: agent` with `on` equal to `registeredOn`. It supports no other day and",
  "  nothing else about the run.",
  "- `evidence/`: any other records the author cites for an act the description credits to the owner.",
  "",
  "The three badges and their hovers are DERIVED from typed fields, never written as prose. Read each derived phrase",
  "by the meaning `rules/` gives it in `pr-badges.md`, and judge the field behind it, not the template's wording.",
  "`Who ran it isn't recorded.` is the honest answer when nothing records who ran it, never an attribution failure.",
  "Whether more proof should have been gathered is the landing grade's question, kept off the description: a proof",
  "slot's reason is judged only on whether it is true of `change/` and `evidence/`.",
  "",
  "Answer all five over the whole description, its outgoing comments included. A single failure is BROKEN:",
  "",
  "1. Does each claim match the change set, the image it cites and the existing comments? Check every image",
  "   against its proves line.",
  "2. Does any sentence credit an act to the owner with no record in `evidence/` behind it, or use I, me, my,",
  "   we, our or us in prose outside code spans, quotes and links?",
  "3. Does anything in the text or an image identify a person, an account, this machine or a secret?",
  "4. Is anything a reader could disagree with hidden below the fold (inside a collapsed section)?",
  "5. Does it break a written ruling in `rules/`?",
  "",
  `${DESCRIPTION_REVIEW_EVERY_VIOLATION}. Each pass is one rewrite for the author, so a violation left off the`,
  "list costs a whole further pass to find.",
  "",
  "This review is its own lane, separate from the pull request's two code-review passes, and it does not count",
  "toward them. Stay inside this folder.",
  "",
].join("\n");

/**
 * What the packet README adds when `github attach upload` is closed on the install preparing it.
 *
 * Why it exists: a reviewer reading `rules/attachments.md` alone ("never substitute a link for the image") told a seat to
 * attach a terminal-shot picture, and the seat uploaded one against the owner's standing line. With attach upload
 * closed a picture cannot be supplied, so asking for one is asking the author to break the owner's rule.
 *
 * @internal exported so a unit test can pin the wording
 */
export const ATTACH_UPLOAD_CLOSED_SECTION: readonly string[] = [
  "## No picture can be attached from this install",
  "",
  "`github attach upload` is closed here until the owner's recorded ruling permits it, so no picture or recording can",
  "reach this description. Proof that says its picture stays local is an honest reading and passes checks 1 and 5 on",
  "that point. Never ask the author to attach, upload or embed a picture, and never name a capture verb as the fix:",
  "that is asking them to break the owner's rule. Every other claim is still judged on the text and the change set.",
  "",
];

/**
 * The packet README for one install: {@link DESCRIPTION_REVIEW_PACKET_README} exactly when attach upload is
 * permitted, plus {@link ATTACH_UPLOAD_CLOSED_SECTION} otherwise. The section names no ruling, row or anchor: the
 * reviewer needs the fact, not the install's register. It is not in `rulesSha256`, and needs no place there: it sits
 * in the packet's base commit, which a review is bound to.
 *
 * @param attachUploadPermitted whether `github attach upload` is permitted on the install preparing the packet
 * @returns the README's text
 */
export function descriptionReviewPacketReadme({ attachUploadPermitted }: { attachUploadPermitted: boolean }): string {
  if (attachUploadPermitted) {
    return DESCRIPTION_REVIEW_PACKET_README;
  }
  return [DESCRIPTION_REVIEW_PACKET_README, ...ATTACH_UPLOAD_CLOSED_SECTION].join("\n");
}
