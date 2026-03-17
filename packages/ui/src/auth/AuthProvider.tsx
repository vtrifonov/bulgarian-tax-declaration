import {
    createContext,
    useContext,
    useEffect,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import {
    doc,
    getDoc,
} from 'firebase/firestore';
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
                setError('No email associated with this account.');
                setAllowed(null);
                return;
            }
            const docRef = doc(db, 'allowedUsers', firebaseUser.email);
            const docSnap = await getDoc(docRef);
            setAllowed(docSnap.exists());
        } catch (err) {
            console.error('Access check failed:', err);
            setError('Could not verify access. Check your connection.');
            setAllowed(null);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);
            if (firebaseUser) {
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
            checkAccess(user).then(() => setLoading(false));
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, allowed, error, signOut: handleSignOut, retryAccess }}>
            {children}
        </AuthContext.Provider>
    );
}
