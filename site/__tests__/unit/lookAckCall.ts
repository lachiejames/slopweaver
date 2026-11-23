/*
 * The four plans the owner showed the voice on one call, in the shape the call file recorded them: every transcript
 * segment's time, turn and finality, each Codex turn starting (a hand-off — `turn/started` follows
 * `delegation.created` within 0.1s, as measured in `site/lib/talkPlanCall.ts`'s `PLAN_CALL_LIMITS`) and each
 * `read_screen`, as measured; times are UTC. The words are synthetic, written so each look ask lands in the segment
 * where the call's did and nothing else in them reads as an ask.
 * Repro of the times, over `$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl`, with `<start-iso>` and `<end-iso>` the
 * window's bounds:
 *
 *   jq -c --arg from <start-iso> --arg to <end-iso> 'select(.atIso >= $from and .atIso <= $to) | if .kind=="segment" then
 *     {at:.atIso[11:23], who, id, final, text} elif (.kind=="tool" and .name=="codex" and (.detail|test("started")))
 *     then {at:.atIso[11:23], handoff:true} elif (.kind=="tool" and .name=="read_screen") then {at:.atIso[11:23],
 *     look:true} else empty end'
 */

/** One line of the call file, cut to what the acknowledgement reads. */
export type CallRecord =
  | { readonly at: string; readonly handoff: true }
  | { readonly at: string; readonly look: true }
  | {
      readonly at: string;
      readonly who: "owner" | "voice";
      readonly id: string;
      readonly final: boolean;
      readonly text: string;
    };

const T1 = "turn_owner_1";
const T2 = "turn_owner_2";
const T3 = "turn_owner_3";
const T4 = "turn_owner_4";
const V1 = "turn_voice_1";
const V2 = "turn_voice_2";
const V3 = "turn_voice_3";
const V4 = "turn_voice_4";

/* The first turn as it grew: its look ask ("take some screenshots") arrives in its third segment. */
const T1_A = " Okay, right. So, um";
const T1_B = `${T1_A}, we're gonna take some screenshots now. Here is`;
const T1_C = `${T1_B} the first of my plans, the work one. You can`;
const T1_D = `${T1_C} see it's at twenty two percent used. And it also`;
const T1_E = `${T1_D} Uh, has no reset left. There is some spare`;
const T1_F = `${T1_E} credit, but I won't touch that. Uh, all right, take a screenshot of`;
const P1 = `${T1_F} this one. I'm going to go through every plan, one at a time, and get you to`;
const P1_END = `${P1} look at each one, and we'll work out what to do with them`;

/* The second turn: no ask at all until "Look at my screen", which lands after its hand-off. */
const T2_A = " Um, now I'll show you the second one";
const T2_B = `${T2_A}. So the first one was the work plan`;
const T2_C = `${T2_B} and this one is the team plan, at nineteen`;
const T2_D = `${T2_C} percent used this week. Um`;
const P2 = `${T2_D}, and it has one full reset available`;

/* The third turn: "Take a look at this" lands before its hand-off. */
const T3_A = " This one is my personal plan, which";
const T3_B = `${T3_A} has a lot more usage Uh, and`;
const P3 = `${T3_A} has a lot more usage Uh, and no resets left.`;

/* The fourth turn: a long stretch about the plan, then "look at my screen" well before its hand-off. */
const T4_A = " Next one is my side project plan";
const T4_B = `${T4_A}, the spare account. It's actually maxed out`;
const T4_C = `${T4_B} Fable this week at a hundred percent. Uh yeah, that one`;
const T4_D = `${T4_C} caused trouble the other day, when uh the supervisor`;
const T4_E = `${T4_D} did not hand off in time, [laugh] to another`;
const T4_F = `${T4_E} plan that had plenty of Fable left, so that was a bug I hope is now`;
const P4 = `${T4_F} fixed`;
const P4_A = `${P4} And j-just then I`;
const P4_B = `${P4_A} expected you to look at my screen and say, okay, having a look`;
const P4_C = `${P4_B}, but you didn't. So, I'm not sure if there's a bug where`;
const P4_D = `${P4_C} you can't tell my turn has ended, or you can't tell I'm`;
const P4_E = `${P4_D} expecting you to look at my screen, Um`;
const P4_END = `${P4_E}, when my words stop`;

/* What the voice said back, each growing the same way. */
const V1_END = " Captured. This plan shows twenty-two percent below. Next?";
const V2_A =
  " Captured too: the team plan is nineteen percent used this week, and has a free full reset expiring October";
const V2_END = `${V2_A} twenty third. Show me the next one?`;
const V3_A = " Captured: the personal plan is sixty-one percent weekly, seventy-one percent Fable.";
const V3_B = `${V3_A} Reset is Friday at 6 p.m., and Claude warns this one could`;
const V3_END = `${V3_B} run out Thursday night. Next one?`;
const V4_A = " You’d finished, and yeah, I should've asked for the screen already. Thanks for the nudge.";
const V4_END = `${V4_A} Captured now: fifty-seven percent weekly, hundred percent Fable; resets Friday, 6 a.m., no extra reset available. Show me the fifth plan?`;

/** The call's records in the order they were written. */
export const FOUR_PLAN_CALL: readonly CallRecord[] = [
  { at: "02:09:54.574", final: false, id: T1, text: " Okay", who: "owner" },
  { at: "02:09:57.528", final: false, id: T1, text: T1_A, who: "owner" },
  { at: "02:10:01.526", final: false, id: T1, text: T1_B, who: "owner" },
  { at: "02:10:05.526", final: false, id: T1, text: T1_C, who: "owner" },
  { at: "02:10:09.526", final: false, id: T1, text: T1_D, who: "owner" },
  { at: "02:10:13.530", final: false, id: T1, text: T1_E, who: "owner" },
  { at: "02:10:17.504", final: false, id: T1, text: T1_F, who: "owner" },
  { at: "02:10:21.543", final: false, id: T1, text: P1, who: "owner" },
  { at: "02:10:24.998", handoff: true },
  { at: "02:10:25.528", final: false, id: T1, text: P1_END, who: "owner" },
  { at: "02:10:31.853", look: true },
  { at: "02:10:37.625", final: true, id: T1, text: P1_END, who: "owner" },
  { at: "02:10:37.626", final: false, id: V1, text: " Captured", who: "voice" },
  { at: "02:10:41.540", final: false, id: V1, text: V1_END, who: "voice" },
  { at: "02:10:42.564", final: true, id: V1, text: V1_END, who: "voice" },
  { at: "02:10:45.514", final: false, id: T2, text: " Um", who: "owner" },
  { at: "02:10:49.526", final: false, id: T2, text: T2_A, who: "owner" },
  { at: "02:10:53.533", final: false, id: T2, text: T2_B, who: "owner" },
  { at: "02:10:57.511", final: false, id: T2, text: T2_C, who: "owner" },
  { at: "02:11:01.527", final: false, id: T2, text: T2_D, who: "owner" },
  { at: "02:11:05.525", final: false, id: T2, text: P2, who: "owner" },
  { at: "02:11:25.263", handoff: true },
  { at: "02:11:25.523", final: false, id: T2, text: `${P2} Look at my screen`, who: "owner" },
  { at: "02:11:31.858", look: true },
  { at: "02:11:36.219", final: true, id: T2, text: `${P2} Look at my screen`, who: "owner" },
  { at: "02:11:36.220", final: false, id: V2, text: " Captured", who: "voice" },
  { at: "02:11:37.525", final: false, id: V2, text: " Captured too: the team", who: "voice" },
  { at: "02:11:41.537", final: false, id: V2, text: V2_A, who: "voice" },
  { at: "02:11:45.450", final: true, id: V2, text: V2_END, who: "voice" },
  { at: "02:11:46.748", final: false, id: T3, text: " This", who: "owner" },
  { at: "02:11:49.524", final: false, id: T3, text: T3_A, who: "owner" },
  { at: "02:11:53.555", final: false, id: T3, text: T3_B, who: "owner" },
  { at: "02:11:57.524", final: false, id: T3, text: `${P3} Take a look at this`, who: "owner" },
  { at: "02:12:25.525", final: false, id: T3, text: `${P3} Take a look at this Screenshot, please`, who: "owner" },
  { at: "02:12:26.486", handoff: true },
  { at: "02:12:33.460", look: true },
  { at: "02:12:37.659", final: true, id: T3, text: `${P3} Take a look at this Screenshot, please`, who: "owner" },
  { at: "02:12:37.660", final: false, id: V3, text: " Captured", who: "voice" },
  { at: "02:12:41.525", final: false, id: V3, text: V3_A, who: "voice" },
  { at: "02:12:45.539", final: false, id: V3, text: V3_B, who: "voice" },
  { at: "02:12:49.129", final: true, id: V3, text: V3_END, who: "voice" },
  { at: "02:12:50.810", final: false, id: T4, text: " Next", who: "owner" },
  { at: "02:12:53.545", final: false, id: T4, text: T4_A, who: "owner" },
  { at: "02:12:57.527", final: false, id: T4, text: T4_B, who: "owner" },
  { at: "02:13:01.530", final: false, id: T4, text: T4_C, who: "owner" },
  { at: "02:13:05.526", final: false, id: T4, text: T4_D, who: "owner" },
  { at: "02:13:09.535", final: false, id: T4, text: T4_E, who: "owner" },
  { at: "02:13:13.530", final: false, id: T4, text: T4_F, who: "owner" },
  { at: "02:13:17.532", final: false, id: T4, text: P4, who: "owner" },
  { at: "02:13:25.535", final: false, id: T4, text: P4_A, who: "owner" },
  { at: "02:13:29.523", final: false, id: T4, text: P4_B, who: "owner" },
  { at: "02:13:33.543", final: false, id: T4, text: P4_C, who: "owner" },
  { at: "02:13:37.531", final: false, id: T4, text: P4_D, who: "owner" },
  { at: "02:13:41.526", final: false, id: T4, text: P4_E, who: "owner" },
  { at: "02:13:44.893", handoff: true },
  { at: "02:13:45.531", final: false, id: T4, text: P4_END, who: "owner" },
  { at: "02:13:50.426", look: true },
  { at: "02:14:01.452", final: true, id: T4, text: P4_END, who: "owner" },
  { at: "02:14:01.453", final: false, id: V4, text: " You’d", who: "voice" },
  { at: "02:14:05.534", final: false, id: V4, text: V4_A, who: "voice" },
  { at: "02:14:15.693", final: true, id: V4, text: V4_END, who: "voice" },
];
