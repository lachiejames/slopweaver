import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/**
 * What an outbound form does with a key nobody declared.
 *
 * Deliberately a different claim from `./DoorDecision.tsx`, which draws the door refusing an over-cap
 * shape. The claim here is the one `src/outbound/strictForm.ts` exists for and nothing else on this site
 * makes: a plain `z.object` DROPS an unknown key silently, so the only safe reading is that a key nobody
 * declared is a key somebody MEANT — and the refusal therefore names the nearest valid field rather than
 * stopping at "unrecognized key".
 *
 * The refusal text in the right-hand panel is the real one, reproduced by passing `language` to a Linear
 * code block whose field is `lang`.
 *
 * @returns the figure, captioned
 */
export function FormRefusal(): ReactElement {
  return (
    <Figure
      arrow="sw-form-arrow"
      viewBox="0 0 1060 340"
      label="A composer fills an outbound form and includes one key the schema does not declare. Every form in the tree is declared with strictForm, so the key is refused rather than dropped, and the refusal names the nearest valid field and then lists every field the form declares. A plain Zod object would have dropped the key silently and posted a message whose substance was missing."
      caption={
        <>
          A plain <code>z.object</code> drops an unknown key. Nothing at parse time can tell an invention from a typo,
          so the only safe reading is that a key nobody declared is a key somebody <strong>meant</strong>, and the
          message that comes back says where the content goes, because the schema is the only thing that knows.
        </>
      }
    >
      <Kicker x={174} y={44} text="WHAT A COMPOSER FILLED IN" />
      <Kicker x={530} y={44} text="src/outbound/strictForm.ts" />
      <Kicker x={886} y={44} text="WHAT COMES BACK" />

      <Panel
        x={24}
        y={64}
        w={300}
        h={196}
        title="One code block of a Linear ticket"
        detail={["kind      declared by the form", "text      declared by the form", "language  nobody declared it"]}
        foot={["the field is lang, and language", "is the same field in another schema"]}
      />

      <Arrow from={324} to={404} y={162} arrow="sw-form-arrow" label="parses" />

      <Solid
        x={412}
        y={112}
        w={236}
        h={100}
        fill={STAGE.mid}
        title="strictForm(shape)"
        detail="every outbound form, no exceptions"
        foot="a raw z.object here fails the ratchet"
      />

      <Arrow from={648} to={728} y={162} arrow="sw-form-arrow" label="refuses" />

      <Panel
        x={736}
        y={64}
        w={300}
        h={196}
        title="The refusal, in the form's own words"
        detail={['unknown field "language":', "REFUSED, not ignored.", 'Did you mean "lang"?']}
        foot={["this form's fields are:", "kind, lang, text"]}
      />

      <text x={24} y={288} fontSize={11.5} fill="var(--sw-figure-muted)">
        A ported payload once reached the digest form carrying four field names from the system it came from. The form
      </text>
      <text x={24} y={306} fontSize={11.5} fill="var(--sw-figure-muted)">
        was a plain object, so all four were dropped: it validated, it previewed clean, it exited 0, and it posted a
      </text>
      <text x={24} y={324} fontSize={11.5} fill="var(--sw-figure-muted)">
        card whose entire substance was missing.
      </text>
    </Figure>
  );
}
