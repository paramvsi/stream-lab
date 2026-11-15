import type { Preview } from '@storybook/react-vite';
import '../src/fonts.css';
import '../src/styles.css';
import { ToastProvider, TooltipProvider } from '../src';

const preview: Preview = {
  parameters: { layout: 'padded', viewport: { defaultViewport: 'desktop' } },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <ToastProvider>
          <Story />
        </ToastProvider>
      </TooltipProvider>
    ),
  ],
};
export default preview;
