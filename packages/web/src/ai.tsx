import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProviderId } from "@flowcommit/shared";
import { api, type Provider } from "./api.ts";

type AiState = {
  providers: Provider[];
  /** The AI tool used for writing help, or null when none is installed. */
  active: Provider | null;
  choose: (id: ProviderId) => void;
  refresh: () => void;
};

const AiContext = createContext<AiState>({ providers: [], active: null, choose: () => {}, refresh: () => {} });

const STORAGE_KEY = "flowcommit.ai.provider";

function readChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AiProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [choice, setChoice] = useState<string | null>(readChoice);

  const refresh = useCallback(() => {
    api
      .aiProviders()
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  useEffect(refresh, [refresh]);

  const choose = useCallback((id: ProviderId) => {
    setChoice(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Remembering the choice is only a convenience.
    }
  }, []);

  const active = useMemo(() => {
    const available = providers.filter((p) => p.available);
    return available.find((p) => p.id === choice) ?? available[0] ?? null;
  }, [providers, choice]);

  return <AiContext.Provider value={{ providers, active, choose, refresh }}>{children}</AiContext.Provider>;
}

export const useAi = () => useContext(AiContext);
