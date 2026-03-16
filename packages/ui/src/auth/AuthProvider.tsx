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
    allowed: boolean | null; // null = not checked yet
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
    user: null,
    loading: true,
    allowed: null,
    signOut: async () => {},
});

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState<boolean | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);
            if (firebaseUser?.email) {
                const docRef = doc(db, 'allowedUsers', firebaseUser.email);
                const docSnap = await getDoc(docRef);
                setAllowed(docSnap.exists());
            } else {
                setAllowed(null);
            }
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    const handleSignOut = async () => {
        await auth.signOut();
        setAllowed(null);
    };

    return (
        <AuthContext.Provider value={{ user, loading, allowed, signOut: handleSignOut }}>
            {children}
        </AuthContext.Provider>
    );
}
