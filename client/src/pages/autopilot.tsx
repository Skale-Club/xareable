/**
 * Autopilot — Auto-Post Scheduling System (client)
 *
 * `/autopilot`: manage "tracks" (trilhas) of automatic post creation, review
 * the manual-approval queue, and browse recent generation/publish history.
 * See docs/autopost-scheduling.md for the full state machine and cron design
 * this page is a client for (server/routes/autopost.routes.ts).
 *
 * Timezone note: `posting_times` / `weekly_day` travel over the wire in UTC
 * (see shared/schema.ts). The small pure helpers below convert local <-> UTC
 * for the track form only — everywhere else (next_slot_at, scheduled_for,
 * published_at, ...) is a full timestamptz that the browser's Date/Intl
 * already renders in local time with no conversion needed.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContentLanguageSelect } from "@/components/ui/ContentLanguageSelect";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Clock,
  ExternalLink,
  ChevronDown,
  Instagram,
  Facebook,
  Send,
} from "lucide-react";
import { DEFAULT_STYLE_CATALOG } from "@shared/schema";
import type {
  AutoPostTrack,
  AutoPostItem,
  AutoPostTrackCadence,
  AutoPostApprovalMode,
  AutoPostItemStatus,
  SocialAccount,
  SupportedLanguage,
  StyleCatalog,
} from "@shared/schema";

// ── Timezone helpers (pure) ──────────────────────────────────────────────────
// posting_times / weekly_day are UTC on the wire. These convert local <-> UTC
// for the track form, including the calendar-day shift a conversion can
// introduce when it crosses midnight (needed to correct weekly_day).

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Whole-day (rounded) difference between two midnight instants, `aMidnightMs
 * - bMidnightMs`. Comparing calendar-day *numbers* directly (e.g.
 * `.getDate() - 2`) breaks at month/year boundaries (Jan 31 -> Feb 1 is a +1
 * shift, but 1 - 31 = -30); comparing absolute millisecond instants of each
 * side's own midnight does not, since Date's constructors normalize rollover
 * internally. Real-world UTC offsets never reach 24h, so the result is
 * always exactly -1, 0, or +1.
 */
function dayShiftBetween(aMidnightMs: number, bMidnightMs: number): -1 | 0 | 1 {
  return Math.round((aMidnightMs - bMidnightMs) / (24 * 60 * 60 * 1000)) as -1 | 0 | 1;
}

/**
 * UTC "HH:MM" -> local "HH:MM" + calendar-day shift (-1, 0, or +1).
 * Anchored on TODAY's UTC date (m1: a FIXED historical anchor like
 * 2000-01-02 uses THAT date's offset rules, which is wrong for roughly half
 * the year in DST zones, and permanently wrong for any zone whose rules
 * changed since — e.g. Brazil dropped DST in 2019. Anchoring on "now"
 * always uses the offset actually in effect today).
 */
function utcTimeToLocal(utcHHMM: string): { time: string; dayShift: -1 | 0 | 1 } {
  const [h, m] = utcHHMM.split(":").map(Number);
  const now = new Date();
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0, 0));

  const utcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const localMidnightMs = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()).getTime();

  return {
    time: `${pad2(anchor.getHours())}:${pad2(anchor.getMinutes())}`,
    // local day minus UTC day — e.g. -1 means the local calendar day is one
    // day BEHIND the UTC day this posting_time is stored against.
    dayShift: dayShiftBetween(localMidnightMs, utcMidnightMs),
  };
}

/** Inverse of utcTimeToLocal: local "HH:MM" -> UTC "HH:MM" + day shift.
 * Also anchored on TODAY (today's LOCAL date, this time — see utcTimeToLocal). */
function localTimeToUtc(localHHMM: string): { time: string; dayShift: -1 | 0 | 1 } {
  const [h, m] = localHHMM.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0); // today, at the given local wall-clock time

  const localMidnightMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const utcMidnightMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  return {
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
    // UTC day minus local day — the inverse sign convention of
    // utcTimeToLocal's dayShift (this is what gets ADDED to a local weekday
    // to store it as a UTC weekly_day — see handleSubmit below).
    dayShift: dayShiftBetween(utcMidnightMs, localMidnightMs),
  };
}

function shiftWeekday(day: number, shift: number): number {
  return (day + shift + 7) % 7;
}

const WEEKDAY_KEYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const ASPECT_RATIO_OPTIONS = ["1:1", "4:5", "3:4", "9:16", "16:9", "4:3"] as const;
/** Radix Select disallows an empty-string item value, so "no override" (the
 * `postMood: ""` form-state / omitted generation_params.post_mood convention)
 * needs a non-empty sentinel in the UI layer only. */
const DEFAULT_POST_MOOD_VALUE = "__default__";

function formatCadenceSummary(track: AutoPostTrack, t: (s: string) => string): string {
  const localTimes = track.posting_times.map((utc) => utcTimeToLocal(utc).time).sort();
  const timesStr = localTimes.join(", ");
  if (track.cadence === "daily") {
    return t("Daily at {times}").replace("{times}", timesStr);
  }
  const dayShift = track.posting_times.length > 0 ? utcTimeToLocal(track.posting_times[0]).dayShift : 0;
  const localWeekday =
    track.weekly_day !== null && track.weekly_day !== undefined ? shiftWeekday(track.weekly_day, dayShift) : null;
  const dayLabel = localWeekday !== null ? t(WEEKDAY_KEYS[localWeekday]) : "?";
  return t("Weekly on {day} at {times}").replace("{day}", dayLabel).replace("{times}", timesStr);
}

function platformIcon(platform: string) {
  if (platform === "instagram") return Instagram;
  if (platform === "facebook") return Facebook;
  return Send;
}

function getStatusMeta(
  status: AutoPostItemStatus,
  t: (s: string) => string,
): { label: string; variant: "default" | "secondary" | "destructive" | "outline"; spinning: boolean } {
  switch (status) {
    case "queued":
      return { label: t("Queued"), variant: "secondary", spinning: false };
    case "generating":
      return { label: t("Generating"), variant: "secondary", spinning: true };
    case "awaiting_approval":
      return { label: t("Awaiting Approval"), variant: "outline", spinning: false };
    case "approved":
      return { label: t("Approved"), variant: "outline", spinning: false };
    case "publishing":
      return { label: t("Publishing"), variant: "secondary", spinning: true };
    case "published":
      return { label: t("Published"), variant: "default", spinning: false };
    case "rejected":
      return { label: t("Rejected"), variant: "outline", spinning: false };
    case "failed":
      return { label: t("Failed"), variant: "destructive", spinning: false };
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type AutoPostItemRow = AutoPostItem & {
  post: { image_url: string | null; thumbnail_url: string | null; caption: string | null } | null;
  track: { name: string } | null;
};

type SocialAccountsResponse = { configured: boolean; mode?: "byok" | "global"; accounts: SocialAccount[] };

interface TrackPayload {
  name: string;
  system_prompt: string;
  cadence: AutoPostTrackCadence;
  posting_times: string[];
  weekly_day?: number;
  approval_mode: AutoPostApprovalMode;
  account_ids: string[];
  generation_params: {
    aspect_ratio?: string;
    content_language?: SupportedLanguage;
    use_text?: boolean;
    use_logo?: boolean;
    post_mood?: string;
  };
  is_active: boolean;
}

interface TrackFormState {
  name: string;
  systemPrompt: string;
  cadence: AutoPostTrackCadence;
  localTimes: string[];
  localWeekday: number;
  approvalMode: AutoPostApprovalMode;
  accountIds: string[];
  isActive: boolean;
  aspectRatio: string;
  contentLanguage: SupportedLanguage;
  postMood: string;
  useText: boolean;
  useLogo: boolean;
}

function buildInitialFormState(track: AutoPostTrack | null): TrackFormState {
  if (!track) {
    return {
      name: "",
      systemPrompt: "",
      cadence: "daily",
      localTimes: ["09:00"],
      localWeekday: new Date().getDay(),
      approvalMode: "manual",
      accountIds: [],
      isActive: true,
      aspectRatio: "1:1",
      contentLanguage: "en",
      postMood: "",
      useText: true,
      useLogo: false,
    };
  }

  const localTimes = track.posting_times.length > 0 ? track.posting_times.map((utc) => utcTimeToLocal(utc).time) : ["09:00"];
  const firstShift = track.posting_times.length > 0 ? utcTimeToLocal(track.posting_times[0]).dayShift : 0;
  const localWeekday =
    track.weekly_day !== null && track.weekly_day !== undefined
      ? shiftWeekday(track.weekly_day, firstShift)
      : new Date().getDay();
  const gp = track.generation_params || {};

  return {
    name: track.name,
    systemPrompt: track.system_prompt,
    cadence: track.cadence,
    localTimes,
    localWeekday,
    approvalMode: track.approval_mode,
    accountIds: track.account_ids,
    isActive: track.is_active,
    aspectRatio: gp.aspect_ratio ?? "1:1",
    contentLanguage: gp.content_language ?? "en",
    postMood: gp.post_mood ?? "",
    useText: gp.use_text ?? true,
    useLogo: gp.use_logo ?? false,
  };
}

// ── Track form dialog ────────────────────────────────────────────────────────

interface TrackFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: AutoPostTrack | null;
  accounts: SocialAccount[];
  accountsConfigured: boolean;
  accountsLoading: boolean;
  submitting: boolean;
  onSubmit: (payload: TrackPayload) => void;
}

function TrackFormDialog({
  open,
  onOpenChange,
  track,
  accounts,
  accountsConfigured,
  accountsLoading,
  submitting,
  onSubmit,
}: TrackFormDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState<TrackFormState>(() => buildInitialFormState(track));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // m6 — same source post-creator-dialog.tsx reads post moods from, so the
  // ids offered here always match what the server (and generateAutoPost)
  // actually recognize.
  const { data: styleCatalog } = useQuery<StyleCatalog>({
    queryKey: ["/api/style-catalog"],
    enabled: open,
  });
  const catalog = styleCatalog || DEFAULT_STYLE_CATALOG;
  const postMoods = catalog.post_moods?.length ? catalog.post_moods : DEFAULT_STYLE_CATALOG.post_moods;

  useEffect(() => {
    if (open) {
      setForm(buildInitialFormState(track));
      setAdvancedOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, track?.id]);

  function updateLocalTime(index: number, value: string) {
    setForm((prev) => ({ ...prev, localTimes: prev.localTimes.map((v, i) => (i === index ? value : v)) }));
  }

  function addLocalTime() {
    setForm((prev) => (prev.localTimes.length >= 4 ? prev : { ...prev, localTimes: [...prev.localTimes, "12:00"] }));
  }

  function removeLocalTime(index: number) {
    setForm((prev) =>
      prev.localTimes.length <= 1 ? prev : { ...prev, localTimes: prev.localTimes.filter((_, i) => i !== index) },
    );
  }

  function toggleAccount(id: string) {
    setForm((prev) => ({
      ...prev,
      accountIds: prev.accountIds.includes(id) ? prev.accountIds.filter((x) => x !== id) : [...prev.accountIds, id],
    }));
  }

  function handleGoToSocialSettings() {
    onOpenChange(false);
    setLocation("/settings?tab=social");
  }

  function handleSubmit() {
    if (!form.name.trim()) {
      toast({ title: t("Name is required."), variant: "destructive" });
      return;
    }
    if (!form.systemPrompt.trim()) {
      toast({ title: t("System prompt is required."), variant: "destructive" });
      return;
    }
    if (form.localTimes.length === 0) {
      toast({ title: t("At least one posting time is required."), variant: "destructive" });
      return;
    }
    // m3 — belt-and-suspenders with the server's own EFFECTIVE-config check:
    // an 'auto' track with no target accounts would generate (and charge
    // for) a post every slot forever with nowhere to publish it.
    if (form.approvalMode === "auto" && form.accountIds.length === 0) {
      toast({
        title: t("Automatic mode requires at least one target account — select one or switch to Manual approval."),
        variant: "destructive",
      });
      return;
    }

    const converted = form.localTimes.map((lt) => localTimeToUtc(lt));
    const postingTimes = Array.from(new Set(converted.map((c) => c.time)));

    let weeklyDay: number | undefined;
    if (form.cadence === "weekly") {
      const utcWeekdays = Array.from(new Set(converted.map((c) => shiftWeekday(form.localWeekday, c.dayShift))));
      if (utcWeekdays.length > 1) {
        toast({
          title: t("All posting times must fall on the same day in UTC — adjust the times or split into separate tracks."),
          variant: "destructive",
        });
        return;
      }
      weeklyDay = utcWeekdays[0];
    }

    const generation_params: TrackPayload["generation_params"] = {
      aspect_ratio: form.aspectRatio,
      content_language: form.contentLanguage,
      use_text: form.useText,
      use_logo: form.useLogo,
    };
    if (form.postMood.trim()) generation_params.post_mood = form.postMood.trim();

    onSubmit({
      name: form.name.trim(),
      system_prompt: form.systemPrompt.trim(),
      cadence: form.cadence,
      posting_times: postingTimes,
      weekly_day: form.cadence === "weekly" ? weeklyDay : undefined,
      approval_mode: form.approvalMode,
      account_ids: form.accountIds,
      generation_params,
      is_active: form.isActive,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-track-form">
        <DialogHeader>
          <DialogTitle>{track ? t("Edit Track") : t("New Track")}</DialogTitle>
          <DialogDescription>
            {t("Configure what this track posts, how often, and whether it needs approval before publishing.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="track-name">{t("Track Name")}</Label>
            <Input
              id="track-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t("e.g. Daily promo posts")}
              maxLength={100}
              data-testid="input-track-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="track-system-prompt">{t("System Prompt")}</Label>
            <Textarea
              id="track-system-prompt"
              value={form.systemPrompt}
              onChange={(e) => setForm((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              placeholder={t("Describe the theme this track should post about, e.g. promotions or announcements.")}
              className="min-h-[90px]"
              maxLength={2000}
              data-testid="textarea-track-system-prompt"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("Cadence")}</Label>
            <Select
              value={form.cadence}
              onValueChange={(v) => setForm((prev) => ({ ...prev, cadence: v as AutoPostTrackCadence }))}
            >
              <SelectTrigger data-testid="select-track-cadence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{t("Daily")}</SelectItem>
                <SelectItem value="weekly">{t("Weekly")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.cadence === "weekly" && (
            <div className="space-y-2">
              <Label>{t("Day of the Week")}</Label>
              <Select
                value={String(form.localWeekday)}
                onValueChange={(v) => setForm((prev) => ({ ...prev, localWeekday: Number(v) }))}
              >
                <SelectTrigger data-testid="select-track-weekday">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_KEYS.map((key, idx) => (
                    <SelectItem key={key} value={String(idx)}>
                      {t(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("Posting Times (your local time)")}</Label>
            <div className="space-y-2">
              {form.localTimes.map((time, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => updateLocalTime(index, e.target.value)}
                    className="w-40"
                    data-testid={`input-track-time-${index}`}
                  />
                  {form.localTimes.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeLocalTime(index)}
                      aria-label={t("Remove")}
                      data-testid={`button-remove-time-${index}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              {form.localTimes.length < 4 && (
                <Button type="button" size="sm" variant="outline" onClick={addLocalTime} data-testid="button-add-time">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {t("Add time")}
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("Approval Mode")}</Label>
            <RadioGroup
              value={form.approvalMode}
              onValueChange={(v) => setForm((prev) => ({ ...prev, approvalMode: v as AutoPostApprovalMode }))}
              className="gap-2"
            >
              <label
                className={`flex items-center gap-2 rounded-md border p-2.5 ${
                  form.accountIds.length === 0 ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover-elevate"
                }`}
              >
                <RadioGroupItem
                  value="auto"
                  disabled={form.accountIds.length === 0}
                  data-testid="radio-approval-auto"
                />
                <span className="text-sm">{t("Automatic — publishes without review")}</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2.5 cursor-pointer hover-elevate">
                <RadioGroupItem value="manual" data-testid="radio-approval-manual" />
                <span className="text-sm">{t("Manual approval — you approve each post before it publishes")}</span>
              </label>
            </RadioGroup>
            {/* m3 — Automatic needs at least one target account (picked further
                down in this form); explain the disabled state inline instead
                of only surfacing it as a submit-time toast. */}
            {form.accountIds.length === 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {t("Select at least one target account below to enable Automatic mode.")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("Target Accounts")}</Label>
            {accountsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("Loading accounts...")}
              </div>
            ) : !accountsConfigured || accounts.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground space-y-1.5">
                <p>{t("You haven't connected any social accounts yet.")}</p>
                <button
                  type="button"
                  className="underline hover:no-underline inline-flex items-center gap-1"
                  onClick={handleGoToSocialSettings}
                  data-testid="button-goto-social-settings"
                >
                  {t("Connect one in Settings → Social.")}
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map((account) => {
                  const Icon = platformIcon(account.platform);
                  return (
                    <label
                      key={account.id}
                      className="flex items-center gap-3 rounded-md border p-2.5 cursor-pointer hover-elevate"
                      data-testid={`row-track-account-${account.id}`}
                    >
                      <Checkbox
                        checked={form.accountIds.includes(account.id)}
                        onCheckedChange={() => toggleAccount(account.id)}
                        data-testid={`checkbox-track-account-${account.id}`}
                      />
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">
                        @{account.username || account.display_name || account.platform}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {form.accountIds.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {t("Publishing will fail until you select at least one account.")}
              </p>
            )}
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-between px-0"
                data-testid="button-toggle-advanced-settings"
              >
                <span>{t("Advanced Settings")}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label>{t("Aspect Ratio")}</Label>
                <Select
                  value={form.aspectRatio}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, aspectRatio: v }))}
                >
                  <SelectTrigger data-testid="select-track-aspect-ratio">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIO_OPTIONS.map((ar) => (
                      <SelectItem key={ar} value={ar}>
                        {ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ContentLanguageSelect
                value={form.contentLanguage}
                onChange={(v) => setForm((prev) => ({ ...prev, contentLanguage: v }))}
                label={t("Content Language")}
              />

              <div className="space-y-2">
                <Label htmlFor="track-post-mood">{t("Post Mood (optional)")}</Label>
                {/* m6 — a Select over the live style-catalog mood ids, not
                    free text: a typed value that doesn't match any catalog
                    id silently drops the mood's art direction server-side
                    (and, since the M6 server fix, is now rejected outright). */}
                <Select
                  value={form.postMood || DEFAULT_POST_MOOD_VALUE}
                  onValueChange={(v) =>
                    setForm((prev) => ({ ...prev, postMood: v === DEFAULT_POST_MOOD_VALUE ? "" : v }))
                  }
                >
                  <SelectTrigger id="track-post-mood" data-testid="select-track-post-mood">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_POST_MOOD_VALUE}>{t("Default (promo)")}</SelectItem>
                    {postMoods.map((mood) => (
                      <SelectItem key={mood.id} value={mood.id} data-testid={`select-track-post-mood-option-${mood.id}`}>
                        {t(mood.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="track-use-text" className="cursor-pointer">
                  {t("Add text overlay")}
                </Label>
                <Switch
                  id="track-use-text"
                  checked={form.useText}
                  onCheckedChange={(v) => setForm((prev) => ({ ...prev, useText: v }))}
                  data-testid="switch-track-use-text"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="track-use-logo" className="cursor-pointer">
                  {t("Add logo overlay")}
                </Label>
                <Switch
                  id="track-use-logo"
                  checked={form.useLogo}
                  onCheckedChange={(v) => setForm((prev) => ({ ...prev, useLogo: v }))}
                  data-testid="switch-track-use-logo"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between rounded-md border p-2.5">
            <div>
              <Label htmlFor="track-is-active" className="cursor-pointer">
                {t("Track Active")}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("Inactive tracks don't generate or publish new posts.")}
              </p>
            </div>
            <Switch
              id="track-is-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm((prev) => ({ ...prev, isActive: v }))}
              data-testid="switch-track-is-active"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-track-form">
            {t("Cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting} data-testid="button-submit-track-form">
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                {track ? t("Saving…") : t("Creating…")}
              </>
            ) : track ? (
              t("Save Changes")
            ) : (
              t("Create Track")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Track card ────────────────────────────────────────────────────────────────

interface TrackCardProps {
  track: AutoPostTrack;
  onEdit: (track: AutoPostTrack) => void;
  onDelete: (id: string) => void;
  onToggleActive: (track: AutoPostTrack) => void;
  onReactivate: (track: AutoPostTrack) => void;
}

function TrackCard({ track, onEdit, onDelete, onToggleActive, onReactivate }: TrackCardProps) {
  const { t } = useTranslation();
  const cadenceSummary = formatCadenceSummary(track, t);
  const modeLabel = track.approval_mode === "auto" ? t("Auto-publish") : t("Needs approval");
  const nextSlotLabel = track.next_slot_at ? new Date(track.next_slot_at).toLocaleString() : t("Not scheduled");

  return (
    <Card className="flex flex-col" data-testid={`track-card-${track.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{track.name}</CardTitle>
            <CardDescription className="line-clamp-2 mt-1">{track.system_prompt}</CardDescription>
          </div>
          <Switch
            checked={track.is_active}
            onCheckedChange={() => onToggleActive(track)}
            aria-label={t("Track Active")}
            data-testid={`switch-track-active-${track.id}`}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{cadenceSummary}</Badge>
          <Badge variant={track.approval_mode === "auto" ? "default" : "secondary"}>{modeLabel}</Badge>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            {t("Next post")}: {nextSlotLabel}
          </span>
        </div>
        {track.account_ids.length === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {t("Publishing will fail until you select at least one account.")}
          </p>
        )}
        {track.paused_reason && (
          <Alert variant="destructive" className="py-2.5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-sm">{t("Track paused")}</AlertTitle>
            <AlertDescription className="text-xs space-y-2">
              <p>{track.paused_reason}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onReactivate(track)}
                data-testid={`button-reactivate-${track.id}`}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                {t("Reactivate")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => onEdit(track)}
          data-testid={`button-edit-track-${track.id}`}
        >
          <Pencil className="w-3.5 h-3.5 mr-1" />
          {t("Edit")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="flex-1"
          onClick={() => onDelete(track.id)}
          data-testid={`button-delete-track-${track.id}`}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" />
          {t("Delete")}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Approval queue card ──────────────────────────────────────────────────────

interface ApprovalQueueCardProps {
  item: AutoPostItemRow;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}

function ApprovalQueueCard({ item, onApprove, onReject, busy }: ApprovalQueueCardProps) {
  const { t } = useTranslation();
  const thumb = item.post?.thumbnail_url || item.post?.image_url;

  return (
    <Card data-testid={`queue-item-${item.id}`}>
      <div className="flex gap-3 p-3">
        <div className="w-16 h-16 rounded-md bg-muted overflow-hidden shrink-0">
          {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {item.track?.name && <div className="text-xs text-muted-foreground truncate">{item.track.name}</div>}
          <p className="text-sm line-clamp-2">{item.post?.caption || t("No caption yet")}</p>
          <div className="text-xs text-muted-foreground">
            {t("Scheduled for {time}").replace("{time}", new Date(item.scheduled_for).toLocaleString())}
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0 justify-center">
          <Button
            type="button"
            size="sm"
            onClick={() => onApprove(item.id)}
            disabled={busy}
            data-testid={`button-approve-${item.id}`}
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            {t("Approve")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onReject(item.id)}
            disabled={busy}
            data-testid={`button-reject-${item.id}`}
          >
            <X className="w-3.5 h-3.5 mr-1" />
            {t("Reject")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── History row ──────────────────────────────────────────────────────────────

interface HistoryRowProps {
  item: AutoPostItemRow;
  onRetry: (id: string) => void;
  busy: boolean;
}

function HistoryRow({ item, onRetry, busy }: HistoryRowProps) {
  const { t } = useTranslation();
  const meta = getStatusMeta(item.status, t);
  const thumb = item.post?.thumbnail_url || item.post?.image_url;

  return (
    <div className="flex items-center gap-3 p-3 border-b last:border-b-0" data-testid={`history-item-${item.id}`}>
      <div className="w-10 h-10 rounded-md bg-muted overflow-hidden shrink-0">
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={meta.variant} className="inline-flex items-center gap-1">
            {meta.spinning && <Loader2 className="w-3 h-3 animate-spin" />}
            {meta.label}
          </Badge>
          {item.track?.name && <span className="text-xs text-muted-foreground truncate">{item.track.name}</span>}
        </div>
        {item.status === "failed" && item.error_message && (
          <p className="text-xs text-destructive mt-1">{item.error_message}</p>
        )}
        <div className="text-xs text-muted-foreground mt-0.5">{new Date(item.scheduled_for).toLocaleString()}</div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {item.status === "failed" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onRetry(item.id)}
            disabled={busy}
            data-testid={`button-retry-${item.id}`}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            {t("Retry")}
          </Button>
        )}
        {item.status === "published" && item.post?.image_url && (
          <a
            href={item.post.image_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline hover:no-underline inline-flex items-center gap-1"
            data-testid={`link-view-image-${item.id}`}
          >
            {t("View image")}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Loading skeletons ────────────────────────────────────────────────────────

function TracksSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full mt-2" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-md shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AutopilotPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTrack, setEditingTrack] = useState<AutoPostTrack | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // m2 — the global queryClient default is staleTime: Infinity / refetchOnWindowFocus:
  // false (see client/src/lib/queryClient.ts), which is right for most of the
  // app but leaves this page's approval queue and track health frozen at
  // whatever it looked like on mount — for an unattended, minutes-long cron
  // sweep, that means real status changes (a generation finishing, an
  // auto-pause tripping) never show up without a manual page reload. These
  // three queries opt back into polling + refocus refetch.
  const tracksQuery = useQuery<{ tracks: AutoPostTrack[] }>({
    queryKey: ["/api/autopost/tracks"],
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const queueQuery = useQuery<{ items: AutoPostItemRow[] }>({
    queryKey: ["/api/autopost/items", "awaiting_approval"],
    queryFn: () => apiRequest("GET", "/api/autopost/items?status=awaiting_approval&limit=50").then((r) => r.json()),
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const historyQuery = useQuery<{ items: AutoPostItemRow[] }>({
    queryKey: ["/api/autopost/items", "history"],
    queryFn: () => apiRequest("GET", "/api/autopost/items?limit=50").then((r) => r.json()),
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const accountsQuery = useQuery<SocialAccountsResponse>({
    queryKey: ["/api/social/accounts"],
    enabled: !!user,
  });

  const tracks = tracksQuery.data?.tracks ?? [];
  const queueItems = queueQuery.data?.items ?? [];
  const historyItems = (historyQuery.data?.items ?? []).filter((item) => item.status !== "awaiting_approval");
  const accounts = (accountsQuery.data?.accounts ?? []).filter((a) => a.is_active);
  const accountsConfigured = accountsQuery.data?.configured ?? false;

  function invalidateItems() {
    queryClient.invalidateQueries({ queryKey: ["/api/autopost/items"] });
  }

  const createTrackMutation = useMutation({
    mutationFn: async (payload: TrackPayload) => {
      const res = await apiRequest("POST", "/api/autopost/tracks", payload);
      return res.json() as Promise<{ track: AutoPostTrack }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autopost/tracks"] });
    },
    onError: (error: Error) => {
      toast({ title: t("Failed to create track"), description: error.message, variant: "destructive" });
    },
  });

  const updateTrackMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<TrackPayload> }) => {
      const res = await apiRequest("PATCH", `/api/autopost/tracks/${id}`, patch);
      return res.json() as Promise<{ track: AutoPostTrack }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autopost/tracks"] });
    },
    onError: (error: Error) => {
      toast({ title: t("Failed to update track"), description: error.message, variant: "destructive" });
    },
  });

  const deleteTrackMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/autopost/tracks/${id}`);
    },
    onSuccess: () => {
      toast({ title: t("Track deleted") });
      queryClient.invalidateQueries({ queryKey: ["/api/autopost/tracks"] });
    },
    onError: (error: Error) => {
      toast({ title: t("Failed to delete track"), description: error.message, variant: "destructive" });
    },
  });

  const approveItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/autopost/items/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("Post approved") });
      invalidateItems();
    },
    onError: (error: Error) => {
      toast({ title: t("Failed to approve post"), description: error.message, variant: "destructive" });
    },
  });

  const rejectItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/autopost/items/${id}/reject`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("Post rejected") });
      invalidateItems();
    },
    onError: (error: Error) => {
      toast({ title: t("Failed to reject post"), description: error.message, variant: "destructive" });
    },
  });

  const retryItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/autopost/items/${id}/retry`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("Retry queued") });
      invalidateItems();
    },
    onError: (error: Error) => {
      toast({ title: t("Failed to retry post"), description: error.message, variant: "destructive" });
    },
  });

  function handleNewTrack() {
    setEditingTrack(null);
    setDialogOpen(true);
  }

  function handleEditTrack(track: AutoPostTrack) {
    setEditingTrack(track);
    setDialogOpen(true);
  }

  function handleToggleActive(track: AutoPostTrack) {
    updateTrackMutation.mutate({ id: track.id, patch: { is_active: !track.is_active } });
  }

  function handleReactivate(track: AutoPostTrack) {
    updateTrackMutation.mutate(
      { id: track.id, patch: { is_active: true } },
      { onSuccess: () => toast({ title: t("Track reactivated") }) },
    );
  }

  function handleConfirmDelete() {
    if (!pendingDeleteId) return;
    deleteTrackMutation.mutate(pendingDeleteId);
    setPendingDeleteId(null);
  }

  function handleFormSubmit(payload: TrackPayload) {
    if (editingTrack) {
      updateTrackMutation.mutate(
        { id: editingTrack.id, patch: payload },
        {
          onSuccess: () => {
            toast({ title: t("Track updated") });
            setDialogOpen(false);
          },
        },
      );
    } else {
      createTrackMutation.mutate(payload, {
        onSuccess: () => {
          toast({ title: t("Track created") });
          setDialogOpen(false);
        },
      });
    }
  }

  const approvingId = approveItemMutation.isPending ? approveItemMutation.variables : null;
  const rejectingId = rejectItemMutation.isPending ? rejectItemMutation.variables : null;
  const retryingId = retryItemMutation.isPending ? retryItemMutation.variables : null;

  return (
    <div className="flex-1 overflow-auto p-6" data-testid="autopilot-page">
      <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6" />
            {t("Autopilot")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("Automatically generate and publish posts on a schedule.")}
          </p>
        </div>
        <Button onClick={handleNewTrack} data-testid="button-new-track">
          <Plus className="w-4 h-4 mr-1" />
          {t("New Track")}
        </Button>
      </header>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">{t("Tracks")}</h2>
        {tracksQuery.isLoading ? (
          <TracksSkeleton />
        ) : tracksQuery.isError ? (
          <p className="text-sm text-destructive">{t("Failed to load tracks.")}</p>
        ) : tracks.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border rounded-lg border-dashed" data-testid="text-tracks-empty">
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>{t("No tracks yet. Create one to start generating posts automatically.")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="tracks-grid">
            {tracks.map((track) => (
              <TrackCard
                key={track.id}
                track={track}
                onEdit={handleEditTrack}
                onDelete={setPendingDeleteId}
                onToggleActive={handleToggleActive}
                onReactivate={handleReactivate}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-1">{t("Approval Queue")}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t("Review generated posts before they publish.")}</p>
        {queueQuery.isLoading ? (
          <ListSkeleton />
        ) : queueQuery.isError ? (
          <p className="text-sm text-destructive">{t("Failed to load items.")}</p>
        ) : queueItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed" data-testid="text-queue-empty">
            <p>{t("No items awaiting approval.")}</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="approval-queue-list">
            {queueItems.map((item) => (
              <ApprovalQueueCard
                key={item.id}
                item={item}
                onApprove={(id) => approveItemMutation.mutate(id)}
                onReject={(id) => rejectItemMutation.mutate(id)}
                busy={approvingId === item.id || rejectingId === item.id}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-1">{t("History")}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t("Recent activity across all your tracks.")}</p>
        {historyQuery.isLoading ? (
          <ListSkeleton />
        ) : historyQuery.isError ? (
          <p className="text-sm text-destructive">{t("Failed to load items.")}</p>
        ) : historyItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed" data-testid="text-history-empty">
            <p>{t("No history yet.")}</p>
          </div>
        ) : (
          <Card data-testid="history-list">
            {historyItems.map((item) => (
              <HistoryRow
                key={item.id}
                item={item}
                onRetry={(id) => retryItemMutation.mutate(id)}
                busy={retryingId === item.id}
              />
            ))}
          </Card>
        )}
      </section>

      <TrackFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        track={editingTrack}
        accounts={accounts}
        accountsConfigured={accountsConfigured}
        accountsLoading={accountsQuery.isLoading}
        submitting={createTrackMutation.isPending || updateTrackMutation.isPending}
        onSubmit={handleFormSubmit}
      />

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this track?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This will permanently delete the track and its scheduling history. Posts already generated will remain in your library.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>{t("Delete Track")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
