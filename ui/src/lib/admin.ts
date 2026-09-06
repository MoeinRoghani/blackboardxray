/**
 * Running the place, from the interface rather than from a shell.
 *
 * Keys, members, invitations, retention. Two of these hand back a secret
 * exactly once, at the moment it is made, and the screens that call them are
 * built around that fact: the value is never fetched again, so it is either
 * copied now or made again.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, del, get, patch, post, put } from "./http";

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  disabled_at: string | null;
  created_by: string | null;
}

export interface MemberRow {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  last_seen_at: string | null;
}

export interface InviteRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  created_by: string | null;
}

export interface SessionRow {
  id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string;
  address: string;
  is_current: boolean;
}

// Keys

export function useKeys(project: string): UseQueryResult<{ keys: KeyRow[] }, ApiError> {
  return useQuery<{ keys: KeyRow[] }, ApiError>({
    queryKey: ["keys", project],
    queryFn: () => get(`/projects/${project}/keys`),
    enabled: Boolean(project),
    retry: false,
  });
}

export function useCreateKey(project: string) {
  const client = useQueryClient();
  return useMutation<{ token: string; name: string }, ApiError, { name: string }>({
    mutationFn: (body) => post(`/projects/${project}/keys`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["keys", project] }),
  });
}

export function useRevokeKey(project: string) {
  const client = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (key) => del(`/projects/${project}/keys/${key}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["keys", project] }),
  });
}

// A project

export function useConfigureProject(project: string) {
  const client = useQueryClient();
  return useMutation<
    unknown,
    ApiError,
    { name?: string; retention_days: number | null }
  >({
    mutationFn: (body) => patch(`/projects/${project}`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useDeleteProject() {
  const client = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (project) => del(`/projects/${project}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useCreateProject(org: string) {
  const client = useQueryClient();
  return useMutation<{ id: string }, ApiError, { name: string }>({
    mutationFn: (body) => post(`/orgs/${org}/projects`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
}

// An organization

export function useCreateOrganization() {
  const client = useQueryClient();
  return useMutation<{ id: string }, ApiError, { name: string }>({
    mutationFn: (body) => post("/orgs", body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useRenameOrganization(org: string) {
  const client = useQueryClient();
  return useMutation<unknown, ApiError, { name: string }>({
    mutationFn: (body) => patch(`/orgs/${org}`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useDeleteOrganization() {
  const client = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (org) => del(`/orgs/${org}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
}

// Members and invitations

export function useMembers(
  org: string
): UseQueryResult<{ members: MemberRow[] }, ApiError> {
  return useQuery<{ members: MemberRow[] }, ApiError>({
    queryKey: ["members", org],
    queryFn: () => get(`/orgs/${org}/members`),
    enabled: Boolean(org),
    retry: false,
  });
}

export function useSetMemberRole(org: string) {
  const client = useQueryClient();
  return useMutation<unknown, ApiError, { member: string; role: string }>({
    mutationFn: ({ member, role }) =>
      patch(`/orgs/${org}/members/${member}`, { role }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["members", org] }),
  });
}

export function useRemoveMember(org: string) {
  const client = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (member) => del(`/orgs/${org}/members/${member}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["members", org] }),
  });
}

export function useInvites(
  org: string
): UseQueryResult<{ invites: InviteRow[] }, ApiError> {
  return useQuery<{ invites: InviteRow[] }, ApiError>({
    queryKey: ["invites", org],
    queryFn: () => get(`/orgs/${org}/invites`),
    enabled: Boolean(org),
    retry: false,
  });
}

export function useCreateInvite(org: string) {
  const client = useQueryClient();
  return useMutation<
    { token: string; email: string; role: string },
    ApiError,
    { email: string; role: string }
  >({
    mutationFn: (body) => post(`/orgs/${org}/invites`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["invites", org] }),
  });
}

export function useRevokeInvite(org: string) {
  const client = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (invite) => del(`/orgs/${org}/invites/${invite}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["invites", org] }),
  });
}

export interface ProjectMemberRow {
  id: string;
  email: string;
  name: string;
  org_role: string;
  /** Null where the organization's role applies unchanged. */
  project_role: string | null;
}

export function useProjectMembers(
  project: string
): UseQueryResult<{ members: ProjectMemberRow[] }, ApiError> {
  return useQuery<{ members: ProjectMemberRow[] }, ApiError>({
    queryKey: ["project-members", project],
    queryFn: () => get(`/projects/${project}/members`),
    enabled: Boolean(project),
    retry: false,
  });
}

export function useSetProjectRole(project: string) {
  const client = useQueryClient();
  return useMutation<unknown, ApiError, { member: string; role: string }>({
    mutationFn: ({ member, role }) =>
      put(`/projects/${project}/members/${member}`, { role }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["project-members", project] });
      client.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// The account

export function useSessions(): UseQueryResult<{ sessions: SessionRow[] }, ApiError> {
  return useQuery<{ sessions: SessionRow[] }, ApiError>({
    queryKey: ["sessions"],
    queryFn: () => get("/me/sessions"),
    retry: false,
  });
}

export function useEndOtherSessions() {
  const client = useQueryClient();
  return useMutation<{ ended: number }, ApiError, void>({
    mutationFn: () => del("/me/sessions"),
    onSuccess: () => client.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useChangePassword() {
  return useMutation<
    void,
    ApiError,
    { current: string; replacement: string }
  >({
    mutationFn: (body) => post<void>("/me/password", body),
  });
}
