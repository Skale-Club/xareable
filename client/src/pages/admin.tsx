import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, Shield, ShieldOff, Search, Calendar, Save, DollarSign, Zap, CreditCard, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Star, StarOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { LandingContent } from "@shared/schema";

interface AdminStats {
  totalUsers: number;
  totalPosts: number;
  totalBrands: number;
  newUsersToday: number;
  newPostsToday: number;
  totalUsageEvents: number;
  totalCostUsdMicros: number;
  activeSubscribers: number;
  trialingUsers: number;
  quotaExhausted: number;
}

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  is_affiliate: boolean;
  brand_name: string | null;
  post_count: number;
  plan_name: string | null;
  monthly_limit: number | null;
  subscription_status: string | null;
  generate_count: number;
  edit_count: number;
  total_cost_usd_micros: number;
}

async function adminFetch(path: string) {
  const sb = supabase();
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type StatusFilter = "all" | "active" | "trialing" | "exhausted" | "canceled" | "past_due" | "affiliate";
type SortField = "joined" | "usage" | "cost";
type SortDir = "asc" | "desc";

function UsersTab() {
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

  function formatCost(micros: number): string {
    return `$${(micros / 1_000_000).toFixed(4)}`;
  }

  function matchStatus(u: AdminUser, filter: StatusFilter): boolean {
    if (filter === "all") return true;
    if (filter === "affiliate") return u.is_affiliate === true;
    if (filter === "active") return u.subscription_status === "active";
    if (filter === "canceled") return u.subscription_status === "canceled";
    if (filter === "past_due") return u.subscription_status === "past_due";
    const used = u.generate_count + u.edit_count;
    const limit = u.monthly_limit ?? Infinity;
    if (filter === "trialing") return u.subscription_status === "trialing" && used < limit;
    if (filter === "exhausted") return u.subscription_status === "trialing" && used >= limit;
    return true;
  }

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
    canceled: allUsers.filter(u => matchStatus(u, "canceled")).length,
    past_due: allUsers.filter(u => matchStatus(u, "past_due")).length,
  };

  const statCards: { label: string; value: string | number; icon: React.ElementType; sub: string; filter?: StatusFilter }[] = [
    { label: "Total Users", value: stats?.totalUsers ?? "—", icon: Users, sub: `+${stats?.newUsersToday ?? 0} today`, filter: "all" },
    { label: "Paid Users", value: stats?.activeSubscribers ?? "—", icon: CreditCard, sub: `${stats?.trialingUsers ?? 0} on free trial`, filter: "active" },
    { label: "Quota Exhausted", value: stats?.quotaExhausted ?? "—", icon: AlertTriangle, sub: "Free trial at limit", filter: "exhausted" },
    { label: "Platform Cost", value: stats ? formatCost(stats.totalCostUsdMicros) : "—", icon: DollarSign, sub: `${stats?.totalUsageEvents ?? 0} total events` },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Card
            key={card.label}
            data-testid={`stat-${card.label.toLowerCase().replace(/ /g, "-")}`}
            onClick={() => card.filter && setStatusFilter(card.filter)}
            className={card.filter ? `cursor-pointer transition-all ${statusFilter === card.filter ? "ring-2 ring-violet-400" : "hover:ring-1 hover:ring-border"}` : ""}
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="text-3xl font-bold mt-1">
                    {statsLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : card.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-violet-400/15 flex items-center justify-center">
                  <card.icon className="w-5 h-5 text-pink-400" />
                </div>
              </div>
            </CardContent>
          </Card>
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
                { key: "active", label: "Paid" },
                { key: "trialing", label: "Free Trial" },
                { key: "exhausted", label: "Quota Full" },
                { key: "past_due", label: "Past Due" },
                { key: "canceled", label: "Canceled" },
              ] as { key: StatusFilter; label: string }[]
            ).map(({ key, label }) => (
              statusCounts[key] > 0 || key === "all" ? (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                    statusFilter === key
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
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b">
                <span>Email</span>
                <span>Brand</span>
                <span>Plan</span>
                <span>Posts</span>
                <button
                  onClick={() => toggleSort("usage")}
                  className="flex items-center gap-1 hover:text-foreground transition-colors whitespace-nowrap"
                  data-testid="sort-usage"
                >
                  Usage
                  {sortField === "usage"
                    ? (sortDir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)
                    : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                </button>
                <button
                  onClick={() => toggleSort("cost")}
                  className="flex items-center gap-1 hover:text-foreground transition-colors whitespace-nowrap"
                  data-testid="sort-cost"
                >
                  Cost
                  {sortField === "cost"
                    ? (sortDir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)
                    : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                </button>
                <button
                  onClick={() => toggleSort("joined")}
                  className="flex items-center gap-1 hover:text-foreground transition-colors whitespace-nowrap"
                  data-testid="sort-joined"
                >
                  Joined
                  {sortField === "joined"
                    ? (sortDir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)
                    : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                </button>
                <span>Role</span>
              </div>
              {filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">No users found</p>
              )}
              {filtered.map((u) => (
                <div
                  key={u.id}
                  className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 items-center text-sm"
                  data-testid={`row-user-${u.id}`}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.email}</p>
                    {u.id === user?.id && (
                      <span className="text-xs text-primary">You</span>
                    )}
                  </div>
                  <span className="text-muted-foreground truncate">{u.brand_name || "—"}</span>
                  <div className="flex flex-col gap-1 items-start">
                    {u.subscription_status === "active" ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-500 whitespace-nowrap">
                        <CreditCard className="w-3 h-3" /> {u.plan_name || "Paid"}
                      </span>
                    ) : (
                      <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">{u.plan_name || "—"}</span>
                    )}
                    {u.subscription_status === "trialing" && u.monthly_limit !== null ? (() => {
                      const used = u.generate_count + u.edit_count;
                      const exhausted = used >= u.monthly_limit;
                      return (
                        <span className={`text-xs whitespace-nowrap font-mono ${exhausted ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          {exhausted ? `${u.monthly_limit}/${u.monthly_limit} FULL` : `${used}/${u.monthly_limit} used`}
                        </span>
                      );
                    })() : u.subscription_status === "past_due" ? (
                      <Badge variant="destructive" className="text-xs py-0">past due</Badge>
                    ) : u.subscription_status === "canceled" ? (
                      <Badge variant="outline" className="text-xs py-0 text-muted-foreground">canceled</Badge>
                    ) : null}
                  </div>
                  <span className="text-center font-mono text-sm">{u.post_count}</span>
                  <span className="text-center text-xs whitespace-nowrap">
                    <span className="font-mono font-medium">{u.generate_count}</span>
                    <span className="text-muted-foreground"> img</span>
                    <span className="text-muted-foreground mx-1">/</span>
                    <span className="font-mono">{u.edit_count}</span>
                    <span className="text-muted-foreground"> edits</span>
                  </span>
                  <span className="text-center font-mono text-xs whitespace-nowrap">
                    {formatCost(u.total_cost_usd_micros)}
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap">
                    <Calendar className="w-3 h-3" />
                    {new Date(u.created_at).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {u.is_affiliate && (
                      <Badge className="text-xs gap-1 bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/20">
                        <Star className="w-3 h-3" /> Afiliado
                      </Badge>
                    )}
                    {u.is_admin ? (
                      <Badge className="text-xs gap-1">
                        <Shield className="w-3 h-3" /> Admin
                      </Badge>
                    ) : !u.is_affiliate ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground">User</Badge>
                    ) : null}
                    {u.id !== user?.id && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={toggleAffiliateMutation.isPending}
                          onClick={() => toggleAffiliateMutation.mutate({ id: u.id, is_affiliate: !u.is_affiliate })}
                          title={u.is_affiliate ? "Remover afiliado" : "Tornar afiliado"}
                          data-testid={`button-toggle-affiliate-${u.id}`}
                        >
                          {u.is_affiliate ? <StarOff className="w-3.5 h-3.5 text-amber-400" /> : <Star className="w-3.5 h-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={toggleAdminMutation.isPending}
                          onClick={() => toggleAdminMutation.mutate({ id: u.id, is_admin: !u.is_admin })}
                          data-testid={`button-toggle-admin-${u.id}`}
                        >
                          {u.is_admin ? <ShieldOff className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                        </Button>
                      </>
                    )}
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

function LandingPageTab() {
  const { toast } = useToast();
  const [content, setContent] = useState<Partial<LandingContent>>({});

  const { data: landingContent, isLoading } = useQuery<LandingContent>({
    queryKey: ["/api/landing/content"],
    queryFn: () => fetch("/api/landing/content").then(res => res.json()),
  });

  useEffect(() => {
    if (landingContent) {
      setContent(landingContent);
    }
  }, [landingContent]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<LandingContent>) => {
      const sb = supabase();
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch("/api/admin/landing/content", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landing/content"] });
      toast({ title: "Landing page content updated successfully" });
    },
    onError: (e: any) => {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(content);
  };

  const handleChange = (field: keyof LandingContent, value: string) => {
    setContent(prev => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero Section */}
      <Card>
        <CardHeader>
          <CardTitle>Hero Section</CardTitle>
          <CardDescription>Main headline and call-to-action buttons at the top of the page</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hero_headline">Headline</Label>
            <Input
              id="hero_headline"
              value={content.hero_headline || ""}
              onChange={(e) => handleChange("hero_headline", e.target.value)}
              placeholder="Create and Post Stunning Social Posts in Seconds"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hero_subtext">Subtext</Label>
            <Textarea
              id="hero_subtext"
              value={content.hero_subtext || ""}
              onChange={(e) => handleChange("hero_subtext", e.target.value)}
              placeholder="Generate brand-consistent social media images and captions with AI..."
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hero_cta_text">Primary CTA Button</Label>
              <Input
                id="hero_cta_text"
                value={content.hero_cta_text || ""}
                onChange={(e) => handleChange("hero_cta_text", e.target.value)}
                placeholder="Start Creating for Free"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hero_secondary_cta_text">Secondary CTA Button</Label>
              <Input
                id="hero_secondary_cta_text"
                value={content.hero_secondary_cta_text || ""}
                onChange={(e) => handleChange("hero_secondary_cta_text", e.target.value)}
                placeholder="See How It Works"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Features Section */}
      <Card>
        <CardHeader>
          <CardTitle>Features Section</CardTitle>
          <CardDescription>Section showcasing the platform's features</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="features_title">Section Title</Label>
            <Input
              id="features_title"
              value={content.features_title || ""}
              onChange={(e) => handleChange("features_title", e.target.value)}
              placeholder="Everything You Need to Automate Content"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="features_subtitle">Section Subtitle</Label>
            <Textarea
              id="features_subtitle"
              value={content.features_subtitle || ""}
              onChange={(e) => handleChange("features_subtitle", e.target.value)}
              placeholder="From brand setup to publish-ready graphics..."
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* How It Works Section */}
      <Card>
        <CardHeader>
          <CardTitle>How It Works Section</CardTitle>
          <CardDescription>Section explaining the three-step process</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="how_it_works_title">Section Title</Label>
            <Input
              id="how_it_works_title"
              value={content.how_it_works_title || ""}
              onChange={(e) => handleChange("how_it_works_title", e.target.value)}
              placeholder="How It Works"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="how_it_works_subtitle">Section Subtitle</Label>
            <Textarea
              id="how_it_works_subtitle"
              value={content.how_it_works_subtitle || ""}
              onChange={(e) => handleChange("how_it_works_subtitle", e.target.value)}
              placeholder="Three simple steps from idea to publish-ready social media content."
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Testimonials Section */}
      <Card>
        <CardHeader>
          <CardTitle>Testimonials Section</CardTitle>
          <CardDescription>Section displaying user testimonials</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="testimonials_title">Section Title</Label>
            <Input
              id="testimonials_title"
              value={content.testimonials_title || ""}
              onChange={(e) => handleChange("testimonials_title", e.target.value)}
              placeholder="Loved by Marketers"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="testimonials_subtitle">Section Subtitle</Label>
            <Textarea
              id="testimonials_subtitle"
              value={content.testimonials_subtitle || ""}
              onChange={(e) => handleChange("testimonials_subtitle", e.target.value)}
              placeholder="See what our users are saying about their experience."
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* CTA Section */}
      <Card>
        <CardHeader>
          <CardTitle>Bottom CTA Section</CardTitle>
          <CardDescription>Final call-to-action section at the bottom of the page</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cta_title">Section Title</Label>
            <Input
              id="cta_title"
              value={content.cta_title || ""}
              onChange={(e) => handleChange("cta_title", e.target.value)}
              placeholder="Ready to Automate Your Content?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cta_subtitle">Section Subtitle</Label>
            <Textarea
              id="cta_subtitle"
              value={content.cta_subtitle || ""}
              onChange={(e) => handleChange("cta_subtitle", e.target.value)}
              placeholder="Join thousands of marketers who create branded social media content..."
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cta_button_text">Button Text</Label>
            <Input
              id="cta_button_text"
              value={content.cta_button_text || ""}
              onChange={(e) => handleChange("cta_button_text", e.target.value)}
              placeholder="Get Started Free"
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          size="lg"
          className="gap-2"
        >
          {updateMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState("users");

  useEffect(() => {
    const handleTabChange = (e: CustomEvent) => {
      setActiveTab(e.detail);
    };
    window.addEventListener("admin-tab-change", handleTabChange as EventListener);
    return () => window.removeEventListener("admin-tab-change", handleTabChange as EventListener);
  }, []);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="admin-page">
      {activeTab === "users" ? <UsersTab /> : <LandingPageTab />}
    </div>
  );
}
