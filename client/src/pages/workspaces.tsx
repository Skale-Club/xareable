import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, Plus, Users } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/workspace";

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

export default function WorkspacesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { activeWorkspace, selectWorkspace } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const { data, isLoading } = useQuery<WorkspacesResponse>({ queryKey: ["/api/workspaces"] });

  const createWorkspace = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/workspaces", { name, ...(slug.trim() ? { slug } : {}) });
      return response.json() as Promise<{ workspace: WorkspaceSummary }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      setCreateOpen(false);
      setName("");
      setSlug("");
      toast({ title: t("Workspace created") });
    },
    onError: (error: Error) => {
      toast({ title: t("Could not create workspace"), description: error.message, variant: "destructive" });
    },
  });

  const schemaReady = data?.schemaReady !== false;
  const workspaces = data?.workspaces || [];

  return (
    <div className="flex-1 overflow-auto" data-testid="workspaces-page">
      <div className="mx-auto w-full max-w-6xl p-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-violet-400">{t("Platform")}</p>
            <h1 className="text-2xl font-bold tracking-tight">{t("Workspaces")}</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground">
              {t("Keep each company’s people, brand, planning, and publishing in its own secure workspace.")}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} disabled={!schemaReady} className="gap-2" data-testid="button-create-workspace">
            <Plus className="h-4 w-4" />
            {t("New workspace")}
          </Button>
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
                {t("Start with one company workspace. Later it will contain the calendar, briefs, social accounts, and team access.")}
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
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium capitalize">{workspace.role}</span>
                  </div>
                  <CardTitle className="pt-3 text-lg">{workspace.name}</CardTitle>
                  <CardDescription>/{workspace.slug}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {workspace.kind === "personal" ? t("Personal workspace") : t("Company workspace")}
                  {workspace.is_skale_club && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" aria-label={t("Skale Club")} />}
                </CardContent>
                <CardContent className="flex justify-end px-6 pb-5 pt-0">
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
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Create workspace")}</DialogTitle>
            <DialogDescription>{t("A workspace keeps one company’s work separate from every other company.")}</DialogDescription>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("Cancel")}</Button>
            <Button onClick={() => createWorkspace.mutate()} disabled={name.trim().length < 2 || createWorkspace.isPending}>
              {createWorkspace.isPending ? t("Creating…") : t("Create workspace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
