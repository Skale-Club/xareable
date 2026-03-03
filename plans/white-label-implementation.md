# White-Label Implementation Plan - Xareable Rebranding

## Overview

Transform the application from hardcoded "My Social Autopilot" branding to a configurable white-label system where the project name and branding can be managed from the Admin Area.

## Current State Analysis

### Hardcoded References Found

| Location | Current Value | Type |
|----------|---------------|------|
| [`client/index.html:6`](client/index.html:6) | My Social Autopilot - AI Social Media Content Creator | `<title>` tag |
| [`client/index.html:8`](client/index.html:8) | My Social Autopilot | `og:title` meta |
| [`client/src/pages/landing.tsx:129`](client/src/pages/landing.tsx:129) | My Social Autopilot | Sidebar brand text |
| [`client/src/pages/landing.tsx:469`](client/src/pages/landing.tsx:469) | My Social Autopilot | Footer text |
| [`client/src/pages/auth.tsx:115`](client/src/pages/auth.tsx:115) | My Social Autopilot | Auth page title |
| [`client/src/components/app-sidebar.tsx`](client/src/components/app-sidebar.tsx) | Likely has brand reference | Sidebar component |

### Existing Infrastructure

- **Admin Panel**: Already has a Landing Page content editor in [`client/src/pages/admin.tsx`](client/src/pages/admin.tsx)
- **Landing Content Table**: `landing_content` table with editable fields
- **Auth Context**: [`client/src/lib/auth.tsx`](client/src/lib/auth.tsx) manages user state
- **API Pattern**: `/api/landing/content` for public, `/api/admin/landing/content` for updates

---

## Architecture Design

```mermaid
flowchart TB
    subgraph Database
        AS[app_settings table]
    end
    
    subgraph Server
        API[/api/settings]
        AdminAPI[/api/admin/settings]
    end
    
    subgraph Frontend
        CTX[AppSettingsContext]
        AdminUI[Admin Settings Tab]
        Components[All UI Components]
    end
    
    AS --> API
    AS --> AdminAPI
    API --> CTX
    AdminAPI --> AdminUI
    CTX --> Components
    AdminUI -->|UPDATE| AdminAPI
    AdminAPI -->|PATCH| AS
```

---

## Implementation Steps

### Phase 1: Database Schema

#### 1.1 Create `app_settings` Table

```sql
-- Migration: Create app_settings table for white-label configuration
CREATE TABLE app_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Branding
    app_name TEXT NOT NULL DEFAULT 'Xareable',
    app_tagline TEXT,
    app_description TEXT,
    
    -- Visual Identity
    logo_url TEXT,
    favicon_url TEXT,
    primary_color TEXT DEFAULT '#8b5cf6',  -- violet-500
    secondary_color TEXT DEFAULT '#ec4899', -- pink-500
    
    -- SEO & Meta
    meta_title TEXT,
    meta_description TEXT,
    og_image_url TEXT,
    
    -- Legal
    terms_url TEXT,
    privacy_url TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id)
);

-- Insert default row
INSERT INTO app_settings (app_name, app_tagline, meta_title, meta_description)
VALUES (
    'Xareable',
    'AI-Powered Social Media Content Creation',
    'Xareable - AI Social Media Content Creator',
    'Create stunning social media images and captions with AI, tailored to your brand identity.'
);

-- RLS Policies
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read app_settings (public)
CREATE POLICY "app_settings_select" ON app_settings
    FOR SELECT USING (true);

-- Only admins can update
CREATE POLICY "app_settings_update" ON app_settings
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_admin = true
        )
    );
```

#### 1.2 Add Zod Schema in [`shared/schema.ts`](shared/schema.ts)

```typescript
export const appSettingsSchema = z.object({
  id: z.string().uuid(),
  app_name: z.string(),
  app_tagline: z.string().nullable(),
  app_description: z.string().nullable(),
  logo_url: z.string().nullable(),
  favicon_url: z.string().nullable(),
  primary_color: z.string(),
  secondary_color: z.string(),
  meta_title: z.string().nullable(),
  meta_description: z.string().nullable(),
  og_image_url: z.string().nullable(),
  terms_url: z.string().nullable(),
  privacy_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  updated_by: z.string().uuid().nullable(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const updateAppSettingsSchema = appSettingsSchema.partial().omit({
  id: true,
  created_at: true,
  updated_at: true,
  updated_by: true,
});
export type UpdateAppSettings = z.infer<typeof updateAppSettingsSchema>;
```

---

### Phase 2: Backend API

#### 2.1 Public Settings Endpoint in [`server/routes.ts`](server/routes.ts)

```typescript
// GET /api/settings - Public app settings
app.get("/api/settings", async (_req, res) => {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .single();
  
  if (error) {
    return res.status(500).json({ message: "Failed to fetch settings" });
  }
  res.json(data);
});
```

#### 2.2 Admin Settings Update Endpoint

```typescript
// PATCH /api/admin/settings - Update app settings (admin only)
app.patch("/api/admin/settings", async (req, res) => {
  const adminCheck = await requireAdmin(req, res);
  if (!adminCheck) return;
  
  const parseResult = updateAppSettingsSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ message: "Invalid request" });
  }
  
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("app_settings")
    .update({
      ...parseResult.data,
      updated_at: new Date().toISOString(),
      updated_by: adminCheck.userId,
    })
    .eq("id", (await supabase.from("app_settings").select("id").single()).data?.id)
    .select()
    .single();
  
  if (error) {
    return res.status(500).json({ message: "Failed to update settings" });
  }
  res.json(data);
});
```

---

### Phase 3: Frontend Context

#### 3.1 Create App Settings Context

Create new file: [`client/src/lib/app-settings.tsx`](client/src/lib/app-settings.tsx)

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppSettings } from "@shared/schema";

interface AppSettingsContextType {
  settings: AppSettings | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const defaultSettings: AppSettings = {
  id: "",
  app_name: "Xareable",
  app_tagline: "AI-Powered Social Media Content Creation",
  app_description: null,
  logo_url: null,
  favicon_url: null,
  primary_color: "#8b5cf6",
  secondary_color: "#ec4899",
  meta_title: null,
  meta_description: null,
  og_image_url: null,
  terms_url: null,
  privacy_url: null,
  created_at: "",
  updated_at: "",
  updated_by: null,
};

const AppSettingsContext = createContext<AppSettingsContextType>({
  settings: defaultSettings,
  loading: true,
  refresh: async () => {},
});

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        
        // Update document title dynamically
        if (data.meta_title) {
          document.title = data.meta_title;
        }
        
        // Update meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc && data.meta_description) {
          metaDesc.setAttribute("content", data.meta_description);
        }
      }
    } catch (err) {
      console.error("Failed to fetch app settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <AppSettingsContext.Provider value={{ 
      settings: settings ?? defaultSettings, 
      loading, 
      refresh: fetchSettings 
    }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export const useAppSettings = () => useContext(AppSettingsContext);
```

#### 3.2 Integrate in [`client/src/App.tsx`](client/src/App.tsx)

```typescript
import { AppSettingsProvider } from "@/lib/app-settings";

// Wrap the app with AppSettingsProvider inside AuthProvider
<AuthProvider>
  <AppSettingsProvider>
    {/* rest of app */}
  </AppSettingsProvider>
</AuthProvider>
```

---

### Phase 4: Update UI Components

#### 4.1 Create useAppName Hook (Convenience)

```typescript
// In client/src/lib/app-settings.tsx
export const useAppName = () => {
  const { settings } = useAppSettings();
  return settings?.app_name ?? "Xareable";
};
```

#### 4.2 Update Components to Use Dynamic Name

| File | Change |
|------|--------|
| [`client/src/pages/landing.tsx`](client/src/pages/landing.tsx) | Replace hardcoded "My Social Autopilot" with `useAppName()` |
| [`client/src/pages/auth.tsx`](client/src/pages/auth.tsx) | Replace hardcoded "My Social Autopilot" with `useAppName()` |
| [`client/src/components/app-sidebar.tsx`](client/src/components/app-sidebar.tsx) | Replace hardcoded brand name with `useAppName()` |
| [`client/index.html`](client/index.html) | Use default title, will be updated by context |

---

### Phase 5: Admin UI

#### 5.1 Add Settings Tab to Admin Page

Add new tab in [`client/src/pages/admin.tsx`](client/src/pages/admin.tsx):

```typescript
// Add to TabsList
<TabsTrigger value="settings">App Settings</TabsTrigger>

// Add TabsContent
<TabsContent value="settings">
  <AppSettingsTab />
</TabsContent>
```

#### 5.2 Create AppSettingsTab Component

```typescript
function AppSettingsTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Partial<AppSettings>>({});
  
  const { data, isLoading } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
    queryFn: () => fetch("/api/settings").then(res => res.json()),
  });
  
  useEffect(() => {
    if (data) setSettings(data);
  }, [data]);
  
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<AppSettings>) => {
      const sb = supabase();
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings updated successfully" });
    },
    onError: (e: any) => {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    },
  });
  
  // Form with fields for:
  // - App Name (text input)
  // - App Tagline (text input)
  // - Logo URL (text input with upload support)
  // - Primary Color (color picker)
  // - Secondary Color (color picker)
  // - Meta Title (text input)
  // - Meta Description (textarea)
  // - Terms URL (text input)
  // - Privacy URL (text input)
}
```

---

## File Changes Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `client/src/lib/app-settings.tsx` | App settings context and hooks |
| `supabase/migrations/20260303000000_app_settings.sql` | Database migration |

### Files to Modify

| File | Changes |
|------|---------|
| [`shared/schema.ts`](shared/schema.ts) | Add `appSettingsSchema` and types |
| [`server/routes.ts`](server/routes.ts) | Add `/api/settings` and `/api/admin/settings` endpoints |
| [`client/src/App.tsx`](client/src/App.tsx) | Wrap with `AppSettingsProvider` |
| [`client/src/pages/landing.tsx`](client/src/pages/landing.tsx) | Use `useAppName()` hook |
| [`client/src/pages/auth.tsx`](client/src/pages/auth.tsx) | Use `useAppName()` hook |
| [`client/src/components/app-sidebar.tsx`](client/src/components/app-sidebar.tsx) | Use `useAppName()` hook |
| [`client/src/pages/admin.tsx`](client/src/pages/admin.tsx) | Add App Settings tab |
| [`client/index.html`](client/index.html) | Update default title to "Xareable" |

---

## Migration Strategy

1. **Deploy Database Migration First**: Create `app_settings` table with default "Xareable" values
2. **Deploy Backend Changes**: Add API endpoints
3. **Deploy Frontend Changes**: Context provider and UI updates
4. **Verify**: All pages show "Xareable" from database

---

## Future Enhancements (Out of Scope)

- Custom CSS injection
- Custom domain mapping
- Email template branding
- Multiple white-label configurations per tenant
