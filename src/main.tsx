import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/Toast';
import './index.css';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: (n, e: any) => n < 2 && ![401, 403, 404].includes(e?.status), refetchOnWindowFocus: true } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AuthProvider><App /></AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
