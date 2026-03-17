import { useState } from 'react';
import {
    getLanguage,
    setLanguage as setCoreLanguage,
    t,
} from '@bg-tax/core';
import { useAuth } from './AuthProvider';

const OWNER_EMAIL = 'v.trifonov@gmail.com';
const OWNER_NAME = 'Vasil Trifonov';

export function AccessRequired() {
    const { user, signOut } = useAuth();
    const [lang, setLang] = useState(getLanguage());
    const [copied, setCopied] = useState(false);
    const [showFallback, setShowFallback] = useState(false);

    const toggleLanguage = () => {
        const newLang = lang === 'en' ? 'bg' : 'en';
        setCoreLanguage(newLang);
        setLang(newLang);
        try {
            localStorage.setItem('bg-tax-language', newLang);
        } catch {}
    };

    const handleCopyEmail = () => {
        const text = `To: ${OWNER_EMAIL}\nSubject: Access Request - BG Tax Declaration\n\nHi, I would like to request access.\n\nName: ${user?.displayName ?? ''}\nEmail: ${
            user?.email ?? ''
        }`;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
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
                    position: 'relative',
                }}
            >
                <button
                    onClick={toggleLanguage}
                    style={{
                        position: 'absolute',
                        top: '0.75rem',
                        right: '0.75rem',
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.75rem',
                        backgroundColor: 'transparent',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                    }}
                >
                    {lang === 'bg' ? 'EN' : 'BG'}
                </button>

                <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                    {t('auth.accessRequired.title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                    {t('auth.accessRequired.description')}
                </p>

                {!showFallback && (
                    <div style={{ marginBottom: '1.5rem' }}>
                        <a
                            href={`mailto:${OWNER_EMAIL}?subject=${encodeURIComponent('Access Request - BG Tax Declaration')}&body=${
                                encodeURIComponent(`Hi, I would like to request access.\n\nName: ${user?.displayName ?? ''}\nEmail: ${user?.email ?? ''}`)
                            }`}
                            onClick={() => {
                                setTimeout(() => {
                                    if (document.hasFocus()) setShowFallback(true);
                                }, 1000);
                            }}
                            style={{
                                display: 'inline-block',
                                padding: '0.75rem 1.5rem',
                                fontSize: '1rem',
                                backgroundColor: 'var(--accent)',
                                color: 'white',
                                borderRadius: '6px',
                                fontWeight: 500,
                                textDecoration: 'none',
                            }}
                        >
                            {t('auth.accessRequired.requestButton')}
                        </a>
                    </div>
                )}

                {showFallback && (
                    <>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                            {t('auth.accessRequired.contactPrefix')} <strong>{OWNER_NAME}</strong> {t('auth.accessRequired.contactSuffix')}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                            <code
                                style={{
                                    fontSize: '0.95rem',
                                    color: 'var(--accent)',
                                    padding: '0.4rem 0.75rem',
                                    backgroundColor: 'var(--bg)',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border)',
                                }}
                            >
                                {OWNER_EMAIL}
                            </code>
                            <button
                                onClick={handleCopyEmail}
                                style={{
                                    padding: '0.4rem 0.75rem',
                                    fontSize: '0.8rem',
                                    backgroundColor: copied ? 'var(--accent)' : 'var(--border)',
                                    color: copied ? 'white' : 'var(--text)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                }}
                            >
                                {copied ? '✓' : t('auth.accessRequired.copyButton')}
                            </button>
                        </div>
                    </>
                )}

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
