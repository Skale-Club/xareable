/**
 * UsersTab - Admin user management tab
 */

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search, CreditCard, AlertTriangle, DollarSign, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { StatCard } from "./stat-card";
import { UsersTable } from "./users/users-table";
import { formatCost, matchStatus } from "@/lib/admin/utils";
import type { AdminStats, AdminUser, StatusFilter, SortField, SortDir } from "@/lib/admin/types";

async function adminFetch<T>(path: string): Promise<T> {
    const sb = supabase();
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(path, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
        const raw = await res.text();
        try {
            const parsed = JSON.parse(raw);
            throw new Error(parsed?.message || raw);
        } catch {
            throw new Error(raw || "Request failed");
        }
    }
    return res.json();
}

export function UsersTab() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [sortField, setSortField] = useState<SortField>("joined");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
        queryKey: ["/api/admin/stats"],
        queryFn: () => adminFetch("/api/admin/stats"),
    });

    const { data: usersData, isLoading: usersLoading } = useQuery<{ users: AdminUser[] }>({
        queryKey: ["/api/admin/users"],
        queryFn: () => adminFetch("/api/admin/users"),
    });

    const toggleAdminMutation = useMutation({
        mutationFn: async ({ id, is_admin }: { id: string; is_admin: boolean }) => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch(`/api/admin/users/${id}/admin`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ is_admin }),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
            toast({ title: "Admin status updated" });
        },
        onError: (e: any) => {
            toast({ title: "Failed to update", description: e.message, variant: "destructive" });
        },
    });

    const toggleAffiliateMutation = useMutation({
        mutationFn: async ({ id, is_affiliate }: { id: string; is_affiliate: boolean }) => {
            const sb = supabase();
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch(`/api/admin/users/${id}/affiliate`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ is_affiliate }),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
            toast({ title: "Affiliate status updated" });
        },
        onError: (e: any) => {
            toast({ title: "Failed to update", description: e.message, variant: "destructive" });
        },
    });

    function toggleSort(field: SortField) {
        if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc");
        else { setSortField(field); setSortDir("desc"); }
    }

    const allUsers = usersData?.users || [];

    const filtered = allUsers
        .filter(u => {
            const matchSearch = !search ||
                u.email?.toLowerCase().includes(search.toLowerCase()) ||
                u.brand_name?.toLowerCase().includes(search.toLowerCase());
            return matchSearch && matchStatus(u, statusFilter);
        })
        .sort((a, b) => {
            let diff = 0;
            if (sortField === "usage") diff = (a.generate_count + a.edit_count) - (b.generate_count + b.edit_count);
            else if (sortField === "cost") diff = a.total_cost_usd_micros - b.total_cost_usd_micros;
            else diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return sortDir === "desc" ? -diff : diff;
        });

    const statusCounts: Record<StatusFilter, number> = {
        all: allUsers.length,
        affiliate: allUsers.filter(u => matchStatus(u, "affiliate")).length,
        active: allUsers.filter(u => matchStatus(u, "active")).length,
        trialing: allUsers.filter(u => matchStatus(u, "trialing")).length,
        exhausted: allUsers.filter(u => matchStatus(u, "exhausted")).length,
    };

    const statCards: { label: string; value: string | number; icon: LucideIcon; sub: string; filter?: StatusFilter }[] = [
        { label: "Total Users", value: stats?.totalUsers ?? "—", icon: Users, sub: `+${stats?.newUsersToday ?? 0} today`, filter: "all" },
        { label: "Paid Users", value: stats?.activeSubscribers ?? "—", icon: CreditCard, sub: `${stats?.trialingUsers ?? 0} on free trial`, filter: "active" },
        { label: "Quota Exhausted", value: stats?.quotaExhausted ?? "—", icon: AlertTriangle, sub: "Free trial at limit", filter: "exhausted" },
        { label: "Platform Cost", value: stats ? formatCost(stats.totalCostUsdMicros) : "—", icon: DollarSign, sub: `${stats?.totalUsageEvents ?? 0} total events` },
    ];

    const isMutating = toggleAdminMutation.isPending || toggleAffiliateMutation.isPending;

    return (
        <div className="space-y-6 pb-24">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map((card) => (
                    <StatCard
                        key={card.label}
                        label={card.label}
                        value={card.value}
                        icon={card.icon}
                        sub={card.sub}
                        loading={statsLoading}
                        onClick={card.filter ? () => setStatusFilter(card.filter as StatusFilter) : undefined}
                        active={card.filter === statusFilter}
                        testId={`stat-${card.label.toLowerCase().replace(/ /g, "-")}`}
                    />
                ))}
            </div>

            <Card>
                <CardHeader className="space-y-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">Users</CardTitle>
                            <span className="text-sm text-muted-foreground font-normal">
                                {usersLoading ? "" : `${filtered.length} of ${allUsers.length}`}
                            </span>
                        </div>
                        <div className="relative w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by email or brand..."
                                className="pl-9"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                data-testid="input-search-users"
                            />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {(
                            [
                                { key: "all", label: "All" },
                                { key: "affiliate", label: "Afiliados" },
                                { key: "active", label: "Credit Buyers" },
                                { key: "trialing", label: "Free Left" },
                                { key: "exhausted", label: "Low Balance" },
                            ] as { key: StatusFilter; label: string }[]
                        ).map(({ key, label }) => (
                            statusCounts[key] > 0 || key === "all" ? (
                                <button
                                    key={key}
                                    onClick={() => setStatusFilter(key)}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${statusFilter === key
                                        ? "bg-violet-500/15 border-violet-400 text-violet-300"
                                        : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                                        }`}
                                    data-testid={`filter-${key}`}
                                >
                                    {label}
                                    <span className={`text-xs tabular-nums ${statusFilter === key ? "text-violet-300" : "text-muted-foreground"}`}>
                                        {statusCounts[key]}
                                    </span>
                                </button>
                            ) : null
                        ))}
                    </div>
                </CardHeader>
                <CardContent>
                    {usersLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <UsersTable 
                            users={filtered}
                            currentUserId={user?.id}
                            sortField={sortField}
                            sortDir={sortDir}
                            toggleSort={toggleSort}
                            onToggleAffiliate={(id, is_affiliate) => toggleAffiliateMutation.mutate({ id, is_affiliate })}
                            onToggleAdmin={(id, is_admin) => toggleAdminMutation.mutate({ id, is_admin })}
                            isMutating={isMutating}
                        />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
