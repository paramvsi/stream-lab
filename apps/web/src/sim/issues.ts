import type { Issue } from '@sl/graph';
import { create } from 'zustand';

/**
 * Validation results live outside the graph store so node cards subscribe per node
 * (SIMULATOR.md: never push derived/run data into `nodes`, it re-renders the whole graph).
 */
export const useIssues = create<{ all: Issue[]; byNode: Record<string, Issue[]> }>(() => ({
  all: [],
  byNode: {},
}));

export function setIssues(all: Issue[]) {
  const byNode: Record<string, Issue[]> = {};
  for (const i of all) if (i.nodeId) (byNode[i.nodeId] ??= []).push(i);
  useIssues.setState({ all, byNode });
}
