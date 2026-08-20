import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import BrollDisplayTemplates from './BrollDisplayTemplates';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <BrollDisplayTemplates />
  </React.StrictMode>,
);
