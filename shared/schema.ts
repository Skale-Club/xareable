import { z } from "zod";

// ── Language Support ─────────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = ["en", "pt", "es"] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  pt: "Português",
  es: "Español",
};

export const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  en: "🇺🇸",
  pt: "🇧🇷",
  es: "🇪🇸",
};

// ── Translation Schemas ──────────────────────────────────────────────────────

export const translationSchema = z.object({
  id: z.string().uuid(),
  source_text: z.string(),
  source_language: z.string().default("en"),
  target_language: z.string(),
  translated_text: z.string(),
  created_at: z.string(),
});
export type Translation = z.infer<typeof translationSchema>;

export const translateRequestSchema = z.object({
  texts: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  targetLanguage: z.enum(SUPPORTED_LANGUAGES),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

export const translateResponseSchema = z.object({
  translations: z.record(z.string(), z.string()),
});
export type TranslateResponse = z.infer<typeof translateResponseSchema>;

// ── Profile ──────────────────────────────────────────────────────────────────

export const profileSchema = z.object({
  id: z.string().uuid(),
  api_key: z.string().nullable(),
  is_admin: z.boolean().default(false),
  is_affiliate: z.boolean().default(false),
  referred_by_affiliate_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

export const brandSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  company_name: z.string(),
  company_type: z.string(),
  color_1: z.string(),
  color_2: z.string(),
  color_3: z.string().nullable(),
  color_4: z.string().nullable(),
  mood: z.string(),
  logo_url: z.string().nullable(),
  created_at: z.string(),
});
export type Brand = z.infer<typeof brandSchema>;

export const insertBrandSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  company_type: z.string().min(1, "Company type is required"),
  color_1: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color"),
  color_2: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color"),
  color_3: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color").nullable().optional(),
  color_4: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color").nullable().optional(),
  mood: z.string().min(1, "Select a style"),
  logo_url: z.string().nullable().optional(),
});
export type InsertBrand = z.infer<typeof insertBrandSchema>;

export const brandStyleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
});
export type BrandStyle = z.infer<typeof brandStyleSchema>;

export const postMoodSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  style_ids: z.array(z.string().min(1)).default([]),
});
export type PostMood = z.infer<typeof postMoodSchema>;

export const aiModelsSchema = z.object({
  image_generation: z.string().default("gemini-3.1-flash-image-preview"),
  text_generation: z.string().default("gemini-2.5-flash"),
  audio_transcription: z.string().default("gemini-2.5-flash"),
  video_generation: z.string().default("veo-3.1-generate-preview"),
});
export type AIModels = z.infer<typeof aiModelsSchema>;

export const styleCatalogSchema = z.object({
  styles: z.array(brandStyleSchema).min(1),
  post_moods: z.array(postMoodSchema).min(1),
  ai_models: aiModelsSchema.optional(),
});
export type StyleCatalog = z.infer<typeof styleCatalogSchema>;
export const MAX_FEATURED_POST_MOODS_PER_STYLE = 4;

export const DEFAULT_STYLE_CATALOG: StyleCatalog = styleCatalogSchema.parse({
  styles: [
    { id: "professional", label: "Professional", description: "Clean, corporate, trustworthy" },
    { id: "playful", label: "Playful", description: "Fun, colorful, energetic" },
    { id: "minimalist", label: "Minimalist", description: "Simple, elegant, refined" },
    { id: "bold", label: "Bold", description: "Strong, impactful, daring" },
    { id: "elegant", label: "Elegant", description: "Sophisticated, luxurious, graceful" },
    { id: "tech", label: "Tech / Cyber", description: "Futuristic, sharp, innovative" },
    { id: "vintage", label: "Vintage", description: "Nostalgic, retro, classic" },
    { id: "natural", label: "Natural", description: "Organic, earthy, calm" },
    { id: "sport", label: "Sport & Movement", description: "Dynamic, active, high-energy" }
  ],
  post_moods: [
    { id: "promo", label: "Promo", description: "Sales & offers", style_ids: ["professional", "playful", "bold", "sport"] },
    { id: "info", label: "Info", description: "Educational", style_ids: ["professional", "minimalist", "elegant", "natural"] },
    { id: "behind-the-scenes", label: "Behind the Scenes", description: "Company culture", style_ids: ["playful", "elegant", "vintage", "sport"] },
    { id: "testimonial", label: "Testimonial", description: "Customer reviews", style_ids: ["professional", "elegant", "vintage", "sport"] },
    { id: "quote", label: "Quote", description: "Inspirational quotes", style_ids: ["minimalist", "bold", "vintage", "sport"] },
    { id: "product-spotlight", label: "Product Spotlight", description: "Highlighting a feature", style_ids: ["minimalist", "bold", "tech", "sport"] },
    { id: "holiday", label: "Holiday", description: "Seasonal greetings", style_ids: ["playful", "elegant", "vintage", "natural"] },
    { id: "event", label: "Event", description: "Webinars & live events", style_ids: ["playful", "bold", "vintage", "sport"] },
    { id: "tips", label: "Tips & Tricks", description: "Helpful advice", style_ids: ["minimalist", "tech", "natural", "sport"] },
    { id: "poll", label: "Poll / Question", description: "Engagement questions", style_ids: ["playful", "tech", "sport"] },
    { id: "announcement", label: "Announcement", description: "Company news", style_ids: ["professional", "bold", "tech"] },
    { id: "hiring", label: "Hiring", description: "Job openings", style_ids: ["professional", "tech", "sport"] }
  ],
  ai_models: {
    image_generation: "gemini-3.1-flash-image-preview",
    text_generation: "gemini-2.5-flash",
    audio_transcription: "gemini-2.5-flash",
  }
});

export const postSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  image_url: z.string().nullable(),
  thumbnail_url: z.string().nullable().default(null),
  content_type: z.enum(["image", "video"]).default("image"),
  caption: z.string().nullable(),
  ai_prompt_used: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
});
export type Post = z.infer<typeof postSchema>;

export const postGalleryItemSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  image_url: z.string().nullable(),
  original_image_url: z.string().nullable(),
  thumbnail_url: z.string().nullable().default(null),
  content_type: z.enum(["image", "video"]).default("image"),
  caption: z.string().nullable(),
  version_count: z.number().int().nonnegative(),
});
export type PostGalleryItem = z.infer<typeof postGalleryItemSchema>;

export const postsPageResponseSchema = z.object({
  posts: z.array(postGalleryItemSchema),
  totalCount: z.number().int().nonnegative(),
});
export type PostsPageResponse = z.infer<typeof postsPageResponseSchema>;

export const postVersionSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  version_number: z.number().int().positive(),
  image_url: z.string(),
  edit_prompt: z.string().nullable(),
  created_at: z.string(),
});
export type PostVersion = z.infer<typeof postVersionSchema>;

export const landingContentSchema = z.object({
  id: z.string().uuid(),
  hero_headline: z.string(),
  hero_subtext: z.string(),
  hero_cta_text: z.string(),
  hero_secondary_cta_text: z.string(),
  hero_image_url: z.string().nullable(),
  features_title: z.string(),
  features_subtitle: z.string(),
  how_it_works_title: z.string(),
  how_it_works_subtitle: z.string(),
  testimonials_title: z.string(),
  testimonials_subtitle: z.string(),
  cta_title: z.string(),
  cta_subtitle: z.string(),
  cta_button_text: z.string(),
  cta_image_url: z.string().nullable(),
  logo_url: z.string().nullable(),
  alt_logo_url: z.string().nullable(),
  icon_url: z.string().nullable(),
  updated_at: z.string(),
  updated_by: z.string().uuid().nullable(),
});
export type LandingContent = z.infer<typeof landingContentSchema>;

export const updateLandingContentSchema = landingContentSchema.partial().extend({
  id: z.string().uuid().optional(),
});
export type UpdateLandingContent = z.infer<typeof updateLandingContentSchema>;

// ── App Settings (White-Label) ─────────────────────────────────────────────────

export const appSettingsSchema = z.object({
  id: z.string().uuid(),
  app_name: z.string(),
  app_tagline: z.string().nullable(),
  app_description: z.string().nullable(),
  logo_url: z.string().nullable(),
  favicon_url: z.string().nullable(),
  primary_color: z.string(),
  secondary_color: z.string(),
  success_color: z.string(),
  error_color: z.string(),
  meta_title: z.string().nullable(),
  meta_description: z.string().nullable(),
  og_image_url: z.string().nullable(),
  terms_url: z.string().nullable(),
  privacy_url: z.string().nullable(),
  gtm_enabled: z.boolean(),
  gtm_container_id: z.string().nullable(),
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

export const adminIntegrationsStatusSchema = z.object({
  gemini_server_key_configured: z.boolean(),
  stripe_secret_key_configured: z.boolean(),
  stripe_webhook_secret_configured: z.boolean(),
  stripe_fully_configured: z.boolean(),
  supabase_url_configured: z.boolean(),
  supabase_anon_key_configured: z.boolean(),
  supabase_service_role_key_configured: z.boolean(),
  gtm_enabled: z.boolean(),
  gtm_container_id: z.string().nullable(),
  gtm_active: z.boolean(),
  ghl_enabled: z.boolean(),
  ghl_configured: z.boolean(),
  telegram_enabled: z.boolean(),
  telegram_configured: z.boolean(),
});
export type AdminIntegrationsStatus = z.infer<typeof adminIntegrationsStatusSchema>;

// ── GHL (GoHighLevel) Integration ─────────────────────────────────────────────

export const ghlIntegrationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  api_key: z.string().nullable(), // Masked on read
  location_id: z.string().nullable(),
  custom_field_mappings: z.record(z.string(), z.string()).default({}),
  last_sync_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
export type GHLIntegrationSettings = z.infer<typeof ghlIntegrationSettingsSchema>;

export const ghlCustomFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  type: z.string().optional(),
});
export type GHLCustomField = z.infer<typeof ghlCustomFieldSchema>;

export const ghlContactPayloadSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  customFields: z.record(z.string(), z.string()).optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type GHLContactPayload = z.infer<typeof ghlContactPayloadSchema>;

export const ghlContactResponseSchema = z.object({
  contact: z.object({
    id: z.string(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  }),
});
export type GHLContactResponse = z.infer<typeof ghlContactResponseSchema>;

export const adminGHLStatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  api_key_masked: z.string().nullable(),
  location_id: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  connection_status: z.enum(['connected', 'disconnected', 'error', 'not_configured']),
});
export type AdminGHLStatus = z.infer<typeof adminGHLStatusSchema>;

export const saveGHLSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  api_key: z.string().min(1, "API key is required").optional(),
  location_id: z.string().min(1, "Location ID is required").optional(),
  custom_field_mappings: z.record(z.string(), z.string()).optional(),
});
export type SaveGHLSettingsRequest = z.infer<typeof saveGHLSettingsRequestSchema>;

// ── Telegram Integration ───────────────────────────────────────────────────────

export const telegramIntegrationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  bot_token: z.string().nullable(),
  chat_ids: z.array(z.string()).default([]),
  notify_on_new_chat: z.boolean().default(false),
  last_tested_at: z.string().nullable().optional(),
});
export type TelegramIntegrationSettings = z.infer<typeof telegramIntegrationSettingsSchema>;

export const adminTelegramStatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  bot_token_masked: z.string().nullable(),
  chat_ids: z.array(z.string()),
  notify_on_new_chat: z.boolean(),
  last_tested_at: z.string().nullable(),
  connection_status: z.enum(["connected", "disconnected", "error", "not_configured"]),
});
export type AdminTelegramStatus = z.infer<typeof adminTelegramStatusSchema>;

export const saveTelegramSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  bot_token: z.string().min(1, "Bot token is required").optional(),
  chat_ids: z.array(z.string().min(1)).max(20).optional(),
  notify_on_new_chat: z.boolean().optional(),
});
export type SaveTelegramSettingsRequest = z.infer<typeof saveTelegramSettingsRequestSchema>;

export const testTelegramRequestSchema = z.object({
  bot_token: z.string().min(1).optional(),
  chat_ids: z.array(z.string().min(1)).max(20).optional(),
});
export type TestTelegramRequest = z.infer<typeof testTelegramRequestSchema>;

export const LOGO_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export const generateRequestSchema = z.object({
  reference_text: z.string().optional(),
  reference_images: z.array(z.object({
    mimeType: z.string(),
    data: z.string()
  })).max(4).optional(),
  post_mood: z.string().min(1, "Select a post mood"),
  copy_text: z.string().optional(),
  aspect_ratio: z.enum(["1:1", "4:5", "9:16", "16:9", "2:3", "1200:628"]),
  use_logo: z.boolean().optional(),
  logo_position: z.enum(LOGO_POSITIONS).optional(),
  content_language: z.enum(SUPPORTED_LANGUAGES).default("en"),
  content_type: z.enum(["image", "video"]).default("image"),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const generateResponseSchema = z.object({
  image_url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
  content_type: z.enum(["image", "video"]).default("image"),
  caption: z.string(),
  headline: z.string(),
  subtext: z.string(),
  post_id: z.string(),
});
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

export const editPostRequestSchema = z.object({
  post_id: z.string().uuid(),
  edit_prompt: z.string().min(1, "Edit prompt is required"),
  content_language: z.enum(SUPPORTED_LANGUAGES).default("en"),
});
export type EditPostRequest = z.infer<typeof editPostRequestSchema>;

export const editPostResponseSchema = z.object({
  version_id: z.string(),
  version_number: z.number(),
  image_url: z.string(),
});
export type EditPostResponse = z.infer<typeof editPostResponseSchema>;

// ── Billing ──────────────────────────────────────────────────────────────────

export const usageEventSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  post_id: z.string().uuid().nullable(),
  event_type: z.enum(["generate", "edit", "transcribe"]),
  // Token usage from Gemini API responses
  text_input_tokens: z.number().int().nullable(),  // gemini-2.5-flash prompt tokens
  text_output_tokens: z.number().int().nullable(),  // gemini-2.5-flash output tokens
  image_input_tokens: z.number().int().nullable(),  // gemini-2.5-flash-image prompt tokens
  image_output_tokens: z.number().int().nullable(),  // gemini-2.5-flash-image output tokens
  // Estimated cost in micro-dollars (1 USD = 1_000_000). e.g. $0.001 → 1000
  cost_usd_micros: z.number().int().nullable(),
  created_at: z.string(),
});
export type UsageEvent = z.infer<typeof usageEventSchema>;

export const userCreditsSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  balance_micros: z.number().int(),
  lifetime_purchased_micros: z.number().int(),
  lifetime_used_micros: z.number().int(),
  stripe_customer_id: z.string().nullable().optional(),
  stripe_default_payment_method_id: z.string().nullable().optional(),
  free_generations_used: z.number().int(),
  free_generations_limit: z.number().int(),
  auto_recharge_enabled: z.boolean(),
  auto_recharge_threshold_micros: z.number().int(),
  auto_recharge_amount_micros: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type UserCredits = z.infer<typeof userCreditsSchema>;

export const creditTransactionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: z.enum(["purchase", "usage", "refund", "bonus", "affiliate_commission"]),
  amount_micros: z.number().int(),
  balance_before_micros: z.number().int(),
  balance_after_micros: z.number().int(),
  usage_event_id: z.string().uuid().nullable(),
  stripe_payment_intent_id: z.string().nullable(),
  stripe_payout_id: z.string().nullable(),
  description: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});
export type CreditTransaction = z.infer<typeof creditTransactionSchema>;

export const creditStatusSchema = z.object({
  allowed: z.boolean(),
  balance_micros: z.number().int(),
  estimated_cost_micros: z.number().int(),
  markup_multiplier: z.number(),
  free_generations_remaining: z.number().int(),
  auto_recharge_enabled: z.boolean(),
});
export type CreditStatus = z.infer<typeof creditStatusSchema>;

export const creditsResponseSchema = z.object({
  credits: userCreditsSchema,
  status: creditStatusSchema,
});
export type CreditsResponse = z.infer<typeof creditsResponseSchema>;

export const creditTransactionsResponseSchema = z.object({
  transactions: z.array(creditTransactionSchema),
});
export type CreditTransactionsResponse = z.infer<typeof creditTransactionsResponseSchema>;

export const purchaseCreditsRequestSchema = z.object({
  amountMicros: z.number().int().min(1),
});
export type PurchaseCreditsRequest = z.infer<typeof purchaseCreditsRequestSchema>;

export const updateAutoRechargeRequestSchema = z.object({
  enabled: z.boolean(),
  thresholdMicros: z.number().int().min(0),
  amountMicros: z.number().int().min(0),
});
export type UpdateAutoRechargeRequest = z.infer<typeof updateAutoRechargeRequestSchema>;

export const affiliateDashboardResponseSchema = z.object({
  is_affiliate: z.boolean(),
  referral_code: z.string().nullable(),
  total_clicks: z.number().int(),
  clicks_last_30_days: z.number().int(),
  stripe_connect_account_id: z.string().nullable(),
  stripe_connect_onboarded: z.boolean(),
  total_commission_earned_micros: z.number().int(),
  total_commission_paid_micros: z.number().int(),
  pending_commission_micros: z.number().int(),
  minimum_payout_micros: z.number().int(),
  auto_payout_enabled: z.boolean(),
  referred_users_count: z.number().int(),
});
export type AffiliateDashboardResponse = z.infer<typeof affiliateDashboardResponseSchema>;

export const affiliateCommissionHistoryItemSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  amount_micros: z.number().int(),
  description: z.string().nullable(),
  stripe_payout_id: z.string().nullable(),
  source_user_id: z.string().uuid().nullable(),
  kind: z.enum(["accrual", "payout"]),
});
export type AffiliateCommissionHistoryItem = z.infer<typeof affiliateCommissionHistoryItemSchema>;

export const affiliateCommissionHistoryResponseSchema = z.object({
  transactions: z.array(affiliateCommissionHistoryItemSchema),
});
export type AffiliateCommissionHistoryResponse = z.infer<typeof affiliateCommissionHistoryResponseSchema>;

export const claimAffiliateReferralRequestSchema = z.object({
  ref: z.string().uuid().optional(),
});
export type ClaimAffiliateReferralRequest = z.infer<typeof claimAffiliateReferralRequestSchema>;

export const claimAffiliateReferralResponseSchema = z.object({
  claimed: z.boolean(),
  reason: z.enum([
    "no_ref",
    "claimed",
    "already_referred",
    "invalid_referrer",
    "self_referral",
  ]),
  referred_by_affiliate_id: z.string().uuid().nullable(),
});
export type ClaimAffiliateReferralResponse = z.infer<typeof claimAffiliateReferralResponseSchema>;

export const markupSettingsSchema = z.object({
  regularMultiplier: z.number(),
  affiliateMultiplier: z.number(),
  minRechargeMicros: z.number().int(),
  defaultAutoRechargeThresholdMicros: z.number().int(),
  defaultAutoRechargeAmountMicros: z.number().int(),
});
export type MarkupSettings = z.infer<typeof markupSettingsSchema>;

export const updateMarkupSettingsRequestSchema = markupSettingsSchema;
export type UpdateMarkupSettingsRequest = z.infer<typeof updateMarkupSettingsRequestSchema>;


// ── Legacy ────────────────────────────────────────────────────────────────────

export type User = {
  id: string;
  username: string;
  password: string;
};
export type InsertUser = Pick<User, "username" | "password">;
