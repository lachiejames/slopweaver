/**
 * The medallion corpus area of the state-home contract: `$home/corpus` and every root and cursor beneath it.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new corpus path is a field on {@link CorpusPaths} and a line in its resolver here.
 */

import { join } from "node:path";

/** The medallion corpus roots under the home. Leaf paths (per-source, per-window) live in `corpusPaths`. */
interface CorpusPaths {
  /** `$home/corpus` — the medallion root. */
  readonly root: string;
  /** `$home/corpus/bronze` — raw `CorpusRecord` lines per source. */
  readonly bronze: string;
  /**
   * `$home/corpus/attachments` — the BYTES of provider files, content-addressed by sha256 and sharded two
   * characters deep. A sibling of `bronze` rather than a child for the same reason `members` is: a record
   * reader recursing `bronze/` would try to parse a PDF as a `CorpusRecord`.
   *
   * A record refers to one of these by DIGEST, never by url — a Notion signed url expires within the hour,
   * so a url in bronze is a dead pointer that still looks live.
   */
  readonly attachments: string;
  /**
   * `$home/corpus/bodies` — the PARSED BODY of a provider page, content-addressed by sha256 and sharded two
   * characters deep, exactly as `attachments` is and through the same store (`corpus/contentStore.ts`).
   *
   * A sibling of `attachments` rather than a child of it because the two hold different things and the
   * distinction is load-bearing: `attachments` holds a provider's own FILE BYTES, while this holds a typed
   * tree this repository derived. A reader sweeping one for files would otherwise meet JSON documents that
   * are not files, and a reader sweeping the other for trees would meet PDFs.
   *
   * It exists so re-deriving a page's text never calls Notion again. A bronze record carries a rendered
   * `text` and a `raw` object, and for Notion `raw` has only ever held the PAGE object, never the body — so
   * the body was a one-way render and every re-derivation meant a re-fetch. A record names its body by
   * DIGEST, which is stable forever and resolves with no network.
   */
  readonly bodies: string;
  /**
   * `$home/corpus/members` — per-source member (person) bronze, deliberately a SIBLING of `bronze` rather
   * than a child: `readCorpusDir` recurses `bronze/` and would try to parse member rows as `CorpusRecord`s
   * (each a warning). Members are identity substrate, not activity, so they stay out of the record pipeline.
   */
  readonly members: string;
  /**
   * `$home/corpus/directory` — the ORG DIRECTORY bronze: Google Workspace Admin's own user list, one JSONL
   * per pull, the authority `person` is keyed on. A sibling of `bronze` for the same
   * reason as `members`, and a sibling of `members` because it is not a platform's member list — it is
   * the roster every platform's members are matched TO.
   */
  readonly directory: string;
  /**
   * `$home/corpus/structures` — per-source structural (org/team/repo/channel/…) bronze, a SIBLING of
   * `bronze` for the same reason as `members`: `readCorpusDir` recurses `bronze/` and would try to parse a
   * structure row as a `CorpusRecord`. Structure is org scaffolding, not activity, so it stays out of the
   * record pipeline (never embedded/ranked) and surfaces only into the silver directory/graph.
   */
  readonly structures: string;
  /**
   * `$home/corpus/history` — per-source ACTIVITY HISTORY (who changed what, when), a SIBLING of `bronze` for
   * the same mechanical reason as `members` and `structures`: `readCorpusDir` recurses `bronze/` and would
   * hand every event to the ranker.
   *
   * Here that separation is not just hygiene, it is the correctness argument. A history event is one line, so
   * BM25 gives a matching term a large share of it, and an event can outrank the very issue it belongs to —
   * which no timestamp choice fixes. Keeping the stream out of `bronze/` means retrieval CANNOT reach it, and
   * what retrieval sees instead is a bounded summary folded into the issue's own searchable text.
   */
  readonly history: string;
  /** `$home/corpus/silver` — derived directory/graph/digests. */
  readonly silver: string;
  /** `$home/corpus/gold` — distilled markdown. */
  readonly gold: string;
  /** `$home/corpus/.cache` — rebuildable per-corpus caches (distil batches, vectors). */
  readonly cache: string;
  /** `$home/corpus/.watermark.json` — per-source incremental resume cursor. */
  readonly watermark: string;
  /**
   * `$home/corpus/.subset.json` — present only when this home is a TIME-BOUNDED SUBSET of another corpus
   * ({@link ../corpus/subset}). Its absence is the ordinary full-corpus case, so nothing scaffolds it and
   * nothing fails without it; its PRESENCE is what makes every answer path off this home say so.
   */
  readonly subset: string;
  /**
   * `$home/corpus/.github-repos.watermark.json` — the PER-REPO GitHub org-mode cursor (`owner/repo` →
   * cursor). Kept separate from the per-source watermark so one busy repo can't advance the whole org past
   * quieter repos; the single-repo path never touches it.
   */
  readonly githubReposWatermark: string;
  /** `$home/corpus/.slack-threads.json` — per-thread last-seen reply cursor (incremental reply reads). */
  readonly slackThreads: string;
  /**
   * `$home/corpus/.slack-channels.watermark.json` — the PER-CHANNEL Slack cursor (channel id → cursor).
   *
   * Kept separate from the per-source watermark for the same reason the per-repo GitHub one is, and for a
   * second reason that only Slack has: the pooled cursor cannot say whether a channel has ever been crawled
   * at all. A channel created, joined, un-archived or simply missed by an earlier walk inherits the pooled
   * cursor and is therefore only ever read FORWARD from it — its whole prior history is unreachable without
   * re-crawling every channel. A per-channel entry is what makes "never backfilled" a state the planner can
   * see, and a full-history pull the thing it does about it exactly once.
   */
  readonly slackChannelsWatermark: string;
  /**
   * `$home/corpus/.gmail-history.json` — the mailbox's `historyId` anchor, and whether it has ever been
   * fully crawled.
   *
   * A SECOND cursor layer for one source, like the per-repo and per-channel files above, and here the two
   * layers are not the same kind of thing at all. The pooled `watermarks/gmail.json` is a `tsIso`, which is
   * what every other source resumes on; this is Gmail's own mailbox sequence id, which is the only cursor
   * that reports a message ARRIVING rather than a message being newer than a date. Gmail keeps roughly a
   * week of it and answers an older id with a 404, so this file also records whether the mailbox was ever
   * crawled end to end — without that, an expiry is indistinguishable from a first run, and the recovery
   * for the two is different.
   */
  readonly gmailHistory: string;
  /**
   * `$home/corpus/exports/chatgpt` — every ChatGPT data export `chatgpt import-export` has taken in, one
   * `<sha256>/` directory per archive holding its `conversations*.json` and a `manifest.json`.
   *
   * The lossless capture for a source that is never fetched: bronze is the projection, and an archive kept here
   * is what a later projection re-reads without asking the owner for another export. Named by content hash, so the
   * same archive downloaded twice is one directory.
   */
  readonly chatgptExports: string;
  /**
   * The live copy of the owner's ChatGPT history: one snapshot per conversation `chatgpt live-sync` read whole from the
   * web session, each a body named by its own hash beside the manifest that names it. Source material `refresh` reads
   * beside every held export, so it sits in the corpus, never in `live/`, which is never ingested.
   */
  readonly chatgptLive: string;
}

/** The corpus area's fields of {@link ../stateHome.StateHomePaths}. */
export interface CorpusStateHomePaths {
  /** The medallion corpus roots. */
  readonly corpus: CorpusPaths;
}

/**
 * Resolve the medallion corpus paths.
 *
 * @param home the resolved Slopweaver home
 * @returns the corpus roots and leaf paths
 */
function corpusHomePaths({ home }: { home: string }): CorpusPaths {
  const corpusRoot = join(home, "corpus");
  return {
    attachments: join(corpusRoot, "attachments"),
    bodies: join(corpusRoot, "bodies"),
    bronze: join(corpusRoot, "bronze"),
    cache: join(corpusRoot, ".cache"),
    chatgptExports: join(corpusRoot, "exports", "chatgpt"),
    chatgptLive: join(corpusRoot, "chatgpt", "live"),
    githubReposWatermark: join(corpusRoot, ".github-repos.watermark.json"),
    gmailHistory: join(corpusRoot, ".gmail-history.json"),
    gold: join(corpusRoot, "gold"),
    history: join(corpusRoot, "history"),
    directory: join(corpusRoot, "directory"),
    members: join(corpusRoot, "members"),
    root: corpusRoot,
    silver: join(corpusRoot, "silver"),
    slackChannelsWatermark: join(corpusRoot, ".slack-channels.watermark.json"),
    slackThreads: join(corpusRoot, ".slack-threads.json"),
    structures: join(corpusRoot, "structures"),
    subset: join(corpusRoot, ".subset.json"),
    watermark: join(corpusRoot, ".watermark.json"),
  };
}

/**
 * Resolve the corpus area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the corpus area's fields, rooted at `home`
 */
export function corpusStateHomePaths({ home }: { home: string }): CorpusStateHomePaths {
  return {
    corpus: corpusHomePaths({ home }),
  };
}
