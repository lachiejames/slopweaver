/**
 * Assemble a {@link BareRefContext} from what this CLI invocation already has on disk — the impure edge
 * `../outbound/linkify/bareRefs.ts`'s pure resolver deliberately does not reach for itself.
 *
 * A repo comes from the checkout's own `origin` remote, exactly what `../config.ts`'s `resolveRepository`
 * already gives every GitHub CLI command — the same fact answers "which repo is this turn about" for Slack
 * and Notion, since a write there also runs from inside this same checkout. The Linear workspace slug and
 * team keys come from `./linearReferenceFacts.ts`, read best-effort: absence is a normal, expected case (no
 * Linear connected, or `derive` never ran), never an error a caller has to branch on.
 *
 * The compliance controls come from the Vanta atlas's own control kind, on the SAME best-effort terms: an
 * install with no atlas simply cannot recognise a control id, which narrows what this door refuses rather
 * than breaking it. The tenant slug is resolved separately from the entities and is allowed to fail on its
 * own, because `../atlas/vanta/tenantSlug.ts` says why — an atlas full of controls with no slug to address
 * them by must refuse a bare `HRS-52` BY NAME, not fall back to letting it through as prose.
 */
import { vantaControlRefs } from "../atlas/vanta/controlLinks.js";
import { readVantaKindFile, vantaAtlasPaths } from "../atlas/vanta/store.js";
import { resolveVantaTenantSlug } from "../atlas/vanta/tenantSlug.js";
import { type Repository, resolveRepository } from "../config.js";
import type { BareRefContext, ComplianceControlRef } from "../outbound/linkify/bareRefs.js";
import { linearReferenceFacts } from "./linearReferenceFacts.js";

/**
 * Every compliance control this install's atlas holds, with the URL each links to — empty when no atlas has
 * been built, which simply narrows what a control id can be recognised as.
 */
function complianceControls({
  home,
  env,
}: {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}): readonly ComplianceControlRef[] {
  const file = readVantaKindFile({ kind: "control", paths: vantaAtlasPaths({ home }) });
  if (file.isErr() || file.value === null) {
    return [];
  }
  const slug = resolveVantaTenantSlug({ env, flag: null, home });
  return vantaControlRefs({ entities: file.value.entities, tenantSlug: slug.isOk() ? slug.value : null });
}

/**
 * The bare-reference context for a CLI write running inside a checkout — the checkout's own repo, plus
 * whatever Linear workspace facts the silver directory already carries.
 *
 * @param home the state home the silver directory and the atlas are read from
 * @param cwd the checkout to read the `origin` remote from (defaults to the process cwd)
 * @param env the environment the Vanta tenant slug may come from, defaulting to the process environment
 * @returns the context; an unresolvable repo, an absent Linear directory or an absent atlas simply narrows
 *   what can resolve, never throws
 */
export function bareRefContext({
  home,
  cwd,
  env = process.env,
}: {
  home: string;
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
}): BareRefContext {
  const repository = resolveRepository({ home, ...(cwd === undefined ? {} : { cwd }) });
  const repos: readonly Repository[] = repository.isOk() ? [repository.value] : [];
  const { workspaceSlug: slug, teamKeys } = linearReferenceFacts({ home });
  return {
    complianceControls: complianceControls({ env, home }),
    linearTeamKeys: teamKeys,
    ...(slug !== undefined ? { linearWorkspaceSlug: slug } : {}),
    repos,
  };
}

/**
 * The bare-reference context for the BOT'S OWN ANSWER to a Slack thread — everything {@link bareRefContext}
 * carries except the checkout's repo, which is deliberately absent.
 *
 * A bot turn runs inside a Slopweaver worktree and answers a thread that is about whatever the thread is
 * about, so the checkout's `origin` is never evidence of which repository a `#<number>` in that answer means.
 * MEASURED on the bisect turn on the release thread (dispatch `C0SYN000002/1789444018.901359`):
 * five acme-admin pull requests cited as bare `#<number>`-style numbers were linked into
 * `github.com/lachiejames/slopweaver/pull/…` by `turn review` and `turn answer` — five dead links to the
 * wrong repository — because both built their context with {@link bareRefContext}, which handed the
 * resolver this checkout as "exactly one repo". The reviewer caught them after the fact; the
 * rule is that the mistake is made structurally impossible instead.
 *
 * With no repo in the context, the pure resolver's own rule does the work: a bare `#<number>` resolves only when
 * the SAME text names exactly one repository with a full `github.com/<owner>/<repo>` link (its "TEXT wins"
 * seam), and otherwise the answer is refused BEFORE it posts, naming the reference and the two spellings
 * that fix it — `owner/repo#<number>`, or one full link beside it. `owner/repo#<number>` always resolved and still
 * does. The Linear workspace facts and the compliance-control table are unchanged, because a Linear key
 * and a control id are resolved against the install, not against a checkout.
 *
 * @param home the state home the silver directory and the atlas are read from
 * @param env the environment the Vanta tenant slug may come from, defaulting to the process environment
 * @returns the context with `repos` empty; an absent Linear directory or atlas narrows what can resolve,
 *   never throws
 */
export function botAnswerBareRefContext({
  home,
  env = process.env,
}: {
  home: string;
  env?: Readonly<Record<string, string | undefined>>;
}): BareRefContext {
  const { workspaceSlug: slug, teamKeys } = linearReferenceFacts({ home });
  return {
    complianceControls: complianceControls({ env, home }),
    linearTeamKeys: teamKeys,
    ...(slug !== undefined ? { linearWorkspaceSlug: slug } : {}),
    repos: [],
  };
}
