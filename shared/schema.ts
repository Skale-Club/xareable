import { z } from "zod";

export const profileSchema = z.object({
  id: z.string().uuid(),
  api_key: z.string().nullable(),
  is_admin: z.boolean().default(false),
  is_affiliate: z.boolean().default(false),
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
  mood: z.string().min(1, "Select a mood"),
  logo_url: z.string().nullable().optional(),
});
export type InsertBrand = z.infer<typeof insertBrandSchema>;

export const postSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  image_url: z.string().nullable(),
  caption: z.string().nullable(),
  ai_prompt_used: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
});
export type Post = z.infer<typeof postSchema>;

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
  features_title: z.string(),
  features_subtitle: z.string(),
  how_it_works_title: z.string(),
  how_it_works_subtitle: z.string(),
  testimonials_title: z.string(),
  testimonials_subtitle: z.string(),
  cta_title: z.string(),
  cta_subtitle: z.string(),
  cta_button_text: z.string(),
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
    data: z.string() // base64 encoded
  })).max(4).optional(),
  post_profile: z.enum(["promo", "info", "clean", "vibrant"]),
  copy_text: z.string().optional(),
  aspect_ratio: z.enum(["1:1", "4:5", "9:16", "16:9", "2:3", "1200:628"]),
  use_logo: z.boolean().optional(),
  logo_position: z.enum(LOGO_POSITIONS).optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const generateResponseSchema = z.object({
  image_url: z.string(),
  caption: z.string(),
  headline: z.string(),
  subtext: z.string(),
  post_id: z.string(),
});
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

export const editPostRequestSchema = z.object({
  post_id: z.string().uuid(),
  edit_prompt: z.string().min(1, "Edit prompt is required"),
});
export type EditPostRequest = z.infer<typeof editPostRequestSchema>;

export const editPostResponseSchema = z.object({
  version_id: z.string(),
  version_number: z.number(),
  image_url: z.string(),
});
export type EditPostResponse = z.infer<typeof editPostResponseSchema>;

// ── Billing ──────────────────────────────────────────────────────────────────

export const subscriptionPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  display_name: z.string(),
  stripe_price_id: z.string().nullable(),
  monthly_limit: z.number().int().nullable(),
  price_cents: z.number().int(),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

export const userSubscriptionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable(),
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  status: z.enum(["trialing", "active", "canceled", "past_due"]),
  current_period_start: z.string().nullable(),
  current_period_end: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type UserSubscription = z.infer<typeof userSubscriptionSchema>;

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

// Billing subscription response: plan info + usage
export const billingSubscriptionResponseSchema = z.object({
  plan: subscriptionPlanSchema.nullable(),
  subscription: userSubscriptionSchema.nullable(),
  used: z.number().int(),
  limit: z.number().int().nullable(),
});
export type BillingSubscriptionResponse = z.infer<typeof billingSubscriptionResponseSchema>;

// Checkout request
export const checkoutRequestSchema = z.object({
  priceId: z.string().min(1),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

// ── Legacy ────────────────────────────────────────────────────────────────────

export type User = {
  id: string;
  username: string;
  password: string;
};
export type InsertUser = Pick<User, "username" | "password">;
