import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, Plus, ShieldCheck, Users } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/workspace";
import { WorkspaceMembersDialog } from "@/components/workspace-members-dialog";
import { canManageMembers } from "@shared/workspace-permissions";

type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  kind: "personal" | "company";
  language: string;
  timezone: string;
  is_skale_club: boolean;
  role: "owner" | "manager" | "creator" | "viewer";
};

type WorkspacesResponse = {
  workspaces: WorkspaceSummary[];
  schemaReady: boolean;
};

type PlatformCompany = Omit<WorkspaceSummary, "role"> & { member_count: number; owners: string[] };

export default function WorkspacesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { activeWorkspace, selectWorkspace, isPlatformAdmin, canCreateCompany } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [managing, setManaging] = useState<{ id: string; name: string } | null>(null);
  const { data, isLoading } = useQuery<WorkspacesResponse>({ queryKey: ["/api/workspaces"] });
  const { data: platform } = useQuery<{ workspaces: PlatformCompany[]; schemaReady: boolean }>({
    queryKey: ["/api/admin/workspaces"],
    enabled: isPlatformAdmin,
  });

  const createWorkspace = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/workspaces", {
        name,
        ...(slug.trim() ? { slug } : {}),
        ...(ownerEmail.trim() ? { owner_email: ownerEmail } : {}),
      });
      return response.json() as Promise<{ workspace: WorkspaceSummary; ownerStatus: string }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workspaces"] });
      setCreateOpen(false);
      setName("");
      setSlug("");
      setOwnerEmail("");
      toast({
        title: t("Company created"),
        description: result.ownerStatus === "invited" ? t("The owner joins the first time they sign in.") : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: t("Could not create company"), description: error.message, variant: "destructive" });
    },
  });

  const schemaReady = data?.schemaReady !== false;
  const workspaces = data?.workspaces || [];

  return (
    <div className="flex-1 overflow-auto" data-testid="workspaces-page">
      <div className="mx-auto w-full max-w-6xl p-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-violet-400">{isPlatformAdmin ? t("Platform") : t("Workspaces")}</p>
            <h1 className="text-2xl font-bold tracking-tight">{t("Workspaces")}</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground">
              {t("Keep each company’s people, brand, planning, and publishing in its own secure workspace.")}
            </p>
          </div>
          {canCreateCompany && (
            <Button onClick={() => setCreateOpen(true)} disabled={!schemaReady} className="gap-2" data-testid="button-create-workspace">
              <Plus className="h-4 w-4" />
              {t("New company")}
            </Button>
          )}
        </div>

        {!schemaReady && (
          <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex gap-3 p-5 text-sm text-muted-foreground">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <p>{t("Workspace setup is waiting for the platform migration. No workspace data has been created yet.")}</p>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Loading workspaces…")}</p>
        ) : workspaces.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-400/10">
                <Building2 className="h-6 w-6 text-violet-400" />
              </div>
              <h2 className="font-semibold">{t("Your workspaces will appear here")}</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {t("Skale Club sets up each company and invites its team. Once you are added, the company shows up here.")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <Card key={workspace.id} data-testid={`workspace-card-${workspace.slug}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-400/10">
                      <Building2 className="h-5 w-5 text-violet-400" />
                    </div>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium capitalize">{t(workspace.role)}</span>
                  </div>
                  <CardTitle className="pt-3 text-lg">{workspace.name}</CardTitle>
                  <CardDescription>/{workspace.slug}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {workspace.kind === "personal" ? t("Personal workspace") : t("Company workspace")}
                  {workspace.is_skale_club && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" aria-label={t("Skale Club")} />}
                </CardContent>
                <CardContent className="flex justify-end gap-2 px-6 pb-5 pt-0">
                  {workspace.kind === "company" && canManageMembers({ role: workspace.role, isPlatformAdmin: false }) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setManaging({ id: workspace.id, name: workspace.name })}
                      data-testid={`button-people-${workspace.slug}`}
                    >
                      {t("People")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={activeWorkspace?.id === workspace.id ? "secondary" : "outline"}
                    onClick={() => selectWorkspace(workspace.id)}
                    disabled={activeWorkspace?.id === workspace.id}
                    data-testid={`button-select-workspace-${workspace.slug}`}
                  >
                    {activeWorkspace?.id === workspace.id ? t("Selected") : t("Select workspace")}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {isPlatformAdmin && (
          <section className="mt-12" data-testid="platform-companies">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <h2 className="text-lg font-semibold">{t("All companies")}</h2>
            </div>
            <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
              {t("Platform view for Skale Club staff. It lists every company and lets you manage who works in it.")}
            </p>
            {(platform?.workspaces?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No companies yet.")}</p>
            ) : (
              <div className="divide-y rounded-md border">
                {platform!.workspaces.map((company) => (
                  <div key={company.id} className="flex flex-wrap items-center gap-3 p-4" data-testid={`platform-company-${company.slug}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {company.name}
                        {company.is_skale_club && <span className="ml-2 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-400">{t("Skale Club")}</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        /{company.slug} · {company.member_count} {t("people")}
                        {company.owners.length > 0 && ` · ${t("Owner")}: ${company.owners.join(", ")}`}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setManaging({ id: company.id, name: company.name })}>
                      {t("Manage people")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <WorkspaceMembersDialog
        workspaceId={managing?.id ?? null}
        workspaceName={managing?.name ?? ""}
        onClose={() => setManaging(null)}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Create company")}</DialogTitle>
            <DialogDescription>{t("A company workspace keeps its work separate from every other company.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">{t("Company name")}</Label>
              <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-slug">{t("Workspace URL")}</Label>
              <Input id="workspace-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={t("Optional — made from the company name if blank")} maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-owner">{t("Owner email")}</Label>
              <Input id="workspace-owner" type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} placeholder={t("Optional — added now if they have an account, invited otherwise")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("Cancel")}</Button>
            <Button onClick={() => createWorkspace.mutate()} disabled={name.trim().length < 2 || createWorkspace.isPending}>
              {createWorkspace.isPending ? t("Creating…") : t("Create company")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
