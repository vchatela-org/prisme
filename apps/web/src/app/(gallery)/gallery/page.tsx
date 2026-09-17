import { Gallery } from './gallery';

export const metadata = {
  title: 'Component gallery · prisme',
  description: 'Every component in @prisme/ui, rendered with fixture data.',
};

/**
 * The component gallery.
 *
 * It is not a nicety. Wave 4 runs four UI workstreams in parallel in this
 * application, and this page is how each of them finds out that a table, a
 * chart frame or a status chip already exists before writing a second one.
 * Anything added to `packages/ui` belongs here the same day.
 *
 * Its own route group, `(gallery)`, so it never collides with a surface's
 * route group when those arrive.
 */
export default function GalleryPage() {
  return <Gallery />;
}
