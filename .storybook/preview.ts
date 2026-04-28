import type { Preview } from '@storybook/react-vite';
import React from 'react';
import { Provider } from 'react-redux';
import { store } from '../src/renderer/stores/store';
import { mockMailApi } from './mockMailApi';

import '../src/renderer/styles/app.css';

// Stories run in a browser, not Electron — install a default mock so any
// component that touches `window.mailApi` keeps working. Individual stories
// can override per-story via parameters.mailApi.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'mailApi', {
    value: mockMailApi,
    writable: true,
    configurable: true,
  });
}

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: '#ffffff' },
        { name: 'dark', value: '#0f172a' },
      ],
    },
  },
  decorators: [
    (Story) =>
      React.createElement(
        Provider,
        { store },
        React.createElement('div', { className: 'p-4' }, React.createElement(Story)),
      ),
  ],
};

export default preview;
