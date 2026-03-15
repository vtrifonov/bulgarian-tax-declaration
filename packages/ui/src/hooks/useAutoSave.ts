import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/app-state';

const SAVE_FILENAME = 'bg-tax-autosave.json';
const DEBOUNCE_MS = 2000;

/**
 * Auto-save hook that debounces state changes and saves to localStorage
 * In a real Tauri app, this would use the fs plugin to save to disk.
 */
export function useAutoSave() {
  const state = useAppStore();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        const json = JSON.stringify(state, null, 2);
        localStorage.setItem(SAVE_FILENAME, json);
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
  }, [state]);
}

/**
 * Load auto-saved state on app startup
 * In a real Tauri app, this would use the fs plugin to read from disk.
 */
export async function loadAutoSave(): Promise<Record<string, unknown> | null> {
  try {
    const json = localStorage.getItem(SAVE_FILENAME);
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null; // No auto-save file or parse error — start fresh
  }
}
