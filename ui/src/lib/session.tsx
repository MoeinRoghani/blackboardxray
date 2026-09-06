/**
 * Who is signed in, and what they can reach.
 *
 * One query answers the three questions the interface has to settle before it
 * knows which screen to draw: has this install been set up, is anybody signed
 * in, and what may they read. Everything else waits on it, because drawing the
 * boards for half a second and then replacing them with a sign in page is
 * worse than drawing nothing for half a second.
 *
 * A 401 from anywhere is the session having ended. Rather than every screen
 * handling it, the query is invalidated and the shell draws the sign in page,
 * which is the same path as arriving signed out.
 */
import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, get, post } from "./http";

export interface Person {
  id: string;
  email: string;
  name: string;
}

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  role: string;
  projects: number;
}

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  role: string;
  runs: number;
  retention_days: number | null;
  org_id: string;
  org_slug: string;
  org_name: string;
}

export interface AuthState {
  needs_setup: boolean;
  allow_signup: boolean;
  user: Person | null;
}

export interface Me {
  user: Person;
  organizations: OrganizationRow[];
  projects: ProjectRow[];
}

interface Session {
  state: AuthState | undefined;
  me: Me | undefined;
  loading: boolean;
  error: ApiError | null;
  /** Re-reads who is signed in and what they can reach. */
  refresh: () => Promise<void>;
}

const Held = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();

  const state = useQuery<AuthState, ApiError>({
    queryKey: ["auth-state"],
    queryFn: () => get<AuthState>("/auth/state"),
    retry: false,
    staleTime: 5000,
  });

  const signedIn = Boolean(state.data?.user);
  const me = useQuery<Me, ApiError>({
    queryKey: ["me"],
    queryFn: () => get<Me>("/me"),
    // Asking who I am before knowing whether anybody is signed in guarantees
    // one 401 on every cold load.
    enabled: signedIn,
    retry: false,
  });

  // Refetch rather than invalidate, because the caller is about to redirect on
  // the answer and an invalidation returns before the answer arrives.
  const refresh = useCallback(async () => {
    await client.refetchQueries({ queryKey: ["auth-state"] });
    await client.refetchQueries({ queryKey: ["me"] });
  }, [client]);

  const value = useMemo<Session>(
    () => ({
      state: state.data,
      me: me.data,
      loading: state.isLoading || (signedIn && me.isLoading),
      error: state.error ?? null,
      refresh,
    }),
    [state.data, state.isLoading, state.error, me.data, me.isLoading, signedIn, refresh]
  );

  return <Held.Provider value={value}>{children}</Held.Provider>;
}

export function useSession(): Session {
  const found = useContext(Held);
  if (found === null) {
    throw new Error("useSession is only usable inside a SessionProvider");
  }
  return found;
}

export function useSignIn() {
  const { refresh } = useSession();
  const client = useQueryClient();
  return useMutation<{ user: Person }, ApiError, { email: string; password: string }>({
    mutationFn: (body) => post("/auth/signin", body),
    onSuccess: async () => {
      forgetTheLastPerson(client);
      await refresh();
    },
  });
}

/**
 * Drops what was cached for whoever was signed in before, and nothing else.
 *
 * Clearing the whole cache also removes the observer the provider is
 * subscribed to, and the refetch that followed then had nothing mounted to
 * refetch: the interface signed in successfully and sat on the sign in page.
 */
function forgetTheLastPerson(client: ReturnType<typeof useQueryClient>): void {
  client.removeQueries({
    predicate: (query) => {
      const first = query.queryKey[0];
      return first !== "auth-state" && first !== "me";
    },
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => post<void>("/auth/signout"),
    onSuccess: () => {
      client.clear();
      // A full reload rather than a route change: it is the one gesture that
      // is certain to leave nothing of the last person on the screen.
      window.location.assign("/");
    },
  });
}

export interface SetupResult {
  user: Person;
  organization: { id: string; slug: string; name: string };
  project: { id: string; slug: string; name: string };
  api_key: string;
}

export function useSetup() {
  const { refresh } = useSession();
  return useMutation<
    SetupResult,
    ApiError,
    {
      email: string;
      password: string;
      name: string;
      organization: string;
      project: string;
    }
  >({
    mutationFn: (body) => post("/setup", body),
    onSuccess: refresh,
  });
}

export interface Invitation {
  email: string;
  role: string;
  organization: string;
  has_account: boolean;
}

export function useInvitation(token: string): UseQueryResult<Invitation, ApiError> {
  return useQuery<Invitation, ApiError>({
    queryKey: ["invite", token],
    queryFn: () => get<Invitation>(`/auth/invite/${encodeURIComponent(token)}`),
    retry: false,
    enabled: Boolean(token),
  });
}

export function useJoin() {
  const { refresh } = useSession();
  const client = useQueryClient();
  return useMutation<
    { user: Person },
    ApiError,
    { token: string; password: string; name: string }
  >({
    mutationFn: (body) => post("/auth/join", body),
    onSuccess: async () => {
      forgetTheLastPerson(client);
      await refresh();
    },
  });
}
