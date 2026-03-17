import { t } from '@bg-tax/core';
import { useAuth } from './AuthProvider';

const OWNER_EMAIL = 'v.trifonov@gmail.com';
const OWNER_NAME = 'Vasil Trifonov';

export function AccessRequired() {
    const { user, signOut } = useAuth();

    const subject = encodeURIComponent('Access Request — BG Tax Declaration');
    const body = encodeURIComponent(
        `Hi, I'd like to request access to the Bulgarian Tax Declaration app.\n\nName: ${user?.displayName ?? 'N/A'}\nEmail: ${user?.email ?? 'N/A'}`,
    );
    const mailtoHref = `mailto:${OWNER_EMAIL}?subject=${subject}&body=${body}`;

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
                    {t('auth.accessRequired.title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                    {t('auth.accessRequired.description')}
                </p>

                <div style={{ marginBottom: '1.5rem' }}>
                    <a
                        href={mailtoHref}
                        style={{
                            display: 'inline-block',
                            padding: '0.75rem 1.5rem',
                            fontSize: '1rem',
                            backgroundColor: 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: 500,
                            textDecoration: 'none',
                        }}
                    >
                        {t('auth.accessRequired.requestButton')}
                    </a>
                </div>

                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
                    {t('auth.accessRequired.contactPrefix')} <strong>{OWNER_NAME}</strong> {t('auth.accessRequired.contactSuffix')}{' '}
                    <a href={`mailto:${OWNER_EMAIL}`} style={{ color: 'var(--accent)' }}>
                        {OWNER_EMAIL}
                    </a>
                </p>

                <button
                    onClick={signOut}
                    style={{
                        padding: '0.6rem 1.5rem',
                        fontSize: '0.9rem',
                        backgroundColor: 'var(--border)',
                        color: 'var(--text)',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                    }}
                >
                    {t('button.signOut')}
                </button>
            </div>
        </div>
    );
}
