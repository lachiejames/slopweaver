import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/** The refusal hue. Three of this figure's four outcomes are refusals, and they are what it is drawn for. */
const REFUSED = "#9f1239";

const EXITS = [
  {
    code: "exit 1",
    detail: "refuseUnanswerableAtlas runs before any selection is made",
    fill: REFUSED,
    title: "The atlas cannot be read back at all",
    y: 70,
  },
  {
    code: "exit 2",
    detail: "so a typo never manufactures a successful empty read",
    fill: REFUSED,
    title: "Unknown platform, kind or surface",
    y: 136,
  },
  {
    code: "exit 3",
    detail: "ANY selected kind, not every: --accept-unproven-empty is the registered hatch",
    fill: REFUSED,
    title: "Nothing matched, and the zero is unproven",
    y: 202,
  },
  {
    code: "exit 0",
    detail: "carrying its claim boundary: coverage, freshness, gaps, permission block",
    fill: STAGE.out,
    title: "A selection of STORED records",
    y: 268,
  },
] as const;

/**
 * Why `atlas read` refuses a zero it cannot prove, and why the four outcomes are ordered by precedence.
 *
 * MEASURED: a kind with an `unavailable` cell and no successful sync answered `0 matching
 * entities` at exit 0, indistinguishable from an organisation that holds none. Precedence rather than
 * preference is the non-obvious half — an atlas that cannot be read back at all is refused before any
 * selection happens, so a `--surface` typo against an unpublished atlas reports the unpublished generation
 * rather than the typo.
 *
 * @returns the figure, captioned
 */
export function AtlasReadExits(): ReactElement {
  return (
    <Figure
      arrow="sw-exits-arrow"
      viewBox="0 0 1060 380"
      label="atlas read has four outcomes in precedence order. Exit 1 refuses an atlas that cannot be read back at all, before any selection is made. Exit 2 refuses an unknown platform, kind or surface. Exit 3 refuses when nothing matched and any selected kind's evidence cannot establish that a zero was ever measured. Exit 0 returns a selection of stored records carrying its claim boundary."
      caption={
        <>
          A zero reported without its claim boundary is how an atlas comes to sound confident about a platform it has
          never reached. <strong>Any</strong> rather than every on exit 3 is deliberate: one unmeasured kind in the
          selection makes the zero over the selection unproven, however well the kinds beside it were measured.
        </>
      }
    >
      <Kicker x={530} y={44} text="IN PRECEDENCE ORDER, NOT PREFERENCE ORDER" />
      <Solid
        x={24}
        y={70}
        w={232}
        h={256}
        fill={STAGE.mid}
        title="atlas read"
        detail="one verb, every atlas"
        foot="the same guarded door doctor uses"
      />
      {EXITS.map((exit) => (
        <g key={exit.code}>
          <Arrow from={256} to={318} y={exit.y + 29} arrow="sw-exits-arrow" />
          <Panel x={326} y={exit.y} w={560} h={58} title={exit.title} detail={exit.detail} />
          <rect x="902" y={exit.y} width="134" height="58" rx="9" fill={exit.fill} />
          <text x="969" y={exit.y + 36} textAnchor="middle" fontSize="16" fontWeight="700" fill="#ffffff">
            {exit.code}
          </text>
        </g>
      ))}
      <text x="24" y="348" fontSize="11.5" fill="var(--sw-figure-muted)">
        A HISTORICAL zero is ANSWERED rather than refused: an acquisition older than the window really did measure it,
      </text>
      <text x="24" y="366" fontSize="11.5" fill="var(--sw-figure-muted)">
        and what it needs is its date attached. The --json document is version 2, and its refusal arm has no entities.
      </text>
    </Figure>
  );
}
