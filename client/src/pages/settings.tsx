import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Key, ExternalLink, Eye, EyeOff, Check, Shield } from "lucide-react";
import { motion } from "framer-motion";

export default function SettingsPage() {
  const { profile, user, refreshProfile } = useAuth();
  const [apiKey, setApiKey] = useState(profile?.api_key || "");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!apiKey.trim()) {
      toast({ title: "Please enter your API key", variant: "destructive" });
      return;
    }
    setSaving(true);
    const sb = supabase();
    const { error } = await sb
      .from("profiles")
      .update({ api_key: apiKey.trim() })
      .eq("id", user!.id);
    setSaving(false);

    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({ title: "API key saved successfully" });
    }
  }

  const isFirstTime = !profile?.api_key;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {isFirstTime && (
            <div className="mb-6 rounded-md bg-primary/5 border border-primary/10 p-4">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-sm">Setup Required</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    To generate AI content, you need to add your Google Gemini API key first.
                    Your key is stored securely and only used to make API calls on your behalf.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">
              Settings
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage your account settings and API configuration.
            </p>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Key className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Google Gemini API Key</CardTitle>
                  <CardDescription>
                    Used for AI-powered content and image generation
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="api-key"
                    type={showKey ? "text" : "password"}
                    placeholder="AIza..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="pr-10"
                    data-testid="input-api-key"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowKey(!showKey)}
                    data-testid="button-toggle-key"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary"
                  data-testid="link-get-key"
                >
                  Get your API key from Google AI Studio
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <Button
                  onClick={handleSave}
                  disabled={saving || !apiKey.trim()}
                  data-testid="button-save-key"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Save Key
                </Button>
              </div>

              {profile?.api_key && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  API key is configured
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
