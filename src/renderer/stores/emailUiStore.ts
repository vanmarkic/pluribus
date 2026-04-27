/**
 * UI-only email state.
 *
 * Holds selection/focus/filter — the things the user controls. Server data
 * (the email list, bodies, attachments) lives in `emailsApi` (RTK Query).
 *
 * Mutating server data here would defeat the cache; mutate via mutation
 * hooks and let RTK Query's `onQueryStarted` patch the cache.
 */

import { create } from 'zustand';

export type EmailFilter = {
  folderPath?: string;
  unreadOnly?: boolean;
  starredOnly?: boolean;
  searchQuery?: string;
};

type EmailUiStore = {
  selectedId: number | null;
  focusedId: number | null;
  selectedIds: Set<number>;
  filter: EmailFilter;

  // Selection + focus
  selectEmail: (id: number | null) => void;
  setFocusedId: (id: number | null) => void;

  // Multiselect
  toggleSelect: (id: number) => void;
  selectRange: (orderedIds: number[], fromId: number, toId: number) => void;
  selectAll: (ids: number[]) => void;
  clearSelection: () => void;

  // Filter
  setFilter: (patch: Partial<EmailFilter>) => void;
  clearFilter: () => void;
  search: (query: string) => void;
};

export const useEmailUiStore = create<EmailUiStore>((set) => ({
  selectedId: null,
  focusedId: null,
  selectedIds: new Set<number>(),
  filter: {},

  selectEmail: (id) => set({ selectedId: id }),
  setFocusedId: (focusedId) => set({ focusedId }),

  toggleSelect: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),

  selectRange: (orderedIds, fromId, toId) => {
    const fromIndex = orderedIds.indexOf(fromId);
    const toIndex = orderedIds.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1) return;
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = orderedIds.slice(start, end + 1);
    set((state) => ({
      selectedIds: new Set([...state.selectedIds, ...rangeIds]),
    }));
  },

  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set() }),

  setFilter: (patch) =>
    set((state) => ({
      filter: { ...state.filter, ...patch },
      selectedId: null,
      selectedIds: new Set(),
    })),

  clearFilter: () =>
    set({
      filter: {},
      selectedId: null,
      selectedIds: new Set(),
    }),

  search: (query) =>
    set({
      filter: { searchQuery: query },
      selectedId: null,
      selectedIds: new Set(),
    }),
}));
