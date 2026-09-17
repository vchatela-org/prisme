/**
 * Tailwind v4 is a PostCSS plugin and needs nothing else — no autoprefixer
 * (it emits modern CSS and Next's browser targets cover the prefixing), and
 * no configuration file: the theme lives in `packages/ui/src/tokens`, reaches
 * CSS through the generated `@theme inline` block, and is imported by
 * `src/styles/globals.css`.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
