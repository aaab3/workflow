/**
 * Cached module metadata from the server API.
 */

import { create } from "zustand";
import { api, type ModuleMeta } from "../api/client";

interface ModulesState {
  modules: ModuleMeta[];
  byId: Record<string, ModuleMeta>;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  get: (id: string) => ModuleMeta | undefined;
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  modules: [],
  byId: {},
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const modules = await api.modules.list();
      const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
      set({ modules, byId, loaded: true, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  get: (id) => get().byId[id],
}));
