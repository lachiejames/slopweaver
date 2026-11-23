import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

const LANES = [
  {
    y: 76,
    h: 82,
    kicker: "READ",
    detail: "this machine, or a provider live, read-only",
    verbs: [
      "store read · store cite · atlas <platform> read · catalog · knowledge",
      "slack read-thread · github read · gmail read · datadog logs",
    ],
  },
  {
    y: 172,
    h: 66,
    kicker: "DRIVE",
    detail: "the owner's Chrome, read-before-write; act and scroll pass the door",
    verbs: ["browser open · read · aim · act · scroll · shot · atlas <platform> walk"],
  },
  {
    y: 252,
    h: 82,
    kicker: "WRITE",
    detail: "through the door, journalled, refusable",
    verbs: [
      "slack post · github pr · linear issue · notion attach",
      "gmail send · calendar book · write vanta · datadog submit",
    ],
  },
] as const;

/**
 * The command surface in one picture: three lanes of verbs, and one door on the write lane.
 *
 * Carries no COUNT, deliberately. A number drawn into an SVG cannot correct itself, and `/build/verbs`
 * renders the real one off `slopweaver catalog --json` two screens below this figure — a diagram stating a
 * frozen total beside a live table is the drift this whole site is built to avoid. The verbs drawn are
 * examples of each lane; the table is the list.
 *
 * The claim it is drawn for is rule 3 — every provider read and write goes through a `slopweaver` verb,
 * never `curl`, never raw `gh`, never a hand-driven browser. The lanes are what make that a shape rather
 * than a slogan: a read reaches a provider read-only — under a read-only grant, or where the provider mints
 * no read-only token a client limited to reads (GET, plus an allowlisted search POST such as Datadog's) — and a write reaches one only through the door: every verb in the
 * bottom lane, and `browser act` and `browser scroll` in the drive lane (`doorRouted`, `src/cli/manifests/browser.ts`). A verb
 * that only changes this machine's own state (`secrets set`) is in none of the lanes.
 *
 * @returns the figure, captioned
 */
export function VerbSurface(): ReactElement {
  return (
    <Figure
      arrow="sw-verbs-arrow"
      viewBox="0 0 1060 420"
      label="Every slopweaver verb that reads, drives a browser or writes outward falls into one of three lanes: read, which answers from what is on this machine (the corpus, the store, the atlases, the registers and the verb catalog) or reads a provider live, read-only, under a read-only grant or a client limited to reads (GET, and an allowlisted search POST), with no door; drive, which takes a read-before-write session in the owner's own Chrome, its act and scroll on a page passing the same admit door; and write, which every outbound act passes through the admit door, where it is judged, journalled and refusable. A verb that only changes this machine's own state, such as secrets set, sits outside the three. Providers include Slack, GitHub, Linear, Notion, Google mail, calendar and drive, Vanta, Datadog and Fathom."
      caption={
        <>
          The verb surface, by what a verb can change. How many there are is deliberately absent here and{" "}
          <a href="/docs/build/verbs">read live on the verb page</a> instead, because a count drawn into an SVG cannot
          correct itself. Everything in the bottom lane passes one door.
        </>
      }
    >
      <Kicker x={128} y={42} text="THE CALLER" />
      <Kicker x={560} y={42} text="THE VERBS, BY LANE" />
      <Kicker x={924} y={42} text="THE WORLD" />

      <Solid
        x={24}
        y={158}
        w={208}
        h={96}
        fill={STAGE.mid}
        title="A visible session"
        detail="Claude Code or Codex"
        foot="never a daemon (rule 2)"
      />

      {LANES.map((lane) => (
        <Panel
          key={lane.kicker}
          x={296}
          y={lane.y}
          w={452}
          h={lane.h}
          title={lane.kicker}
          detail={lane.detail}
          foot={lane.verbs}
        />
      ))}

      <Arrow from={232} to={288} y={206} arrow="sw-verbs-arrow" />

      <Solid
        x={812}
        y={76}
        w={224}
        h={82}
        fill={STAGE.mid}
        title="Provider APIs"
        detail="Fathom · Drive · the atlases"
        foot="where a live read goes"
      />
      <Arrow from={748} to={808} y={117} arrow="sw-verbs-arrow" />

      <Solid
        x={812}
        y={250}
        w={224}
        h={86}
        fill={STAGE.out}
        title="Every doored provider"
        detail="Slack · GitHub · Linear · …"
        foot="where a write lands"
      />
      <rect x="772" y="240" width="24" height="106" rx="6" fill={STAGE.in} />
      <text
        x="784"
        y="302"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="700"
        fill="#ffffff"
        transform="rotate(-90 784 302)"
      >
        THE DOOR
      </text>
      <Arrow from={748} to={768} y={293} arrow="sw-verbs-arrow" />
      <Arrow from={800} to={808} y={293} arrow="sw-verbs-arrow" />

      {/*
       * Two lines, hand-broken: SVG text does not wrap, so a single string this long runs past the
       * 1060-unit viewBox and is CLIPPED. `Panel` takes an ARRAY for its detail and foot slots for the same
       * reason; a bare `<text>` like this one is re-measured rather than trusted, by the sweep in
       * `docs/docs-site/verification.md` § "Nothing here wraps, so nothing here warns".
       */}
      <text x={40} y={372} fontSize={11.5} fill="var(--sw-figure-muted)">
        `classifyRawCommand` refuses a `curl` or a raw `gh` that would route around a verb;
      </text>
      <text x={40} y={390} fontSize={11.5} fill="var(--sw-figure-muted)">
        `browserSurface.ts` refuses a doored provider reached by hand.
      </text>
    </Figure>
  );
}
