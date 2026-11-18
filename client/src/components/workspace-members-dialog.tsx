import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Trash2 } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@shared/schema";

type MembersResponse = {
  members: { user_id: string; role: WorkspaceRole; email: string | null }[];
  invites: { id: string; email: string; role: WorkspaceRole; expires_at: string }[];
};

type Props = {
  workspaceId: string | null;
  workspaceName: string;
  onClose: () => void;
};

/** Owner (and platform staff) view of one company's people: members, invites, roles. */
export function WorkspaceMembersDialog({ workspaceId, workspaceName, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("creator");
  const queryKey = [`/api/workspaces/${workspaceId}/members`];

  const { data, isLoading, error } = useQuery<MembersResponse>({
    queryKey,
    enabled: Boolean(workspaceId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/workspaces"] });
  };
  const onError = (err: Error) => toast({ title: t("Something went wrong"), description: err.message, variant: "destructive" });

  const invite = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/workspaces/${workspaceId}/invites`, { email, role });
      return response.json() as Promise<{ status: "added" | "invited" }>;
    },
    onSuccess: (result) => {
      setEmail("");
      refresh();
      toast({ title: result.status === "added" ? t("Member added") : t("Invite saved — it applies when they sign in") });
    },
    onError,
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, nextRole }: { userId: string; nextRole: WorkspaceRole }) =>
      apiRequest("PATCH", `/api/workspaces/${workspaceId}/members/${userId}`, { role: nextRole }),
    onSuccess: refresh,
    onError,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/workspaces/${workspaceId}/members/${userId}`),
    onSuccess: refresh,
    onError,
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => apiRequest("DELETE", `/api/workspaces/${workspaceId}/invites/${inviteId}`),
    onSuccess: refresh,
    onError,
  });

  const roleSelect = (value: WorkspaceRole, onChange: (next: WorkspaceRole) => void, testId: string) => (
    <Select value={value} onValueChange={(next) => onChange(next as WorkspaceRole)}>
      <SelectTrigger className="w-32 capitalize" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WORKSPACE_ROLES.map((option) => (
          <SelectItem key={option} value={option} className="capitalize">{t(option)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={Boolean(workspaceId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl" data-testid="workspace-members-dialog">
        <DialogHeader>
          <DialogTitle>{t("People in")} {workspaceName}</DialogTitle>
          <DialogDescription>
            {t("Owners manage who can see and work in this company. People you invite by email join the first time they sign in.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="invite-email">{t("Email")}</Label>
            <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
          </div>
          {roleSelect(role, setRole, "select-invite-role")}
          <Button onClick={() => invite.mutate()} disabled={!email.includes("@") || invite.isPending} data-testid="button-invite-member">
            {t("Add")}
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <div className="space-y-4">
            <ul className="divide-y rounded-md border" data-testid="workspace-member-list">
              {(data?.members || []).map((member) => (
                <li key={member.user_id} className="flex items-center gap-2 p-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{member.email || member.user_id}</span>
                  {roleSelect(member.role, (nextRole) => changeRole.mutate({ userId: member.user_id, nextRole }), `select-role-${member.user_id}`)}
                  <Button size="icon" variant="ghost" aria-label={t("Remove member")} onClick={() => removeMember.mutate(member.user_id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>

            {(data?.invites?.length ?? 0) > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">{t("Waiting to sign in")}</p>
                <ul className="divide-y rounded-md border">
                  {data!.invites.map((pending) => (
                    <li key={pending.id} className="flex items-center gap-2 p-3">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{pending.email}</span>
                      <span className="rounded-full bg-muted px-2 py-1 text-xs capitalize">{t(pending.role)}</span>
                      <Button size="icon" variant="ghost" aria-label={t("Cancel invite")} onClick={() => cancelInvite.mutate(pending.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
