import { t } from '@bg-tax/core';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import {
    doc,
    getDoc,
} from 'firebase/firestore';
import {
    createContext,
    useContext,
    useEffect,
    useState,
} from 'react';
import type { ReactNode } from 'react';

import {
    auth,
    db,
} from '../firebase-config';

interface AuthState {
    user: User | null;
    loading: boolean;
    allowed: boolean | null;
    error: string | null;
    signOut: () => Promise<void>;
    retryAccess: () => void;
}

const AuthContext = createContext<AuthState>({
    user: null,
    loading: true,
    allowed: null,
    error: null,
    signOut: async () => {},
    retryAccess: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components -- hook and provider are co-located by convention
export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);

    const checkAccess = async (firebaseUser: User) => {
        try {
            setError(null);

            if (!firebaseUser.email) {
                setError(t('auth.error.noEmail'));
                setAllowed(null);

                return;
            }
            const docRef = doc(db, 'allowedUsers', firebaseUser.email);
            const docSnap = await getDoc(docRef);

            setAllowed(docSnap.exists());
        } catch (err) {
            console.error('Access check failed:', err);
            setError(t('auth.error.connectionFailed'));
            setAllowed(null);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser) {
                setLoading(true);
                setAllowed(null);
                await checkAccess(firebaseUser);
            } else {
                setAllowed(null);
                setError(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const handleSignOut = async () => {
        await auth.signOut();
        setAllowed(null);
        setError(null);
    };

    const retryAccess = () => {
        if (user) {
            setLoading(true);
            setAllowed(null);
            void checkAccess(user).then(() => setLoading(false));
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, allowed, error, signOut: handleSignOut, retryAccess }}>
            {children}
        </AuthContext.Provider>
    );
}
