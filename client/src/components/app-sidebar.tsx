import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { usePostCreator } from "@/lib/post-creator";
import { useAdminMode } from "@/lib/admin-mode";
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
import { PlusCircle, Image, Settings, LogOut, Sparkles, Users, Home, Shield, ShieldOff } from "lucide-react";

const userNavItems = [
  { title: "My Posts", url: "/dashboard", icon: Image },
  { title: "Settings", url: "/settings", icon: Settings },
];

const adminNavItems = [
  { title: "Users", url: "/admin", icon: Users, page: "users" },
  { title: "Landing Page", url: "/admin", icon: Home, page: "landing" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, profile, brand, signOut } = useAuth();
  const { openCreator, isOpen } = usePostCreator();
  const { isAdminMode, toggleMode, setAdminMode } = useAdminMode();

  const isAdmin = profile?.is_admin;

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
                {isAdminMode ? "Admin Panel" : "Social Autopilot"}
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
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
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
                      <span>New Post</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {userNavItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={location === item.url}>
                        <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {brand && (
              <SidebarGroup>
                <SidebarGroupLabel>Brand Info</SidebarGroupLabel>
                <SidebarGroupContent className="px-3 space-y-3 text-xs">
                  <div>
                    <div className="text-muted-foreground mb-0.5">Company</div>
                    <div className="font-medium truncate">{brand.company_name}</div>
                  </div>

                  <div>
                    <div className="text-muted-foreground mb-0.5">Industry</div>
                    <div className="font-medium truncate">{brand.company_type}</div>
                  </div>

                  <div>
                    <div className="text-muted-foreground mb-1">Colors</div>
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
                    <div className="text-muted-foreground mb-0.5">Mood</div>
                    <div className="font-medium capitalize">{brand.mood}</div>
                  </div>

                  {profile?.api_key && (
                    <div>
                      <div className="text-muted-foreground mb-0.5">API Key</div>
                      <div className="flex items-center gap-1.5 text-green-500">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        <span className="font-medium">Configured</span>
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
            <SidebarGroupLabel>Admin Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      onClick={() => {
                        // This will be handled by the admin page's tab state
                        window.dispatchEvent(new CustomEvent("admin-tab-change", { detail: item.page }));
                      }}
                      data-testid={`nav-admin-${item.title.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3 space-y-2">
        {isAdmin && (
          <Button
            variant={isAdminMode ? "default" : "outline"}
            size="sm"
            onClick={toggleMode}
            className="w-full gap-2"
            data-testid="toggle-admin-mode"
          >
            {isAdminMode ? (
              <>
                <ShieldOff className="w-4 h-4" />
                <span>Exit Admin</span>
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                <span>Admin Panel</span>
              </>
            )}
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
    </Sidebar>
  );
}
