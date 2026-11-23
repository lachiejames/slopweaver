"use client";

/**
 * A card's picture: the page, a numbered red box over each thing to read or grab, and the numbers' labels listed
 * beneath — so the card reads as a checklist the picture points into, and the owner hardly leaves the UI.
 *
 * Two cards carry one: a hand step's provider page, and an ask's screenshot, which the owner sees on the queue card
 * with a red box around the thing to read. Both are stored and boxed by the same model
 * (`src/hand/shot.ts`), so one figure draws both and only its words differ.
 *
 * The SVG shares the picture's natural size as its `viewBox` and is stretched over the `<img>` exactly, so the boxes
 * scale with the picture at any card width; the stroke does not scale, so a box reads the same on a 2x capture as on
 * a 1x one. Every coordinate is `../../lib/handShot.ts`'s.
 */
import { type ReactElement, useState } from "react";

import { type HandShotView, shotOverlay } from "../../lib/handShot";
import { StaleMark } from "./StaleMark";

/** Which card the picture is on, which is all its words depend on. */
export type ShotSubject = "step" | "ask";

/** The figure's words, per card. */
const WORDS: Readonly<Record<ShotSubject, { alt: string; label: string; unread: string }>> = {
  ask: {
    alt: "the screenshot this ask is about",
    label: "what to look at in the screenshot",
    unread: "the screenshot this ask carries",
  },
  step: {
    alt: "the provider page this step happens on",
    label: "where to look on the provider page",
    unread: "the picture this step was posted with",
  },
};

/**
 * The card's picture with its boxes, or a staleness mark whose hover says it could not be read, with the boxes'
 * labels still listed — never a broken image, and never a sentence in the picture's place.
 *
 * @param shot the picture, as `hand list --json` or `handover list --json` published it
 * @param subject the card it is on, which picks its words
 * @returns the figure
 */
export function HandShot({ shot, subject }: { shot: HandShotView; subject: ShotSubject }): ReactElement {
  const [failed, setFailed] = useState(false);
  const overlay = shotOverlay({ shot });
  const words = WORDS[subject];
  // A picture with no boxes is the page `hand post` opened before the note went up — the page itself, nothing to grab.
  const boxed = overlay.boxes.length > 0;
  if (failed) {
    const carried = overlay.boxes.map((box) => `${String(box.number)} ${box.label}`).join(", ");
    return (
      <p className="m-0 inline-flex items-center gap-[0.35rem] text-[0.8rem] text-muted-foreground">
        <StaleMark facts={[{ subject: words.unread, why: "the store did not serve it" }]} />
        {boxed ? carried : null}
      </p>
    );
  }
  return (
    <figure className="m-0 flex flex-col gap-2" aria-label={words.label}>
      <div className="relative w-full overflow-hidden rounded-lg border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element -- served locally from the shot store; nothing to optimise */}
        <img
          src={overlay.src}
          width={shot.width}
          height={shot.height}
          alt={words.alt}
          className="block h-auto w-full"
          onError={() => {
            setFailed(true);
          }}
        />
        <svg
          viewBox={overlay.viewBox}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full text-danger"
          aria-hidden="true"
        >
          {overlay.boxes.map((box) => (
            <g key={box.number}>
              <rect
                {...box.rect}
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                rx={4}
              />
              <rect x={box.tag.x} y={box.tag.y} width={box.tag.size} height={box.tag.size} fill="currentColor" rx={3} />
              <text
                x={box.tag.x + box.tag.size / 2}
                y={box.tag.y + box.tag.size / 2}
                fill="var(--background)"
                fontSize={box.tag.size * 0.7}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {box.number}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {boxed ? (
        <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[0.85rem]">
          {overlay.boxes.map((box) => (
            <li key={box.number} className="flex items-baseline gap-2">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-danger text-[0.72rem] font-bold text-background">
                {box.number}
              </span>
              <span>{box.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-[0.8rem] text-muted-foreground">
          the page as the post opened it, before the note went up
        </p>
      )}
    </figure>
  );
}
