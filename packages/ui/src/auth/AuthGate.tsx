import type { ReactNode } from 'react';
import { t } from '@bg-tax/core';
import { useAuth } from './AuthProvider';
import { LoginScreen } from './LoginScreen';
import { AccessRequired } from './AccessRequired';

const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

export function AuthGate({ children }: { children: ReactNode }) {
    const { user, loading, allowed, error, retryAccess } = useAuth();

    if (isTauri) return <>{children}</>;

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
                {t('auth.loading')}
            </div>
        );
    }

    if (!user) {
        return <LoginScreen />;
    }

    if (error) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--bg)' }}>
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
                    <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{t('auth.connectionError.title')}</h1>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                        {error}
                    </p>
                    <button
                        onClick={retryAccess}
                        style={{
                            padding: '0.75rem 1.5rem',
                            fontSize: '1rem',
                            backgroundColor: 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: 500,
                            marginBottom: '1rem',
                        }}
                    >
                        {t('auth.connectionError.retry')}
                    </button>
                </div>
            </div>
        );
    }

    if (!allowed) {
        return <AccessRequired />;
    }

    return <>{children}</>;
}
