import { composeStories, setProjectAnnotations } from '@storybook/react';
import { render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import preview from '../.storybook/preview';

setProjectAnnotations(preview);

// Every story in ui + errors (TESTING.md: axe on every story, 0 violations).
const modules = {
  ...import.meta.glob('./*.stories.tsx', { eager: true }),
  ...import.meta.glob('../../errors/src/*.stories.tsx', { eager: true }),
} as Record<string, Parameters<typeof composeStories>[0]>;

const cases = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(composeStories(mod)).map(
    ([name, Story]) => [`${file.split('/').pop()} · ${name}`, Story as ComponentType] as const,
  ),
);

describe('A11Y · stories', () => {
  it('found the stories', () => expect(cases.length).toBeGreaterThan(25));

  it.each(cases)('%s has 0 axe violations', async (_name, Story) => {
    render(<Story />);
    await waitFor(() => expect(document.body.childElementCount).toBeGreaterThan(0));
    const res = await axe.run(document.body, {
      // ponytail: jsdom has no layout, so contrast can't be measured here. Tokens are AA by design; Playwright+axe
      // in a real browser checks contrast (M11 visual/a11y gate).
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
  });
});
