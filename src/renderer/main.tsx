import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import './index.css';
import './workspace-design-system.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('The renderer mount point (#root) is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
