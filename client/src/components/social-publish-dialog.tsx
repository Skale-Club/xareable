/**
 * SocialPublishDialog — Zernio Social Publishing (Phase P3 Client)
 *
 * Opened from the post viewer (and, in future, the posts grid) to publish a
 * post directly to the user's connected Instagram / Facebook accounts via
 * Zernio. See docs/zernio-social-publishing.md for the full contract.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { apiRequest } from "@/lib/queryClient";
import {
  Instagram,
  Facebook,
  Send,
  Loader2,
  ExternalLink,
  RotateCcw,
  LayoutPanelTop,
  Info,
  Sparkles,
} from "lucide-react";
import type { Post, SocialAccount, SocialStatusResponse, PostPublication } from "@shared/schema";
import {
  PLATFORM_COPY_RULES,
  isCopyPlatform,
  publishTextFor,
  validatePlatformCopy,
  type CopyPlatform,
  type PlatformCopy,
} from "@shared/platform-copy";

type PublishablePost = Pick<Post, "id" | "caption" | "content_type" | "slide_count">;

interface SocialPublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: PublishablePost;
}

type SocialAccountsResponse = {
  configured: boolean;
  mode?: "byok" | "global";
  accounts: SocialAccount[];
};

type PublicationsResponse = { publications: PostPublication[] };

type PlatformCopyResponse = { copies: PlatformCopy[]; repaired?: boolean };

/** Editable per-platform text, keyed by platform. null = the single shared caption is used. */
type CopyDrafts = Partial<Record<CopyPlatform, PlatformCopy>>;

function platformIcon(platform: string) {
  if (platform === "instagram") return Instagram;
  if (platform === "facebook") return Facebook;
  return Send;
}

export function SocialPublishDialog({ open, onOpenChange, post }: SocialPublishDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [caption, setCaption] = useState(post.caption || "");
  const [timing, setTiming] = useState<"now" | "schedule">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [igContentType, setIgContentType] = useState<"feed" | "story">("feed");
  const [igFirstComment, setIgFirstComment] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [copyDrafts, setCopyDrafts] = useState<CopyDrafts | null>(null);
  const [isWriting, setIsWriting] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery<SocialStatusResponse>({
    queryKey: ["/api/social/status"],
    enabled: open,
  });

  const { data: accountsResp, isLoading: accountsLoading } = useQuery<SocialAccountsResponse>({
    queryKey: ["/api/social/accounts"],
    enabled: open,
  });

  const { data: publicationsResp } = useQuery<PublicationsResponse>({
    queryKey: ["/api/social/publications", post.id],
    queryFn: () => apiRequest("GET", `/api/social/publications?post_id=${post.id}`).then((r) => r.json()),
    enabled: open && !!post.id,
  });

  // Reset the form whenever the dialog opens (possibly for a different post).
  useEffect(() => {
    if (open) {
      setCaption(post.caption || "");
      setSelectedAccountIds([]);
      setTiming("now");
      setScheduledFor("");
      setIgContentType("feed");
      setIgFirstComment("");
      setCopyDrafts(null);
    }
  }, [open, post.id]);

  const configured = status?.configured ?? false;
  const accounts = useMemo(() => (accountsResp?.accounts || []).filter((a) => a.is_active), [accountsResp]);
  const publications = publicationsResp?.publications || [];
  const hasInstagramSelected = selectedAccountIds.some(
    (id) => accounts.find((a) => a.id === id)?.platform === "instagram",
  );

  // Platforms of the selected accounts that have per-platform rules (Instagram, Facebook today).
  const selectedPlatforms = useMemo(() => {
    const seen = new Set<CopyPlatform>();
    for (const id of selectedAccountIds) {
      const platform = accounts.find((a) => a.id === id)?.platform;
      if (isCopyPlatform(platform)) seen.add(platform);
    }
    return [...seen];
  }, [selectedAccountIds, accounts]);
  const draftedPlatforms = selectedPlatforms.filter((platform) => copyDrafts?.[platform]);
  const hasDraftIssues = draftedPlatforms.some((platform) => !validatePlatformCopy(copyDrafts![platform]!).ok);

  const minDateTimeLocal = useMemo(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }, []);

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleGoToSettings() {
    onOpenChange(false);
    setLocation("/settings?tab=social");
  }

  async function handleWriteForPlatforms() {
    if (selectedPlatforms.length === 0 || isWriting) return;
    setIsWriting(true);
    try {
      const response = await apiRequest("POST", "/api/social/platform-copy", {
        post_id: post.id,
        platforms: selectedPlatforms,
      });
      const data = (await response.json()) as PlatformCopyResponse;
      setCopyDrafts((prev) => {
        const next: CopyDrafts = { ...(prev || {}) };
        for (const copy of data.copies) next[copy.platform] = copy;
        return next;
      });
    } catch (error: any) {
      toast({
        title: t("Could not write the texts"),
        description: String(error?.message || t("Please try again.")),
        variant: "destructive",
      });
    } finally {
      setIsWriting(false);
    }
  }

  function updateDraft(platform: CopyPlatform, field: "title" | "body", value: string) {
    setCopyDrafts((prev) => {
      const current = prev?.[platform];
      if (!current) return prev;
      return { ...prev, [platform]: { ...current, [field]: value } };
    });
  }

  async function handlePublish() {
    if (selectedAccountIds.length === 0 || isPublishing) return;
    if (timing === "schedule" && !scheduledFor) return;

    setIsPublishing(true);
    try {
      // Always send the caption — an explicitly emptied textarea means
      // "publish with no caption" (Zernio allows empty content with media);
      // omitting the field would make the server fall back to post.caption.
      const body: Record<string, unknown> = {
        post_id: post.id,
        account_ids: selectedAccountIds,
        caption: caption.trim(),
      };
      if (timing === "schedule" && scheduledFor) {
        body.scheduled_for = new Date(scheduledFor).toISOString();
      }
      if (hasInstagramSelected) {
        body.instagram_options = {
          content_type: igContentType,
          first_comment: igFirstComment.trim() || undefined,
        };
      }
      // Platforms with their own written text publish that text; the rest use `caption`.
      if (draftedPlatforms.length > 0) {
        body.platform_captions = Object.fromEntries(
          draftedPlatforms.map((platform) => [platform, publishTextFor(copyDrafts![platform]!)]),
        );
      }

      const response = await apiRequest("POST", "/api/social/publish", body);
      const result = (await response.json().catch(() => null)) as
        | { failed?: { platform: string; message: string }[] }
        | null;
      qc.invalidateQueries({ queryKey: ["/api/social/publications", post.id] });
      if (result?.failed && result.failed.length > 0) {
        // Some platforms went out and some did not: say exactly which.
        toast({
          title: t("Some platforms did not publish"),
          description: result.failed.map((f) => `${f.platform}: ${f.message}`).join(" · "),
          variant: "destructive",
        });
      } else {
        toast({
          title: timing === "schedule" ? t("Post scheduled") : t("Post sent for publishing"),
        });
      }
    } catch (error: any) {
      toast({
        title: t("Publish failed"),
        description: String(error?.message || t("Could not publish this post right now.")),
        variant: "destructive",
      });
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleRetry(publicationId: string) {
    if (retryingId) return;
    setRetryingId(publicationId);
    try {
      await apiRequest("POST", `/api/social/publications/${publicationId}/retry`);
      qc.invalidateQueries({ queryKey: ["/api/social/publications", post.id] });
      toast({ title: t("Retrying publish") });
    } catch (error: any) {
      toast({
        title: t("Retry failed"),
        description: String(error?.message || ""),
        variant: "destructive",
      });
    } finally {
      setRetryingId(null);
    }
  }

  const canSubmit =
    configured &&
    selectedAccountIds.length > 0 &&
    !isPublishing &&
    !hasDraftIssues &&
    (timing === "now" || !!scheduledFor);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-social-publish">
        <DialogHeader>
          <DialogTitle>{t("Publish to social media")}</DialogTitle>
          <DialogDescription>
            {t("Send this post directly to your connected Instagram and Facebook accounts.")}
          </DialogDescription>
        </DialogHeader>

        {statusLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !configured ? (
          <div className="flex flex-col items-center text-center gap-3 py-8">
            <Send className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-sm">
              {t("Connect a Zernio account to publish directly to Instagram and Facebook from Xareable.")}
            </p>
            <Button onClick={handleGoToSettings} data-testid="button-goto-settings-social">
              {t("Go to Settings")}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Accounts */}
            <div className="space-y-2">
              <Label>{t("Accounts")}</Label>
              {accountsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("Loading accounts...")}
                </div>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("No connected accounts yet.")}{" "}
                  <button
                    type="button"
                    className="underline hover:no-underline"
                    onClick={handleGoToSettings}
                    data-testid="button-connect-accounts-link"
                  >
                    {t("Connect one in Settings.")}
                  </button>
                </p>
              ) : (
                <div className="space-y-2">
                  {accounts.map((account) => {
                    const Icon = platformIcon(account.platform);
                    return (
                      <label
                        key={account.id}
                        className="flex items-center gap-3 rounded-md border p-2.5 cursor-pointer hover-elevate"
                        data-testid={`row-social-account-${account.id}`}
                      >
                        <Checkbox
                          checked={selectedAccountIds.includes(account.id)}
                          onCheckedChange={() => toggleAccount(account.id)}
                          data-testid={`checkbox-social-account-${account.id}`}
                        />
                        <Avatar className="h-7 w-7">
                          {account.avatar_url && (
                            <AvatarImage src={account.avatar_url} alt={account.username || account.platform} />
                          )}
                          <AvatarFallback>
                            <Icon className="w-3.5 h-3.5" />
                          </AvatarFallback>
                        </Avatar>
                        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          @{account.username || account.display_name || account.platform}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Caption */}
            <div className="space-y-2">
              <Label htmlFor="social-publish-caption">{t("Caption")}</Label>
              <Textarea
                id="social-publish-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="min-h-[100px]"
                data-testid="textarea-social-caption"
              />
            </div>

            {/* Per-platform text */}
            {selectedPlatforms.length > 0 && (
              <div className="space-y-3" data-testid="section-platform-copy">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {t("Each platform has its own rules. Write a version for every selected platform, with hashtags that fit its limits.")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={handleWriteForPlatforms}
                    disabled={isWriting}
                    data-testid="button-write-platform-copy"
                  >
                    {isWriting ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {draftedPlatforms.length > 0 ? t("Rewrite for each platform") : t("Write for each platform")}
                  </Button>
                </div>

                {selectedPlatforms.map((platform) => {
                  const draft = copyDrafts?.[platform];
                  if (!draft) return null;
                  const rule = PLATFORM_COPY_RULES[platform];
                  const { issues, counts } = validatePlatformCopy(draft);
                  const Icon = platformIcon(platform);
                  const hashtagRange =
                    rule.hashtagMin === 0
                      ? `${t("up to")} ${rule.hashtagMax}`
                      : `${rule.hashtagMin}–${rule.hashtagMax}`;
                  return (
                    <div key={platform} className="space-y-2 rounded-md border border-border/60 p-3" data-testid={`copy-${platform}`}>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="w-4 h-4" />
                        {rule.label}
                      </div>

                      {rule.hasTitle && (
                        <div className="space-y-1">
                          <Label htmlFor={`copy-title-${platform}`}>{t("Title")}</Label>
                          <Input
                            id={`copy-title-${platform}`}
                            value={draft.title ?? ""}
                            onChange={(e) => updateDraft(platform, "title", e.target.value)}
                            data-testid={`input-copy-title-${platform}`}
                          />
                          <p
                            className={`text-xs ${rule.titleMax !== null && counts.titleLength > rule.titleMax ? "text-destructive" : "text-muted-foreground"}`}
                          >
                            {counts.titleLength} / {rule.titleMax}
                          </p>
                        </div>
                      )}

                      {rule.hasBody && (
                        <div className="space-y-1">
                          <Label htmlFor={`copy-body-${platform}`}>{rule.hasTitle ? t("Description") : t("Text")}</Label>
                          <Textarea
                            id={`copy-body-${platform}`}
                            value={draft.body ?? ""}
                            onChange={(e) => updateDraft(platform, "body", e.target.value)}
                            className="min-h-[110px]"
                            data-testid={`textarea-copy-body-${platform}`}
                          />
                          <p
                            className={`text-xs ${rule.bodyMax !== null && counts.bodyLength > rule.bodyMax ? "text-destructive" : "text-muted-foreground"}`}
                          >
                            {counts.bodyLength} / {rule.bodyMax}
                          </p>
                        </div>
                      )}

                      <p
                        className={`text-xs ${counts.hashtags < rule.hashtagMin || counts.hashtags > rule.hashtagMax ? "text-destructive" : "text-muted-foreground"}`}
                        data-testid={`copy-hashtags-${platform}`}
                      >
                        {counts.hashtags} {t("hashtags")} ({hashtagRange})
                      </p>

                      {issues.length > 0 && (
                        <ul className="space-y-0.5 text-xs text-destructive" data-testid={`copy-issues-${platform}`}>
                          {issues.map((issue) => (
                            <li key={issue.code}>{issue.message}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}

                {draftedPlatforms.length > 0 && (
                  <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {t("Platform limits are working defaults and have not been checked against each platform's official rules yet. Platforms without a written version use the caption above.")}
                  </p>
                )}
              </div>
            )}

            {/* Carousel note */}
            {post.content_type === "carousel" && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md border border-border/60 bg-muted/20 p-2.5">
                <LayoutPanelTop className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {t("This post will publish as a multi-image carousel with {n} slides (max 10 per platform).").replace(
                    "{n}",
                    String(post.slide_count ?? 1),
                  )}
                </span>
              </div>
            )}

            {/* Timing */}
            <div className="space-y-2">
              <Label>{t("Timing")}</Label>
              <RadioGroup
                value={timing}
                onValueChange={(v) => setTiming(v as "now" | "schedule")}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="now" id="social-timing-now" />
                  <Label htmlFor="social-timing-now" className="font-normal cursor-pointer">
                    {t("Publish now")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="schedule" id="social-timing-schedule" />
                  <Label htmlFor="social-timing-schedule" className="font-normal cursor-pointer">
                    {t("Schedule")}
                  </Label>
                </div>
              </RadioGroup>
              {timing === "schedule" && (
                <Input
                  type="datetime-local"
                  min={minDateTimeLocal}
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  data-testid="input-social-scheduled-for"
                />
              )}
            </div>

            {/* Instagram options */}
            {hasInstagramSelected && (
              <div className="space-y-3 rounded-md border border-border/60 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Instagram className="w-4 h-4" />
                  {t("Instagram options")}
                </div>
                <div className="space-y-2">
                  <Label>{t("Post as")}</Label>
                  <Select value={igContentType} onValueChange={(v) => setIgContentType(v as "feed" | "story")}>
                    <SelectTrigger data-testid="select-instagram-content-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="feed">{t("Feed")}</SelectItem>
                      <SelectItem value="story">{t("Story")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="social-ig-first-comment">{t("First comment (optional)")}</Label>
                  <Textarea
                    id="social-ig-first-comment"
                    value={igFirstComment}
                    onChange={(e) => setIgFirstComment(e.target.value)}
                    placeholder={t("Add a first comment, e.g. hashtags")}
                    className="min-h-[60px]"
                    data-testid="textarea-instagram-first-comment"
                  />
                </div>
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {t("Instagram will label this post as AI-generated, as required by Meta.")}
                </p>
              </div>
            )}

            {/* Existing publications for this post */}
            {publications.length > 0 && (
              <div className="space-y-2">
                <Label>{t("Publication history")}</Label>
                <div className="space-y-2">
                  {publications.map((pub) => {
                    const Icon = platformIcon(pub.platform);
                    return (
                      <div
                        key={pub.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                        data-testid={`row-publication-${pub.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <span className="text-sm truncate capitalize">{pub.platform}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {pub.status === "published" ? (
                            <Badge className="text-white" style={{ backgroundColor: "var(--app-success-color)" }}>
                              {pub.platform_post_url ? (
                                <a
                                  href={pub.platform_post_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1"
                                  data-testid={`link-publication-${pub.id}`}
                                >
                                  {t("Published")} <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                t("Published")
                              )}
                            </Badge>
                          ) : pub.status === "failed" ? (
                            <>
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="destructive" data-testid={`badge-publication-failed-${pub.id}`}>
                                      {t("Failed")}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p className="text-xs">{pub.error_message || t("Unknown error")}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRetry(pub.id)}
                                disabled={retryingId !== null}
                                data-testid={`button-retry-publication-${pub.id}`}
                              >
                                {retryingId === pub.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3.5 h-3.5" />
                                )}
                              </Button>
                            </>
                          ) : (
                            <Badge variant="secondary">
                              {pub.status === "scheduled" ? t("Scheduled") : t("Pending")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {configured && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-social-publish">
              {t("Cancel")}
            </Button>
            <Button onClick={handlePublish} disabled={!canSubmit} data-testid="button-submit-social-publish">
              {isPublishing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              {timing === "schedule" ? t("Schedule post") : t("Publish now")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
