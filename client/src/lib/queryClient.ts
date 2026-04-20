import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    let parsedErrorMessage: string | null = null;

    if (contentType.includes("application/json")) {
      try {
        const payload = JSON.parse(text) as { message?: string; error?: string };
        const code = typeof payload?.error === "string" ? payload.error.trim() : "";
        const message = typeof payload?.message === "string" ? payload.message.trim() : "";

        if (code && message) {
          parsedErrorMessage = `${res.status}: ${code} - ${message}`;
        } else if (code) {
          parsedErrorMessage = `${res.status}: ${code}`;
        } else if (message) {
          parsedErrorMessage = `${res.status}: ${message}`;
        }
      } catch {
        // fallback to plain text below when JSON parse fails
      }
    }

    if (parsedErrorMessage) {
      throw new Error(parsedErrorMessage);
    }

    throw new Error(`${res.status}: ${text}`);
  }
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const sb = supabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  return headers;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const headers: Record<string, string> = { ...authHeaders };
  if (data) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const authHeaders = await getAuthHeaders();
    const url = queryKey[0];
    if (typeof url !== "string") {
      throw new Error("Query key must start with a request URL string");
    }

    const res = await fetch(url, {
      credentials: "include",
      headers: authHeaders,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
