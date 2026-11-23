/**
 * Which ONE workspace a console row belongs to, read off structured fields and never off its words.
 *
 * Acme work must show up on the Acme page and never on the Slopweaver page. An Acme ISO ask carries
 * `repo: …/personal/slopweaver` — the checkout every fleet session runs in, because that is where the verbs live —
 * while every pull request it names is `acme/acme-admin`. A classifier that read that checkout ahead of everything,
 * and under it a regex over the row's prose, would place the ask on the wrong page.
 *
 * So the rule is three sentences:
 *
 * - **Evidence is a structured value, parsed whole**: a stated workspace, a GitHub repository (`owner/repo` or a
 *   GitHub URL), a Slack permalink or a row read from the installation's Slack register, a Linear or Vanta URL in
 *   the organisation's workspace, `state:` or a `localhost` URL naming this installation itself, an act KIND
 *   whose recorder only writes it for this installation's own repository, or a join to a board row that is itself
 *   placed. Never a title, a summary, a question, a checkout path or anything searched inside text.
 * - **Every piece of evidence is gathered; no address outranks another.** One workspace among them is `placed`;
 *   none is `unplaced`; both is `conflict`. The one ruling over a conflict is a STATED workspace — a judgement
 *   written with its reason (`handover set-workspace --because`) — and even that is never silent: the evidence it
 *   overrules stays on the placement and the row wears a mark naming it.
 * - **`unplaced` and `conflict` are FINDINGS**, placed by ONE default rule — `self`, this installation's own
 *   workspace (`./workspacePlacementContext.ts` `workspaceOfPlacement`) — under a mark saying the default placed it,
 *   and counted on the page. Never both views: a team card drawn on the Slopweaver view is a bug of a whole class.
 *   Never hidden either: an ask waiting on the owner that no view shows is worse.
 *
 * A checkout path is deliberately NOT evidence, in either direction. `repo:` on a board row is the checkout
 * `cmux spawn` cuts a worktree from (`handover set-repo`), which is where the work RUNS, not whose it is — the
 * measured defect. A Linear team and an atlas are read only where a row carries one as an ADDRESS — a
 * `linear.app/acme` or `app.vanta.com/c/acme` URL — because no register publishes either as a row-level
 * field of its own; inferring one from prose is the thing this module refuses.
 */

import type { PlacementOrganisation } from "./placementOrganisation";
import {
  GITHUB_HOSTS,
  hostNameOf,
  isLoopbackUrl,
  repositorySlugOf,
  routedOf,
  slackPermalinkPath,
  urlOf,
} from "./workspacePlacementAddress";
import type { Workspace, WorkspaceEvidence, WorkspacePlacement } from "./workspacePlacementBasis";

export {
  isWorkspace,
  type Workspace,
  type WorkspaceEvidence,
  type WorkspacePlacement,
  type WorkspaceSource,
} from "./workspacePlacementBasis";
// `./talkActionItems.ts` sits at its file-size floor, so it keeps its one import line from here.
export { findingLabel, markedCount } from "./workspacePlacementContext";

/**
 * The placement a set of evidence makes.
 *
 * @param evidence every structured value the row carried that names a workspace
 * @param why what the row carried instead, said on the row when the evidence is empty
 * @returns `placed` on one workspace, `unplaced` on none, `conflict` on both — unless one stated workspace
 *   settles both, which places the row there and carries what it overruled. The record's own stated workspace
 *   outranks one a joined row stated, which rules only when the record states none
 */
export function placementOf({
  evidence,
  why,
}: {
  evidence: readonly WorkspaceEvidence[];
  why: string;
}): WorkspacePlacement {
  const workspaces = new Set(evidence.map((one) => one.workspace));
  if (workspaces.size === 0) {
    return { kind: "unplaced", why };
  }
  if (workspaces.size > 1) {
    // The record's OWN stated workspace rules; one it inherited from a joined row rules only when it states none.
    let stated = evidence.filter((one) => one.source === "stated");
    if (stated.length === 0) {
      stated = evidence.filter((one) => one.source === "joined-stated");
    }
    const ruling = stated.at(0);
    if (ruling === undefined || stated.some((one) => one.workspace !== ruling.workspace)) {
      return { evidence, kind: "conflict" };
    }
    return {
      by: evidence.filter((one) => one.workspace === ruling.workspace),
      kind: "placed",
      overruled: evidence.filter((one) => one.workspace !== ruling.workspace),
      workspace: ruling.workspace,
    };
  }
  // One workspace in a non-empty set, so every piece of evidence names it.
  return { by: evidence, kind: "placed", workspace: [...workspaces].at(0)! };
}

/**
 * The evidence a row read from the installation's own Slack register carries — a held reply, a parked post.
 * The register reads one Slack workspace, the organisation's, so the register IS the structured value.
 *
 * @param register which Slack register the row came from, said on a finding
 * @returns the evidence
 */
export function slackRegisterEvidence({ register }: { register: string }): WorkspaceEvidence {
  return { source: "slack-workspace", value: register, workspace: "team" };
}

/**
 * The evidence a record's own stated workspace is.
 *
 * @param workspace what the record states, when it states one
 * @returns the evidence, or nothing
 */
export function statedEvidence({ workspace }: { workspace: Workspace | undefined }): readonly WorkspaceEvidence[] {
  if (workspace === undefined) {
    return [];
  }
  return [{ source: "stated", value: workspace, workspace }];
}

/** The host Linear serves every workspace's pages on, `linear.app/<workspace>/…`. */
const LINEAR_HOST = "linear.app";

/** The host Vanta serves its app on, a workspace's pages under `app.vanta.com/c/<workspace>/…`. */
const VANTA_HOST = "app.vanta.com";

/**
 * Every reader that has to know WHOSE an address is, closed over one organisation. The console reads the organisation
 * once per page (`./placementOrganisationLive.ts`) and hands this placer down; a pure projection takes it as a
 * parameter, and nothing here is a module constant, so a second organisation places by its own owner and hosts.
 */
export interface WorkspacePlacer {
  /**
   * The workspace a repository names, from an exact `owner/repo` (or `owner/repo#n`) or a `github.com` URL.
   *
   * A value that is neither is no evidence, and nor is a repository outside the organisation: this reads WHOSE
   * repository it is, and an owner it does not know is not a guess it gets to make. GitHub routes every
   * `github.com/<owner>/<name>` path to a repository — an organisation's own pages are `github.com/orgs/<org>/…` and an
   * account's settings `github.com/settings/…` — so the first two segments of a URL under the organisation name a
   * repository of it, and an organisation page names none. This build's own repository is `self` first, even under
   * the organisation's owner.
   */
  readonly repositoryEvidence: (args: { readonly value: string }) => WorkspaceEvidence | undefined;
  /** The workspace a Slack permalink on one of the organisation's Slack hosts names, the team's. */
  readonly slackEvidence: (args: { readonly value: string }) => WorkspaceEvidence | undefined;
  /** The workspace a `linear.app` URL in the organisation's Linear workspace names; none when it has no Linear. */
  readonly linearEvidence: (args: { readonly value: string }) => WorkspaceEvidence | undefined;
  /** The workspace an `app.vanta.com/c/<workspace>` URL in the organisation's names; none when it has no Vanta. */
  readonly vantaEvidence: (args: { readonly value: string }) => WorkspaceEvidence | undefined;
  /**
   * Every workspace a list of ADDRESSES names — each value read whole as a GitHub repository, a Slack permalink, a
   * Linear URL or a Vanta URL, and anything else (a console page, a local path, a sentence) contributing nothing.
   */
  readonly addressEvidence: (args: { readonly values: readonly string[] }) => readonly WorkspaceEvidence[];
  /**
   * The values among a record's addresses that parse as a URL, on a host a reader names a workspace on or on this
   * machine, but not as a web link spelled as written — `https://github.com:443/acme/acme-admin/pull/<number>`, a link padded
   * with whitespace, `ftp://github.com/…`. {@link urlOf} refuses each, rightly, so it names nothing; but it is plainly
   * an address on a host that places rows, and its record's other addresses may name the other workspace. Such a
   * record is a finding, never placed by the addresses beside it.
   */
  readonly repairedAddresses: (args: { readonly values: readonly string[] }) => readonly string[];
  /** Where something IN a repository belongs — a pull request, a census line: the repository it is in. */
  readonly repositoryPlacement: (args: { readonly repo: string }) => WorkspacePlacement;
}

/**
 * The placer one organisation's readers share.
 *
 * @param organisation what `slopweaver org show --json` printed, the fields placement reads
 * @returns the placer, every reader closed over that organisation and nothing else
 */
export function buildWorkspacePlacer({ organisation }: { organisation: PlacementOrganisation }): WorkspacePlacer {
  const slackHosts: ReadonlySet<string> = new Set(organisation.slackHosts);
  const { githubOwner, linearWorkspace, selfRepository, vantaWorkspace } = organisation;
  // Every host an address reader names a workspace on: GitHub, the organisation's Slack, and Linear and Vanta only
  // where the organisation has one.
  const readHosts = new Set<string>([...GITHUB_HOSTS, ...slackHosts]);
  if (linearWorkspace !== null) {
    readHosts.add(LINEAR_HOST);
  }
  if (vantaWorkspace !== null) {
    readHosts.add(VANTA_HOST);
  }

  const repositoryEvidence: WorkspacePlacer["repositoryEvidence"] = ({ value }) => {
    const slug = repositorySlugOf({ value });
    if (slug === undefined) {
      return undefined;
    }
    if (slug === selfRepository) {
      return { source: "repository", value: slug, workspace: "self" };
    }
    // `repositorySlugOf` only ever answers `owner/repo`, so both halves are there.
    const [owner] = slug.split("/");
    if (owner !== githubOwner) {
      return undefined;
    }
    return { source: "repository", value: slug, workspace: "team" };
  };

  const slackEvidence: WorkspacePlacer["slackEvidence"] = ({ value }) => {
    const routed = routedOf({ value });
    if (routed === undefined || !slackHosts.has(routed.host)) {
      return undefined;
    }
    const path = slackPermalinkPath({ routed });
    if (path === undefined) {
      return undefined;
    }
    // The conversation path, not only the host, so a mark overruling it names which channel or thread.
    return { source: "slack-workspace", value: path, workspace: "team" };
  };

  const linearEvidence: WorkspacePlacer["linearEvidence"] = ({ value }) => {
    const routed = routedOf({ value });
    if (linearWorkspace === null || routed?.host !== LINEAR_HOST) {
      return undefined;
    }
    if (routed.segments.at(0)?.toLowerCase() !== linearWorkspace) {
      return undefined;
    }
    return { source: "linear-workspace", value: `${LINEAR_HOST}/${linearWorkspace}`, workspace: "team" };
  };

  const vantaEvidence: WorkspacePlacer["vantaEvidence"] = ({ value }) => {
    const routed = routedOf({ value });
    if (vantaWorkspace === null || routed?.host !== VANTA_HOST || routed.segments.length < 2) {
      return undefined;
    }
    const marker = routed.segments.at(0);
    const slug = routed.segments.at(1);
    if (marker !== "c" || slug?.toLowerCase() !== vantaWorkspace) {
      return undefined;
    }
    return { source: "vanta-workspace", value: `${VANTA_HOST}/c/${vantaWorkspace}`, workspace: "team" };
  };

  // In this order, and the first that names a workspace is the value's evidence.
  const readers = [repositoryEvidence, slackEvidence, linearEvidence, vantaEvidence] as const;
  const addressEvidence: WorkspacePlacer["addressEvidence"] = ({ values }) => {
    const out: WorkspaceEvidence[] = [];
    for (const value of values) {
      const named = readers.map((reader) => reader({ value })).find((one) => one !== undefined);
      if (named !== undefined) {
        out.push(named);
      }
    }
    return out;
  };

  const repairedAddresses: WorkspacePlacer["repairedAddresses"] = ({ values }) =>
    values.filter((value) => {
      if (urlOf({ value }) !== undefined || !URL.canParse(value)) {
        return false;
      }
      // Another scheme too: `ftp://github.com/octo-self/slopweaver` names nothing, yet it plainly points at a
      // repository, so it may not leave its record placed by what else it cites.
      const url = new URL(value);
      return readHosts.has(hostNameOf({ url })) || isLoopbackUrl({ url });
    });

  const repositoryPlacement: WorkspacePlacer["repositoryPlacement"] = ({ repo }) =>
    placementOf({
      evidence: addressEvidence({ values: [repo] }),
      why: `${repo} is not a repository of the organisation`,
    });

  return {
    addressEvidence,
    linearEvidence,
    repairedAddresses,
    repositoryEvidence,
    repositoryPlacement,
    slackEvidence,
    vantaEvidence,
  };
}

/** The prefix an autonomy act's subject carries when the act changed this installation's own state. */
const INSTALLATION_STATE = "state:";

/**
 * The evidence a subject naming this installation itself is — a `state:<path>` or a `localhost` URL, its own
 * console. This installation is Slopweaver's. Read on an act's SUBJECT only, where it says the act changed this
 * installation; a console link on any other record (a hand step's `url` or `where`) is where the owner goes to look,
 * and the console draws both workspaces, so it names neither.
 *
 * @param value the subject's whole value
 * @returns the evidence, or `undefined` when the value names neither
 */
export function installationStateEvidence({ value }: { value: string }): WorkspaceEvidence | undefined {
  if (value.startsWith(INSTALLATION_STATE)) {
    return { source: "installation-state", value: INSTALLATION_STATE, workspace: "self" };
  }
  const url = urlOf({ value });
  if (url === undefined || !isLoopbackUrl({ url })) {
    return undefined;
  }
  return { source: "installation-state", value: url.host, workspace: "self" };
}

/**
 * The act kinds whose ONLY recorder writes them for this installation's own repository. `open-internal-finding-
 * pull-request` is written by `src/cli/commands/github/findingRulingGate.ts` only once its `internal` test
 * — the pull request's repository IS the one this build lives in — has passed.
 */
const OWN_REPOSITORY_ACT_KINDS: ReadonlySet<string> = new Set(["open-internal-finding-pull-request"]);

/**
 * The evidence an autonomy act's KIND is, when the code that records that kind guarantees the repository.
 *
 * @param kind the act's recorded kind
 * @returns the evidence, or `undefined` for a kind that guarantees nothing
 */
export function actKindEvidence({ kind }: { kind: string }): WorkspaceEvidence | undefined {
  if (!OWN_REPOSITORY_ACT_KINDS.has(kind)) {
    return undefined;
  }
  return { source: "act-kind", value: kind, workspace: "self" };
}

/**
 * A joined record's own stated workspace, lent to the record joining it a tier below that record's own.
 *
 * @param one the joined record's stated evidence
 * @param slug the joined record's id, said in the lent value
 * @returns the lent ruling
 */
function lentRuling({ one, slug }: { one: WorkspaceEvidence; slug: string }): WorkspaceEvidence {
  return { source: "joined-stated", value: `${slug} states ${one.value}`, workspace: one.workspace };
}

/**
 * The evidence a JOIN to another placed record is — an act's board row, a hand step's ask, a workstream's row.
 * A placed record lends its workspace and every piece of evidence that placed it, its statements a tier down; a conflicting one lends every piece of its evidence, its statements a tier down, so the conflict
 * travels rather than being resolved by whichever side joined, unless the joiner states its own; an unplaced one lends nothing. A record its stated
 * workspace placed over a conflict lends that ruling AND what it overruled, so the joiner is placed by the same
 * ruling and wears the same "stated over a conflict" mark naming the same address. The ruling is lent as
 * `joined-stated`, a tier below the joiner's own: a hand step posted with `--context` is placed by its own word.
 *
 * @param slug the joined record's id, said on a finding
 * @param placement the joined record's own placement
 * @returns the evidence
 */
export function joinedEvidence({
  slug,
  placement,
}: {
  slug: string;
  placement: WorkspacePlacement;
}): readonly WorkspaceEvidence[] {
  if (placement.kind === "placed") {
    const joined: WorkspaceEvidence = { source: "board-row", value: slug, workspace: placement.workspace };
    // Every piece of evidence that placed it travels, its statements a tier down: a joiner whose own stated
    // workspace overrules the joined row then names the ADDRESS it overruled, never only the row's slug, and a
    // joiner's contrary address meets the same ruling it would have met on the joined row.
    const lent = placement.by.map((one): WorkspaceEvidence => {
      if (one.source === "stated") {
        return lentRuling({ one, slug });
      }
      return one;
    });
    if (placement.overruled === undefined) {
      return [joined, ...lent];
    }
    return [joined, ...lent, ...placement.overruled];
  }
  if (placement.kind === "conflict") {
    // Its statements travel a tier down too, so a joiner's own stated workspace still outranks them.
    return placement.evidence.map((one): WorkspaceEvidence => {
      if (one.source === "stated") {
        return lentRuling({ one, slug });
      }
      return one;
    });
  }
  return [];
}
