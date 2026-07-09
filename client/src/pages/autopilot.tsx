/**
 * Content Autopilot (Project P002)
 *
 * Create/manage automated content plans (direction + frequency + auto-approve +
 * monthly budget) and review the approval queue. Gated by publishing_mode.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Pause, Play, Trash2, Check, X, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ContentPlan, FrequencyPreset } from "@shared/schema";

interface Connection { id: string; platform: string; account_name: string | null }
interface QueueItem { id: string; caption: string | null; media_urls: string[]; status: string }

const FREQ_LABELS: Record<FrequencyPreset, string> = {
    daily: "Diário",
    three_per_week: "3× por semana",
    weekly: "Semanal",
    custom: "Personalizado",
};
const WEEKDAYS = [["Dom", 0], ["Seg", 1], ["Ter", 2], ["Qua", 3], ["Qui", 4], ["Sex", 5], ["Sáb", 6]] as const;
const MICROS_PER_USD = 1_000_000;

export default function AutopilotPage() {
    const { profile } = useAuth();
    const { toast } = useToast();
    const mode = (profile as any)?.publishing_mode ?? "disabled";

    const [name, setName] = useState("");
    const [brief, setBrief] = useState("");
    const [themesText, setThemesText] = useState("");
    const [targets, setTargets] = useState<string[]>([]);
    const [freq, setFreq] = useState<FrequencyPreset>("weekly");
    const [customDays, setCustomDays] = useState<number[]>([1]);
    const [postTime, setPostTime] = useState("09:00");
    const [autoApprove, setAutoApprove] = useState(false);
    const [budgetUsd, setBudgetUsd] = useState("10");

    const connections = useQuery<{ connections: Connection[] }>({
        queryKey: ["/api/social/connections"],
        enabled: mode !== "disabled",
    });
    const plans = useQuery<{ plans: ContentPlan[] }>({
        queryKey: ["/api/autopilot/plans"],
        enabled: mode !== "disabled",
    });
    const queue = useQuery<{ queue: QueueItem[] }>({
        queryKey: ["/api/autopilot/queue"],
        enabled: mode !== "disabled",
    });

    const createPlan = useMutation({
        mutationFn: async () => {
            const body = {
                name: name.trim(),
                brief: brief.trim() || undefined,
                themes: themesText.split("\n").map((t) => t.trim()).filter(Boolean),
                target_accounts: targets,
                frequency_preset: freq,
                custom_days: freq === "custom" ? customDays : [],
                post_time: postTime,
                auto_approve: autoApprove,
                monthly_budget_micros: Math.round(parseFloat(budgetUsd || "0") * MICROS_PER_USD),
            };
            return apiRequest("POST", "/api/autopilot/plans", body);
        },
        onSuccess: () => {
            toast({ title: "Plano criado" });
            setName(""); setBrief(""); setThemesText(""); setTargets([]);
            queryClient.invalidateQueries({ queryKey: ["/api/autopilot/plans"] });
        },
        onError: (e: Error) => toast({ title: "Falha ao criar plano", description: e.message, variant: "destructive" }),
    });

    const togglePlan = useMutation({
        mutationFn: async (p: ContentPlan) =>
            apiRequest("PATCH", `/api/autopilot/plans/${p.id}`, { status: p.status === "active" ? "paused" : "active" }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/autopilot/plans"] }),
    });
    const deletePlan = useMutation({
        mutationFn: async (id: string) => apiRequest("DELETE", `/api/autopilot/plans/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/autopilot/plans"] }),
    });
    const approveItem = useMutation({
        mutationFn: async (id: string) => apiRequest("POST", `/api/autopilot/queue/${id}/approve`),
        onSuccess: () => { toast({ title: "Publicado" }); queryClient.invalidateQueries({ queryKey: ["/api/autopilot/queue"] }); },
        onError: (e: Error) => toast({ title: "Falha ao publicar", description: e.message, variant: "destructive" }),
    });
    const rejectItem = useMutation({
        mutationFn: async (id: string) => apiRequest("POST", `/api/autopilot/queue/${id}/reject`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/autopilot/queue"] }),
    });

    if (mode === "disabled") {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div className="max-w-md">
                    <h1 className="text-lg font-semibold">Autopilot indisponível</h1>
                    <p className="mt-2 text-sm text-muted-foreground">A publicação em redes sociais não está habilitada para a sua conta.</p>
                </div>
            </div>
        );
    }

    const conns = connections.data?.connections ?? [];
    const canSubmit = name.trim() && targets.length > 0 && parseFloat(budgetUsd || "0") > 0;

    return (
        <div className="flex-1 overflow-auto p-4 md:p-6 max-w-5xl mx-auto w-full space-y-6">
            <div className="flex items-center gap-2">
                <Bot className="w-6 h-6" />
                <h1 className="text-xl font-semibold">Autopilot de conteúdo</h1>
            </div>

            {/* Create plan */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Novo plano</CardTitle>
                    <CardDescription>Direcionamento + frequência + orçamento. Posts entram na fila de aprovação (ou publicam sozinhos, se você ligar).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Nome</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Promoções semanais" data-testid="input-plan-name" />
                    </div>
                    <div className="space-y-2">
                        <Label>Direcionamento (brief)</Label>
                        <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Tom, estratégia, público…" rows={3} />
                    </div>
                    <div className="space-y-2">
                        <Label>Temas (um por linha — a IA rotaciona)</Label>
                        <Textarea value={themesText} onChange={(e) => setThemesText(e.target.value)} placeholder={"Novidades\nBastidores\nDepoimentos"} rows={3} />
                    </div>
                    <div className="space-y-2">
                        <Label>Contas de destino</Label>
                        {conns.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Conecte uma conta em Configurações primeiro.</p>
                        ) : (
                            <div className="flex flex-wrap gap-3">
                                {conns.map((c) => (
                                    <label key={c.id} className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={targets.includes(c.id)}
                                            onCheckedChange={(v) =>
                                                setTargets((prev) => (v ? [...prev, c.id] : prev.filter((x) => x !== c.id)))
                                            }
                                        />
                                        {c.account_name || c.platform}
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Frequência</Label>
                            <Select value={freq} onValueChange={(v) => setFreq(v as FrequencyPreset)}>
                                <SelectTrigger data-testid="select-frequency"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {(Object.keys(FREQ_LABELS) as FrequencyPreset[]).map((f) => (
                                        <SelectItem key={f} value={f}>{FREQ_LABELS[f]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Horário (UTC)</Label>
                            <Input type="time" value={postTime} onChange={(e) => setPostTime(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Orçamento mensal (US$)</Label>
                            <Input type="number" min="1" step="1" value={budgetUsd} onChange={(e) => setBudgetUsd(e.target.value)} data-testid="input-budget" />
                        </div>
                    </div>
                    {freq === "custom" && (
                        <div className="space-y-2">
                            <Label>Dias</Label>
                            <div className="flex flex-wrap gap-3">
                                {WEEKDAYS.map(([lbl, d]) => (
                                    <label key={d} className="flex items-center gap-1.5 text-sm">
                                        <Checkbox
                                            checked={customDays.includes(d)}
                                            onCheckedChange={(v) =>
                                                setCustomDays((prev) => (v ? [...prev, d] : prev.filter((x) => x !== d)))
                                            }
                                        />
                                        {lbl}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <p className="text-sm font-medium">Auto-publicar</p>
                            <p className="text-xs text-muted-foreground">Ligado: publica sozinho. Desligado: fila de aprovação (recomendado).</p>
                        </div>
                        <Switch checked={autoApprove} onCheckedChange={setAutoApprove} data-testid="switch-auto-approve" />
                    </div>
                    <Button onClick={() => createPlan.mutate()} disabled={!canSubmit || createPlan.isPending} data-testid="btn-create-plan">
                        {createPlan.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                        Criar plano
                    </Button>
                </CardContent>
            </Card>

            {/* Plans */}
            <Card>
                <CardHeader><CardTitle className="text-base">Planos</CardTitle></CardHeader>
                <CardContent>
                    {plans.isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (plans.data?.plans ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum plano ainda.</p>
                    ) : (
                        <ul className="divide-y">
                            {plans.data!.plans.map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{p.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {FREQ_LABELS[p.frequency_preset]} · {p.status} · US$ {(p.monthly_budget_micros / MICROS_PER_USD).toFixed(0)}/mês · {p.auto_approve ? "auto" : "aprovação"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="icon" onClick={() => togglePlan.mutate(p)} title={p.status === "active" ? "Pausar" : "Ativar"}>
                                            {p.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => deletePlan.mutate(p.id)} title="Excluir">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            {/* Approval queue */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Fila de aprovação</CardTitle>
                    <CardDescription>Posts gerados aguardando sua aprovação para publicar.</CardDescription>
                </CardHeader>
                <CardContent>
                    {queue.isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (queue.data?.queue ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nada aguardando aprovação.</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {queue.data!.queue.map((item) => (
                                <div key={item.id} className="rounded-lg border overflow-hidden">
                                    {item.media_urls?.[0] && (
                                        <img src={item.media_urls[0]} alt="" className="w-full aspect-square object-cover" />
                                    )}
                                    <div className="p-3 space-y-2">
                                        <p className="text-sm line-clamp-3">{item.caption}</p>
                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={() => approveItem.mutate(item.id)} disabled={approveItem.isPending} data-testid={`btn-approve-${item.id}`}>
                                                <Check className="w-4 h-4 mr-1" /> Aprovar
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={() => rejectItem.mutate(item.id)} disabled={rejectItem.isPending}>
                                                <X className="w-4 h-4 mr-1" /> Rejeitar
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
