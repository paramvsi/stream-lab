import { create } from 'zustand';

/** Header "Saved" indicator (SIM-20, board W09f). */
export const useSaveState = create<{
  state: 'saved' | 'saving' | 'error';
  /** A shared link's view (W18): nothing is saved there, whatever another pipeline's autosave reports. */
  shared: boolean;
}>(() => ({ state: 'saved', shared: false }));
