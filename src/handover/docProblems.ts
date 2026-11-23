/**
 * What one handover doc's front matter reads as wrong, gathered for `./doc.ts`'s `parseHandoverDoc`. Its own file
 * so `./doc.ts` stays under the file-size ratchet.
 *
 * Pure: the caller supplies the already-read fields.
 */
import { templateProblems } from "../cmux/launchTemplate.js";
import { problemsBesideHisWords } from "./hisWords.js";
import { workspaceProblems } from "./workspace.js";

/**
 * Every problem one doc's front-matter reading found: the flat keys', the nested blocks', and a declared template's
 * or workspace's.
 *
 * @param flat the flat keys' reading — every key written twice, and what it could not read
 * @param nested what the nested blocks could not read
 * @param named the flat value under a key, absent when the doc wrote none
 * @returns the problems, in that order
 */
export function docProblems({
  flat,
  nested,
  named,
}: {
  flat: { readonly duplicated: readonly string[]; readonly problems: readonly string[] };
  nested: readonly string[];
  named: ({ key }: { key: string }) => string | undefined;
}): readonly string[] {
  return [
    ...problemsBesideHisWords({ duplicated: flat.duplicated, problems: flat.problems }),
    ...nested,
    ...templateProblems({ declared: named({ key: "template" }) }),
    ...workspaceProblems({ declared: named({ key: "workspace" }) }),
  ];
}
