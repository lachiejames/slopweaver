/*
 * What a cited record is — which integration or place in this console, and where inside it — read off the
 * reference alone: the words a citation chip and its hover card draw, and a held draft's `[n]` markers turned into
 * the footnotes Streamdown renders.
 *
 * The archive's chip (`citations/citation-chip.tsx`) drew a platform, a connection and a date out of a citation's
 * metadata. The console's citations carry none: a held draft's is `{ id, label: "[n]", url }`
 * (`src/outbound/artifact/schema.ts`), and an act card's link is `{ label, url }` (`./queueCardAct.ts`). So the
 * reference is the whole evidence, and the card says only what the reference says — never a title it would have
 * to fetch. WHICH kind a reference is comes from its own shape: an address's host through `./citationKinds.ts`,
 * or the typed arm a caller that already knows the kind passes — never from the prose around it. Pure, so the
 * unit lane holds it without React.
 */

import { consoleCardPath } from "./alignment";
import { integrationKindOf, PLACE_KINDS, WEB_KIND } from "./citationKinds";
import { integrationPlace } from "./citationPlaces";
import { consoleHref, localPageSlugOf } from "./localPageHref";
import { emojiText } from "./slackEmoji";

/**
 * One thing a citation points at. An address is classified by its host; the other arms are a place in this
 * console whose kind the caller already knows — a board row by its slug, a queue card by its key, a talk turn by
 * its id — so nothing has to be parsed back out of a string to find it.
 */
export type CitationReference =
  | { readonly kind: "address"; readonly url: string }
  | { readonly kind: "board-row"; readonly slug: string }
  | { readonly kind: "queue-card"; readonly key: string }
  | { readonly kind: "talk-turn"; readonly id: string };

/** What a cited reference is, in the words the hover card draws. */
export interface CitedSource {
  /** The registry key (`./citationKinds.ts`) the chip draws its colour and icon by. */
  readonly kind: string;
  /** The source's name: `Slack`, `GitHub`, `a local page`. */
  readonly source: string;
  /** Where in that source, as specific as the reference allows: `lachiejames/slopweaver #NNNN`. */
  readonly place: string;
  /** Whether following it leaves this machine — a board row or a local page does not. */
  readonly external: boolean;
}

/** The parts of an address the naming reads, or `undefined` when it is not one this can read. */
function partsOf({
  url,
}: {
  url: string;
}): { host: string; path: readonly string[]; protocol: string; search: URLSearchParams; hash: string } | undefined {
  // A board row's address is a path on this console, so a relative one is resolved against a placeholder origin;
  // whether it WAS relative is read off the string, never off that placeholder, which an absolute URL could name.
  if (!URL.canParse(url, "http://localhost")) {
    return undefined;
  }
  const parsed = new URL(url, "http://localhost");
  const path = parsed.pathname.split("/").filter((segment) => segment !== "");
  return {
    hash: parsed.hash,
    host: parsed.hostname.replace(/^www\./u, ""),
    path,
    protocol: parsed.protocol,
    search: parsed.searchParams,
  };
}

/** A place in this console, named by its registry row. */
function inConsole({ id, place }: { id: keyof typeof PLACE_KINDS; place: string }): CitedSource {
  return { external: false, kind: id, place, source: PLACE_KINDS[id].source };
}

/**
 * A console path's place: a board row, a queue card, or any other page of this console.
 *
 * @returns the source
 */
function consolePlace({ path, search }: { path: readonly string[]; search: URLSearchParams }): CitedSource {
  const [page = ""] = path;
  const row = search.get("row");
  // `/workstreams?row=` is the board's older row address, still in transcripts; both read as the row, drawn as words.
  if ((page === "board" || page === "workstreams") && row !== null) {
    return inConsole({ id: "board", place: row });
  }
  const open = search.get("open");
  if (page === "queue" && open !== null) {
    return inConsole({ id: "queue", place: open });
  }
  return inConsole({ id: "console", place: `/${path.join("/")}` });
}

/**
 * Whether an absolute address is this console — it is served at `http://localhost:3000` (listening on 127.0.0.1),
 * and a second checkout serves another port (`src/hand/consoleLink.ts`), so a hand step's minted link names it
 * absolutely. The IPv6 loopback (`[::1]`, as `URL` writes its hostname), any 127.x.x.x address and a fully qualified
 * `localhost.` are the same machine, so a retired page cited through one draws as words too.
 *
 * What this does NOT recognise, by construction: any other name for this machine (a LAN address, a hosts-file alias,
 * its Bonjour `.local` name). No producer mints one — `src/hand/consoleLink.ts` writes `http://localhost:<port>` — so
 * such a link is hand-typed; what would close it is resolving the host, which a pure renderer cannot do.
 */
function isConsoleHost({ host, protocol }: { host: string; protocol: string }): boolean {
  return protocol === "http:" && isLoopbackHost({ host });
}

/**
 * Whether a host names this machine's loopback: `localhost`, `localhost.`, `[::1]`, any 127.x.x.x address, or that range
 * IPv4-mapped into IPv6, which `URL` writes as `[::ffff:7fXX:XXXX]`. Every other numeric spelling of 127.x —
 * `127.1`, `0x7f000001`, `2130706433`, `[0:0:0:0:0:0:0:1]` — `URL` already canonicalises to one of these.
 */
function isLoopbackHost({ host }: { host: string }): boolean {
  const bare = host.replace(/\.$/u, "");
  return (
    LOOPBACK_HOSTS.has(bare) ||
    /^127(?:\.\d{1,3}){3}$/u.test(bare) ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/u.test(bare)
  );
}

/** The loopback names `URL` gives this machine beside the 127.x.x.x range, the console's own address. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "[::1]"]);

/**
 * Name the record an address points at, from the address alone.
 *
 * @param url the cited address — an `https://` one, a local page's `file://…/pages/<slug>/index.html`, a console
 *   path such as a queue card's `/queue?open=<key>`, or the console's own `http://localhost:<port>/…`
 * @returns the source, the place inside it, and whether following it leaves this machine
 */
export function citedAddress({ url }: { url: string }): CitedSource {
  const slug = localPageSlugOf({ url });
  if (slug !== undefined) {
    return inConsole({ id: "page", place: slug });
  }
  const parts = partsOf({ url });
  if (parts === undefined) {
    return { external: true, kind: WEB_KIND.id, place: url, source: "an address" };
  }
  const { host, path, protocol, search, hash } = parts;
  if ((url.startsWith("/") && !url.startsWith("//")) || isConsoleHost({ host, protocol })) {
    return consolePlace({ path, search });
  }
  if (protocol !== "https:" && protocol !== "http:") {
    return { external: true, kind: WEB_KIND.id, place: url, source: "an address" };
  }
  const integration = integrationKindOf({ host });
  if (integration === undefined) {
    return { external: true, kind: WEB_KIND.id, place: host, source: host };
  }
  const place = integrationPlace({ kind: integration.id, parts: { hash, host, path } });
  return { external: true, kind: integration.id, place, source: integration.source };
}

/**
 * Where a reference opens: an address is itself — a local page's `file://` one the console's own route to it — and a
 * queue card or talk turn the Queue. A reference that opens nowhere ({@link opensNowhere}) — a board row, or an
 * address under a retired page — is drawn as its words.
 *
 * @returns the href a chip links to, or `undefined` for one that opens nowhere, which draws as words
 */
export function referenceHref({ reference }: { reference: CitationReference }): string | undefined {
  if (opensNowhere({ reference })) {
    return undefined;
  }
  if (reference.kind === "address") {
    return consoleHref({ url: reference.url });
  }
  if (reference.kind === "board-row") {
    return undefined;
  }
  if (reference.kind === "queue-card") {
    return `${consoleCardPath({ key: reference.key })}?${new URLSearchParams({ open: reference.key }).toString()}`;
  }
  // The talk page is retired into the call widget, so a turn opens the Queue, where the call is
  // drawn, and its hover card names the turn.
  return "/queue";
}

/**
 * Name the record a reference points at.
 *
 * @returns the source, the place inside it, and whether following it leaves this machine
 */
export function citedSource({ reference }: { reference: CitationReference }): CitedSource {
  if (reference.kind === "address") {
    return citedAddress({ url: reference.url });
  }
  if (reference.kind === "board-row") {
    return inConsole({ id: "board", place: reference.slug });
  }
  if (reference.kind === "queue-card") {
    return inConsole({ id: "queue", place: reference.key });
  }
  return inConsole({ id: "talk", place: `turn ${reference.id}` });
}

/**
 * The console's pages retired with no redirect: the Board, which does not belong on the console, and Machine,
 * which is gone too.
 */
const RETIRED_PAGES: ReadonlySet<string> = new Set(["board", "machine"]);

/**
 * Whether a reference opens nowhere, so every surface draws it as words rather than a link: a board row — by its
 * slug, or by an address naming one, `/board?row=` or the older `/workstreams?row=` (a Queue card never cites one)
 * — or any address on this console under a retired page (`/machine`, `/board`), whose route is gone.
 *
 * @returns whether it opens nowhere
 */
export function opensNowhere({ reference }: { reference: CitationReference }): boolean {
  const source = citedSource({ reference });
  if (source.kind === "board") {
    return true;
  }
  if (reference.kind !== "address") {
    return false;
  }
  if (source.kind === "console") {
    return underRetiredPage({ path: source.place.split("/") });
  }
  // The console is never served over https, so an https loopback address is read as the web above; one under a
  // retired page still opens nowhere, on this machine or anywhere else (`https://localhost:3000/machine`).
  const parts = partsOf({ url: reference.url });
  if (parts?.protocol !== "https:" || !isLoopbackHost({ host: parts.host })) {
    return false;
  }
  return underRetiredPage({ path: parts.path });
}

/**
 * Whether a path's first page names a retired page, read as the router reads it: the whole path percent-decoded ONCE,
 * so `/%62oard` is `/board` and `/%2Fboard` or `/%2F/board` is `//board`; split on every separator the
 * decoding exposes, so `/machine%2Fagents` is under Machine; empty names skipped; lowercased, so no casing reads as
 * another page. A path that does not decode is judged as written.
 */
function underRetiredPage({ path }: { path: readonly string[] }): boolean {
  const page = decodedOf({ segment: path.join("/") })
    .split(/[/\\]/u)
    .find((part) => part !== "");
  return page !== undefined && RETIRED_PAGES.has(page.toLowerCase());
}

/** A path percent-decoded, or as written when it does not decode. */
function decodedOf({ segment }: { segment: string }): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A citation a draft declares, as `readThread.ts` reads one. */
export interface FootnoteCitation {
  readonly label: string;
  readonly url: string;
}

/** A draft's `[n]` marker, exactly as a citation's label is written. */
const MARKER = /\[(\d+)\]/gu;

/**
 * A held draft as footnoted markdown: each `[n]` marker that is a declared citation's label becomes the GFM
 * footnote reference `[^n]`, and one definition per referenced citation follows, in number order. A marker no
 * citation declares stays the text it was. A citation the text never references is still shown, on a closing
 * "Also cited" line: the answer form lets an `index` row alone cite one (`src/outbound/assistant/answerForm.ts`),
 * and `readThread.ts` flattens only the body, so a footnote-only rendering would drop it.
 *
 * The link text is the source and place (`Slack · a message`), so a footnote reads as what it is without
 * a hover. The address sits in angle brackets with any angle bracket in it escaped, so nothing in it can end the
 * link early, and a `&` or `\\` is escaped too, so an entity or a backslash escape in it reaches the href as written.
 *
 * @param text the draft flattened to text, citations as their labels
 * @param citations what the draft declares, labels like `[1]`
 * @returns the markdown Streamdown renders
 */
export function footnotedMarkdown({
  text,
  citations,
}: {
  text: string;
  citations: readonly FootnoteCitation[];
}): string {
  const byNumber = new Map<string, FootnoteCitation>();
  for (const citation of citations) {
    const number = /^\[(\d+)\]$/u.exec(citation.label)?.at(1);
    if (number !== undefined && !byNumber.has(number)) {
      byNumber.set(number, citation);
    }
  }
  const linkTo = ({ citation, prefix }: { citation: FootnoteCitation; prefix: string }): string => {
    const { source, place } = citedAddress({ url: citation.url });
    const words = `${prefix}${source} · ${place}`.replace(/[[\]\\]/gu, "\\$&");
    // The one href rule every chip follows, so a footnote to a board row or a retired page draws as words.
    const href = referenceHref({ reference: { kind: "address", url: citation.url } });
    if (href === undefined) {
      return words;
    }
    const destination = href
      .replace(/[<>]/gu, (bracket) => encodeURIComponent(bracket))
      .replace(/[&\\]/gu, (literal) => `\\${literal}`);
    return `[${words}](<${destination}>)`;
  };
  const referenced = new Set<string>();
  const body = text.replace(MARKER, (marker, number: string) => {
    if (!byNumber.has(number)) {
      return marker;
    }
    referenced.add(number);
    return `[^${number}]`;
  });
  const definitions = [...referenced]
    .toSorted((a, b) => Number(a) - Number(b))
    .map((number) => `[^${number}]: ${linkTo({ citation: byNumber.get(number)!, prefix: "" })}`);
  const footnoted = new Set([...referenced].map((number) => byNumber.get(number)!));
  const unreferenced = citations
    .filter((citation) => !footnoted.has(citation))
    .map((citation) => linkTo({ citation, prefix: `${citation.label} ` }));
  const parts = [body];
  if (unreferenced.length > 0) {
    parts.push(`Also cited: ${unreferenced.join(" · ")}`);
  }
  if (definitions.length > 0) {
    parts.push(definitions.join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * A held reply as the markdown Streamdown renders: its standard shortcodes read as the emoji Slack will draw, then
 * footnoted. The emoji pass runs over the draft's own words BEFORE any footnote address is written, and leaves code,
 * web addresses and every name the snapshot lacks exactly as written (`./slackEmoji.ts`).
 *
 * @param text the draft flattened to text, citations as their labels
 * @param citations what the draft declares, labels like `[1]`
 * @returns the markdown the held reply renders
 */
export function heldDraftMarkdown({
  text,
  citations,
}: {
  text: string;
  citations: readonly FootnoteCitation[];
}): string {
  return footnotedMarkdown({ citations, text: emojiText({ text }) });
}

/**
 * The reference a register row's `anchor` names, when it names one a chip can draw: an `https://` address, this
 * console's own `http://localhost` route, or a talk turn as `talk:<id>`. Any other anchor — a transcript pointer,
 * a commit, prose — is `undefined` and drawn as written: a chip is never guessed out of a string whose kind it
 * cannot read.
 *
 * @param anchor the anchor as the register wrote it
 * @returns the reference, or `undefined`
 */
export function anchorReference({ anchor }: { anchor: string }): CitationReference | undefined {
  const trimmed = anchor.trim();
  const talk = /^talk:([\w-]+)$/u.exec(trimmed);
  if (talk !== null) {
    const [, id = ""] = talk;
    return { id, kind: "talk-turn" };
  }
  if (/^(?:https:\/\/|http:\/\/(?:localhost|127\.0\.0\.1)[:/])\S+$/u.test(trimmed)) {
    return { kind: "address", url: trimmed };
  }
  return undefined;
}
