/**
 * The permissions guide's page: a script-free `data:` document with each permission's row, the animated System
 * Settings for the step, its instructions and its links on the guide's own scheme. Pure; `permissionGuideShell.ts`
 * loads it.
 */
import { dataUrl, escapeHtml } from "./fleetPage";
import {
  INPUT_CONTROL_NAME,
  INPUT_CONTROL_WHY,
  type InputControlStanding,
  type InputControlView,
} from "./inputControlConsent";
import {
  GUIDE_SCHEME,
  type GuideLink,
  type GuideStep,
  type GuideView,
  type PermissionId,
  type PermissionStanding,
} from "./permissionGuide";

/**
 * The href for one link.
 *
 * @returns the `slopweaver-guide://…` URL
 */
function hrefOf({ link }: { link: GuideLink }): string {
  if (link.kind === "ask" || link.kind === "settings") {
    return `${GUIDE_SCHEME}//${link.kind}/${link.permission}`;
  }
  if (link.kind === "input-control-accept") {
    return `${GUIDE_SCHEME}//input-control/accept`;
  }
  if (link.kind === "input-control-decline") {
    return `${GUIDE_SCHEME}//input-control/decline`;
  }
  if (link.kind === "input-control-settings") {
    return `${GUIDE_SCHEME}//input-control/settings`;
  }
  return `${GUIDE_SCHEME}//${link.kind}`;
}

/**
 * The words beside the optional mouse and keyboard control row.
 *
 * @returns its state in a word or two
 */
function inputControlWord({ standing }: { standing: InputControlStanding }): string {
  switch (standing) {
    case "granted":
      return "On";
    case "declined":
      return "Not now";
    case "offer":
    case "settings":
      return "Off";
    default: {
      const unhandled: never = standing;
      return unhandled;
    }
  }
}

/**
 * The optional mouse and keyboard control row, its dot green only once macOS trusts the app.
 *
 * @param view the optional step as decided
 * @returns the row's HTML, every value escaped
 */
function inputControlRowHtml({ view }: { view: InputControlView }): string {
  const rowClass = view.standing === "granted" ? "granted" : "optional";
  const state = escapeHtml({ text: inputControlWord({ standing: view.standing }) });
  return `<li class="${rowClass}"><span class="dot"></span><span><b>${escapeHtml({ text: INPUT_CONTROL_NAME })}</b> <span class="tag">Optional</span><span class="why">${escapeHtml({ text: INPUT_CONTROL_WHY })}</span></span><span class="state">${state}</span></li>`;
}

const STYLE = `
:root{color-scheme:dark}
body{margin:0;background:#0f1115;color:#e7e9ee;font:13px/1.45 -apple-system,system-ui,sans-serif}
main{padding:18px 20px}
.title{font-size:16px;font-weight:600;margin:0 0 4px}
.sub{opacity:.75;margin:0 0 12px}
.rows{list-style:none;margin:0 0 14px;padding:0}
.rows li{display:grid;grid-template-columns:14px 1fr auto;gap:8px;align-items:baseline;padding:6px 0;border-top:1px solid #1d2129}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;background:#eab308}
.granted .dot{background:#22c55e}
.optional .dot{background:#6b7280}
.tag{font-size:11px;opacity:.6;font-weight:400}
.state{font-size:12px;opacity:.75}
.why{display:block;font-size:12px;opacity:.65}
.step{margin:0 0 6px;font-weight:600}
.how{margin:10px 0 12px;padding-left:20px}
.how li{margin:0 0 4px}
.act{display:inline-block;margin:0 0 10px;padding:7px 16px;border-radius:8px;background:#3b82f6;color:#fff;text-decoration:none;font-weight:600}
.links a,.reopen a{color:#93b4f8}
.links{font-size:12px;opacity:.85;margin:10px 0 0}
.reopen{font-size:12px;opacity:.85;margin:0 0 6px}
.problem{font-size:12px;color:#fca5a5;margin:6px 0 0}
.sim{position:relative;width:372px;height:204px;border-radius:10px;background:#1e2027;border:1px solid #2c2f37;overflow:hidden;font-size:11px;color:#d7d9de}
.sim .bar{position:absolute;left:0;top:0;right:0;height:22px;background:#24262d}
.sim .bar i{display:inline-block;width:8px;height:8px;border-radius:50%;margin:7px 0 0 7px;background:#ef4444}
.sim .bar i+i{background:#eab308}.sim .bar i+i+i{background:#22c55e}
.sim .side{position:absolute;left:0;top:22px;bottom:0;width:118px;background:#191b21}
.sim .side span{position:absolute;left:8px;width:102px;height:20px;line-height:20px;padding-left:6px;border-radius:5px;box-sizing:border-box}
.sim .side .sel{background:#2f5fd0;color:#fff}
.sim .crumb{position:absolute;left:130px;top:30px;margin:0;opacity:.6}
.sim .ptitle{position:absolute;left:130px;top:46px;margin:0;font-size:14px;font-weight:600}
.sim .row{position:absolute;left:128px;width:234px;height:28px;line-height:28px;padding-left:28px;box-sizing:border-box;border-radius:6px;background:#23262e}
.sim .row b{position:absolute;left:7px;top:7px;width:14px;height:14px;border-radius:4px;background:#4b5563}
.sim .row .mark{background:linear-gradient(135deg,#8b5cf6,#3b82f6)}
.sim .other{top:80px}
.sim .app{top:112px;background:#263357;box-shadow:0 0 0 2px #3b82f6}
.sim .tog{position:absolute;right:8px;top:7px;width:26px;height:15px;border-radius:8px;background:#2f7cf6}
.sim .tog i{position:absolute;top:2px;left:13px;width:11px;height:11px;border-radius:50%;background:#fff}
.sim .other .tog{background:#2f7cf6}
.sim .tap{position:absolute;left:331px;top:116px;width:20px;height:20px;border-radius:50%;border:2px solid #93b4f8;opacity:0}
.sim .sheet{position:absolute;left:146px;top:52px;width:206px;height:96px;padding:10px;box-sizing:border-box;border-radius:10px;background:#2a2d35;border:1px solid #3a3e48;box-shadow:0 8px 24px rgb(0 0 0 / 60%);opacity:0}
.sim .sheet span{position:absolute;right:10px;bottom:10px;padding:3px 9px;border-radius:6px;background:#2f7cf6;color:#fff}
.sim .hand{position:absolute;left:0;top:0;width:22px;height:26px;transform:translate(337px,124px)}
.mic .app,.sys .app{animation:lit 7s infinite}
.mic .tog.target,.sys .tog.target{animation:flip 7s infinite}
.mic .tog.target i,.sys .tog.target i{animation:knob 7s infinite}
.mic .tap,.sys .tap{animation:tap 7s infinite}
.mic .hand,.sys .hand{animation:hand 7s infinite}
.scr .app{animation:lit 9s infinite}
.scr .tog.target{animation:flip-s 9s infinite}
.scr .tog.target i{animation:knob-s 9s infinite}
.scr .tap{animation:tap-s 9s infinite}
.scr .sheet{animation:sheet 9s infinite}
.scr .hand{animation:hand-s 9s infinite}
@keyframes lit{0%,20%{background:#23262e;box-shadow:none}26%,82%{background:#263357;box-shadow:0 0 0 2px #3b82f6}90%,100%{background:#23262e;box-shadow:none}}
@keyframes flip{0%,45%{background:#3a3d44}49%,100%{background:#2f7cf6}}
@keyframes knob{0%,45%{left:2px}49%,100%{left:13px}}
@keyframes tap{0%,42%{opacity:0;transform:scale(.4)}45%{opacity:1;transform:scale(.8)}55%,100%{opacity:0;transform:scale(1.6)}}
@keyframes hand{0%{transform:translate(300px,200px);opacity:0}8%{transform:translate(300px,200px);opacity:1}22%,30%{transform:translate(226px,124px)}40%{transform:translate(337px,124px) scale(1)}44%{transform:translate(337px,124px) scale(.8)}48%,80%{transform:translate(337px,124px) scale(1);opacity:1}90%,100%{transform:translate(337px,124px);opacity:0}}
@keyframes flip-s{0%,35%{background:#3a3d44}38%,100%{background:#2f7cf6}}
@keyframes knob-s{0%,35%{left:2px}38%,100%{left:13px}}
@keyframes tap-s{0%,33%{opacity:0;transform:scale(.4)}35%{opacity:1;transform:scale(.8)}42%,100%{opacity:0;transform:scale(1.6)}}
@keyframes sheet{0%,46%{opacity:0}50%,74%{opacity:1}78%,100%{opacity:0}}
@keyframes hand-s{0%{transform:translate(300px,200px);opacity:0}6%{transform:translate(300px,200px);opacity:1}17%,23%{transform:translate(226px,124px)}30%{transform:translate(337px,124px) scale(1)}34%{transform:translate(337px,124px) scale(.8)}37%,48%{transform:translate(337px,124px) scale(1)}58%{transform:translate(296px,132px) scale(1)}62%{transform:translate(296px,132px) scale(.8)}66%,80%{transform:translate(296px,132px) scale(1);opacity:1}90%,100%{transform:translate(296px,132px);opacity:0}}
@media (prefers-reduced-motion:reduce){.sim *{animation:none!important}}
`;

/**
 * Each step's animation: one switch pressed (`mic`, `sys`), or one switch then macOS's Quit & Reopen sheet (`scr`).
 * System Audio Recording draws no sheet — macOS has not been seen to ask for a reopen there.
 */
const SIM_CLASS: Readonly<Record<PermissionId, string>> = { microphone: "mic", screen: "scr", systemAudio: "sys" };

/** The sidebar of the drawn System Settings, Privacy & Security selected as the deep link opens it. */
const SIDEBAR = ["Wi‑Fi", "General", "Appearance", "Privacy & Security", "Desktop & Dock"];

/** A pointing hand, its fingertip at the top-left of its box. */
const HAND =
  '<svg class="hand" viewBox="0 0 22 26" aria-hidden="true"><path d="M5 2c1.2 0 2 .9 2 2v8.2l.9-.6c1-.6 2.2-.4 2.8.5l.3.4.6-.3c1-.5 2.2-.2 2.7.7l.2.4.5-.2c1-.4 2.2 0 2.6 1l1.3 3.6c.7 2 .3 4.2-1.1 5.8L16 25H8l-4.9-6.4c-.7-.9-.6-2.2.3-2.9.8-.6 1.9-.5 2.6.2V4c0-1.1.8-2 2-2z" fill="#fff" stroke="rgb(17 17 17)" stroke-width="1.2"/></svg>';

/**
 * The animated System Settings for one step: the page the deep link opens, the owner's app's row lit, a pointer pressing its
 * switch on — and, for Screen Recording, macOS's Quit & Reopen sheet pressed after it. Hidden from assistive tech;
 * the numbered steps beside it say the same.
 *
 * @param step the step drawn
 * @param appName the app's row
 * @returns the HTML, every value escaped
 */
function walkthroughHtml({ step, appName }: { step: GuideStep; appName: string }): string {
  const side = SIDEBAR.map((name, index) => {
    const selected = name === "Privacy & Security" ? ' class="sel"' : "";
    return `<span${selected} style="top:${String(30 + index * 22)}px">${escapeHtml({ text: name })}</span>`;
  }).join("");
  const sheet =
    step.permission === "screen"
      ? `<div class="sheet">“${escapeHtml({ text: appName })}” may not be able to record the contents of your screen until it is quit.<span>Quit &amp; Reopen</span></div>`
      : "";
  const kind = SIM_CLASS[step.permission];
  return [
    `<div class="sim ${kind}" aria-hidden="true">`,
    '<div class="bar"><i></i><i></i><i></i></div>',
    `<div class="side">${side}</div>`,
    '<p class="crumb">‹ Privacy &amp; Security</p>',
    `<p class="ptitle">${escapeHtml({ text: step.paneTitle })}</p>`,
    '<div class="row other"><b></b>zoom.us<span class="tog"><i></i></span></div>',
    `<div class="row app"><b class="mark"></b>${escapeHtml({ text: appName })}<span class="tog target"><i></i></span></div>`,
    '<span class="tap"></span>',
    sheet,
    HAND,
    "</div>",
  ].join("");
}

/**
 * The words beside a permission's dot.
 *
 * @returns its state in a word or two
 */
function stateWord({ standing }: { standing: PermissionStanding }): string {
  if (standing === "granted") {
    return "On";
  }
  return standing === "managed" ? "Managed" : "Off";
}

/**
 * The link that puts the guide away. Not now to a voice permission is remembered as the permissions off then; Not now
 * to the optional step is remembered as the owner's answer to IT, a separate record, so it is never asked at launch again;
 * with nothing left to do, Close.
 *
 * @param step the voice permission's step, while one is off
 * @param optional the optional step, while it is the one shown
 * @returns the link's HTML
 */
function closeLinkHtml({
  step,
  optional,
}: {
  step: GuideStep | undefined;
  optional: InputControlView["step"];
}): string {
  if (step !== undefined) {
    return `<a href="${escapeHtml({ text: hrefOf({ link: { kind: "dismiss" } }) })}">Not now</a>`;
  }
  if (optional?.button.link.kind === "input-control-accept") {
    return `<a href="${escapeHtml({ text: hrefOf({ link: { kind: "input-control-decline" } }) })}">Not now</a>`;
  }
  return `<a href="${escapeHtml({ text: hrefOf({ link: { kind: "dismiss" } }) })}">Close</a>`;
}

/**
 * The guide as a `data:` URL.
 *
 * @param view what it says
 * @param title the document's title, which the window shows as its own
 * @returns the URL the guide's window loads
 */
export function guideUrl({ view, title }: { view: GuideView; title: string }): string {
  const rows = view.rows
    .map((row) => {
      const state = escapeHtml({ text: stateWord({ standing: row.standing }) });
      return `<li class="${escapeHtml({ text: row.standing })}"><span class="dot"></span><span><b>${escapeHtml({ text: row.label })}</b><span class="why">${escapeHtml({ text: row.why })}</span></span><span class="state">${state}</span></li>`;
    })
    .join("");
  const parts = [
    `<p class="title">${escapeHtml({ text: view.headline })}</p>`,
    `<p class="sub">${escapeHtml({ text: view.sub })}</p>`,
    `<ul class="rows">${rows}${inputControlRowHtml({ view: view.inputControl })}</ul>`,
  ];
  const step = view.step;
  // The optional step only once every voice permission is on: a call's own permission always comes first.
  const optional = step === undefined ? view.inputControl.step : undefined;
  if (optional !== undefined) {
    parts.push(`<p class="step">${escapeHtml({ text: `${INPUT_CONTROL_NAME} (optional)` })}</p>`);
    parts.push(`<ol class="how">${optional.how.map((line) => `<li>${escapeHtml({ text: line })}</li>`).join("")}</ol>`);
    const href = escapeHtml({ text: hrefOf({ link: optional.button.link }) });
    parts.push(`<a class="act" href="${href}">${escapeHtml({ text: optional.button.label })}</a>`);
  }
  if (step !== undefined) {
    parts.push(`<p class="step">${escapeHtml({ text: `Turn on ${step.label}` })}</p>`);
    parts.push(walkthroughHtml({ appName: view.appName, step }));
    parts.push(`<ol class="how">${step.how.map((line) => `<li>${escapeHtml({ text: line })}</li>`).join("")}</ol>`);
    if (step.button !== undefined) {
      const href = escapeHtml({ text: hrefOf({ link: step.button.link }) });
      parts.push(`<a class="act" href="${href}">${escapeHtml({ text: step.button.label })}</a>`);
    }
    const app = escapeHtml({ text: view.appName });
    if (step.reopen === "offer") {
      const href = escapeHtml({ text: hrefOf({ link: { kind: "reopen" } }) });
      parts.push(
        `<p class="reopen">Turned it on and it still says Off? macOS applies it once ${app} reopens: <a href="${href}">Reopen ${app}</a></p>`,
      );
    } else if (step.reopen === "after-call") {
      parts.push(
        `<p class="reopen">Turned it on and it still says Off? Reopen ${app} after your call: quitting now would end it.</p>`,
      );
    }
  }
  if (view.problem !== undefined) {
    parts.push(`<p class="problem">${escapeHtml({ text: view.problem })}</p>`);
  }
  const recheck = escapeHtml({ text: hrefOf({ link: { kind: "recheck" } }) });
  parts.push(`<p class="links"><a href="${recheck}">Check again</a> · ${closeLinkHtml({ optional, step })}</p>`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml({ text: title })}</title><style>${STYLE}</style></head><body><main>${parts.join("")}</main></body></html>`;
  return dataUrl({ html });
}
