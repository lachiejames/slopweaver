import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/** The crossings, top to bottom: where each lands, and the word on its arrow. */
const CROSSINGS = [
  {
    fill: STAGE.out,
    title: "Every doored provider",
    detail: "Slack · GitHub · Linear · …",
    foot: "WRITE: doored, journalled",
    arrowLabel: "the door",
  },
  {
    fill: STAGE.mid,
    title: "Live provider reads",
    detail: "Fathom · a ChatGPT chat · atlases",
    foot: "READ: read-only, stated residue",
    arrowLabel: "read-only",
  },
  {
    fill: STAGE.in,
    title: "Anthropic: Claude",
    detail: "your Claude session · a one-token gauge",
    foot: "CLAUDE: the session you run",
    arrowLabel: "your session",
  },
  {
    fill: STAGE.in,
    title: "OpenAI: Codex · the web",
    detail: "prompts, diffs, draft threads · the web",
    foot: "CODEX: per invocation or as-me draft",
    arrowLabel: "opt-in",
  },
  {
    fill: STAGE.in,
    title: "OpenAI: the voice",
    detail: "mic, tool results, screen frames",
    foot: "TALK: on your press, ChatGPT plan",
    arrowLabel: "on your press",
  },
] as const;

/** Vertical pitch of one crossing box, and the box's own height. */
const PITCH = 86;
const BOX_H = 76;

/**
 * Where your data can leave this machine, drawn as a boundary with every crossing that carries it named.
 * Installing dependencies and pulling updates also reach the package registry and GitHub; they carry none
 * of it, so they are stated in the label rather than drawn.
 *
 * The page it sits on is the one place the OpenAI crossings must not be buried: `slopweaver codex` sends
 * prompts, repository reads and review diffs, opt-in per invocation, and a pass with the network open may
 * reach any host it decides to fetch (`docs/security/codex-boundary.md`); the console voice (`slopweaver talk`)
 * sends the microphone and every tool result it reads, on the owner's ChatGPT plan, only on the owner's press.
 * Drawing each as a labelled crossing rather than a footnote is the whole point of the figure.
 *
 * @returns the figure, captioned
 */
export function EgressBoundary(): ReactElement {
  return (
    <Figure
      arrow="sw-egress-arrow"
      viewBox="0 0 1060 590"
      label="Everything inside the boundary runs on this device: the corpus, the atlases, the store, which is always local and refuses another host with no escape hatch, the gates, the local read verbs and the store backup, which writes an encrypted copy into directories you name, uploads nothing, and refuses a cloud address (a folder something else carries off this machine, a network share or a synced cloud folder, takes the copy with it, and nothing checks for one). Five things carry your data across it: provider writes, through the admit door and journalled; live provider reads, read-only under a read-only grant or a client limited to reads (GET, and an allowlisted search POST), Fathom, one ChatGPT chat and the atlases among them; your Claude session to Anthropic, with the one-token request slopweaver claude gauge spends to read a plan's budget; the slopweaver codex verbs, which send prompts, repository reads and review diffs to OpenAI and, with network access and live web search on, may reach a search provider and any host a pass decides to fetch, opt-in per invocation, and slopweaver slack draft record, which sends a new as-me draft's conversation and your voice brief to OpenAI for a comparison draft, unless the draft was approved at record, carries media or is Codex's own; and the console voice, which sends the microphone, tool results and screen frames to OpenAI on the ChatGPT plan, only on a press. Installing dependencies and pulling updates also reach the package registry and GitHub, carrying none of your data."
      caption={
        <>
          The boundary, with every crossing that carries your data named.{" "}
          <strong>Codex, the console voice and a ChatGPT chat read are the three OpenAI egresses</strong>, each opt-in:
          stated here rather than buried, because a reader who learns it from a footnote has already assumed the
          opposite. The store never crosses: a store URL naming another host is refused, and no hatch opens that.
        </>
      }
    >
      <rect
        x="24"
        y="52"
        width="600"
        height="520"
        rx="14"
        fill="var(--sw-figure-panel)"
        stroke="var(--sw-figure-line)"
        strokeDasharray="6 5"
      />
      <Kicker x={324} y={78} text="THIS DEVICE: YOUR DATA LEAVES ONLY AT RIGHT" />

      <Panel x={48} y={124} w={264} h={80} title="The corpus" detail="bronze · silver · gold" foot="$SLOPWEAVER_HOME" />
      <Panel
        x={336}
        y={124}
        w={264}
        h={80}
        title="The store"
        detail="Postgres, local only, no hatch"
        foot="RLS declared"
      />
      <Panel
        x={48}
        y={300}
        w={264}
        h={80}
        title="the atlases"
        detail="what each platform IS"
        foot="look it up, never guess"
      />
      <Panel
        x={336}
        y={300}
        w={264}
        h={80}
        title="The gate surface"
        detail="yarn lint, one run"
        foot="no short-circuit"
      />
      <Panel
        x={48}
        y={476}
        w={552}
        h={80}
        title="The local read verbs"
        detail="store read · store cite · atlas <platform> read · knowledge · velocity"
        foot="no token, no record, no network"
      />

      {CROSSINGS.map((crossing, index) => {
        const y = 52 + index * PITCH;
        const mid = y + BOX_H / 2;
        return (
          <g key={crossing.title}>
            <Solid
              x={800}
              y={y}
              w={236}
              h={BOX_H}
              fill={crossing.fill}
              title={crossing.title}
              detail={crossing.detail}
              foot={crossing.foot}
            />
            <Arrow from={624} to={796} y={mid} arrow="sw-egress-arrow" />
            <text x="636" y={mid - 12} fontSize="11" fill="var(--sw-figure-muted)">
              {crossing.arrowLabel}
            </text>
          </g>
        );
      })}
    </Figure>
  );
}
