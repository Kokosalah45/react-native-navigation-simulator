import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSimulator } from './components/AppSimulator';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppSimulator />
  </StrictMode>,
);
