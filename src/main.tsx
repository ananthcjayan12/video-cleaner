import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installNarrationPreview } from './narration-preview';
import './styles.css';
import './narration-preview.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

installNarrationPreview();
