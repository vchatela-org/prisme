// Declarations for the asset modules the bundler handles and the compiler does
// not.
//
// Next.js declares these in `next/types/global.d.ts`, but that file reaches the
// program only through `next-env.d.ts`, which Next generates and this repository
// gitignores (`.gitignore`: `apps/web/next-env.d.ts`). A fresh checkout therefore
// has no declaration for `import '../styles/globals.css'` at all.
//
// That went unnoticed while `noUncheckedSideEffectImports` defaulted to `false`,
// which is what TypeScript 5.9 did — an unresolved side-effect import was simply
// not looked at. TypeScript 6.0 defaults it to `true`, and CI's `typecheck`
// never runs `next build` first, so the one side-effect import in this app has
// to resolve like any other. Declaring the asset module is the fix; switching
// the check back off would only hide the next misspelled import with it.

declare module '*.css';
declare module '*.sass';
declare module '*.scss';
