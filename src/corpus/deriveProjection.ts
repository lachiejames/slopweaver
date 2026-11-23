/**
 * The `derive` projection's two field decisions, kept out of `./corpusStore` so the record assembler stays
 * one readable function and this projection's reasoning sits in one place.
 *
 * Both exist for the same measured fact: over 43,380 records across all six sources, `text`
 * was 43.8% of bronze's bytes and `raw` was 37.0% — and `src/silver` reads neither wholesale. Reproduce the
 * breakdown by summing `JSON.stringify(value).length` per top-level key over a bronze sample, and the heap
 * effect with `slopweaver dev heap-curve --projection derive --corpus ~/.slopweaver/corpus/bronze/<source>`.
 */
import { isRecord } from "../lib/parsers.js";
import type { CorpusProjection } from "./corpusRowCore.js";
import { readsUnresolvedText } from "./unresolvedText.js";

/**
 * The body a projection keeps, and — for `derive` — the one fact it records before dropping it.
 *
 * The order is the whole point: the flag is computed while the text is still in hand, so nothing downstream
 * has to have kept the text to answer the same question. Every other projection returns nothing, and the
 * body already on `core` stands.
 *
 * @param text the record's body, the thing being dropped
 * @param projection which fields this read retains
 * @param title the record's title, when it has one — the marker test reads title and body together
 * @returns the fields to spread over `core`, empty for every projection that keeps the body
 */
export function bodyFields({
  text,
  projection,
  title,
}: {
  text: string;
  projection: CorpusProjection;
  title: string | undefined;
}): { text: string; unresolved: boolean } | Record<string, never> {
  if (projection !== "derive") {
    return {};
  }
  return {
    text: "",
    unresolved: readsUnresolvedText({ text, ...(title !== undefined ? { title } : {}) }),
  };
}

/**
 * The GitHub REST account type off a search hit's `user` object, when the payload carried one.
 *
 * GitHub answers the same question twice under two names, and which one a record carries is decided by the
 * leg that fetched it rather than by anything about the record. GraphQL spells it `author.__typename`
 * (`Bot` / `User`); the REST issue-search hit `src/corpus/github/fetch.ts` projects `pr` and `issue` rows
 * from spells it `user.type` (`Bot` / `User`), and that leg selects no `author` at all. Measured across the
 * a couple of hundred thousand GitHub bronze records on the owner's install: every one of the tens of
 * thousands of `pr` rows carries no `__typename`, while `user.type` answers on about half of them.
 *
 * Reproduce (the `(none)` bucket is what this exists to shrink):
 * `node -e 'const{createInterface}=require("node:readline"),{createReadStream}=require("node:fs");const
 * t=new Map();createInterface({input:createReadStream(process.argv[1])}).on("line",l=>{if(!l.trim())return;
 * const r=JSON.parse(l);if(r.kind!=="pr"&&r.kind!=="issue")return;const
 * u=r.raw?.user;t.set(u?.type??"(none)",(t.get(u?.type??"(none)")??0)+1)}).on("close",()=>console.log(t))'
 * $SLOPWEAVER_HOME/corpus/bronze/github/compact.jsonl`
 *
 * @param raw the record's own payload
 * @returns the account type, or `undefined` when this payload is not a REST hit carrying one
 */
function githubAccountType({ raw }: { raw: Readonly<Record<string, unknown>> }): string | undefined {
  const user = raw["user"];
  if (!isRecord(user)) {
    return undefined;
  }
  const type = user["type"];
  return typeof type === "string" ? type : undefined;
}

/**
 * The `raw` scalars silver reads, lifted out of a payload that is 37.0% of bronze's bytes.
 *
 * Exhaustive when written, and the list is checkable rather than asserted: `raw.subtype` and
 * `raw.bot_id` are the Slack machine-transport signals (`../silver/actorKind.machineTransportReasons`),
 * `raw.author.__typename` and `raw.user.type` are the GitHub account-kind signals
 * (`machineIdentityReasons`), and `raw.user` — when it is a STRING — is the Slack native author id
 * (`../silver/personResolver`). Nothing else in `src/silver` reads `record.raw` at all.
 *
 * **`raw.user` is two different fields wearing one name**, which is why it is read twice here. Slack's is a
 * `U…` string; GitHub's REST hit makes it an object carrying `type`. Reading only the string half is what
 * dropped the GitHub REST signal for every `pr` and `issue` record under a derive while leaving it visible
 * under a bronze read — a test written at the wrong projection could not have seen it.
 * {@link ../silver/personResolver.chatNativeAuthorId} is unaffected in either direction: it early-returns
 * on a non-Slack source and then requires a string, so the object form is invisible to it.
 *
 * The shape returned is a `raw` again rather than a new field, so every consumer keeps its existing reads
 * and a source that later needs another scalar adds it here instead of re-plumbing silver. A payload with
 * none of them yields `undefined`, so a record that carried nothing useful carries nothing at all.
 *
 * @param raw the record's own payload, when it had a parseable one
 * @returns the retained scalars, or `undefined` when none of them were present
 */
export function deriveRawDigest({
  raw,
}: {
  raw: Readonly<Record<string, unknown>> | undefined;
}): Readonly<Record<string, unknown>> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const author = raw["author"];
  const typename = isRecord(author) ? author["__typename"] : undefined;
  const accountType = githubAccountType({ raw });
  const digest: Record<string, unknown> = {};
  if (typeof raw["subtype"] === "string") {
    digest["subtype"] = raw["subtype"];
  }
  if (typeof raw["bot_id"] === "string") {
    digest["bot_id"] = raw["bot_id"];
  }
  if (typeof raw["user"] === "string") {
    digest["user"] = raw["user"];
  }
  if (accountType !== undefined) {
    digest["user"] = { type: accountType };
  }
  if (typeof typename === "string") {
    digest["author"] = { __typename: typename };
  }
  return Object.keys(digest).length > 0 ? digest : undefined;
}
