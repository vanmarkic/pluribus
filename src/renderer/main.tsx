/**
 * Renderer Entry Point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import App from './App';
import { ThemeProvider } from './hooks/useTheme';
import { store } from './stores/store';
import './styles/app.css';

// Inject mock API for browser testing (when not in Electron)
import { injectMockApiIfNeeded } from './mockApi';
injectMockApiIfNeeded();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </Provider>
  </React.StrictMode>
);
