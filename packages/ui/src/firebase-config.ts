import { initializeApp } from 'firebase/app';
import {
    getAuth,
    GoogleAuthProvider,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: 'AIzaSyCAtxcNfbraeiMG2ZunIxW91rc9nlvf6I8',
    authDomain: 'bg-tax-declaration.firebaseapp.com',
    projectId: 'bg-tax-declaration',
    storageBucket: 'bg-tax-declaration.firebasestorage.app',
    messagingSenderId: '569683738581',
    appId: '1:569683738581:web:447f25819f7700d717475c',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
