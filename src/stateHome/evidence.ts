/**
 * The evidence area of the state-home contract: what a session measured, photographed, published or handed to a
 * later process — visual evidence, proof, pages, proposals, briefs, fan-outs and the daily reports.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new path here is a field on {@link EvidenceStateHomePaths} and a line in its resolver.
 */

import { join } from "node:path";

import { PAGES_DIRECTORY } from "../pages/url.js";

/** The evidence area's fields of {@link ../stateHome.StateHomePaths}. */
export interface EvidenceStateHomePaths {
  /**
   * `$home/visual-evidence/records` — one append-only file per image DIGEST, holding what a session
   * recorded about looking at that picture before it was attached to an outbound message.
   *
   * Keyed by digest rather than by path, which is the property that makes renaming the file,
   * citing another receipt or switching upload lane all resolve the same record. See
   * `src/visualEvidence/store.ts`.
   */
  readonly visualEvidenceRecords: string;
  /**
   * `$home/visual-evidence/captures` — one JSON document per `browser shot` evidence capture: the raw,
   * cropped and final artifact identities, the readiness observations and the crop that was taken. The
   * final record in `visualEvidenceRecords` links back by `captureId`. See `src/visualEvidence/captureRecord.ts`.
   */
  readonly visualEvidenceCaptures: string;
  /**
   * `$home/visual-evidence/uploads` — one JSON document per verified `github attach upload`: the asset GitHub
   * returned, the capture and image receipts it rests on, the one-line statement of what it proves, and the digest of
   * the bytes fetched back from GitHub. A pull-request description cites one by id. See
   * `src/outbound/github/attachReceipt.ts`.
   */
  readonly visualEvidenceUploads: string;
  /**
   * `$home/eval/answer-quality-cases.json` — the REAL answer-quality rubrics, and the reason the
   * `answer-quality` dev-gate check has two lanes rather than one.
   *
   * Under the home rather than in the repository because each rubric is derived from a golden naming real
   * people and carrying sensitive context — the same partition the frozen eval set already follows. The
   * committed `eval/answer-quality.fixture.json` is synthetic and stands in for it wherever a check has to
   * be reproducible by someone who does not have this file, CI included. A machine without it is a machine
   * whose gate run SAYS the lane did not run; see `src/devGate/answerQualityCheck.ts`.
   */
  readonly answerQualityCasesJson: string;
  /**
   * `$home/footprint` — the workstream assignment ledger, append-only JSONL.
   *
   * A SIBLING of `ledgers/` for the same reason `queue` is: what it holds is the owner's own rulings
   * about which workstream a thing belongs to, corrected over time, rather than an audit trail of what
   * happened. It stores assignments and nothing else — never status, never a summary — so it stays a
   * view over the board rather than a second register (`docs/workstreams.md`).
   */
  readonly footprint: string;
  /**
   * `$home/morning` — dated daily reports written by recipes and by hand, `<report-name>-YYYY-MM-DD.md`,
   * e.g. the self-improvement recipe's `self-improvement-YYYY-MM-DD.md` (the "Friction Review"). Free prose,
   * never a `CorpusRecord`, so it lives beside `briefs/` rather than under `corpus/`. Read-only from this
   * side of the door: the writer is `acme-admin`'s work-console recipe, which resolves it as
   * `homedir()/.slopweaver/morning` directly rather than through `$SLOPWEAVER_HOME` — a pre-existing
   * cross-repo mismatch, harmless while the two agree (the common case) and out of this file's scope to
   * close. See `reflect/frictionReviewGap.ts`.
   */
  readonly morning: string;
  /**
   * `$home/briefs` — one `<channel>-<messageTs>.json` per Slack tag the listener captured.
   *
   * The handoff between two processes: `turn brief` writes what a turn was SHOWN, and `turn answer` reads it
   * back to ground what the supervisor session composed. Under the home rather than a temp dir because the
   * gap between the two is a human-length investigation, and because it is the file to open when an answer
   * looks wrong. Keyed by the ADDRESSING message's own timestamp, not the thread root — two asks sharing one
   * thread now get two files, since keying on the thread alone let a second ask overwrite the first's brief.
   */
  readonly briefs: string;
  /**
   * Where one `store read` fan-out puts its plan and its shard files, one directory per fan-out.
   *
   * Under the home rather than a temp directory because a plan is read back by `store collect` after the
   * readers have run, which can be minutes later and is a different process — and because a fan-out that
   * went wrong is worth being able to open afterwards.
   */
  readonly fanout: string;
  /**
   * Detective waves planned OUTSIDE a bot turn: one directory per wave, holding the brief and the report for
   * each detective. A wave planned with `--ask` lands in `live.slack.detectives` instead, inside the turn's
   * record set.
   *
   * Its own root rather than a subdirectory of {@link fanout}, because the two carry different things: a
   * fan-out plan hands a reader a SHARD of already-selected records, while a detective brief hands it a
   * LEAD and the tool surface to pull on it. Sharing a directory would make a `store collect` run over a
   * detective wave look like a plan with no shards rather than a category error.
   */
  readonly detective: string;
  /**
   * `$home/proposals` — one `<slug>.json` per proposal intake.
   *
   * Under the home rather than a temp dir for the same reason `briefs` is: the gap between opening an
   * intake and publishing the document is days of human-length work, and the intake carries the only stable
   * identity a proposal has. Notion assigns page ids, so this file is what lets a re-publish find the page
   * it is replacing rather than creating a second one.
   */
  readonly proposals: string;
  /**
   * `$home/proposals/register` — one append-only `<slug>.jsonl` per tracked proposal, folded on read.
   *
   * A SIBLING directory rather than `<slug>.json` directly under `proposals`, because that root is already
   * occupied by one `<intake-id>.json` per intake (`intakeStore.ts`), and a register entry for a
   * tooling-origin proposal deliberately reuses the SAME slug as its intake id — placing the two flat in one
   * directory would collide the moment the register does the thing it is meant to do.
   */
  readonly proposalsRegister: string;
  /**
   * `$home/proposals/config/destination.json` — where THIS install publishes a proposal: one strict tagged
   * value (`outbound/proposal/destination.ts`), written by `proposal destination set`.
   *
   * The destination is the install's choice rather than the code's, so it lives in the store. A
   * subdirectory rather than `proposals/destination.json`, because that root holds one `<intake-id>.json` per
   * intake and `destination` is a valid intake id: a flat file would be read back as somebody's intake.
   */
  readonly proposalsDestinationJson: string;
  /**
   * `$home/pages` — one directory per LOCAL page, each holding the `index.html` a reader opens.
   *
   * Every session that used to end in one Claude artifact the owner reacts to ends
   * in one local page instead. This is where that page lives, and `pages/<slug>/index.html` is the whole
   * address shape — `../pages/url.ts` reads a page's identity back out of it.
   *
   * A SIBLING of {@link StateHomePaths.publishedPages} rather than a corner of it, because the two answer
   * different questions. This one holds the page the owner opens NOW, one file per slug, overwritten in place. That
   * one holds every version that ever reached the owner, keyed by digest, so a correction has bytes to diff
   * against. Collapsing them would mean either losing the history or making the owner pick a version to read.
   */
  readonly pages: string;
  /**
   * `$home/published-pages` — one directory per published artifact, holding the exact bytes of every
   * version that reached the owner plus a `latest.json` naming the newest.
   *
   * The freeze is what makes a CORRECTION possible at all. A page with no source file on disk
   * that needed one paragraph of a ruling stamped onto it meant reconstructing ~30 KB
   * of HTML from the published copy — the move most likely to introduce a silent transcription error, on a
   * page whose whole subject was a defect nobody could see. A later correction edits a FILE, never a memory
   * of one, and `../outbound/briefing/corrections.ts` diffs against these bytes rather than against a list
   * an author remembered.
   */
  readonly publishedPages: string;
  /**
   * `$home/page-meetings.jsonl` — the append-only ledger tying a local page to the one calendar meeting it prepares
   * the owner for (`slopweaver page tag`), which the `meeting-prep-due` monitor reads (`../pages/meetingTag.ts`).
   *
   * OUTSIDE {@link StateHomePaths.pages} on purpose: the console serves every file under a page's directory, and a
   * meeting's title and time are not the page's to publish.
   */
  readonly pageMeetings: string;
  /**
   * `$home/page-reviews` — one directory per page slug, holding every review repository `page review-prepare` built
   * for it and `published.json`, the review record the page last published with (`../pages/reviewRepo.ts`).
   *
   * OUTSIDE {@link StateHomePaths.pages} for the reason {@link StateHomePaths.pageMeetings} gives: the console serves
   * every file under a page's directory, and the inputs a review read — the owner's words, a run's doc — are not the page's
   * to publish.
   */
  readonly pageReviews: string;
  /**
   * `$home/pr-description-reviews` — the packet repositories `github pr review-prepare` built for a fresh
   * reviewer, and one receipt per reviewed packet, keyed by the digest of the exact description, images, written
   * rules and change set (`../outbound/github/descriptionReviewStore.ts`).
   *
   * In the home and never on the pull request's branch: a receipt committed there would change the change set
   * its own digest binds. The write verbs read it immediately before sending a description.
   */
  readonly prDescriptionReviews: string;
  /**
   * `$home/datadog-shots` — where `datadog shot` writes the images it captured.
   *
   * Evidence a reader looks at and attaches, kept out of `corpus/` because nothing ingests it. One of the four
   * roots of the measurements class: `store import-fleet --only measurements` carries each image into the
   * store's Storage bucket, because a shot of a window that has since aged out cannot be re-taken.
   */
  readonly datadogShotsDir: string;
  /**
   * `$home/evidence` — what an investigation MEASURED, written by hand: transcripts, series, audits and the
   * screenshots behind them. Canon cites these files as anchors, so `store import-fleet --only measurements`
   * carries them into the store and `store measurement-show` reads one back after its file is gone.
   */
  readonly evidenceDir: string;
  /**
   * `$home/evidence/github-exposure` — one owner-only directory per `github exposure sweep` run: what it found,
   * with the matched text and where each match sits, every uploaded asset with every place linking it, and the
   * run's coverage. Only the state home holds a finding or an upload URL; the verb prints counts. Under `evidenceDir`, so the store's measurement import carries it like any other.
   */
  readonly githubExposureReports: string;
  /**
   * `$home/evidence/publication-audit` — one owner-only directory per `audit publications` run, and `latest.json`, the
   * last run's sanitised report the `publication-leak` monitor reads. A finding here is a class, a door, a link and a
   * coordinate-only id: never the matched text, which no file of this area holds. See `src/live/publicationAudit/store.ts`.
   */
  readonly publicationAuditReports: string;
  /**
   * `$home/proof` —the screenshots and captures a pull request cited as its proof. The same class, leg and
   * reader as {@link StateHomePaths.evidenceDir}.
   */
  readonly proofDir: string;
  /** `$home/proof/desktop-e2e` — one folder per `desktop e2e` run: its photographs and `report.json`. */
  readonly desktopE2eProofDir: string;
  /**
   * `$home/notion-renders` — where `notion verify` writes the screenshots it captured, one directory per page.
   *
   * Output rather than state: it is evidence a reader looks at, and deleting the whole tree costs nothing but
   * a re-run. Kept out of `corpus/` because nothing ingests it.
   */
  readonly notionRendersDir: string;
  /** `$home/proof/zero-references` — the zip `audit references` exported and scanned, the latest one only. */
  readonly zeroReferencesProofDir: string;
  /**
   * `$home/fresh-cuts` — one directory per `fresh-cut produce` run, holding `record.json` (the source SHA, the tree
   * hash and the new root SHA) and one `verify-<instant>.json` per `fresh-cut verify` (`../freshCut/store.ts`).
   *
   * In the home and never in the cut: a verification's findings name the files a private term was found in.
   */
  readonly freshCuts: string;
}

/**
 * The visual-evidence directories, which share a parent and are read together.
 *
 * @param home the Slopweaver home
 * @returns the image-record, capture-record and upload-receipt directories
 */
function visualEvidencePaths({
  home,
}: {
  home: string;
}): Pick<EvidenceStateHomePaths, "visualEvidenceCaptures" | "visualEvidenceRecords" | "visualEvidenceUploads"> {
  return {
    visualEvidenceCaptures: join(home, "visual-evidence", "captures"),
    visualEvidenceRecords: join(home, "visual-evidence", "records"),
    visualEvidenceUploads: join(home, "visual-evidence", "uploads"),
  };
}

/**
 * Resolve the evidence area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the evidence area's fields, rooted at `home`
 */
export function evidenceStateHomePaths({ home }: { home: string }): EvidenceStateHomePaths {
  return {
    briefs: join(home, "briefs"),
    fanout: join(home, "fanout"),
    detective: join(home, "detective"),
    zeroReferencesProofDir: join(home, "proof", "zero-references"),
    footprint: join(home, "footprint"),
    freshCuts: join(home, "fresh-cuts"),
    answerQualityCasesJson: join(home, "eval", "answer-quality-cases.json"),
    morning: join(home, "morning"),
    notionRendersDir: join(home, "notion-renders"),
    datadogShotsDir: join(home, "datadog-shots"),
    evidenceDir: join(home, "evidence"),
    githubExposureReports: join(home, "evidence", "github-exposure"),
    publicationAuditReports: join(home, "evidence", "publication-audit"),
    proofDir: join(home, "proof"),
    desktopE2eProofDir: join(home, "proof", "desktop-e2e"),
    ...visualEvidencePaths({ home }),
    proposals: join(home, "proposals"),
    proposalsDestinationJson: join(home, "proposals", "config", "destination.json"),
    proposalsRegister: join(home, "proposals", "register"),
    pages: join(home, PAGES_DIRECTORY),
    publishedPages: join(home, "published-pages"),
    pageMeetings: join(home, "page-meetings.jsonl"),
    pageReviews: join(home, "page-reviews"),
    prDescriptionReviews: join(home, "pr-description-reviews"),
  };
}
