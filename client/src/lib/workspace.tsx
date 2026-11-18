import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";

export type WorkspaceRole = "owner" | "manager" | "creator" | "viewer";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  kind: "personal" | "company";
  language: string;
  timezone: string;
  is_skale_club: boolean;
  role: WorkspaceRole;
};

type WorkspacesResponse = {
  workspaces: WorkspaceSummary[];
  schemaReady: boolean;
  isPlatformAdmin?: boolean;
  canCreateCompany?: boolean;
};

type WorkspaceState = {
  activeWorkspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  schemaReady: boolean;
  /** Skale Club platform staff: a separate permission from any workspace role. */
  isPlatformAdmin: boolean;
  canCreateCompany: boolean;
  selectWorkspace: (workspaceId: string) => void;
};

const ACTIVE_WORKSPACE_KEY = "xareable_active_workspace_id";
const WorkspaceContext = createContext<WorkspaceState | null>(null);

async function fetchWorkspaces(): Promise<WorkspacesResponse> {
  const response = await fetch("/api/workspaces", {
    credentials: "include",
    headers: await getAuthHeaders(),
  });
  if (!response.ok) throw new Error("Could not load workspaces.");
  return response.json() as Promise<WorkspacesResponse>;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<WorkspacesResponse>({
    queryKey: ["/api/workspaces"],
    queryFn: fetchWorkspaces,
    enabled: Boolean(user),
    staleTime: 30_000,
  });
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const workspaces = data?.workspaces || [];

  // Attach this person to any invite sent to their confirmed email, then refresh.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiRequest("POST", "/api/workspaces/accept-invites");
        const body = (await response.json()) as { accepted?: number };
        if (!cancelled && (body.accepted ?? 0) > 0) {
          queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
        }
      } catch {
        // Invites are best-effort; a failure must never block sign-in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setActiveWorkspaceId(null);
      return;
    }
    const saved = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const selected = workspaces.some((workspace) => workspace.id === saved)
      ? saved
      : workspaces[0]?.id || null;
    setActiveWorkspaceId(selected);
    if (selected) window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, selected);
    else window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  }, [user, workspaces]);

  const value = useMemo<WorkspaceState>(() => {
    const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null;
    return {
      activeWorkspace,
      workspaces,
      loading: isLoading,
      schemaReady: data?.schemaReady !== false,
      isPlatformAdmin: Boolean(data?.isPlatformAdmin),
      canCreateCompany: Boolean(data?.canCreateCompany),
      selectWorkspace:(workspaceId: string) => {
        if (!workspaces.some((workspace) => workspace.id === workspaceId)) return;
        setActiveWorkspaceId(workspaceId);
        window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
      },
    };
  }, [activeWorkspaceId, data?.schemaReady, data?.isPlatformAdmin, data?.canCreateCompany, isLoading, workspaces]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
