import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useAdminMode } from "@/lib/admin-mode";
import { usePostCreator } from "@/lib/post-creator";
import { useTranslation } from "@/hooks/useTranslation";
import { GradientIcon } from "@/components/ui/gradient-icon";
import { useAppName } from "@/lib/app-settings";
import { AddCreditsModal } from "@/components/add-credits-modal";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { PlusCircle, Image, Settings, LogOut, Sparkles, Users, Home, CreditCard, Star, Banknote } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_STYLE_CATALOG, type CreditsResponse, type StyleCatalog } from "@shared/schema";

const userNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: Image },
  { title: "Credits", url: "/credits", icon: CreditCard },
  { title: "Settings", url: "/settings", icon: Settings },
];

const adminNavItems = [
  { title: "Users", url: "/admin/users", icon: Users, page: "users" },
  { title: "Pricing", url: "/admin/pricing", icon: Banknote, page: "pricing" },
  { title: "Post Creation", url: "/admin/post-creation", icon: Sparkles, page: "post-creation" },
  { title: "Landing Page", url: "/admin/landing", icon: Home, page: "landing" },
  { title: "SEO", url: "/admin/seo", icon: Sparkles, page: "seo" },
  { title: "App Settings", url: "/admin/settings", icon: Settings, page: "settings" },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const appName = useAppName();
  const { user, profile, brand, signOut } = useAuth();
  const { openCreator, isOpen } = usePostCreator();
  const { isAdminMode, toggleMode } = useAdminMode();
  const { t } = useTranslation();
  const [isAddCreditsOpen, setIsAddCreditsOpen] = useState(false);

  const { data: credits } = useQuery<CreditsResponse>({
    queryKey: ["/api/credits"],
    enabled: !!user,
  });
  const { data: styleCatalog } = useQuery<StyleCatalog>({
    queryKey: ["/api/style-catalog"],
    enabled: !!brand,
  });

  const isAdmin = profile?.is_admin;
  const styles = styleCatalog?.styles || DEFAULT_STYLE_CATALOG.styles;
  const brandStyle = styles.find((item) => item.id === brand?.mood);
  const adminPageSegment = location.startsWith("/admin") ? (location.split("/")[2] || "users") : null;
  const activeAdminPage = adminPageSegment === "styles" ? "post-creation" : adminPageSegment;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href={isAdminMode ? "/admin" : "/dashboard"}>
          <div className="flex items-center gap-2.5 cursor-pointer" data-testid="link-home">
            {brand?.logo_url ? (
              <img
                src={brand.logo_url}
                alt={brand.company_name}
                className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                data-testid="sidebar-brand-logo"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(45deg, #c4b5fd, #fbcfe8, #fed7aa)" }}>
                <Sparkles className="w-4 h-4 text-violet-800" />
              </div>
            )}
	            <div className="min-w-0">
	              <div className="font-bold text-sm tracking-tight truncate">
	                {isAdminMode ? t("Admin Panel") : appName}
	              </div>
              {!isAdminMode && brand && (
                <div className="text-xs text-muted-foreground truncate">
                  {brand.company_name}
                </div>
              )}
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {!isAdminMode ? (
          // User Panel Navigation
	          <>
	            <SidebarGroup>
	              <SidebarGroupLabel>{t("Navigation")}</SidebarGroupLabel>
	              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={isOpen}
                      onClick={() => openCreator()}
                      data-testid="nav-new-post"
                      className="text-white hover:text-white border-0 [background:linear-gradient(45deg,#8b5cf6,#f472b6,#fb923c)] hover:[background:linear-gradient(45deg,#9d7af7,#f589c3,#fca355)] transition-all"
	                    >
	                      <PlusCircle />
	                      <span>{t("New Post")}</span>
	                    </SidebarMenuButton>
	                  </SidebarMenuItem>
                  {userNavItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={location === item.url}>
	                        <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
	                          <item.icon />
	                          <span>{t(item.title)}</span>
	                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                  {profile?.is_affiliate && (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/affiliate"}>
	                        <Link href="/affiliate" data-testid="nav-affiliate">
	                          <Star />
	                          <span>{t("Affiliate")}</span>
	                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

	            {brand && (
	              <SidebarGroup>
	                <SidebarGroupLabel>{t("Brand Info")}</SidebarGroupLabel>
	                <SidebarGroupContent className="px-2 space-y-3 text-xs">
	                  <div>
	                    <div className="text-muted-foreground mb-0.5">{t("Company")}</div>
	                    <div className="font-medium truncate">{brand.company_name}</div>
	                  </div>

	                  <div>
	                    <div className="text-muted-foreground mb-0.5">{t("Industry")}</div>
	                    <div className="font-medium truncate">{brand.company_type}</div>
	                  </div>

	                  <div>
	                    <div className="text-muted-foreground mb-1">{t("Colors")}</div>
	                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-5 h-5 rounded-sm border border-border"
                        style={{ backgroundColor: brand.color_1 }}
                      />
                      <div
                        className="w-5 h-5 rounded-sm border border-border"
                        style={{ backgroundColor: brand.color_2 }}
                      />
                      {brand.color_3 && (
                        <div
                          className="w-5 h-5 rounded-sm border border-border"
                          style={{ backgroundColor: brand.color_3 }}
                        />
                      )}
                      {brand.color_4 && (
                        <div
                          className="w-5 h-5 rounded-sm border border-border"
                          style={{ backgroundColor: brand.color_4 }}
                        />
                      )}
                    </div>
                  </div>

	                  <div>
	                    <div className="text-muted-foreground mb-0.5">{t("Style")}</div>
	                    <div className="font-medium">{t(brandStyle?.label || brand.mood)}</div>
	                  </div>

	                  {profile?.api_key && (profile?.is_admin || profile?.is_affiliate) && (
	                    <div>
	                      <div className="text-muted-foreground mb-0.5">{t("API Key")}</div>
	                      <div className="flex items-center gap-1.5 text-green-500">
	                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
	                        <span className="font-medium">{t("Configured")}</span>
	                      </div>
	                    </div>
	                  )}
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
	        ) : (
	          // Admin Panel Navigation
	          <SidebarGroup>
	            <SidebarGroupLabel>{t("Admin Navigation")}</SidebarGroupLabel>
	            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeAdminPage === item.page}
                    >
                      <Link
                        href={item.url}
                        data-testid={`nav-admin-${item.title.toLowerCase().replace(/\s/g, "-")}`}
	                      >
	                        <item.icon />
	                        <span>{t(item.title)}</span>
	                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3 space-y-2">
        {!isAdminMode && credits && !profile?.is_admin && !profile?.is_affiliate && (
	          <div className="px-1 space-y-1">
	            <div className="flex items-center justify-between text-xs text-muted-foreground">
	              <span>{t("Balance")}</span>
	              <span className="tabular-nums font-medium">
	                ${(credits.credits.balance_micros / 1_000_000).toFixed(2)}
	              </span>
	            </div>
	            <div className="text-[11px] text-muted-foreground">
	              {credits.status.free_generations_remaining > 0
	                ? `${credits.status.free_generations_remaining} ${t(
	                    credits.status.free_generations_remaining === 1
	                      ? "free generation left"
	                      : "free generations left"
	                  )}`
	                : `${t("Next charge")}: $${(credits.status.estimated_cost_micros / 1_000_000).toFixed(3)}`}
	            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full hover:text-white border border-border hover:border-0 hover:[background:linear-gradient(45deg,#8b5cf6,#f472b6,#fb923c)] transition-all"
	              onClick={() => setIsAddCreditsOpen(true)}
	            >
	              {t("Add Credits")}
	            </Button>
	          </div>
	        )}
        {profile?.is_admin && (
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="w-full justify-start gap-2"
	          >
	            <a href="/" data-testid="nav-homepage">
	              <Home className="w-4 h-4" />
	              <span>{t("Go to Homepage")}</span>
	            </a>
	          </Button>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">
              {user?.email}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            data-testid="button-signout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
      <AddCreditsModal open={isAddCreditsOpen} onOpenChange={setIsAddCreditsOpen} />
    </Sidebar>
  );
}
