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
import { Loader2, Users, Shield, ShieldOff, Search, Calendar, Save, DollarSign, Zap, CreditCard, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Star, StarOff, Settings, Palette, Upload, Image, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { LandingContent, AppSettings, MarkupSettings } from "@shared/schema";
import { useAppSettings } from "@/lib/app-settings";

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
  generate_count: number;
  edit_count: number;
  total_cost_usd_micros: number;
  balance_micros: number;
  free_generations_remaining: number;
  referred_by_affiliate_id: string | null;
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

type StatusFilter = "all" | "active" | "trialing" | "exhausted" | "affiliate";
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
    if (filter === "active") return u.plan_name === "Credits";
    if (filter === "trialing") return u.free_generations_remaining > 0;
    if (filter === "exhausted") return u.free_generations_remaining <= 0 && u.balance_micros <= 0;
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
                    <span className={`flex items-center gap-1 text-xs font-medium whitespace-nowrap ${u.plan_name === "Credits" ? "text-green-500" : "text-muted-foreground"}`}>
                      <CreditCard className="w-3 h-3" /> {u.plan_name || "Free"}
                    </span>
                    <span className="text-xs whitespace-nowrap font-mono text-muted-foreground">
                      ${(u.balance_micros / 1_000_000).toFixed(2)} balance
                    </span>
                    {u.free_generations_remaining > 0 && (
                      <Badge variant="outline" className="text-xs py-0 text-muted-foreground">{u.free_generations_remaining} free left</Badge>
                    )}
                    {u.referred_by_affiliate_id && (
                      <span className="text-[11px] text-muted-foreground">Referred user</span>
                    )}
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
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);

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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["image/svg+xml", "image/png", "image/jpeg"];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Only SVG, PNG, and JPEG are supported", variant: "destructive" });
      return;
    }

    setUploadingLogo(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const sb = supabase();
        const { data: { session } } = await sb.auth.getSession();

        const res = await fetch("/api/admin/landing/upload-logo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ file: base64, contentType: file.type }),
        });

        if (!res.ok) throw new Error(await res.text());
        const { logo_url } = await res.json();
        setContent(prev => ({ ...prev, logo_url }));
        queryClient.invalidateQueries({ queryKey: ["/api/landing/content"] });
        toast({ title: "Logo uploaded successfully" });
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["image/svg+xml", "image/png", "image/x-icon"];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Only SVG, PNG, and ICO are supported", variant: "destructive" });
      return;
    }

    setUploadingIcon(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const sb = supabase();
        const { data: { session } } = await sb.auth.getSession();

        const res = await fetch("/api/admin/landing/upload-icon", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ file: base64, contentType: file.type }),
        });

        if (!res.ok) throw new Error(await res.text());
        const { icon_url } = await res.json();
        setContent(prev => ({ ...prev, icon_url }));
        queryClient.invalidateQueries({ queryKey: ["/api/landing/content"] });
        toast({ title: "Icon uploaded successfully" });
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setUploadingIcon(false);
    }
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

      {/* Branding Section */}
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Logo and icon for the landing page header/footer and browser tab</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Logo Upload */}
            <div className="space-y-2">
              <Label>Landing Page Logo</Label>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/svg+xml,image/png,image/jpeg"
                  onChange={handleLogoUpload}
                  className="hidden"
                  disabled={uploadingLogo}
                />
                {content.logo_url ? (
                  <div className="relative w-full h-40 rounded-lg border bg-muted flex items-center justify-center overflow-hidden group hover:border-primary/50 transition-colors">
                    <img
                      src={content.logo_url}
                      alt="Logo preview"
                      className="max-w-full max-h-full object-contain"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="text-center text-white">
                        {uploadingLogo ? (
                          <>
                            <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                            <p className="text-sm font-medium">Uploading...</p>
                          </>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 mx-auto mb-2" />
                            <p className="text-sm font-medium">Upload Logo</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-40 rounded-lg border-2 border-dashed bg-muted/20 flex items-center justify-center hover:border-primary/50 hover:bg-muted/40 transition-colors">
                    <div className="text-center">
                      {uploadingLogo ? (
                        <>
                          <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-muted-foreground" />
                          <p className="text-sm text-muted-foreground font-medium">Uploading...</p>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground font-medium">Upload Logo</p>
                          <p className="text-xs text-muted-foreground mt-1">Click to browse</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </label>
              <p className="text-xs text-muted-foreground">Appears in header and footer (SVG, PNG, or JPEG)</p>
            </div>

            {/* Icon Upload */}
            <div className="space-y-2">
              <Label>Favicon / Icon</Label>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/svg+xml,image/png,image/x-icon"
                  onChange={handleIconUpload}
                  className="hidden"
                  disabled={uploadingIcon}
                />
                {content.icon_url ? (
                  <div className="relative w-full h-40 rounded-lg border bg-muted flex items-center justify-center overflow-hidden group hover:border-primary/50 transition-colors">
                    <img
                      src={content.icon_url}
                      alt="Icon preview"
                      className="max-w-full max-h-full object-contain"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="text-center text-white">
                        {uploadingIcon ? (
                          <>
                            <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                            <p className="text-sm font-medium">Uploading...</p>
                          </>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 mx-auto mb-2" />
                            <p className="text-sm font-medium">Upload Icon</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-40 rounded-lg border-2 border-dashed bg-muted/20 flex items-center justify-center hover:border-primary/50 hover:bg-muted/40 transition-colors">
                    <div className="text-center">
                      {uploadingIcon ? (
                        <>
                          <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-muted-foreground" />
                          <p className="text-sm text-muted-foreground font-medium">Uploading...</p>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground font-medium">Upload Icon</p>
                          <p className="text-xs text-muted-foreground mt-1">Click to browse</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </label>
              <p className="text-xs text-muted-foreground">Browser tab icon (SVG, PNG, or ICO)</p>
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

function AdminPricingTab() {
  const { toast } = useToast();
  const [form, setForm] = useState<MarkupSettings | null>(null);

  const { data, isLoading } = useQuery<MarkupSettings>({
    queryKey: ["/api/admin/markup-settings"],
    queryFn: () => adminFetch("/api/admin/markup-settings"),
  });

  useEffect(() => {
    if (data) {
      setForm(data);
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async (payload: MarkupSettings) => {
      const sb = supabase();
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch("/api/admin/markup-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<MarkupSettings>;
    },
    onSuccess: (next) => {
      setForm(next);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markup-settings"] });
      toast({ title: "Pricing settings updated" });
    },
    onError: (e: any) => {
      toast({ title: "Failed to update pricing", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const setField = <K extends keyof MarkupSettings>(field: K, value: MarkupSettings[K]) => {
    setForm((current) => current ? { ...current, [field]: value } : current);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pay-Per-Use Pricing</CardTitle>
          <CardDescription>Control global markup and recharge defaults for the credits model.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="regularMultiplier">Regular User Markup</Label>
              <Input
                id="regularMultiplier"
                type="number"
                step="0.1"
                min="1"
                value={form.regularMultiplier}
                onChange={(e) => setField("regularMultiplier", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="affiliateMultiplier">Affiliate Customer Markup</Label>
              <Input
                id="affiliateMultiplier"
                type="number"
                step="0.1"
                min="1"
                value={form.affiliateMultiplier}
                onChange={(e) => setField("affiliateMultiplier", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="rounded-lg border p-3 text-sm text-muted-foreground">
            Example: if Gemini costs $0.01, regular users pay ${(0.01 * form.regularMultiplier).toFixed(3)} and referred users pay ${(0.01 * form.affiliateMultiplier).toFixed(3)}.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recharge Defaults</CardTitle>
          <CardDescription>Minimum purchase and suggested auto-recharge defaults.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="minRechargeMicros">Minimum Top-Up (USD)</Label>
            <Input
              id="minRechargeMicros"
              type="number"
              min="1"
              value={form.minRechargeMicros / 1_000_000}
              onChange={(e) => setField("minRechargeMicros", Math.round(Number(e.target.value) * 1_000_000))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultAutoRechargeThresholdMicros">Default Threshold (USD)</Label>
            <Input
              id="defaultAutoRechargeThresholdMicros"
              type="number"
              min="0"
              value={form.defaultAutoRechargeThresholdMicros / 1_000_000}
              onChange={(e) => setField("defaultAutoRechargeThresholdMicros", Math.round(Number(e.target.value) * 1_000_000))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultAutoRechargeAmountMicros">Default Auto Top-Up (USD)</Label>
            <Input
              id="defaultAutoRechargeAmountMicros"
              type="number"
              min="0"
              value={form.defaultAutoRechargeAmountMicros / 1_000_000}
              onChange={(e) => setField("defaultAutoRechargeAmountMicros", Math.round(Number(e.target.value) * 1_000_000))}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => updateMutation.mutate(form)}
          disabled={updateMutation.isPending}
          className="gap-2"
        >
          {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Pricing
        </Button>
      </div>
    </div>
  );
}

export default function AdminPage({ initialTab = "users" }: { initialTab?: string }) {
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    // Update active tab when initialTab changes (from URL)
    setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="admin-page">
      {activeTab === "users" ? <UsersTab /> : activeTab === "landing" ? <LandingPageTab /> : activeTab === "pricing" ? <AdminPricingTab /> : activeTab === "seo" ? <SeoTab /> : <AppSettingsTab />}
    </div>
  );
}

function SeoTab() {
  const { toast } = useToast();
  const { settings, refresh } = useAppSettings();
  const [localSettings, setLocalSettings] = useState<Partial<AppSettings>>({});

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<AppSettings>) => {
      const sb = supabase();
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch("/api/admin/settings", {
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
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "SEO settings updated successfully" });
    },
    onError: (e: any) => {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(localSettings);
  };

  const handleChange = (field: keyof AppSettings, value: string) => {
    setLocalSettings(prev => ({ ...prev, [field]: value }));
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Meta Tags
          </CardTitle>
          <CardDescription>Basic SEO metadata for search engines</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="meta_title">Meta Title</Label>
            <Input
              id="meta_title"
              value={localSettings.meta_title || ""}
              onChange={(e) => handleChange("meta_title", e.target.value)}
              placeholder="Xareable - AI Social Media Content Creator"
            />
            <p className="text-xs text-muted-foreground">The title that appears in search results and browser tabs</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="meta_description">Meta Description</Label>
            <Textarea
              id="meta_description"
              value={localSettings.meta_description || ""}
              onChange={(e) => handleChange("meta_description", e.target.value)}
              placeholder="Create stunning social media images and captions with AI..."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">A brief description that appears in search results (150-160 characters recommended)</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="w-5 h-5" />
            Open Graph & Social
          </CardTitle>
          <CardDescription>How your site appears when shared on social media</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="og_image_url">OG Image URL</Label>
            <Input
              id="og_image_url"
              value={localSettings.og_image_url || ""}
              onChange={(e) => handleChange("og_image_url", e.target.value)}
              placeholder="https://example.com/og-image.png"
            />
            <p className="text-xs text-muted-foreground">Image displayed when your site is shared on Facebook, LinkedIn, etc. (1200x630px recommended)</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="favicon_url">Favicon URL</Label>
            <Input
              id="favicon_url"
              value={localSettings.favicon_url || ""}
              onChange={(e) => handleChange("favicon_url", e.target.value)}
              placeholder="https://example.com/favicon.png"
            />
            <p className="text-xs text-muted-foreground">Browser tab icon (32x32px or 64x64px PNG/ICO)</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Legal Links</CardTitle>
          <CardDescription>Terms and Privacy policy URLs (also used for SEO compliance)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="seo_terms_url">Terms of Service URL</Label>
            <Input
              id="seo_terms_url"
              value={localSettings.terms_url || ""}
              onChange={(e) => handleChange("terms_url", e.target.value)}
              placeholder="https://example.com/terms"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo_privacy_url">Privacy Policy URL</Label>
            <Input
              id="seo_privacy_url"
              value={localSettings.privacy_url || ""}
              onChange={(e) => handleChange("privacy_url", e.target.value)}
              placeholder="https://example.com/privacy"
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
          Save SEO Settings
        </Button>
      </div>
    </div>
  );
}

function AppSettingsTab() {
  const { toast } = useToast();
  const { settings, refresh } = useAppSettings();
  const [localSettings, setLocalSettings] = useState<Partial<AppSettings>>({});

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<AppSettings>) => {
      const sb = supabase();
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch("/api/admin/settings", {
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
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "App settings updated successfully" });
    },
    onError: (e: any) => {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(localSettings);
  };

  const handleChange = (field: keyof AppSettings, value: string) => {
    setLocalSettings(prev => ({ ...prev, [field]: value }));
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            App Branding
          </CardTitle>
          <CardDescription>Configure the application name and branding</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="app_name">App Name</Label>
            <Input
              id="app_name"
              value={localSettings.app_name || ""}
              onChange={(e) => handleChange("app_name", e.target.value)}
              placeholder="Xareable"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app_tagline">Tagline</Label>
            <Input
              id="app_tagline"
              value={localSettings.app_tagline || ""}
              onChange={(e) => handleChange("app_tagline", e.target.value)}
              placeholder="AI-Powered Social Media Content Creation"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app_description">Description</Label>
            <Textarea
              id="app_description"
              value={localSettings.app_description || ""}
              onChange={(e) => handleChange("app_description", e.target.value)}
              placeholder="Brief description of your application"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo_url">Logo URL</Label>
            <Input
              id="logo_url"
              value={localSettings.logo_url || ""}
              onChange={(e) => handleChange("logo_url", e.target.value)}
              placeholder="https://example.com/logo.png"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            Colors
          </CardTitle>
          <CardDescription>Primary and secondary brand colors</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primary_color">Primary Color</Label>
              <div className="flex gap-2">
                <Input
                  id="primary_color"
                  value={localSettings.primary_color || ""}
                  onChange={(e) => handleChange("primary_color", e.target.value)}
                  placeholder="#8b5cf6"
                />
                <div
                  className="w-10 h-10 rounded-md border"
                  style={{ backgroundColor: localSettings.primary_color || "#8b5cf6" }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary_color">Secondary Color</Label>
              <div className="flex gap-2">
                <Input
                  id="secondary_color"
                  value={localSettings.secondary_color || ""}
                  onChange={(e) => handleChange("secondary_color", e.target.value)}
                  placeholder="#ec4899"
                />
                <div
                  className="w-10 h-10 rounded-md border"
                  style={{ backgroundColor: localSettings.secondary_color || "#ec4899" }}
                />
              </div>
            </div>
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
