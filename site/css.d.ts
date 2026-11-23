// TypeScript 6 checks side-effect imports, and a stylesheet has no declaration to find. Next.js handles
// the import itself; this file is only what stops `next build`'s typecheck refusing it.
declare module "*.css";
