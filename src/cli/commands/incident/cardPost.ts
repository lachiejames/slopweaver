/**
 * What `incident note` and `incident postmortem` share once each has built its card: the published-page check its
 * Open button rests on, and the dry run that admits against their real home and draws from a throwaway one.
 *
 * Shared rather than copied because both are a rule about what they are shown: a dry run that drifted between the two
 * verbs would prove one card's admission and not the other's.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PagePublished } from "../../../pages/published.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { handAdmissionExit, recordHandStep } from "../hand/applyPost.js";
import { namedRowRefusal } from "../hand/post.js";

/**
 * Why a card's proof page cannot back its Open button, asked of the store: absent, or a store that could not say.
 * The two read differently because they lead to different moves — publish it, or get the store reachable.
 *
 * @param verb the verb's words after `slopweaver`, as its diagnostics open (`incident note`)
 * @param home the state home whose store is asked
 * @param slug the proof page the card opens
 * @param pagePublished asks the store
 * @param what the page's role in a refusal (`the receipts`)
 * @param opens what publishing it lets the card do (`the note opens them`)
 * @returns the refusal to write, or undefined when the store serves the page
 */
export async function proofPageRefusal({
  verb,
  home,
  slug,
  pagePublished,
  what,
  opens,
}: {
  verb: string;
  home: string;
  slug: string;
  pagePublished: PagePublished;
  what: string;
  opens: string;
}): Promise<string | undefined> {
  const published = await pagePublished({ home, slug });
  if (published.isErr()) {
    return `${verb}: could not check that proof "${slug}" is published, so nothing was posted: ${published.error.message}`;
  }
  if (published.value) {
    return undefined;
  }
  return (
    `${verb}: proof "${slug}" is no published page (the store holds none by that name) — publish ${what} with ` +
    `\`slopweaver page publish ${slug} --page <file> --review <id>\` (the review from ` +
    `\`slopweaver page review-prepare\`) first, so ${opens}`
  );
}

/**
 * Admit against their real home, then record and draw from a throwaway one.
 *
 * @param verb the verb's words after `slopweaver`, as its diagnostics open (`incident note`)
 * @param home their state home — the row, the drafts and the posting rules are judged against it
 * @param post the built step and its reporting choices
 * @returns the process exit code
 */
export async function dryRunCardPost({
  verb,
  home,
  post,
}: {
  verb: string;
  home: string;
  post: Omit<Parameters<typeof recordHandStep>[0], "home" | "admitRow" | "supersedes">;
}): Promise<number> {
  const refused = handAdmissionExit({ deps: post.deps, home, step: post.step });
  if (refused !== undefined) {
    return refused;
  }
  const row = post.step.row;
  const rowRefused = row === undefined ? undefined : namedRowRefusal({ home, row });
  if (rowRefused !== undefined) {
    post.deps.writeDiagnostic(`${verb}: ${rowRefused}`);
    return EXIT_ERROR;
  }
  const throwaway = mkdtempSync(join(tmpdir(), `${verb.replaceAll(" ", "-")}-dry-run-`));
  post.deps.writeOut(`${verb} --dry-run: admitted against ${home}; drawn from ${throwaway}, their queue untouched`);
  return recordHandStep({ ...post, admitRow: () => undefined, home: throwaway, supersedes: undefined });
}
