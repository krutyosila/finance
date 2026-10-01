import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-ext-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-ext-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-ext-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-ext-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/manrope/latin-ext-800.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-ext-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-ext-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-ext-600.css';
import './styles.css';
import { App } from './App';
import { AuthProvider } from './auth';
import { PwaProvider, registerProductionWorker } from './pwa';
import { initializeTheme } from './theme';

initializeTheme();
registerProductionWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PwaProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </PwaProvider>
  </React.StrictMode>,
);
