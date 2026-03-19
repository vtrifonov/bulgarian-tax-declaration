/**
 * Encrypt/decrypt SPB-8 personal data (EGN, name, phone, email) at rest in localStorage.
 * Uses AES-GCM with a key derived from a hardcoded passphrase via PBKDF2.
 *
 * NOTE: This is obfuscation, not cryptographic security. The passphrase is hardcoded
 * in the source code, so an attacker with access to both localStorage and the source
 * can decrypt the data. The purpose is to prevent personal data from being stored
 * as readable plaintext — not to protect against a determined attacker with full
 * machine access. For a local-only desktop/browser app, this is an acceptable trade-off.
 */

const PASSPHRASE = 'bg-tax-declaration-personal-data-2024';
const SALT_STORAGE = 'bg-tax-personal-salt';
const ALGORITHM = 'AES-GCM';
const PBKDF2_ITERATIONS = 100_000;

/** Convert Uint8Array to base64 string */
function toBase64(bytes: Uint8Array): string {
    let binary = '';

    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}

/** Convert base64 string to Uint8Array */
function fromBase64(b64: string): Uint8Array {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** Get or create the salt (random, stored in localStorage) */
function getSalt(): Uint8Array {
    const stored = localStorage.getItem(SALT_STORAGE);

    if (stored) {
        return fromBase64(stored);
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));

    localStorage.setItem(SALT_STORAGE, toBase64(salt));

    return salt;
}

/** Derive AES-256 key from the hardcoded passphrase + salt */
async function deriveKey(): Promise<CryptoKey> {
    const salt = getSalt();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(PASSPHRASE),
        'PBKDF2',
        false,
        ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: ALGORITHM, length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

/** Encrypt a plaintext string → base64 string (iv + ciphertext) */
export async function encryptPersonalData(plaintext: string): Promise<string> {
    const key = await deriveKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
        key,
        encoded,
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);

    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return toBase64(combined);
}

/** Decrypt a base64 string (iv + ciphertext) → plaintext string */
export async function decryptPersonalData(encrypted: string): Promise<string> {
    const key = await deriveKey();
    const combined = fromBase64(encrypted);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
        key,
        ciphertext.buffer as ArrayBuffer,
    );

    return new TextDecoder().decode(decrypted);
}

/** Check if a value looks like encrypted data (base64 string, not a JSON object) */
export function isEncrypted(value: unknown): value is string {
    return typeof value === 'string' && value.length > 20 && !value.startsWith('{');
}
