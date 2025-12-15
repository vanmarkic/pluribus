/**
 * Renderer Entry Point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './hooks/useTheme';
import './styles/app.css';

// Inject mock API for browser testing (when not in Electron)
import { injectMockApiIfNeeded } from './mockApi';
injectMockApiIfNeeded();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
