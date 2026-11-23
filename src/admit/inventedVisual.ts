/**
 * INVENTED VISUALS — the PURE detector for a picture this machine DREW standing in for a picture of the
 * real thing, checked at every seam where a visual enters an outbound artifact.
 *
 * ## The measured rule
 *
 * A locally rendered page (`http://127.0.0.1:8792/before.html`) was screenshotted and handed over as Vanta
 * "before" evidence. The rule is a hard block on inventing images like this, because a session often does it
 * as a substitute for screenshots: the single outbound door cannot be bypassed (with an escape hatch of
 * course), and the same shape of hook belongs on a session that tries to invent an image.
 *
 * ## The instances, surveyed rather than assumed
 *
 * Five instances across three sessions, all reproduced from this machine's own transcripts:
 *
 * | when (UTC)   | what was captured                            | how it entered an artifact          |
 * | ------------ | -------------------------------------------- | ----------------------------------- |
 * | 02:30:57     | `file:///…` navigate                         | refused by the extension, never shot |
 * | 02:31:33     | `http://127.0.0.1:8791/vanta-critical.html`  | screenshot offered as Vanta state   |
 * | 06:44:49     | `http://127.0.0.1:8791/vanta-BEFORE.html`    | screenshot offered as Vanta state   |
 * | 08:55–09:00  | `http://127.0.0.1:8792/{before,after}.html`  | `01-before.jpg` / `02-after.jpg`    |
 * | 02:2x        | matplotlib charts of a replayed query        | attached as monitor backtest proof  |
 *
 * Reproduce the sweep over any machine holding the transcripts (a `mcp__claude-in-chrome__*` call whose
 * argument is a loopback or `file://` URL):
 *
 * ```sh
 * grep -rhoE '"url": *"(http://(127\.0\.0\.1|localhost|0\.0\.0\.0)[^"]*|file://[^"]*)"' \
 *   ~/.claude/projects --include='*.jsonl' | sort | uniq -c | sort -rn
 * ```
 *
 * ## The one thing the survey settled, and it is the opposite of the obvious design
 *
 * `before.html` was **not** hand-rolled. It came out of the shipped door verb,
 * `slopweaver atlas vanta vulnerabilities --severity CRITICAL --html "$SP/before.html"` — so its data was
 * real, read through the door, and correct. It was an invented image anyway. So a provenance stamp exempting slopweaver's
 * own renderer would have let this very incident through, and there is no exemption here at all: **a
 * capture of a page served from this machine is an invented visual whether or not slopweaver drew it.**
 * `../atlas/vanta/vulnerabilityReport.ts` is a legitimate instrument for a doorless surface and stays
 * exactly as it is — its output now costs an acknowledgement to send, which is the whole point.
 *
 * ## Tripwire, not fence
 *
 * The same philosophy as `./rawTools.ts`: **a block confirms you were wrong; the absence of one means
 * nothing.** A visual can be invented in ways no rule here sees — a chart drawn by a library that stamps
 * nothing, a page rendered on another machine, a crop of a real shot that removes the part that disagreed.
 * Every check below is decidable from bytes a seam already holds, and none of them is a proof of honesty.
 *
 * One blind spot is MEASURED rather than supposed, so it is named here instead of found later: matplotlib
 * stamps its PNG and its SVG and stamps its JPEG with nothing at all — `savefig` to `.jpg` produced 17,975
 * bytes carrying no marker, against the same figure's 22,085-byte PNG carrying one at byte 50. So a chart
 * saved as a JPEG is caught only when it happens to sit beside a rendered page. Reproduce:
 *
 * ```sh
 * python3 -c "import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as p; p.plot([1,2],[1,2]); \
 *   p.savefig('/tmp/m.jpg'); p.savefig('/tmp/m.png')" && \
 *   python3 -c "print(open('/tmp/m.jpg','rb').read().find(b'Matplotlib'), \
 *     open('/tmp/m.png','rb').read().find(b'Matplotlib'))"
 * ```
 *
 * ## What each seam can decide
 *
 * A seam supplies what it has, and gets exactly the checks its own inputs settle — stated here rather than
 * discovered, because a reader comparing two seams' refusals will otherwise read the difference as a bug:
 *
 * - **the attachment door** holds the file, so it gets all four reasons;
 * - **the answer form** is decidable from the answer's own bytes and reads no filesystem
 *   (`../live/turn/answerPreflight.ts`'s standing contract), so it gets the two reference-only reasons;
 * - **the PR description** is a body of markdown in CI with no local file at all, so it gets the same two.
 */

/**
 * Where a visual entered the outbound artifact — named so a refusal says which door saw it.
 *
 * @internal — exported so each seam's collector can name its own value rather than restate the union.
 */
export type VisualSeam = "attachment" | "answer-image" | "pr-embed";

/**
 * Why one visual is an invented one. Each value is a reason a refusal quotes verbatim.
 *
 * @internal — exported so a test can assert which reason fired without parsing a finding's prose.
 */
export type InventedVisualReason =
  "local-render-url" | "page-not-capture" | "rendered-page-sibling" | "generated-chart";

/**
 * One candidate visual, reduced to what a detector can actually judge.
 *
 * `head` and `siblings` are what the ATTACHMENT seam adds and the two reference-only seams cannot: a body
 * of markdown and a composed answer both name a file without holding one.
 */
export interface CandidateVisual {
  /** Which door is looking at it. */
  readonly seam: VisualSeam;
  /** The path or URL exactly as the artifact carries it — quoted back in the refusal. */
  readonly ref: string;
  /** The file's leading bytes, when the seam read them; omit when it carries only a reference. */
  readonly head?: Uint8Array;
  /** Every other entry in the file's own directory, when the seam listed it; omit when it did not. */
  readonly siblings?: readonly string[];
}

/** One visual the detector will not let through, and what to do instead. */
export interface InventedVisual {
  readonly reason: InventedVisualReason;
  readonly seam: VisualSeam;
  /** The offending path or URL, as the artifact carries it. */
  readonly ref: string;
  /** Why this is not evidence — the sentence a worker reads and acts on. */
  readonly why: string;
  /** The real path to the same claim, named the way the worker has to go and get it. */
  readonly real: string;
}

/**
 * Hosts that only ever resolve on the machine that rendered the page. `0.0.0.0` is here because a server
 * bound to it is reachable at `http://0.0.0.0/` locally and nowhere a reader can open, and the IPv6
 * loopback is spelled bracketed because that is the only spelling a URL authority can carry.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

/** Schemes that address this machine's own disk rather than anything a reader can open. */
const LOCAL_SCHEMES: readonly string[] = ["file:", "data:"];

/** Extensions an IMAGE slot must never be handed: a page or a vector this session composed, not a capture. */
const PAGE_EXTENSIONS: readonly string[] = [".html", ".htm", ".svg"];

/**
 * Plotting-library stamps a generated chart leaves in its own bytes.
 *
 * ONE row, from the one generator measured in the surveyed instances — a second row is earned by a second
 * measured instance, never by guessing which libraries exist (the same discipline
 * `./realArtifact.ts`'s subject table keeps). MEASURED on this machine, matplotlib 3.9.4: the marker lands
 * at byte 50 of a `savefig` PNG (a `tEXt Software` chunk) and byte 701 of the SVG. Reproduce:
 *
 * ```sh
 * python3 -c "import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as p; \
 *   p.plot([1,2],[1,2]); p.savefig('/tmp/m.png')" && \
 *   python3 -c "print(open('/tmp/m.png','rb').read().find(b'Matplotlib version'))"
 * ```
 */
const CHART_STAMPS: readonly string[] = ["Matplotlib version"];

/**
 * How many leading bytes a seam needs to read for {@link CHART_STAMPS} to be findable.
 *
 * 4 KiB, against a measured deepest marker at byte 701 — the SVG offset above. It is a ceiling on the read,
 * never a claim that a stamp cannot sit past it: a file that carries one further in is simply not caught,
 * which is this module's stated tripwire property rather than a defect.
 */
export const VISUAL_HEAD_BYTES = 4096;

/**
 * How many words an acknowledgement must carry before it waives anything.
 *
 * A bare marker exempts nothing — the same rule the `named-object-params-exempt` marker keeps, and for the
 * same reason: the next reader has to be told WHY, and "yes" tells them nothing. Four is enough for a
 * clause and too few for a shrug.
 */
export const ACKNOWLEDGEMENT_MIN_WORDS = 4;

/**
 * Whether an acknowledgement carries a reason of substance rather than a token word.
 *
 * @param reason the text the caller supplied with the hatch
 * @returns whether it carries at least {@link ACKNOWLEDGEMENT_MIN_WORDS} words
 */
export function acknowledgementCarriesAReason({ reason }: { reason: string }): boolean {
  return (
    reason
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length >= ACKNOWLEDGEMENT_MIN_WORDS
  );
}

/** The correction every reason shares — the one real path back to evidence a reader can check. */
const REAL_CAPTURE =
  "capture the provider's OWN surface through the doored browser route, or link the deployed thing itself";

/**
 * A URL authority with its port removed, in both spellings a host can take.
 *
 * The bracketed IPv6 form is why this is a function rather than a `split(":")`: `[::1]:8791` splits into
 * `[` on a colon, so a naive split reports a host that matches nothing and lets the loopback through.
 *
 * @param host the authority as it appears between the scheme and the first slash
 * @returns the host alone, brackets kept so it matches the table's own spelling
 */
function hostWithoutPort({ host }: { host: string }): string {
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    return close === -1 ? host : host.slice(0, close + 1);
  }
  // `split` always yields at least one element, so the assertion is honest rather than a masked miss.
  return host.split(":")[0]!;
}

/**
 * Whether a reference addresses only the machine that produced it.
 *
 * Deliberately string-first rather than `new URL()`: a PR body carries `src="http://127.0.0.1:8792/x.html"`
 * and an answer carries an absolute path, and neither is guaranteed to parse as a URL at all.
 *
 * @param ref the path or URL as the artifact carries it
 * @returns whether it is a `file:`/`data:` reference or one served from a loopback host
 */
export function addressesThisMachineOnly({ ref }: { ref: string }): boolean {
  const lower = ref.trim().toLowerCase();
  if (LOCAL_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
    return true;
  }
  const withoutScheme = lower.replace(/^https?:\/\//, "");
  if (withoutScheme === lower) {
    return false;
  }
  const host = withoutScheme.split("/")[0]!;
  const bare = hostWithoutPort({ host });
  return LOOPBACK_HOSTS.has(bare) || bare.endsWith(".localhost");
}

/**
 * Whether a reference names a page or a vector rather than a captured raster.
 *
 * @param ref the path or URL as the artifact carries it
 * @returns whether its extension is one an image slot must never carry
 */
export function refersToAPage({ ref }: { ref: string }): boolean {
  const withoutQuery = ref.split("?")[0]!;
  const lower = withoutQuery.trim().toLowerCase();
  return PAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Whether a directory listing holds a page this machine could have rendered for the shot.
 *
 * This is the `01-before.jpg` beside `before.html` shape the surveyed instances all had, and it is
 * deliberately the whole DIRECTORY rather than a matching stem: the shot was numbered and the page was not,
 * so a stem match would have caught none of them. It over-triggers on a shot saved next to unrelated HTML,
 * and the acknowledgement is what that case costs.
 *
 * @param siblings every other entry in the file's own directory
 * @returns whether any of them is an HTML page
 */
export function sitsBesideARenderedPage({ siblings }: { siblings: readonly string[] }): boolean {
  return siblings.some((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith(".html") || lower.endsWith(".htm");
  });
}

/**
 * Whether a file's leading bytes carry a plotting library's own stamp.
 *
 * @param head the leading bytes, read up to {@link VISUAL_HEAD_BYTES}
 * @returns whether any measured chart stamp appears in them
 */
export function carriesAChartStamp({ head }: { head: Uint8Array }): boolean {
  const text = Buffer.from(head).toString("latin1");
  return CHART_STAMPS.some((stamp) => text.includes(stamp));
}

/** The reason rows, each with the sentence a worker acts on. Order is the order a refusal lists them. */
function reasonsFor({ visual }: { visual: CandidateVisual }): readonly InventedVisualReason[] {
  const reasons: InventedVisualReason[] = [];
  if (addressesThisMachineOnly({ ref: visual.ref })) {
    reasons.push("local-render-url");
  }
  if (refersToAPage({ ref: visual.ref })) {
    reasons.push("page-not-capture");
  }
  const siblings = visual.siblings;
  if (siblings !== undefined && !refersToAPage({ ref: visual.ref }) && sitsBesideARenderedPage({ siblings })) {
    reasons.push("rendered-page-sibling");
  }
  const head = visual.head;
  if (head !== undefined && carriesAChartStamp({ head })) {
    reasons.push("generated-chart");
  }
  return reasons;
}

/** The worker-facing sentence for one reason. Total over the union. */
function whyOf({ reason }: { reason: InventedVisualReason }): string {
  switch (reason) {
    case "local-render-url":
      return "this is a page served from this machine — nobody else can open it, and a shot of it is a picture of something you rendered rather than of the provider's own surface";
    case "page-not-capture":
      return "an image slot was handed a page or a vector you composed, which is a drawing of your own arithmetic and not a capture of anything";
    case "rendered-page-sibling":
      return "this shot sits in a directory holding an HTML page, which is the shape of a page rendered here and photographed";
    case "generated-chart":
      return "these bytes carry a plotting library's own stamp, so this chart is a drawing of your own numbers and can be right about the data while wrong about what the real surface shows";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

/**
 * Every invented visual among the candidates, in candidate order then reason order. Pure and total.
 *
 * A candidate with more than one reason yields one entry PER reason rather than a single merged one: the
 * corrections differ, and a refusal that collapsed them would name only the first thing wrong with a file
 * that is wrong in two ways.
 *
 * @param visuals the candidates each seam collected, already reduced to refs plus whatever bytes it holds
 * @returns every visual that must not go out unacknowledged; empty when none does
 */
export function inventedVisualsIn({ visuals }: { visuals: readonly CandidateVisual[] }): readonly InventedVisual[] {
  return visuals.flatMap((visual) =>
    reasonsFor({ visual }).map((reason): InventedVisual => ({
      real: REAL_CAPTURE,
      reason,
      ref: visual.ref,
      seam: visual.seam,
      why: whyOf({ reason }),
    })),
  );
}

/**
 * The composing session's standing instruction on this rule — printed beside the visual-evidence default,
 * so it arrives before a capture is taken rather than when a send is refused.
 *
 * Always renders and takes no arguments, exactly as `../live/turn/visualEvidenceGuidance.ts` does: nothing
 * in a question predicts whether the session will be tempted to draw its own picture.
 *
 * @returns the lines to print, in order
 */
export function inventedVisualPreflightLines(): readonly string[] {
  return [
    "REAL SURFACES ONLY — a picture you rendered is never a substitute for a picture of the real thing:",
    "  1. A screenshot of `localhost`, `127.0.0.1`, `0.0.0.0` or a `file://` path is REFUSED at the",
    "     attachment door, in the answer form and in a PR description. So is an HTML or SVG page handed to",
    "     an image slot, and so is a chart a plotting library drew. This holds even when a slopweaver verb",
    "     rendered the page and the data behind it came through the door — that is",
    "     exactly the shot the owner rejects.",
    "  2. Go and get the real one: capture the provider's OWN surface through the doored browser route, or",
    "     hand back a link to the deployed thing. `../atlas/vanta/vulnerabilityReport.ts` and its kin remain",
    "     the instrument for a genuinely doorless surface — sending one now costs an acknowledgement.",
    '  3. The hatch is `--acknowledge "<reason>"` at the attachment door and the door override token',
    "     everywhere else. Both are RECORDED. Reach for one when you have looked at it and the local render",
    "     is honestly the only surface there is — never to get past a refusal you did not read.",
    "  4. A block confirms you were wrong. The absence of one means nothing: a drawing this cannot see is",
    "     still a drawing, and naming it in `grounding.evidence.substitutedForReal` is still your job.",
  ];
}
