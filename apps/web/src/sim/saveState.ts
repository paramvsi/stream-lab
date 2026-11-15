import { create } from 'zustand';

/** Header "Saved" indicator (SIM-20, board W09f). */
export const useSaveState = create<{ state: 'saved' | 'saving' | 'error' }>(() => ({ state: 'saved' }));
