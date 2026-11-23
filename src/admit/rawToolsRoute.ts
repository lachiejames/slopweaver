/**
 * Where a blocked raw command is pointed instead — the route category `./rawTools.ts` classifies a block
 * into, and the words each category prints.
 *
 * Split out of `./rawTools.ts` when the `gh run rerun --failed` category (`github rerun`) took that file past
 * its size ceiling. The seam is real: the classifier decides WHICH category a command falls
 * in, and this module owns what each one tells the reader, so a new governed verb is one category and one
 * sentence here plus the predicate that recognises it there.
 */
import { gcloudCategory } from "./rawGcloudRoute.js";

/**
 * The classified action behind a block — what actually decides the route hint. `tool` alone is not enough:
 * `/slopweaver:github` covers a real `git push` and a handful of `gh pr` mutations, but nothing else this
 * classifier blocks has a governed verb at all yet (an adversarial P1 pass on an earlier, tool-keyed version
 * of this hint found it pointing `git reset --hard` and `gh release delete` at a command that cannot do
 * either), so each of those gets its own honest hint instead of a false promise.
 */
export type RouteCategory =
  | "cmux-governed"
  | "cmux-ungoverned"
  | "cmux-retired"
  | "git-push"
  | "local-destructive-git"
  | "supported-github-write"
  | "supported-github-write-review-request"
  | "supported-github-write-retarget"
  | "supported-github-write-rerun"
  | "supported-github-write-cycle"
  | "other-github-write"
  | "external-request"
  | "governed-read-watch"
  | "ungoverned-read-watch"
  | "governed-read-run-log"
  | "script-reach"
  | "cloud-cli"
  | "gcp-governed"
  | "secrets-cli"
  | "production-cli";

/**
 * Where the block message points, in prose, for one classified route category.
 *
 * @param category the classified category
 * @returns the phrase completing "Route it through …"
 */
export function routeHint({ category }: { category: RouteCategory }): string {
  switch (category) {
    case "cmux-governed":
      return "the matching `slopweaver cmux …` / `slopweaver session watch` verb (`slopweaver catalog`)";
    case "cmux-ungoverned":
      return "a governed cmux verb if one exists (`slopweaver catalog`), or the explicit break-glass below — this cmux subcommand has none yet";
    // A seat whose transcript still carries an old instruction to publish a checklist or lane reaches for
    // the raw form once the verb is gone; the ungoverned hint would point it at break-glass, inviting the write the
    // owner retired. The process-wide override still opens it, as it opens every raw class: every refusal keeps a hatch.
    case "cmux-retired":
      return "nothing — sidebar checklists, status lanes and progress bars are retired, so drop that instruction; a seat's state reaches the owner as a Queue card or a floating note";
    case "git-push":
    case "supported-github-write":
      return "the `/slopweaver:github` command (or `slopweaver github <verb>` directly)";
    case "supported-github-write-review-request":
      return "`slopweaver github pr request-review --repo <owner/name> --number <n> --reviewer <login>`";
    case "supported-github-write-retarget":
      return "`slopweaver github pr retarget --repo <owner/name> --number <n> --base <ref>`";
    case "supported-github-write-rerun":
      return "`slopweaver github rerun --repo <owner/name> --run-id <id>` (or `--number <n>` for a pull request's head)";
    case "supported-github-write-cycle":
      return "`slopweaver github cycle --repo <owner/name> --number <n>` to close and reopen an OPEN pull request for fresh CI — no verb reopens one somebody closed";
    case "local-destructive-git":
      return "a non-destructive alternative, or the explicit break-glass below — no governed verb performs this";
    case "other-github-write":
      return "a governed GitHub verb if one exists (`slopweaver catalog`), or the explicit break-glass below — this one has none yet";
    case "external-request":
      return "the door (run the matching `slopweaver` verb)";
    case "governed-read-watch":
      return "`slopweaver github checks --number <n> --wait [--timeout-seconds <n>]`";
    case "ungoverned-read-watch":
      return "a governed GitHub verb if one exists (`slopweaver catalog`), or the explicit break-glass below — no governed verb covers a workflow-run watch yet";
    case "governed-read-run-log":
      return "`slopweaver github checks --number <n> --log` from a pull request, or `slopweaver github run-log <run-id> [--job <name>]` from a run id — annotations first, then a bounded tail";
    case "script-reach":
      return "the governed verb for what the script does (`slopweaver catalog`; a CI watch is `slopweaver github checks --number <n> --wait`), or the explicit break-glass below";
    case "gcp-governed":
      return "`slopweaver gcp <run|secret|service-account|services|artifacts> <action>` (`slopweaver gcp <family> --help`) — a write previews first and is sent only with the `--approve` digest that preview prints";
    // Each of the three below names NO verb, because none exists. That is the whole point of the category:
    // a hint pointing at a verb which cannot do the job is worse than the generic one, because it actively
    // misdirects — the exact mistake `GITHUB_COMMAND_COVERS`'s own comment records being hit on
    // `pr edit --base` before anyone noticed the door was missing entirely.
    case "cloud-cli":
      return "a read through the matching atlas if one is filled (`slopweaver catalog`), or the explicit break-glass below — no governed verb performs this operation";
    case "secrets-cli":
      return "`slopweaver secrets set` to STORE a credential this install needs, or the explicit break-glass below — no governed verb reads a vault, and a raw read puts the value in a transcript";
    case "production-cli":
      return "the recorded grant named below — this class does NOT take the ambient break-glass";
  }
}

/**
 * The sidebar writes the owner retired — a checklist, a progress bar, a workspace status lane. No verb
 * performs them and none should, so a raw one is refused as RETIRED rather than pointed at break-glass.
 */
const CMUX_RETIRED_SUBCOMMANDS: ReadonlySet<string> = new Set(["todo", "set-progress", "clear-progress"]);

/**
 * A word as cmux receives it, near enough for a hint: a shell removes quotes and backslashes wherever they sit, so
 * `'todo'`, `t'odo'` and `t\odo` are all `todo`.
 */
function shellWord({ word }: { word: string | undefined }): string | undefined {
  return word?.replace(/['"\\]/gu, "");
}

/**
 * Whether a raw `cmux` call is one of the sidebar writes the owner retired, however its words are quoted.
 *
 * @param subcommand the first non-flag word after `cmux`
 * @param sub the next non-flag word, when there is one
 * @returns true for `todo`, `set-progress`, `clear-progress` and `workspace status`
 */
export function isRetiredCmuxWrite({ subcommand, sub }: { subcommand: string; sub: string | undefined }): boolean {
  const word = shellWord({ word: subcommand })!;
  return CMUX_RETIRED_SUBCOMMANDS.has(word) || (word === "workspace" && shellWord({ word: sub }) === "status");
}

/**
 * What a reaching CLI's category reaches, in prose, for the block's reason line.
 *
 * @param category the reaching category
 * @returns the phrase completing "raw <tool> reaches …"
 */
export function reachDescription({ category }: { category: RouteCategory }): string {
  if (category === "cloud-cli" || category === "gcp-governed") {
    return "a cloud control plane outside the door";
  }
  if (category === "secrets-cli") {
    return "a credential vault outside the door";
  }
  return "a production system outside the door";
}

/**
 * How a reaching CLI's call is classified: the category its table entry names — a `gcloud` call refined by
 * whether `slopweaver gcp` performs it — and the reason line naming what it reaches.
 *
 * @param reaching the category the reaching-tools table names for this tool
 * @param tokens the call's own tokens, env prefix already stripped
 * @returns the segment's category, reason and tool
 */
export function reachingSegment({
  tool,
  tokens,
  reaching,
}: {
  tool: string;
  tokens: readonly string[];
  reaching: RouteCategory;
}): { readonly category: RouteCategory; readonly reason: string; readonly tool: string } {
  const category = tool === "gcloud" ? gcloudCategory({ tokens }) : reaching;
  return { category, reason: `raw ${tool} reaches ${reachDescription({ category: reaching })}`, tool };
}
