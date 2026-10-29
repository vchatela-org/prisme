import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Notice } from './states.js';

describe('Notice', () => {
  it('says what is missing, why, and where to go, as a status', () => {
    const html = renderToStaticMarkup(
      <Notice
        title="Health is starved and has nothing queued."
        description="Anything queued there would be lifted."
        action={<a href="/create/initiative?area=health">Create an initiative here</a>}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Health is starved and has nothing queued.');
    expect(html).toContain('Anything queued there would be lifted.');
    expect(html).toContain('href="/create/initiative?area=health"');
  });

  it('renders no action slot without an action', () => {
    const html = renderToStaticMarkup(<Notice title="A title" description="A description" />);
    expect(html).not.toContain('self-start');
  });
});
