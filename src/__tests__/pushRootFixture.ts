/**
 * A state home with no push-root register, for the push suites that exercise something other than the
 * old-history guard.
 *
 * Every push now takes a REQUIRED `home` (`src/admit/githubPush.ts` § `pushAndVerify`), because an optional one
 * would be a way past the guard. A suite whose subject is the lease, the readback or the working-tree check
 * passes this path: nothing exists under it, so the register reads as absent, the guard asks Git nothing and
 * the injected Git fakes see exactly the calls they did before. Nothing is ever written there — the guard only
 * reads — so the ambient-home sandbox is never at stake.
 */
export const HOME_WITHOUT_PUSH_ROOTS = "/nonexistent/slopweaver-home-without-push-roots";
