import { createRoot } from 'react-dom/client';
import { SuperDocUIProvider } from 'superdoc/ui/react';
import App from './App';
import 'superdoc/style.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <SuperDocUIProvider>
    <App />
  </SuperDocUIProvider>,
);
