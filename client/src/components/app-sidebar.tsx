import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
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
import { PlusCircle, Image, Settings, LogOut, Sparkles } from "lucide-react";

const navItems = [
  { title: "New Post", url: "/dashboard", icon: PlusCircle },
  { title: "My Posts", url: "/posts", icon: Image },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, brand, signOut } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/dashboard">
          <div className="flex items-center gap-2.5 cursor-pointer" data-testid="link-home">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm tracking-tight truncate">Social Autopilot</div>
              {brand && (
                <div className="text-xs text-muted-foreground truncate">
                  {brand.company_name}
                </div>
              )}
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                  >
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
            <SidebarGroupLabel>Brand Colors</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="flex items-center gap-2 px-3 py-1.5">
                <div
                  className="w-5 h-5 rounded"
                  style={{ backgroundColor: brand.color_1 }}
                />
                <div
                  className="w-5 h-5 rounded"
                  style={{ backgroundColor: brand.color_2 }}
                />
                <div
                  className="w-5 h-5 rounded"
                  style={{ backgroundColor: brand.color_3 }}
                />
                <span className="text-xs text-muted-foreground ml-1 capitalize">
                  {brand.mood}
                </span>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
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
