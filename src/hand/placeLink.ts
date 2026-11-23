/**
 * A hand step that names a place on the web carries a link to that place — what its queue card draws as the one
 * call to action (`site/lib/handCard.ts`'s `stepDestination`).
 *
 * A queue card reading "Sign in to dashboard.clerk.com in the work Chrome window that just opened" needs a clickable
 * link on the host it names, as its call to action. This module keeps a step from being POSTED with the place in its
 * prose and no link to it at all.
 *
 * Its own module rather than more of `./posting.ts`, which composes the rules: which words name a place, and which
 * of the step's fields link one, is one seam. Pure.
 */
import { type HandStepError, HandStepErrors } from "./errors.js";
import { opensOwnHandStep } from "./queueLink.js";
import type { HandStep } from "./step.js";

/**
 * A BARE web host in prose: dot-separated labels ending in a top-level domain a step names a provider on.
 *
 * Bare means not inside an email address (`security@slopweaver.ai` names a mailbox, not a page), not inside an
 * address the card already chips (`https://claude.ai/…`, drawn clickable by `site/lib/inlineCitations.ts`), and
 * not a file name — so the top-level domain is a closed list that leaves out `sh`, `md`, `ts` and `json`, which in
 * this prose are always a file (`hook.sh`, `SKILL.md`).
 *
 * MEASURED over the 254 steps ever posted, {@link unlinkedPlace} misses 15: seven monitor sign-ins naming
 * a provider host with no link on it (`mon-signin-go-xero-com`, `mon-signin-acme-trelica-app`,
 * `mon-signin-app-hex-tech` and re-posts), `google-cloud-console-reauth`, and seven that spell an address in `what` or
 * `where` with no `--url` at all, so their card drew no call to action. An open host pattern, measured first, flagged
 * 17 more that were an email address or an OAuth scope. Reproduce by replaying `grep '"kind":"posted"'
 * "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then {@link unlinkedPlace}. A host on a domain
 * outside the list is the stated residue.
 */
const BARE_HOST =
  /(?<![@/.\w-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|ai|app|dev|co|cloud|so|au|uk|nz|us|me|xyz|tech|eu))\b(?![@\w-]|\.\w)/giu;

/**
 * A macOS application bundle written the way the Finder shows one — `Raycast.app`, `Google Chrome.app`'s last word —
 * which the `app` top-level domain would otherwise read as a web host. A host the fleet writes is lowercase.
 */
const APP_BUNDLE = /^[A-Z][\w-]*\.app$/u;

/** An absolute web address in prose, which the card draws as a citation chip wherever it sits. */
const WEB_ADDRESS = /https?:\/\/[^\s<>"'`)\]]+/giu;

/**
 * The hostname of an address, lowercased, or `undefined` when it does not parse.
 *
 * @param address an absolute address
 * @returns the hostname
 */
function hostOf({ address }: { address: string }): string | undefined {
  return URL.canParse(address) ? new URL(address).hostname.toLowerCase() : undefined;
}

/**
 * The bare web hosts a sentence names, lowercased, first named first.
 *
 * @param text one of the step's sentences
 * @returns each distinct host, empty when the sentence names none
 */
export function namedHosts({ text }: { text: string }): readonly string[] {
  const hosts = [...text.matchAll(BARE_HOST)].map((match) => match[1]!).filter((host) => !APP_BUNDLE.test(host));
  return [...new Set(hosts.map((host) => host.toLowerCase()))];
}

/**
 * The bare hosts the step's sentence and its place name, first named first.
 *
 * @param step the step a caller is about to record
 * @returns each distinct host
 */
function namedPlaces({ step }: { step: HandStep }): readonly string[] {
  const named = [step.what, step.where].flatMap((text) => (text === undefined ? [] : namedHosts({ text })));
  return [...new Set(named)];
}

/**
 * The first absolute address the step's sentence or its place spells out, with its host, or `undefined`.
 *
 * @param step the step a caller is about to record
 * @returns the address and its host
 */
function spelledAddress({ step }: { step: HandStep }): { address: string; host: string } | undefined {
  for (const text of [step.what, step.where]) {
    for (const match of text === undefined ? [] : text.matchAll(WEB_ADDRESS)) {
      const host = hostOf({ address: match[0] });
      if (host !== undefined) {
        return { address: match[0], host };
      }
    }
  }
  return undefined;
}

/**
 * The host of every address the step's card draws as a link: its `url`, the page the fleet `opened`, each cited
 * address, each checklist line's page, and any absolute address its sentence or its place spells out.
 *
 * @param step the step a caller is about to record
 * @returns each linked hostname, lowercased
 */
function linkedHosts({ step }: { step: HandStep }): readonly string[] {
  const { cites = [], checklist = [] } = step;
  const addresses: string[] = [...cites];
  for (const value of [step.url, step.opened, ...checklist.map((line) => line.url)]) {
    if (value !== undefined) {
      addresses.push(value);
    }
  }
  for (const text of [step.what, step.where]) {
    if (text !== undefined) {
      addresses.push(...[...text.matchAll(WEB_ADDRESS)].map((match) => match[0]));
    }
  }
  return addresses.flatMap((address) => {
    const host = hostOf({ address });
    return host === undefined ? [] : [host];
  });
}

/**
 * The address the queue card draws first as its call to action — `site/lib/handCard.ts`'s `stepDestination`, which
 * `src/` cannot import: the page the fleet opened, else the step's link unless that link is this very card, else its
 * one cited address when it cites exactly one.
 *
 * @param step the step a caller is about to record
 * @returns the address, or `undefined` when the card draws no `go to` row
 */
function drawnDestination({ step }: { step: HandStep }): string | undefined {
  if (step.opened !== undefined) {
    return step.opened;
  }
  if (step.url !== undefined && !opensOwnHandStep({ id: step.id, url: step.url })) {
    return step.url;
  }
  const { cites = [] } = step;
  return cites.length === 1 ? cites[0] : undefined;
}

/**
 * The hosts the card draws as a call to action: its `go to` row ({@link drawnDestination}), and each checklist line's
 * page, which that line draws as its own.
 *
 * @param step the step a caller is about to record
 * @returns each such hostname, lowercased
 */
function drawnHosts({ step }: { step: HandStep }): readonly string[] {
  const { checklist = [] } = step;
  return [drawnDestination({ step }), ...checklist.map((line) => line.url)].flatMap((address) => {
    const host = address === undefined ? undefined : hostOf({ address });
    return host === undefined ? [] : [host];
  });
}

/**
 * Whether a link's host reaches the named one: the same host, or a page under it (`dashboard.clerk.com` for
 * `clerk.com`). Never the parent a named host sits under — `vercel.app` is not `team.vercel.app`.
 *
 * @param named the host the prose names
 * @param linked a host one of the step's links is on
 * @returns true when the link goes to the named place
 */
function reaches({ named, linked }: { named: string; linked: string }): boolean {
  return linked === named || linked.endsWith(`.${named}`);
}

/** A named place the card does not send the owner to, and whether some other link of the step reaches it. */
export interface PlaceMiss {
  readonly host: string;
  /** The `--url` the refusal suggests: the address the prose spelled, else the named host's root. */
  readonly link: string;
  /** True when a link reaches the place, just not the one the card draws first. */
  readonly linkedElsewhere: boolean;
}

/**
 * The first place the step names that its card would not send the owner to.
 *
 * A bare host must be reached by one of the step's links, and a call to action the card draws ({@link drawnHosts})
 * must reach one of the hosts it names. An address spelled out in the prose is its own inline chip, so it asks only
 * that the card draw SOME call to action: an OAuth scope written as `https://www.googleapis.com/auth/…` beside a console `--url` is an identifier,
 * not where the step happens. A notice sends the owner nowhere (`HandStep.notice`), so a host in its sentence is the news —
 * an incident title naming the service that is down.
 *
 * @param step the step a caller is about to record
 * @returns the miss, or `undefined` when the card's `go to` row reaches a place the step names, or it names none
 */
export function unlinkedPlace({ step }: { step: HandStep }): PlaceMiss | undefined {
  if (step.notice === true) {
    return undefined;
  }
  const named = namedPlaces({ step });
  const drawn = drawnHosts({ step });
  if (named.length === 0) {
    const spelled = spelledAddress({ step });
    if (spelled === undefined || drawn.length > 0) {
      return undefined;
    }
    return { host: spelled.host, link: spelled.address, linkedElsewhere: true };
  }
  const linked = linkedHosts({ step });
  const unlinked = named.find((host) => !linked.some((one) => reaches({ linked: one, named: host })));
  if (unlinked !== undefined) {
    return { host: unlinked, link: `https://${unlinked}/…`, linkedElsewhere: false };
  }
  if (named.some((host) => drawn.some((one) => reaches({ linked: one, named: host })))) {
    return undefined;
  }
  return { host: named[0]!, link: `https://${named[0]!}/…`, linkedElsewhere: true };
}

/** One open card naming a place it does not send the owner to — what `hand list --gaps` reports. */
export interface PlaceGap {
  readonly id: string;
  readonly host: string;
  readonly what: string;
}

/**
 * Every step naming a place on the web its card does not send the owner to, in the order given — the posting rule
 * asked of cards already on the owner's queue, which predate it or reached the register some other way.
 *
 * @param steps the open steps
 * @returns one gap per such step, empty when every card links the places it names
 */
export function placeGaps({ steps }: { steps: readonly HandStep[] }): readonly PlaceGap[] {
  return steps.flatMap((step) => {
    const miss = unlinkedPlace({ step });
    return miss === undefined ? [] : [{ host: miss.host, id: step.id, what: step.what }];
  });
}

/**
 * The refusal for a step that names a place on the web its card would not send the owner to — a POSTING rule, outside
 * `buildHandStep` (`./step.ts`) for the reason its `linkAsLiteral` gives: the register already holds such rows.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the card's first link reaches a place the step names
 */
export function placeWithoutLink({ step }: { step: HandStep }): HandStepError | undefined {
  const miss = unlinkedPlace({ step });
  if (miss === undefined) {
    return undefined;
  }
  const fix = `pass --url ${miss.link} (or --opened with the page the fleet opened, plus --where naming that window)`;
  if (miss.linkedElsewhere) {
    return HandStepErrors.invalidField({
      field: "url",
      why:
        `does not reach ${miss.host}, which the step names as where it happens — the queue card draws --opened, ` +
        `else --url when it is not this card, else a sole --cite, as its one call to action, so ${fix}`,
    });
  }
  return HandStepErrors.invalidField({
    field: "url",
    why:
      `is missing for ${miss.host}, which the step names as where it happens — the queue card draws the step's ` +
      `link as its one call to action, so ${fix}`,
  });
}
