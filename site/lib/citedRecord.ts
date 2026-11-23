/**
 * What a citation chip's hover card reads about the record it points at, when that record is a pull request or a
 * Linear ticket — the pure half of `a-hover-citation-chip-for-a-pr-or-ticket-shows-title-checks-and-review-state-27-sep`.
 *
 * Hovering a pull request's chip on a queue card shows the PR title, and whether its checks pass and whether it
 * needs review, rather than the bare PR link; the same card carries more for PRs and tickets.
 *
 * A pull request's checks and review state are NOT read here. They are the landing row's, drawn by the very
 * components the pull-requests page draws (`../components/live/PrStatus.tsx`) off the `landing-reading` channel the
 * shell already polls on every page — one source, never a second derivation. What this module adds is the read
 * for a record that reading does not hold: a pull request that is not one of the owner's open ones (merged, closed, or
 * somebody else's), which `github pr summary` answers with its title and lifecycle, and a ticket, which
 * `linear read` answers with its title and a state id that `linear states --no-record` names. Argv out, payloads
 * in, an answer out; `../app/api/cited/route.ts` spawns.
 */

import type { Landing, LandingRow } from "../components/live/readLanding";
import { type Bag, bags, isBag, str, sub } from "./bag";
import type { CitationReference } from "./citationDisplay";
import { githubPullOf, linearIssueOf } from "./citationPlaces";

/** A GitHub owner or repository name — what may reach an argv from a pull request's address. */
const GITHUB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * MEASURED: `time slopweaver github pr summary https://github.com/acme/acme-admin/pull/<number> --json`,
 * `time slopweaver linear read SUP-9811 --json` and `time slopweaver linear states --team SUP --no-record --json`
 * each answer in a few seconds; a ticket's two reads run side by side.
 */
export const CITED_TIMEOUT_MS = 30_000;

/** The record a chip's address names, when it is one the hover card reads more about. */
export type CitedRecord =
  | { readonly kind: "pull"; readonly repoSlug: string; readonly number: number; readonly url: string }
  | { readonly kind: "ticket"; readonly key: string; readonly team: string };

/**
 * A pull request's canonical address, or a ticket's key, out of a cited address — `undefined` for anything else.
 * Only a plain `https` address on the provider's own host qualifies: no port, no credentials, and the path read by
 * the same grammar the hover card's place line uses (`./citationPlaces.ts`).
 *
 * @param url the chip's address as the card wrote it
 * @returns the record, or `undefined` when the address names neither a pull request nor a Linear issue
 */
export function citedRecordOf({ url }: { url: string }): CitedRecord | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.port !== "" || parsed.username !== "" || parsed.password !== "") {
    return undefined;
  }
  const host = parsed.hostname.replace(/^www\./u, "");
  const path = parsed.pathname.split("/").filter((segment) => segment !== "");
  if (host === "github.com") {
    const pull = githubPullOf({ path });
    const [owner = "", repo = ""] = path;
    if (pull === undefined || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
      return undefined;
    }
    const canonical = `https://github.com/${pull.repoSlug}/pull/${String(pull.number)}`;
    return { kind: "pull", number: pull.number, repoSlug: pull.repoSlug, url: canonical };
  }
  if (host === "linear.app") {
    const issue = linearIssueOf({ path });
    if (issue === undefined) {
      return undefined;
    }
    return { key: issue.key, kind: "ticket", team: issue.team };
  }
  return undefined;
}

/**
 * The record a chip's reference names — only an address can name one; a board row, queue card or talk turn never
 * does.
 *
 * @returns the record, or `undefined`
 */
export function citedRecordFor({ reference }: { reference: CitationReference }): CitedRecord | undefined {
  if (reference.kind !== "address") {
    return undefined;
  }
  return citedRecordOf({ url: reference.url });
}

/**
 * The one address a record is read and cached by, whatever tab, query or slug the chip's own address carried — so
 * `…/pull/<number>` and `…/pull/<number>/files` share a read, and so does every slug a ticket's address was written with.
 *
 * @returns the canonical address, which {@link citedRecordOf} reads back to the same record
 */
export function canonicalCitedAddress({ record }: { record: CitedRecord }): string {
  if (record.kind === "pull") {
    return record.url;
  }
  return `https://linear.app/issue/${record.key}`;
}

/**
 * The landing row for a pull request — the same row the pull-requests page draws, matched on repository and number,
 * the repository compared as GitHub does, without case.
 *
 * @param landing the reading the shell holds
 * @param pull the pull request a chip names
 * @returns the row, or `undefined` when the reading does not hold it
 */
export function landingRowFor({
  landing,
  pull,
}: {
  landing: Pick<Landing, "rows">;
  pull: Pick<Extract<CitedRecord, { kind: "pull" }>, "repoSlug" | "number">;
}): LandingRow | undefined {
  const slug = pull.repoSlug.toLowerCase();
  return landing.rows.find((row) => row.number === pull.number && row.repoSlug.toLowerCase() === slug);
}

/** One verb the route runs, and the command it names in a refusal. */
export interface CitedArgv {
  readonly argv: readonly string[];
  readonly title: string;
}

/**
 * The verbs that read a record the landing reading does not hold: one for a pull request, two for a ticket.
 *
 * @returns the argv to run, each literal — the record's own fields were checked against a strict shape
 */
export function citedReadArgvs({ record }: { record: CitedRecord }): readonly CitedArgv[] {
  if (record.kind === "pull") {
    const argv = ["github", "pr", "summary", record.url, "--json"];
    return [{ argv, title: `slopweaver ${argv.join(" ")}` }];
  }
  const read = ["linear", "read", record.key, "--json"];
  const states = ["linear", "states", "--team", record.team, "--no-record", "--json"];
  return [
    { argv: read, title: `slopweaver ${read.join(" ")}` },
    { argv: states, title: `slopweaver ${states.join(" ")}` },
  ];
}

/** The four lifecycle words `github pr summary` prints. */
const LIFECYCLES = ["open", "draft", "merged", "closed"] as const;

/** A pull request's lifecycle word. */
export type PullLifecycleWord = (typeof LIFECYCLES)[number];

/** What the hover card draws for a record the route read. */
export type CitedRead =
  | { readonly kind: "pull"; readonly url: string; readonly title: string; readonly lifecycle: PullLifecycleWord }
  | {
      readonly kind: "ticket";
      readonly key: string;
      readonly title: string;
      readonly state: string;
      /** Linear's own category — `started`, `completed`, `canceled` — which decides the state's tone. */
      readonly stateType: string;
    };

/**
 * A pull request out of `github pr summary --json`.
 *
 * @param record the pull request the route asked about, which the answer must be
 * @returns its title and lifecycle, or `undefined` when the answer is not the verb's shape or not this pull request
 */
export function citedPullOf({
  payload,
  record,
}: {
  payload: unknown;
  record: Extract<CitedRecord, { kind: "pull" }>;
}): CitedRead | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const title = str({ bag: payload, key: "title" });
  const url = str({ bag: payload, key: "url" });
  const lifecycle = LIFECYCLES.find((word) => word === payload["state"]);
  if (title === undefined || lifecycle === undefined || url?.toLowerCase() !== record.url.toLowerCase()) {
    return undefined;
  }
  return { kind: "pull", lifecycle, title, url: record.url };
}

/** The state a ticket's `state.id` names, out of its team's states. */
function stateNamed({ states, id }: { states: readonly Bag[]; id: string }): Bag | undefined {
  return states.find((state) => state["id"] === id);
}

/**
 * A ticket out of `linear read --json` and its team's `linear states --json`.
 *
 * @param read the parsed `linear read` answer
 * @param states the parsed `linear states` answer for the ticket's team
 * @param record the ticket the route asked about, which the read must be
 * @returns its title and named state, or `undefined` when either answer is not the verb's shape, the read is not
 *   this ticket, or the state id is not one of the team's
 */
export function citedTicketOf({
  read,
  states,
  record,
}: {
  read: unknown;
  states: unknown;
  record: Extract<CitedRecord, { kind: "ticket" }>;
}): CitedRead | undefined {
  if (!isBag(read) || !isBag(states)) {
    return undefined;
  }
  const data = sub({ bag: read, key: "data" });
  const team = sub({ bag: states, key: "team" });
  const known = bags({ bag: states, key: "states" });
  if (data === undefined || team === undefined || known === undefined) {
    return undefined;
  }
  const title = str({ bag: data, key: "title" });
  const identifier = str({ bag: data, key: "identifier" });
  const stateRef = sub({ bag: data, key: "state" });
  const stateId = stateRef === undefined ? undefined : str({ bag: stateRef, key: "id" });
  if (title === undefined || identifier !== record.key || stateId === undefined) {
    return undefined;
  }
  if (str({ bag: team, key: "key" }) !== record.team) {
    return undefined;
  }
  const state = stateNamed({ id: stateId, states: known });
  const name = state === undefined ? undefined : str({ bag: state, key: "name" });
  const stateType = state === undefined ? undefined : str({ bag: state, key: "type" });
  if (name === undefined || stateType === undefined) {
    return undefined;
  }
  return { key: record.key, kind: "ticket", state: name, stateType, title };
}

/** The glyph and colour a ticket's state draws in — the console's `StateLabel` set. */
export type TicketStatus = "open" | "inProgress" | "done" | "cancelled";

/**
 * The state label for a ticket, by Linear's own category of its state — never by the state's name, which each
 * team chooses (`In Review`, `Merged`, `In QA` are all `started` on one team).
 *
 * @param stateType Linear's category: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`, `duplicate`
 * @returns the label's status
 */
export function ticketStatusOf({ stateType }: { stateType: string }): TicketStatus {
  if (stateType === "completed") {
    return "done";
  }
  if (stateType === "canceled" || stateType === "duplicate") {
    return "cancelled";
  }
  if (stateType === "started") {
    return "inProgress";
  }
  return "open";
}

/** The route's answer. */
export type CitedResult =
  | { readonly ok: true; readonly observedAtIso: string; readonly read: CitedRead }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * The card's view of one read. A ready one may be the last ready answer standing over a newer read: `refreshing`
 * while that read is in flight, `stale` when it failed — the earlier answer stays drawn, marked, never replaced by
 * the failure.
 */
export type CitedState =
  | { readonly phase: "loading" }
  | { readonly phase: "not-measured"; readonly why: string }
  | {
      readonly phase: "ready";
      readonly read: CitedRead;
      readonly observedAtIso: string;
      readonly stale?: { readonly why: string };
      readonly refreshing?: true;
    };

/**
 * Read the route's answer into the card's state, refusing any shape that is not the route's own.
 *
 * @param body the parsed response
 * @returns the state
 */
export function citedStateOf({ body }: { body: unknown }): Exclude<CitedState, { phase: "loading" }> {
  if (!isBag(body)) {
    return { phase: "not-measured", why: "/api/cited answered something that is not its own shape" };
  }
  if (body["ok"] !== true) {
    const stated = str({ bag: body, key: "notMeasured" });
    if (stated === undefined) {
      return { phase: "not-measured", why: "/api/cited refused and gave no reason" };
    }
    return { phase: "not-measured", why: stated };
  }
  const read = sub({ bag: body, key: "read" });
  const observedAtIso = str({ bag: body, key: "observedAtIso" });
  const title = read === undefined ? undefined : str({ bag: read, key: "title" });
  if (read === undefined || observedAtIso === undefined || title === undefined) {
    return { phase: "not-measured", why: "/api/cited answered without the record it read" };
  }
  if (read["kind"] === "pull") {
    const url = str({ bag: read, key: "url" });
    const lifecycle = LIFECYCLES.find((word) => word === read["lifecycle"]);
    if (url === undefined || lifecycle === undefined) {
      return { phase: "not-measured", why: "/api/cited answered a pull request missing its fields" };
    }
    return { observedAtIso, phase: "ready", read: { kind: "pull", lifecycle, title, url } };
  }
  const key = str({ bag: read, key: "key" });
  const state = str({ bag: read, key: "state" });
  const stateType = str({ bag: read, key: "stateType" });
  if (read["kind"] !== "ticket" || key === undefined || state === undefined || stateType === undefined) {
    return { phase: "not-measured", why: "/api/cited answered a ticket missing its fields" };
  }
  return { observedAtIso, phase: "ready", read: { key, kind: "ticket", state, stateType, title } };
}

/** The reads a page has made, shared by every chip on it: one in flight per address, the last ready one kept. */
export interface CitedCache {
  /**
   * The last ready answer for an address, if one has come back.
   *
   * @returns the kept answer, or `undefined`
   */
  readonly kept: (url: string) => Extract<CitedState, { phase: "ready" }> | undefined;
  /**
   * Read an address, riding a read of it already in flight rather than starting a second.
   *
   * @returns the settled answer
   */
  readonly read: (url: string) => Promise<Exclude<CitedState, { phase: "loading" }>>;
}

/**
 * A cache over one read. The read must settle rather than reject: a failure is a `not-measured` answer, unless an
 * earlier read of the address was ready — then that answer is kept and answered again marked `stale` with the
 * failure's reason, because a failed read contradicts nothing and the page keeps showing its last data.
 *
 * @param lookup reads one address through the route
 * @returns the cache
 */
export function citedCache({
  lookup,
}: {
  lookup: (url: string) => Promise<Exclude<CitedState, { phase: "loading" }>>;
}): CitedCache {
  const answers = new Map<string, Extract<CitedState, { phase: "ready" }>>();
  const inFlight = new Map<string, Promise<Exclude<CitedState, { phase: "loading" }>>>();
  const read: CitedCache["read"] = (url) => {
    const riding = inFlight.get(url);
    if (riding !== undefined) {
      return riding;
    }
    const started = lookup(url).then((answer): Exclude<CitedState, { phase: "loading" }> => {
      inFlight.delete(url);
      if (answer.phase === "ready") {
        answers.set(url, answer);
        return answer;
      }
      const kept = answers.get(url);
      if (kept === undefined) {
        return answer;
      }
      return { ...kept, stale: { why: answer.why } };
    });
    inFlight.set(url, started);
    return started;
  };
  return { kept: (url) => answers.get(url), read };
}
