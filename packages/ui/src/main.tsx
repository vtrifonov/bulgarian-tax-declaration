import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setLanguage } from '@bg-tax/core';
import './index.css';
import App from './App.tsx';

// Restore language before first render so auth screens use the correct language
try {
    const saved = localStorage.getItem('bg-tax-language');
    if (saved === 'en' || saved === 'bg') setLanguage(saved);
} catch {}

createRoot(document.getElementById('root')!).render(
    (
        <StrictMode>
            <App />
        </StrictMode>
    ),
);
