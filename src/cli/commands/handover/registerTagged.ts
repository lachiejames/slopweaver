/**
 * `handover register --tag`: the tags a new row is registered with, and the locked create → tag → mirror sequence
 * every registration runs.
 *
 * The doc is always mirrored once it exists, whether or not its tag write then succeeded — the row is on the board
 * either way, and a failed tag prints the one command that finishes it, safe whether or not the append landed.
 */

import { slopweaverHome } from "../../../config.js";
import { TAG_LIST_SEPARATOR } from "../../../handover/rowTags.js";
import { acquireRowTagsLock, appendTagWrite } from "../../../handover/tagStore.js";
import { parseTagRequest, type TagRequest } from "../../../handover/tagWrite.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { RegisterOut } from "./askRowRun.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { createRowDoc, registerSlug } from "./registerWrite.js";
import { printTagOutcome, printTagRecovery } from "./tagReceipt.js";

/** The reason a registration's tag event records. */
const REGISTERED_WHY = "registered with --tag";

/**
 * The tags `--tag` and `--new-value` ask a new row to carry, or why they cannot.
 *
 * @param values the parsed register flags
 * @returns the request (undefined when `--tag` was not passed), or the usage refusal
 */
export function plannedTags({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly refusal: string } | { readonly tags: TagRequest | undefined } {
  const tag = values["tag"];
  const newValue = values["new-value"];
  if (typeof tag !== "string") {
    return typeof newValue === "string"
      ? { refusal: "--new-value acknowledges a value --tag sets — pass --tag" }
      : { tags: undefined };
  }
  if (typeof values["dir"] === "string") {
    return {
      refusal: "--tag is refused beside --dir: a row's journal belongs to the home board, whatever --dir names",
    };
  }
  const request = parseTagRequest({
    assignments: tag.split(TAG_LIST_SEPARATOR),
    drops: undefined,
    newValues: typeof newValue === "string" ? newValue : undefined,
  });
  return request.isErr() ? { refusal: request.error.join("; ") } : { tags: request.value };
}

/**
 * Create the row, tag it when asked, mirror it — the whole write, under the board-wide tag lock.
 *
 * @param handoverDir the board directory the doc lands in
 * @param home the state home
 * @param slug the new row's slug, already proven safe
 * @param text the doc to write
 * @param tags the tags to write, or undefined for none
 * @param printed prints the registration receipt once the doc exists
 * @param out where the tag receipt goes
 * @returns the process exit code — non-zero when the doc, its tags or its mirror failed
 */
export async function writeRegisteredRow({
  handoverDir,
  home,
  slug,
  text,
  tags,
  printed,
  out,
}: {
  handoverDir: string;
  home: string;
  slug: string;
  text: string;
  tags: TagRequest | undefined;
  printed: (path: string) => void;
  out: RegisterOut;
}): Promise<number> {
  const nowIso = new Date().toISOString();
  const lock = acquireRowTagsLock({ home, nowIso });
  if (lock.isErr()) {
    logger.error({ msg: `handover register: ${lock.error.message}` });
    return EXIT_ERROR;
  }
  try {
    const runsDir = stateHomePaths({ home }).runs;
    const created = createRowDoc({ handoverDir, runsDir, slug, tags, text });
    if (created.isErr()) {
      logger.error({ msg: `handover register: ${created.error}` });
      return EXIT_ERROR;
    }
    printed(created.value.path);
    let tagFailed = false;
    if (tags !== undefined && created.value.judged !== undefined) {
      const outcome = appendTagWrite({
        judged: created.value.judged,
        now: () => new Date().toISOString(),
        runsDir,
        slug,
        why: REGISTERED_WHY,
      });
      if (outcome.isErr()) {
        tagFailed = true;
        logger.error({ msg: `handover register: the row is on the board, its tags are not: ${outcome.error.message}` });
        printTagRecovery({
          home: home === slopweaverHome() ? undefined : home,
          request: tags,
          runsDir,
          slug,
          why: REGISTERED_WHY,
        });
      } else {
        printTagOutcome({ out, outcome: outcome.value, slug });
      }
    }
    const mirrorFailed = await mirrorAfterWrite({ home, path: created.value.path, verb: "register" });
    return mirrorFailed || tagFailed ? EXIT_ERROR : EXIT_OK;
  } finally {
    lock.value.release();
  }
}

/**
 * The slug and tags a registration plans — the two things that decide which row it creates and what that row
 * carries — or the first usage refusal between them.
 *
 * @param ask the trimmed ask, which the slug is built from when `--slug` is absent
 * @param values the parsed register flags
 * @returns the slug and planned tags, or the refusal
 */
export function plannedRow({
  ask,
  values,
}: {
  ask: string;
  values: Readonly<Record<string, unknown>>;
}): { readonly refusal: string } | { readonly slug: string; readonly tags: TagRequest | undefined } {
  const named = values["slug"];
  const slug = registerSlug({ ask, named: typeof named === "string" ? named : undefined });
  if ("refusal" in slug) {
    return slug;
  }
  const tags = plannedTags({ values });
  if ("refusal" in tags) {
    return tags;
  }
  return { slug: slug.slug, tags: tags.tags };
}
