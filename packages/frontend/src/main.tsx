import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import { initFirestore } from './services/firestore';

// Initialize dataset.theme from localStorage immediately
const initialTheme = localStorage.getItem('agentwatch-theme') || 'dark';
document.documentElement.dataset.theme = initialTheme;

// Initialize Firebase + Firestore (gracefully no-ops if env vars are missing)
void initFirestore();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
