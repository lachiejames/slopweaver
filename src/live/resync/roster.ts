/**
 * Reading this build's whole resync roster off the repository — the effectful shell around
 * `./policy.ts`'s pure join.
 *
 * Both halves are already declared somewhere and neither is declared here. An atlas contributes its
 * `resyncCommand` and `freshnessWindow` from its own descriptor, loaded through the registry's lazy thunk
 * exactly as `atlas freshness` loads it; a corpus source contributes its window from
 * `corpus/freshnessPolicy.ts`. So a new atlas landing in the repository joins the schedule by being
 * registered, with nothing to remember and nothing to add here — which is the property the roster
 * exists for. A roster somebody has to keep in step by hand is the roster that drifts until a
 * card asks the owner whether to resync.
 *
 * ## The one read that is not off the repository, and why it is here
 *
 * A github corpus resync has to NAME the organisation it crawls, because a scheduled pass's cwd is always a
 * worktree under `$SLOPWEAVER_HOME` and `config.ts`'s `cwdRepositoryRefusal` refuses that cwd's own `origin`
 * as any verb's subject. Which organisation is per-install state, so it is not in the repository and must
 * not be — the fetch takes everything reachable into the store, and identifying config stays out of the
 * codebase.
 *
 * It comes from `profile.json`'s declared main checkouts, the same declaration `checkout status`,
 * `worktree prune` and `doctor` already read — their distinct `origin` OWNER is the organisation. There is
 * deliberately no second `github.org` field: nothing in this repository writes the top-level `profile.json`
 * (`../../profileStore.ts` and `../../outbound/voice/briefStore.ts` only read it, `../../init/stateInit.ts`
 * seeds it once, and `live/turn/judgementProfileStore.ts` writes a different file), and the owner does not
 * hand-edit config, so a field with no writer would be a convention rather than a mechanism. An organisation
 * with no local checkout is the case that earns that field, with a verb to set it, as its own row.
 *
 * This file is where the read belongs — it is already the effectful shell, and `./policy.ts` is pure.
 */
import { hasScheduledResync, isCompileOnlyDescriptor } from "../../atlas/kit/contract.js";
import { atlasFreshnessWindowMs } from "../../atlas/kit/freshnessWindow.js";
import { atlasPlatforms, findAtlasPlatform } from "../../atlas/registry.js";
import { originRepositoryOf } from "../../config.js";
import { heldExports } from "../../corpus/chatgpt/exportStore.js";
import { heldLiveManifests } from "../../corpus/chatgpt/liveSnapshotStore.js";
import { corpusFreshnessWindowMs } from "../../corpus/freshnessPolicy.js";
import { type CorpusSource } from "../../corpus/types.js";
import { FETCHABLE_SOURCES } from "../../integrations/corpusSources.js";
import { mainCheckoutsFromProfile } from "../../profileStore.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  type AtlasResyncInput,
  buildResyncPolicies,
  type CorpusResyncInput,
  type ResyncPolicyRoster,
} from "./policy.js";
import { resyncRecipeId } from "./target.js";

/**
 * The one fetchable source whose refresh resolves its subject from a PATH rather than from a credential, so
 * a scheduled pass has to be told which organisation it covers.
 */
const ORG_SUBJECT_SOURCES: ReadonlySet<CorpusSource> = new Set<CorpusSource>(["github"]);

/**
 * The fetchable sources fed by an export the owner downloads, whose scheduled pass is their own `sync` verb, each with
 * where a home keeps the exports it has taken in.
 *
 * Such a source is seated only once its first export is held. Until then the owner has not opted in, and a daily `sync`
 * with nothing to read would leave the store holding no row, so the postcondition would fail it every day on every
 * install the owner never exported from. An export once taken in is never removed, so the row does not flap — and one
 * that no longer reads still seats it, reported as a roster problem, so damage never retires the run that reports it.
 */
const EXPORT_SUBJECT_ROOTS: ReadonlyMap<CorpusSource, (args: { home: string }) => string> = new Map([
  ["chatgpt", ({ home }: { home: string }) => stateHomePaths({ home }).corpus.chatgptExports],
]);

/**
 * The export-fed sources that ALSO read the account back through the owner's web session, each with where its live
 * copy sits. Once that copy holds a chat, the owner has run the backfill and opted in, so the source's pass becomes its
 * `live-sync`: the account is read daily, and the export stays the backup taken in by hand. A live copy that will not
 * read still seats the row, reported as a problem, exactly as an export that will not read does.
 */
const LIVE_SUBJECT_ROOTS: ReadonlyMap<CorpusSource, (args: { home: string }) => string> = new Map([
  ["chatgpt", ({ home }: { home: string }) => stateHomePaths({ home }).corpus.chatgptLive],
]);

/**
 * The source's live-sync row, when its live copy holds a chat or will not read; `undefined` when it has no live copy
 * or that copy holds nothing yet, so the source falls through to its export row.
 */
function liveResyncInput({
  home,
  source,
  windowMs,
}: {
  home: string;
  source: CorpusSource;
  windowMs: number;
}): { input: CorpusResyncInput; problems: readonly string[] } | undefined {
  const liveRoot = LIVE_SUBJECT_ROOTS.get(source);
  if (liveRoot === undefined) {
    return undefined;
  }
  const input: CorpusResyncInput = { source, subject: { kind: "live" }, windowMs };
  const live = heldLiveManifests({ root: liveRoot({ home }) });
  if (live.isErr()) {
    return { input, problems: [`${source} live copy: ${live.error.message}`] };
  }
  return live.value.size > 0 ? { input, problems: [] } : undefined;
}

/** What one roster read resolved, alongside every declaration it could not turn into a subject. */
export interface CorpusResyncInputRead {
  readonly inputs: readonly CorpusResyncInput[];
  /** One line per declaration that could not be read or name one organisation, and per held export that will not read. */
  readonly problems: readonly string[];
}

/** The organisation the declared checkouts name, or the one reason they name none. */
export interface OrgRead {
  readonly org: string | null;
  readonly problems: readonly string[];
}

/**
 * Every corpus source this build schedules, with its declared window and whatever it must name.
 *
 * The FETCHABLE list rather than the whole `CorpusSource` union: `gold` is synthesised at query time and
 * `self` is a local scan of this repository, so neither is a provider anything could resync on a cadence.
 *
 * A source that must name an organisation and cannot is OMITTED rather than given an unusable subject, and
 * the reason is reported — a row registered with no resolvable subject is the failure this whole shape
 * exists to end, so it must not register at all. An export-fed source with no export held is omitted too,
 * silently: that is a source the owner has not opted into, not a problem. One whose held export will not read is seated
 * AND reported.
 *
 * @param home the state home whose `profile.json` declares the main checkouts, and whose held exports seat an
 *   export-fed source
 * @returns one input per schedulable source, in the order the refresh parser declares them, plus one problem
 *   per declaration that could not name an organisation and per held export that will not read
 *
 * @internal — {@link readResyncRoster} is the whole roster; this half is exported for its own unit test.
 */
export function corpusResyncInputs({ home }: { readonly home: string }): CorpusResyncInputRead {
  const declared = declaredOrg({ home });
  const problems = [...declared.problems];
  const inputs: CorpusResyncInput[] = [];
  for (const source of FETCHABLE_SOURCES) {
    const windowMs = corpusFreshnessWindowMs({ source });
    const live = liveResyncInput({ home, source, windowMs });
    if (live !== undefined) {
      inputs.push(live.input);
      problems.push(...live.problems);
      continue;
    }
    const exportRoot = EXPORT_SUBJECT_ROOTS.get(source);
    if (exportRoot !== undefined) {
      // A held export that will not read is still an opt-in: the row stays, so its daily run keeps failing loudly.
      const held = heldExports({ root: exportRoot({ home }) });
      if (held.exports.length > 0 || held.unreadable.length > 0) {
        inputs.push({ source, subject: { kind: "export" }, windowMs });
      }
      problems.push(...held.unreadable.map((line) => `${source} held export: ${line}`));
      continue;
    }
    if (!ORG_SUBJECT_SOURCES.has(source)) {
      inputs.push({ source, subject: { kind: "none" }, windowMs });
      continue;
    }
    if (declared.org === null) {
      continue;
    }
    inputs.push({ source, subject: { kind: "org", org: declared.org }, windowMs });
  }
  return { inputs, problems };
}

/**
 * One declared checkout's resolved `origin` owner, or why it could not be read. The effectful edge hands
 * these in so the decision below stays pure.
 */
export type DeclaredOwner =
  | { readonly kind: "owner"; readonly owner: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string };

/**
 * The organisation a set of declared checkouts names: the ONE distinct `origin` owner across them.
 *
 * PURE, and separated from the git read on purpose. The decision has four branches worth asserting
 * exhaustively and none of them needs a repository on disk, so testing it through real `git init` fixtures
 * bought nothing and cost every case a subprocess.
 *
 * More than one owner REFUSES rather than picking the first. Two organisations is a real configuration, and
 * crawling one while silently ignoring the other is the same class of defect as the cwd guess this
 * resolution replaced — a subject nobody chose, reported as a success.
 *
 * An unreadable checkout is its own problem line and the others still count, the same judgement
 * `./policy.ts` makes about one unresolvable atlas descriptor.
 *
 * @param owners one entry per declared checkout, in declared order
 * @returns the organisation, or null with every reason it could not be named
 */
export function orgFromDeclaredOwners({ owners }: { readonly owners: readonly DeclaredOwner[] }): OrgRead {
  const problems: string[] = [];
  const distinct = new Map<string, string>();
  for (const entry of owners) {
    if (entry.kind === "unreadable") {
      problems.push(`declared main checkout ${entry.path}: ${entry.why}`);
      continue;
    }
    const key = entry.owner.toLowerCase();
    if (!distinct.has(key)) {
      // FIRST spelling wins, so the organisation a reader sees is the one the earliest declared checkout
      // spells. `Map.set` unconditionally would keep the LAST, which makes the reported name depend on
      // declaration order for no reason anyone chose.
      distinct.set(key, entry.owner);
    }
  }
  const spellings = [...distinct.values()];
  if (spellings.length === 1) {
    // Safe: length checked.
    return { org: spellings[0]!, problems };
  }
  if (spellings.length === 0) {
    return {
      org: null,
      problems: [
        ...problems,
        "corpus github: no declared main checkout names an organisation, so a scheduled pass has nothing to " +
          "crawl and would refuse its own cwd — add a `mainCheckouts` array to $SLOPWEAVER_HOME/profile.json " +
          "(docs/main-checkouts.md)",
      ],
    };
  }
  return {
    org: null,
    problems: [
      ...problems,
      `corpus github: the declared main checkouts name ${String(spellings.length)} organisations ` +
        `(${spellings.join(", ")}), and crawling one of them would silently skip the rest — declare checkouts ` +
        "from one organisation, or open a row for an explicit org field (docs/main-checkouts.md)",
    ],
  };
}

/** Read each declared checkout's `origin` owner, then let {@link orgFromDeclaredOwners} decide. */
function declaredOrg({ home }: { readonly home: string }): OrgRead {
  const owners = mainCheckoutsFromProfile({ home }).map((checkout): DeclaredOwner => {
    const resolved = originRepositoryOf({ cwd: checkout.path });
    if (resolved.isErr()) {
      return { kind: "unreadable", path: checkout.path, why: resolved.error.join("; ") };
    }
    return { kind: "owner", owner: resolved.value.owner };
  });
  return orgFromDeclaredOwners({ owners });
}

/**
 * Every atlas this build schedules, with its declared command and window.
 *
 * An atlas whose descriptor declares a manual-only `resyncSchedule` is left out, so the registrar retires the row it
 * once wrote for it, because such an atlas does not have to run a scheduled automated sync. Its
 * `resyncCommand` still runs by hand.
 *
 * @returns one input per registered atlas on the managed schedule, in registry order
 *
 * @internal — as above.
 */
export async function atlasResyncInputs(): Promise<readonly AtlasResyncInput[]> {
  const inputs: AtlasResyncInput[] = [];
  for (const platform of atlasPlatforms()) {
    const registration = findAtlasPlatform({ platform });
    if (registration === null) {
      continue;
    }
    const descriptor = await registration.readDescriptor();
    if (!hasScheduledResync({ descriptor })) {
      continue;
    }
    inputs.push({
      platform,
      resyncCommand: descriptor.resyncCommand,
      seated: !isCompileOnlyDescriptor({ descriptor }),
      windowMs: atlasFreshnessWindowMs({ descriptor }),
    });
  }
  return inputs;
}

/**
 * The managed resync rows this build writes to run in the chair's tick rather than seat — one per
 * compile-only atlas. Read from the descriptors alone: no git, no network, no profile, so `automation due` keeps
 * its read-only promise while asking.
 *
 * @returns the recipe ids, in registry order
 */
export async function tickResyncRecipeIds(): Promise<readonly string[]> {
  const inputs = await atlasResyncInputs();
  return inputs
    .filter((input) => !input.seated)
    .map((input) => resyncRecipeId({ target: { kind: "atlas", platform: input.platform } }));
}

/**
 * The whole roster this build schedules.
 *
 * @param home the state home whose `profile.json` names the organisation a github corpus resync crawls —
 *   every caller already holds the one its own verb was given, so a roster and the pass it schedules cannot
 *   read two different profiles
 * @returns one policy per atlas and per corpus source, plus one problem per target that could not get one
 */
export async function readResyncRoster({ home }: { readonly home: string }): Promise<ResyncPolicyRoster> {
  const corpus = corpusResyncInputs({ home });
  const built = buildResyncPolicies({ atlases: await atlasResyncInputs(), corpus: corpus.inputs });
  return { policies: built.policies, problems: [...corpus.problems, ...built.problems] };
}
