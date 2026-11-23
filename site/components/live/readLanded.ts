/**
 * The reader for `fleet landed --json` — what landed on main, each change beside the owner's words and its proof
 * (`src/fleet/landed.ts`).
 *
 * A sibling of `./read.ts`, and every rule that file's module doc states governs this one: refuse rather than
 * substitute, never DROP a row. The verb writes an absent field as `null`, so a field that is MISSING is the wire
 * changing under the page, and the whole reading is refused — a history with one landing quietly dropped reads
 * exactly like a quieter day, and a landing shown without its words would read as one the owner never asked for.
 */
import { type Bag, bags, bool, isBag, nullableNum, num, str, sub } from "../../lib/bag";
import {
  instant,
  type LandedProofView,
  type LandedUnderView,
  type LandedWordsView,
  orNull,
  REFUSED,
  readProof,
  readUnder,
  readWords,
  why,
} from "./readLandedArms";

export type {
  LandedClaimView,
  LandedProofView,
  LandedSideView,
  LandedUnderView,
  LandedWordsView,
} from "./readLandedArms";

/** One landed change. */
export interface LandedView {
  readonly sha: string;
  readonly mergedIso: string;
  readonly number: number | undefined;
  readonly title: string;
  readonly url: string | undefined;
  readonly row: { readonly slug: string; readonly archived: boolean } | undefined;
  readonly words: LandedWordsView;
  readonly under: LandedUnderView;
  readonly proof: LandedProofView;
}

/** What the page draws: the window read and every landing in it, newest first. */
export interface LandedReportView {
  readonly observedAtIso: string;
  readonly repo: string;
  readonly ref: string;
  readonly refSha: string;
  readonly limit: number;
  /** PR-ledger files that would not read — any one may be a second record for a change shown as joined. */
  readonly ledgerUnread: readonly { readonly file: string; readonly why: string }[];
  readonly landings: readonly LandedView[];
}

/** @returns the row a change joined, `undefined` for the verb's `null`, or {@link REFUSED} */
function readRow({ bag }: { bag: Bag }): LandedView["row"] | typeof REFUSED {
  if (bag["row"] === null) {
    return undefined;
  }
  const row = sub({ bag, key: "row" });
  if (row === undefined) {
    return REFUSED;
  }
  const slug = str({ bag: row, key: "slug" });
  const archived = bool({ bag: row, key: "archived" });
  if (slug === undefined || archived === undefined) {
    return REFUSED;
  }
  return { archived, slug };
}

/** @returns one landing, or `undefined` when any part of it will not read */
function readLanding({ bag }: { bag: Bag }): LandedView | undefined {
  const sha = str({ bag, key: "sha" });
  const mergedIso = instant({ bag, key: "mergedIso" });
  const number = nullableNum({ bag, key: "number" });
  const title = str({ bag, key: "title" });
  const url = orNull({ bag, key: "url" });
  const row = readRow({ bag });
  const wordsBag = sub({ bag, key: "words" });
  const underBag = sub({ bag, key: "under" });
  const proofBag = sub({ bag, key: "proof" });
  if (
    sha === undefined ||
    mergedIso === undefined ||
    number === false ||
    title === undefined ||
    url === REFUSED ||
    row === REFUSED ||
    wordsBag === undefined ||
    underBag === undefined ||
    proofBag === undefined
  ) {
    return undefined;
  }
  const words = readWords({ bag: wordsBag });
  const under = readUnder({ bag: underBag });
  const proof = readProof({ bag: proofBag });
  if (words === undefined || under === undefined || proof === undefined) {
    return undefined;
  }
  return { mergedIso, number, proof, row, sha, title, under, url, words };
}

/**
 * Project `fleet landed --json` into the Past view's landed history.
 *
 * The landings are kept in git's first-parent order, which is the order main received them. Nothing here depends on
 * their commit instants being monotonic: "since you last looked" counts by instant (`../../lib/landedLooked.ts`).
 *
 * @returns the report, or `undefined` when any part of it will not read
 */
export function readLanded(payload: unknown): LandedReportView | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = instant({ bag: payload, key: "observedAtIso" });
  const repo = str({ bag: payload, key: "repo" });
  const ref = str({ bag: payload, key: "ref" });
  const refSha = str({ bag: payload, key: "refSha" });
  const limit = num({ bag: payload, key: "limit" });
  const rows = bags({ bag: payload, key: "landings" });
  const unreadBags = bags({ bag: payload, key: "ledgerUnread" });
  if (
    observedAtIso === undefined ||
    repo === undefined ||
    ref === undefined ||
    refSha === undefined ||
    limit === undefined ||
    rows === undefined ||
    unreadBags === undefined
  ) {
    return undefined;
  }
  const ledgerUnread: { file: string; why: string }[] = [];
  for (const one of unreadBags) {
    const file = str({ bag: one, key: "file" });
    const reason = why({ bag: one });
    if (file === undefined || reason === undefined) {
      return undefined;
    }
    ledgerUnread.push({ file, why: reason });
  }
  const landings: LandedView[] = [];
  for (const row of rows) {
    const landing = readLanding({ bag: row });
    if (landing === undefined) {
      return undefined;
    }
    landings.push(landing);
  }
  return { landings, ledgerUnread, limit, observedAtIso, ref, refSha, repo };
}
