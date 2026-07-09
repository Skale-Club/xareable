/**
 * Social Connections card (Project P001 — Zernio)
 *
 * Rendered inside Settings. Behaviour is driven by the super-admin-controlled
 * profiles.publishing_mode (read-only on the client — the DB trigger blocks
 * user writes):
 *   - disabled → the whole section is hidden.
 *   - byok     → the client must paste their own Zernio API key, then connect.
 *   - platform → the client connects directly (Xareable's platform key).
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Facebook, Instagram, Loader2, Trash2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import type { SocialPlatform } from "@shared/schema";

interface Connection {
    id: string;
    platform: SocialPlatform;
    account_name: string | null;
    account_avatar_url: string | null;
    status: string;
    connected_at: string;
}

const PLATFORM_META: Record<SocialPlatform, { label: string; Icon: typeof Facebook }> = {
    facebook: { label: "Facebook", Icon: Facebook },
    instagram: { label: "Instagram", Icon: Instagram },
};

export function SocialConnectionsCard() {
    const { profile, user, refreshProfile } = useAuth();
    const { toast } = useToast();
    const mode = (profile as any)?.publishing_mode ?? "disabled";
    const existingKey = (profile as any)?.zernio_api_key ?? null;
    const [keyInput, setKeyInput] = useState("");
    const [savingKey, setSavingKey] = useState(false);

    const connectionsQuery = useQuery<{ connections: Connection[] }>({
        queryKey: ["/api/social/connections"],
        enabled: mode !== "disabled",
    });

    // Surface the OAuth callback result (?connected / ?connect_error).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const connected = params.get("connected");
        const err = params.get("connect_error");
        if (connected) {
            toast({ title: "Conta conectada", description: `${connected} conectado com sucesso.` });
            queryClient.invalidateQueries({ queryKey: ["/api/social/connections"] });
        } else if (err) {
            toast({ title: "Falha ao conectar", description: err, variant: "destructive" });
        }
        if (connected || err) {
            params.delete("connected");
            params.delete("connect_error");
            const qs = params.toString();
            window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
        }
    }, [toast]);

    const connectMutation = useMutation({
        mutationFn: async (platform: SocialPlatform) => {
            const res = await apiRequest("POST", "/api/social/connect", { platform });
            return (await res.json()) as { url: string };
        },
        onSuccess: ({ url }) => {
            window.location.href = url; // hosted OAuth
        },
        onError: (e: Error) => toast({ title: "Não foi possível iniciar a conexão", description: e.message, variant: "destructive" }),
    });

    const disconnectMutation = useMutation({
        mutationFn: async (id: string) => apiRequest("DELETE", `/api/social/connections/${id}`),
        onSuccess: () => {
            toast({ title: "Conta desconectada" });
            queryClient.invalidateQueries({ queryKey: ["/api/social/connections"] });
        },
        onError: (e: Error) => toast({ title: "Falha ao desconectar", description: e.message, variant: "destructive" }),
    });

    if (mode === "disabled") return null;

    const needsKey = mode === "byok" && !existingKey;
    const connections = connectionsQuery.data?.connections ?? [];

    async function saveKey() {
        if (!user || !keyInput.trim()) return;
        setSavingKey(true);
        try {
            const { error } = await supabase()
                .from("profiles")
                .update({ zernio_api_key: keyInput.trim() })
                .eq("id", user.id);
            if (error) throw error;
            setKeyInput("");
            await refreshProfile();
            toast({ title: "Chave Zernio salva" });
        } catch (e: any) {
            toast({ title: "Falha ao salvar a chave", description: e?.message, variant: "destructive" });
        } finally {
            setSavingKey(false);
        }
    }

    return (
        <Card data-testid="card-social-connections">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Plug className="w-5 h-5" /> Conexões sociais
                </CardTitle>
                <CardDescription>
                    Conecte suas contas do Facebook e Instagram para publicar e agendar direto pela Xareable.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {mode === "byok" && (
                    <div className="rounded-md border p-3 space-y-2">
                        <p className="text-sm font-medium">Chave da API Zernio</p>
                        <p className="text-xs text-muted-foreground">
                            {existingKey
                                ? "Chave configurada. Cole uma nova para substituir."
                                : "Crie uma conta gratuita no Zernio, gere uma chave e cole aqui para liberar a publicação."}
                        </p>
                        <div className="flex gap-2">
                            <Input
                                type="password"
                                placeholder="sk_..."
                                value={keyInput}
                                onChange={(e) => setKeyInput(e.target.value)}
                                data-testid="input-zernio-key"
                            />
                            <Button onClick={saveKey} disabled={savingKey || !keyInput.trim()} data-testid="btn-save-zernio-key">
                                {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
                            </Button>
                        </div>
                    </div>
                )}

                {!needsKey && (
                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(PLATFORM_META) as SocialPlatform[]).map((platform) => {
                            const { label, Icon } = PLATFORM_META[platform];
                            return (
                                <Button
                                    key={platform}
                                    variant="outline"
                                    onClick={() => connectMutation.mutate(platform)}
                                    disabled={connectMutation.isPending}
                                    data-testid={`btn-connect-${platform}`}
                                >
                                    <Icon className="w-4 h-4 mr-2" /> Conectar {label}
                                </Button>
                            );
                        })}
                    </div>
                )}

                {connectionsQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" /> Carregando conexões…
                    </div>
                ) : connections.length > 0 ? (
                    <ul className="divide-y rounded-md border">
                        {connections.map((c) => {
                            const { label, Icon } = PLATFORM_META[c.platform] ?? PLATFORM_META.facebook;
                            return (
                                <li key={c.id} className="flex items-center justify-between gap-3 p-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Icon className="w-5 h-5 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{c.account_name || label}</p>
                                            <p className="text-xs text-muted-foreground capitalize">{c.platform} · {c.status}</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => disconnectMutation.mutate(c.id)}
                                        disabled={disconnectMutation.isPending}
                                        data-testid={`btn-disconnect-${c.id}`}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    !needsKey && (
                        <p className="text-sm text-muted-foreground">Nenhuma conta conectada ainda.</p>
                    )
                )}
            </CardContent>
        </Card>
    );
}

export default SocialConnectionsCard;
