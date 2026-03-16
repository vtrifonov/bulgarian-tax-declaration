import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { LoginScreen } from './LoginScreen';

const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

export function AuthGate({ children }: { children: ReactNode }) {
    const { user, loading, allowed } = useAuth();

    // Desktop app — skip auth entirely
    if (isTauri) return <>{children}</>;

    if (loading) {
        return (
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100vh',
                    color: 'var(--text-secondary)',
                    fontSize: '1.1rem',
                }}
            >
                Loading...
            </div>
        );
    }

    if (!user || allowed === null) {
        return <LoginScreen />;
    }

    if (!allowed) {
        return <LoginScreen denied />;
    }

    return <>{children}</>;
}
