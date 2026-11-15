import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx', '../../errors/src/**/*.stories.tsx'],
  viteFinal: (c) => ({ ...c, plugins: [...(c.plugins ?? []), tailwindcss()] }),
};
export default config;
