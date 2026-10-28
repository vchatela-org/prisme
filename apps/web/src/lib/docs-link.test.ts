import { describe, expect, it } from 'vitest';
import { docsUrl, HOW_IT_WORKS } from './docs-link';

describe('a link to prisme’s own documents (S13)', () => {
  it('names the tag a published image runs', () => {
    expect(docsUrl(HOW_IT_WORKS, 'v0.18.0')).toBe(
      'https://github.com/vchatela-org/prisme/blob/v0.18.0/docs/19-how-it-works.md',
    );
  });

  it('falls back to main for a development build', () => {
    expect(docsUrl(HOW_IT_WORKS, 'dev')).toContain('/blob/main/docs/');
    expect(docsUrl(HOW_IT_WORKS, 'v1.2')).toContain('/blob/main/');
  });
});
