/**
 * The sessions page and its floating note, as self-contained HTML. Pure.
 *
 * The page is the ONE panel the shell shows for the fleet: a capacity line, every seat as a coloured dot with its
 * band and the row it runs, the reason in plain words, and at most one button. There is no priority control and no
 * reseat button — recovery is the shell's, and a seat's priority is its board row's. The producer's own text sits
 * under a fold and is never the headline.
 *
 * Both documents carry no script and a policy that allows none. The one button is a link on the
 * `slopweaver-fleet:` scheme, which the main process intercepts and acts on only when it names the hand step
 * standing at that moment (`fleetLinkOf`); every value drawn is escaped.
 */
import { clockTime } from "./fleetAutomation";
import { RESUME_COMMAND } from "./fleetAutomationLaunch";
import type { FleetHealth, FleetReason, FleetSeat } from "./fleetHealth";

/** The scheme the page's one button and the note's two links navigate to. */
export const FLEET_SCHEME = "slopweaver-fleet:";

/** What a link on the page asks for. */
export type FleetLink =
  { readonly kind: "act"; readonly stepId: string } | { readonly kind: "dismiss"; readonly stepId: string };

/**
 * Escape text for HTML content and double-quoted attributes.
 *
 * @param text the raw text
 * @returns it, safe to place in either
 */
export function escapeHtml({ text }: { text: string }): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The link a page navigation names, when it is one of ours.
 *
 * @param url the URL the page tried to open
 * @returns the link, or `undefined` for anything else
 */
export function fleetLinkOf({ url }: { url: string }): FleetLink | undefined {
  if (!url.startsWith(FLEET_SCHEME)) {
    return undefined;
  }
  const match = /^slopweaver-fleet:\/\/(act|dismiss)\/([^/?#]{1,200})$/u.exec(url);
  if (match === null) {
    return undefined;
  }
  const stepId = decodeURIComponent(match[2]!);
  return match[1] === "act" ? { kind: "act", stepId } : { kind: "dismiss", stepId };
}

/**
 * The href for one link.
 *
 * @returns the `slopweaver-fleet://…` URL
 */
function hrefOf({ link }: { link: FleetLink }): string {
  return `${FLEET_SCHEME}//${link.kind}/${encodeURIComponent(link.stepId)}`;
}

/**
 * A `data:` URL for one document.
 *
 * @param html the whole document
 * @returns the URL a window loads
 */
export function dataUrl({ html }: { html: string }): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

const STYLE = `
:root{color-scheme:dark}
body{margin:0;background:#0f1115;color:#e7e9ee;font:14px/1.45 -apple-system,system-ui,sans-serif}
main{padding:20px 24px;max-width:960px}
h1{font-size:20px;margin:0 0 4px}
.sub{opacity:.75;margin:0 0 14px}
.capacity{font-size:13px;opacity:.85;margin:0 0 16px;font-variant-numeric:tabular-nums}
.act{display:inline-block;margin:4px 0 14px;padding:7px 16px;border-radius:8px;background:#3b82f6;color:#fff;text-decoration:none;font-weight:600}
details{margin:0 0 16px;opacity:.85}
summary{cursor:pointer;font-size:12px;opacity:.75}
pre{white-space:pre-wrap;font:12px/1.4 ui-monospace,Menlo,monospace;background:#171a21;padding:8px 10px;border-radius:6px}
ul{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:14px 74px 1fr;gap:8px;align-items:baseline;padding:6px 0;border-top:1px solid #1d2129}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;transform:translateY(1px)}
.red{background:#ef4444}.yellow{background:#eab308}.green{background:#22c55e}
.flash{animation:flash 1s steps(2,start) infinite}
@keyframes flash{to{visibility:hidden}}
.band{font:12px ui-monospace,Menlo,monospace;opacity:.8}
.title{font-weight:500}
.detail{display:block;font-size:12px;opacity:.7}
.empty{opacity:.45}
.why li{display:list-item;list-style:disc inside;padding:2px 0;border:0;font-size:12px}
`;

/**
 * One script-free document around a body, in the shell's own style — the sessions page and both floating notes.
 *
 * @param title the document's title
 * @param body HTML already escaped by the caller
 * @returns the whole document, under a policy that allows no script
 */
export function documentOf({ title, body }: { title: string; body: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml({ text: title })}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/** What a seat is called on the page when its row names nothing better. */
function roleLabel({ seat }: { seat: FleetSeat }): string {
  switch (seat.role) {
    case "supervisor":
      return "supervisor";
    case "loop":
      return "service";
    case "keep-alive":
      return "service";
    case "worker":
      return seat.priority;
    case "empty":
      return "free";
    default: {
      const unreachable: never = seat.role;
      return unreachable;
    }
  }
}

/**
 * An instant as the owner reads it: a clock time on the reading's own day, else the weekday too, so a sign from yesterday
 * never reads as one from this afternoon. Never an age, so an unchanged reading draws an identical document.
 */
function whenOf({ iso, nowIso, timeZone }: { iso: string; nowIso: string; timeZone: string | undefined }): string {
  const day = new Intl.DateTimeFormat("en-CA", timeZone === undefined ? {} : { timeZone });
  const time = clockTime({ ms: Date.parse(iso), timeZone });
  if (day.format(Date.parse(iso)) === day.format(Date.parse(nowIso))) {
    return time;
  }
  const weekday = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(Date.parse(iso));
  return `${weekday} ${time}`;
}

/**
 * The supervisor's last sign of working, in one sentence, or that none has been seen — the success signal whose
 * absence is what reads it down.
 *
 * @param seat the supervisor's seat
 * @param nowIso the reading's instant, which decides whether a day is named
 * @param timeZone the zone the time is read in; the machine's own when undefined
 * @returns the sentence
 */
export function signalLine({
  seat,
  nowIso,
  timeZone,
}: {
  seat: FleetSeat;
  nowIso: string;
  timeZone: string | undefined;
}): string {
  if (seat.lastSignal === undefined) {
    return "No sign it was working has been seen: it has not said it is caught up or closed a sweep.";
  }
  const at = whenOf({ iso: seat.lastSignal.atIso, nowIso, timeZone });
  if (seat.lastSignal.kind === "reoriented") {
    return `Last sign it was working: it said it was caught up at ${at}.`;
  }
  return `Last sign it was working: it closed a sweep at ${at}.`;
}

/** One seat as a row; the supervisor's also names its last sign of working. */
function seatRow({
  seat,
  nowIso,
  timeZone,
}: {
  seat: FleetSeat;
  nowIso: string;
  timeZone: string | undefined;
}): string {
  const dot = `<span class="dot ${seat.colour}${seat.flashing ? " flash" : ""}" title="${seat.colour}"></span>`;
  const band = `<span class="band">${escapeHtml({ text: roleLabel({ seat }) })}</span>`;
  const signal =
    seat.role === "supervisor"
      ? `<span class="detail">${escapeHtml({ text: signalLine({ nowIso, seat, timeZone }) })}</span>`
      : "";
  const what = `<span><span class="title">${escapeHtml({ text: seat.rowTitle })}</span><span class="detail">${escapeHtml({ text: seat.detail })}</span>${signal}</span>`;
  return `<li${seat.role === "empty" ? ' class="empty"' : ""}>${dot}${band}${what}</li>`;
}

/**
 * Why the note reads the way it does, one line each, for its fold: every red seat's own words, the supervisor's last
 * sign of working and since when one has been expected, the console when it is not serving, and what recovery did.
 * The note says what is wrong; this is what it was read off, so the owner can judge whether the reading is right.
 *
 * @param health the reading the note is drawn from
 * @param timeZone the zone times are read in; the machine's own when undefined
 * @returns the lines, in that order
 */
export function noteWhy({
  health,
  timeZone,
}: {
  health: FleetHealth;
  timeZone: string | undefined;
}): readonly string[] {
  const nowIso = health.observedAtIso;
  const lines = health.seats
    .filter((seat) => seat.colour === "red" && !seat.held && seat.role !== "empty")
    .map((seat) => `${seat.rowTitle}: ${seat.detail}`);
  const chair = health.seats.find((seat) => seat.role === "supervisor");
  if (chair !== undefined && chair.colour !== "green") {
    lines.push(signalLine({ nowIso, seat: chair, timeZone }));
    if (chair.signalExpectedSinceIso !== undefined) {
      lines.push(
        `A sign has been expected since ${whenOf({ iso: chair.signalExpectedSinceIso, nowIso, timeZone })}, when it started or took the seat.`,
      );
    }
  }
  if (health.console === "down") {
    lines.push("The console is not answering.");
  } else if (health.console === "unmeasured") {
    lines.push("The console could not be checked.");
  }
  const step = health.reason.handStep;
  if (step?.recoveryDetail !== undefined) {
    lines.push(step.recoveryDetail);
  } else {
    lines.push(health.reason.detail);
  }
  return lines;
}

/** The reason block: headline, detail, the one button, and the fold. */
function reasonBlock({ reason, unmapped }: { reason: FleetReason; unmapped: readonly string[] }): string {
  const parts = [
    `<h1>${escapeHtml({ text: reason.headline })}</h1>`,
    `<p class="sub">${escapeHtml({ text: reason.detail })}</p>`,
  ];
  const step = reason.handStep;
  if (step !== undefined) {
    parts.push(
      `<a class="act" href="${escapeHtml({ text: hrefOf({ link: { kind: "act", stepId: step.id } }) })}">${escapeHtml({ text: step.label })}</a>`,
    );
  }
  const folded = [...(reason.raw === undefined ? [] : [reason.raw]), ...unmapped];
  if (folded.length > 0) {
    parts.push(
      `<details><summary>The original text</summary><pre>${escapeHtml({ text: folded.join("\n\n") })}</pre></details>`,
    );
  }
  return parts.join("");
}

/** The capacity line: online over configured, the console, and the attempt underway. */
function capacityLine({ health }: { health: FleetHealth }): string {
  const parts = [
    `${String(health.capacity.online)} of ${String(health.capacity.configured)} online`,
    `console ${health.console}`,
  ];
  if (health.recoveryPhase !== undefined) {
    parts.push(`recovery: ${health.recoveryPhase}`);
  }
  return `<p class="capacity">${escapeHtml({ text: parts.join(" · ") })}</p>`;
}

/**
 * The sessions page for one reading.
 *
 * @param health the reading, with the shell's own failure already folded in
 * @param timeZone the zone times are read in; the machine's own when undefined
 * @returns the page's HTML
 */
export function fleetPageHtml({ health, timeZone }: { health: FleetHealth; timeZone: string | undefined }): string {
  const nowIso = health.observedAtIso;
  const body = [
    reasonBlock({ reason: health.reason, unmapped: health.unmapped }),
    capacityLine({ health }),
    `<ul>${health.seats.map((seat) => seatRow({ nowIso, seat, timeZone })).join("")}</ul>`,
  ].join("");
  return documentOf({ body, title: "Sessions" });
}

/**
 * The sessions page as a `data:` URL.
 *
 * @param health the reading
 * @param timeZone the zone times are read in; the machine's own when undefined
 * @returns the URL the window loads
 */
export function fleetPageUrl({ health, timeZone }: { health: FleetHealth; timeZone: string | undefined }): string {
  return dataUrl({ html: fleetPageHtml({ health, timeZone }) });
}

/**
 * The sessions page while no reading exists: why, in one line, with the producer's text under the fold.
 *
 * @param problem why `fleet health` produced nothing usable
 * @returns the URL the window loads
 */
export function fleetUnreadableUrl({ problem }: { problem: string }): string {
  const body = reasonBlock({
    reason: {
      code: "FLEET_UNREADABLE",
      detail: "The sessions page reads the fleet every half minute and tries again by itself.",
      handStep: undefined,
      headline: "Slopweaver could not read the fleet.",
      raw: problem,
    },
    unmapped: [],
  });
  return dataUrl({ html: documentOf({ body, title: "Sessions" }) });
}

/**
 * The floating note for the one hand step: its sentence, its button, a close link, and why it reads this way under a
 * fold — progressive disclosure, so the note stays a sentence and the evidence is one click away. "Start recovery
 * again" also shows the command it runs, selectable, so the owner can see what pressing it does or run it by hand; no other
 * step has a command for the owner to paste, so no other step shows one.
 *
 * @param health the reading carrying the step
 * @param timeZone the zone times are read in; the machine's own when undefined
 * @returns the note's URL, or `undefined` when the reading offers no step
 */
export function fleetNoteUrl({
  health,
  timeZone,
}: {
  health: FleetHealth;
  timeZone: string | undefined;
}): string | undefined {
  const step = health.reason.handStep;
  if (step === undefined) {
    return undefined;
  }
  const why = noteWhy({ health, timeZone })
    .map((line) => `<li>${escapeHtml({ text: line })}</li>`)
    .join("");
  const body = [
    `<p class="title">${escapeHtml({ text: step.note })}</p>`,
    `<a class="act" href="${escapeHtml({ text: hrefOf({ link: { kind: "act", stepId: step.id } }) })}">${escapeHtml({ text: step.label })}</a> `,
    `<a class="detail" href="${escapeHtml({ text: hrefOf({ link: { kind: "dismiss", stepId: step.id } }) })}">Not now</a>`,
    `<details><summary>Why it reads this way</summary><ul class="why">${why}</ul></details>`,
    ...(step.action.kind === "resume"
      ? [`<p class="detail">Or run it yourself:</p><pre>${escapeHtml({ text: RESUME_COMMAND })}</pre>`]
      : []),
  ].join("");
  return dataUrl({ html: documentOf({ body, title: "Slopweaver fleet" }) });
}
