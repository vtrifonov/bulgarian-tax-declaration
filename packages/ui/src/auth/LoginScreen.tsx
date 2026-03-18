import { t } from '@bg-tax/core';
import { signInWithPopup } from 'firebase/auth';
import { useState } from 'react';

import {
    auth,
    googleProvider,
} from '../firebase-config';

export function LoginScreen() {
    const [loginError, setLoginError] = useState<string | null>(null);

    const handleLogin = async () => {
        setLoginError(null);
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (err) {
            console.error('Login failed:', err);
            setLoginError(err instanceof Error ? err.message : t('auth.loginFailed'));
        }
    };

    return (
        <div
            style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                backgroundColor: 'var(--bg)',
            }}
        >
            <div
                style={{
                    textAlign: 'center',
                    padding: '3rem',
                    backgroundColor: 'var(--card-bg)',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                    maxWidth: '400px',
                    width: '100%',
                }}
            >
                <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                    {t('auth.title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.9rem' }}>
                    {t('auth.subtitle')}
                </p>

                {loginError && (
                    <div
                        style={{
                            padding: '0.75rem',
                            marginBottom: '1rem',
                            backgroundColor: 'var(--error-bg)',
                            border: '1px solid var(--error-border)',
                            borderRadius: '6px',
                            fontSize: '0.85rem',
                            color: 'var(--text)',
                        }}
                    >
                        {loginError}
                    </div>
                )}
                <button
                    onClick={handleLogin}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem 1.5rem',
                        fontSize: '1rem',
                        backgroundColor: 'white',
                        color: '#333',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 500,
                    }}
                >
                    <svg width='20' height='20' viewBox='0 0 48 48'>
                        <path
                            fill='#EA4335'
                            d='M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'
                        />
                        <path
                            fill='#4285F4'
                            d='M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'
                        />
                        <path
                            fill='#FBBC05'
                            d='M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'
                        />
                        <path
                            fill='#34A853'
                            d='M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'
                        />
                    </svg>
                    {t('auth.signInGoogle')}
                </button>
            </div>
        </div>
    );
}
