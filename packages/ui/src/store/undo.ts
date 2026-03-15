import type {
    StateCreator,
    StoreMutatorIdentifier,
} from 'zustand';
import { create } from 'zustand';

export interface UndoDiff {
    path: string; // e.g., "holdings.3.quantity"
    oldValue: unknown;
    newValue: unknown;
}

export interface UndoState {
    undoStack: UndoDiff[][]; // Each entry is a batch of diffs from one action
    redoStack: UndoDiff[][];
    undo: () => void;
    redo: () => void;
    pushDiffs: (diffs: UndoDiff[]) => void;
    clearHistory: () => void;
}

const MAX_UNDO = 100;

export const createUndoMiddleware = <T extends object>(
    initialState: T,
): [
    StateCreator<T & UndoState, [['zustand/persist', never]]>,
    (diffs: UndoDiff[]) => void,
    () => void,
    () => void,
] => {
    let stateSnapshot = JSON.parse(JSON.stringify(initialState));
    let undoStack: UndoDiff[][] = [];
    let redoStack: UndoDiff[][] = [];

    const pushDiffs = (diffs: UndoDiff[]) => {
        if (diffs.length > 0) {
            undoStack.push(diffs);
            redoStack = [];
            if (undoStack.length > MAX_UNDO) {
                undoStack.shift();
            }
        }
    };

    const undo = () => {
        if (undoStack.length === 0) return;
        // This is a simplified version; real implementation would need
        // to be integrated with the Zustand store directly
    };

    const redo = () => {
        if (redoStack.length === 0) return;
        // This is a simplified version
    };

    const clearHistory = () => {
        undoStack = [];
        redoStack = [];
    };

    const stateCreator: StateCreator<T & UndoState> = (set) => ({
        ...initialState,
        undoStack,
        redoStack,
        undo,
        redo,
        pushDiffs,
        clearHistory,
    });

    return [stateCreator as any, pushDiffs, undo, redo];
};
