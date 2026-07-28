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
// NOTE: is_admin and is_affiliate are mutually exclusive.
// A user cannot be both admin and affiliate due to conflict of interest.
// This is enforced by database constraint: admin_affiliate_mutual_exclusion

export const profileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable().optional(),
  api_key: z.string().nullable(),
  openai_api_key: z.string().nullable().optional(),  // Phase 12 (PROV-06): admin/affiliate OpenAI key
  openrouter_api_key: z.string().nullable().optional(),  // Phase 21.1 (GATE-06): affiliate's own OpenRouter key
  image_provider: z.enum(["gemini", "openai"]).nullable().optional(),  // Phase 12.1: per-user provider preference (admin/affiliate only)
  is_admin: z.boolean().default(false),
  is_affiliate: z.boolean().default(false),
  referred_by_affiliate_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
}).refine(
  (data) => !(data.is_admin === true && data.is_affiliate === true),
  { message: "User cannot be both admin and affiliate" }
);
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
  style_description: z.string().nullable().optional(),
  created_at: z.string(),
});
export type Brand = z.infer<typeof brandSchema>;

export const brandReferencePhotoSchema = z.object({
  id: z.string().uuid(),
  brand_id: z.string().uuid(),
  user_id: z.string().uuid(),
  photo_url: z.string(),
  position: z.number().int(),
  created_at: z.string(),
});
export type BrandReferencePhoto = z.infer<typeof brandReferencePhotoSchema>;

export const brandReferencePhotosResponseSchema = z.object({
  photos: z.array(brandReferencePhotoSchema),
});
export type BrandReferencePhotosResponse = z.infer<typeof brandReferencePhotosResponseSchema>;

export const createBrandReferencePhotoSchema = z.object({
  photo_url: z.string().url(),
  position: z.number().int().min(0).optional(),
});
export type CreateBrandReferencePhoto = z.infer<typeof createBrandReferencePhotoSchema>;

// ── Phase 25 (PLAN-07) — platform-curated style reference boards ────────────
// Platform-wide (keyed by a style_catalog id, NOT by brand_id/user_id).
// Ownership/ACL is INVERTED vs brand_reference_photos: public read, admin write.
export const STYLE_REFERENCE_SCOPES = ["style", "post_mood"] as const;
export type StyleReferenceScope = typeof STYLE_REFERENCE_SCOPES[number];

export const styleReferencePhotoSchema = z.object({
  id: z.string().uuid(),
  scope: z.enum(STYLE_REFERENCE_SCOPES),
  style_id: z.string().min(1),
  photo_url: z.string(),
  position: z.number().int(),
  created_at: z.string(),
});
export type StyleReferencePhoto = z.infer<typeof styleReferencePhotoSchema>;

export const styleReferencePhotosResponseSchema = z.object({
  photos: z.array(styleReferencePhotoSchema),
});
export type StyleReferencePhotosResponse = z.infer<typeof styleReferencePhotosResponseSchema>;

export const createStyleReferencePhotoSchema = z.object({
  scope: z.enum(STYLE_REFERENCE_SCOPES),
  style_id: z.string().min(1),
  photo_url: z.string().url(),
  position: z.number().int().min(0).optional(),
});
export type CreateStyleReferencePhoto = z.infer<typeof createStyleReferencePhotoSchema>;

// Max images an admin may attach to one style/mood board. Chosen above the
// 4-slot model input cap so an admin can curate a board and the priority merge
// (server/services/style-reference.service.ts) picks the top-N by position.
export const MAX_STYLE_REFERENCE_PHOTOS = 8;

export const updateStyleDescriptionSchema = z.object({
  style_description: z.string().max(1000).nullable(),
});
export type UpdateStyleDescription = z.infer<typeof updateStyleDescriptionSchema>;

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

// ── Phase 25 (PLAN-05) — Aesthetic DNA: dense art direction per style/mood ──
// Additive with defaults so every stored platform_settings.style_catalog row
// keeps parsing with NO migration (same mechanism aiModelsSchema.planning used
// in Phase 22 and aiModelsSchema.critic in Phase 24).
export const artDirectionSchema = z.object({
  photography_type: z.string().default(""),
  lighting: z.string().default(""),
  composition: z.string().default(""),
  texture: z.string().default(""),
  negative_prompts: z.array(z.string().min(1)).default([]),
});
export type ArtDirection = z.infer<typeof artDirectionSchema>;

export const EMPTY_ART_DIRECTION: ArtDirection = {
  photography_type: "", lighting: "", composition: "", texture: "", negative_prompts: [],
};

export const brandStyleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  art_direction: artDirectionSchema.default(EMPTY_ART_DIRECTION),
});
export type BrandStyle = z.infer<typeof brandStyleSchema>;

export const postMoodSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  style_ids: z.array(z.string().min(1)).default([]),
  art_direction: artDirectionSchema.default(EMPTY_ART_DIRECTION),
});
export type PostMood = z.infer<typeof postMoodSchema>;

export const TEXT_RENDER_MODES = ["auto", "guided", "exact"] as const;
export type TextRenderMode = typeof TEXT_RENDER_MODES[number];

export const textStylePromptHintsSchema = z.object({
  typography: z.string().default(""),
  layout: z.string().default(""),
  emphasis: z.string().default(""),
  avoid: z.array(z.string().min(1)).default([]),
});
export type TextStylePromptHints = z.infer<typeof textStylePromptHintsSchema>;

export const textStylePreviewSchema = z.object({
  font_family: z.string().default("var(--font-sans)"),
  sample_text: z.string().default("Sample"),
  use_case: z.string().default(""),
});
export type TextStylePreview = z.infer<typeof textStylePreviewSchema>;

export const textStyleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  categories: z.array(z.string().min(1)).default([]),
  preview: textStylePreviewSchema.default({
    font_family: "var(--font-sans)",
    sample_text: "Sample",
    use_case: "",
  }),
  prompt_hints: textStylePromptHintsSchema.default({
    typography: "",
    layout: "",
    emphasis: "",
    avoid: [],
  }),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const TEXT_BLOCK_ROLES = ["highlight", "support", "cta"] as const;
export type TextBlockRole = typeof TEXT_BLOCK_ROLES[number];

export const textBlockSchema = z.object({
  role: z.enum(TEXT_BLOCK_ROLES),
  text: z.string().trim().min(1).max(200),
});
export type TextBlock = z.infer<typeof textBlockSchema>;

export const aiModelsSchema = z.object({
  image_generation: z.string().default("gemini-3.1-flash-image-preview"),
  text_generation: z.string().default("gemini-2.5-flash"),
  audio_transcription: z.string().default("gemini-2.5-flash"),
  video_generation: z.string().default("veo-3.1-generate-preview"),
  // Phase 22 (PLAN-03): DEDICATED slug for the single-image art-director planning
  // call. Deliberately NOT a repoint of text_generation, which is shared by 3 other
  // call purposes (generateCaptionOnly, callCarouselTextPlan, ensureCaptionQuality)
  // that must not inherit a Pro-tier price. Additive: styleCatalogSchema.parse()
  // backfills this default on every existing stored style_catalog row, so NO
  // migration is required.
  // Must be a slug with OpenRouter structured_outputs support AND a valid bare
  // Google model name (the GATE-07 "direct" rollback builds
  // generativelanguage.googleapis.com/v1beta/models/${model}:generateContent from it),
  // hence the bare — not "google/"-prefixed — form.
  planning: z.string().default("gemini-2.5-pro"),
  // Phase 24 (CRIT-01). Dedicated slug for the multimodal visual-critic call.
  // Deliberately NOT a repoint of `planning` (which is Pro-tier and runs once
  // per generation) — the critic runs 1-3 times per generation, so it
  // defaults to a flash tier.
  // MUST be a slug with BOTH OpenRouter structured_outputs support AND
  // `image` input modality.
  // Additive: styleCatalogSchema.safeParse() backfills this default on every
  // stored row, so NO migration is required (same mechanism Phase 22 used
  // for `planning`).
  // Unlike `planning`, the critic call class has NO GATE-07 "direct" rollback
  // branch (24-CONTEXT.md locked decision: OpenRouter-only), so the
  // bare-vs-prefixed slug form only has to satisfy
  // normalizeOpenRouterModelSlug — bare "gemini-2.5-flash" becomes
  // "google/gemini-2.5-flash".
  // Live-verified 2026-07-28 against
  // https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs :
  // google/gemini-2.5-flash is present (254 models returned) and its
  // architecture.input_modalities includes "image" — see 24-01-SUMMARY.md for
  // the raw evidence.
  critic: z.string().default("gemini-2.5-flash"),
});
export type AIModels = z.infer<typeof aiModelsSchema>;

export const postFormatSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1),
  label: z.string().min(1),
  subtitle: z.string().default(""),
  icon: z.string().default("Square"), // Will be mapped to Lucide icons
});
export type PostFormat = z.infer<typeof postFormatSchema>;

// ── Scenery Catalog (v1.1) ───────────────────────────────────────────────────
// Scenery presets for the product-photo enhancement feature (ENHC-02).
// Stored inside app_settings.style_catalog.sceneries; admin-curated in v1.1.

export const scenerySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  prompt_snippet: z.string().min(1),
  preview_image_url: z.string().nullable(),
  is_active: z.boolean().default(true),
});
export type Scenery = z.infer<typeof scenerySchema>;

export const styleCatalogSchema = z.object({
  styles: z.array(brandStyleSchema).min(1),
  post_moods: z.array(postMoodSchema).min(1),
  text_styles: z.array(textStyleSchema).optional(),
  post_formats: z.array(postFormatSchema).optional(),
  video_formats: z.array(postFormatSchema).optional(),
  ai_models: aiModelsSchema.optional(),
  sceneries: z.array(scenerySchema).optional(),
});
export type StyleCatalog = z.infer<typeof styleCatalogSchema>;
export const MAX_FEATURED_POST_MOODS_PER_STYLE = 4;

export const DEFAULT_STYLE_CATALOG: StyleCatalog = styleCatalogSchema.parse({
  styles: [
    {
      id: "professional",
      label: "Professional",
      description: "Clean, corporate, trustworthy",
      art_direction: {
        photography_type: "editorial corporate photography, 50mm prime lens, shallow depth of field, clean commercial finish",
        lighting: "soft key light from camera-left with a gentle fill light, controlled highlights, zero harsh shadows",
        composition: "centered subject with generous negative space along the margins, balanced symmetrical framing",
        texture: "crisp matte surfaces, subtle fine-grain finish, no visible sensor noise",
        negative_prompts: ["plastic AI skin", "generic stock-photo handshake staging", "warped hands", "muddy oversaturated color cast"],
      },
    },
    {
      id: "playful",
      label: "Playful",
      description: "Fun, colorful, energetic",
      art_direction: {
        photography_type: "vibrant lifestyle photography, wide-angle candid energy, punchy saturated commercial look",
        lighting: "bright even daylight with a colorful bounce fill, cheerful high-key exposure",
        composition: "dynamic off-center framing with playful diagonal energy, ample open space for movement",
        texture: "glossy saturated surfaces, light film-grain sparkle, confetti-like specular highlights",
        negative_prompts: ["flat corporate stiffness", "desaturated dull palette", "plastic AI skin", "warped hands"],
      },
    },
    {
      id: "minimalist",
      label: "Minimalist",
      description: "Simple, elegant, refined",
      art_direction: {
        photography_type: "studio product photography, macro-adjacent framing, ultra-clean gallery-white aesthetic",
        lighting: "single soft diffused overhead light, near-shadowless even illumination",
        composition: "extreme negative space, subject isolated in one-third of frame, uncluttered geometry",
        texture: "smooth flawless surfaces, zero grain, matte-white backdrop",
        negative_prompts: ["cluttered busy background", "heavy ornamentation", "plastic AI skin", "warped hands"],
      },
    },
    {
      id: "bold",
      label: "Bold",
      description: "Strong, impactful, daring",
      art_direction: {
        photography_type: "high-contrast advertising photography, wide-angle dramatic perspective, punchy commercial finish",
        lighting: "hard directional key light with deep contrast shadows, dramatic rim lighting",
        composition: "tight aggressive framing, subject filling most of the frame, minimal breathing room",
        texture: "saturated glossy surfaces, crisp sharp edges, high-contrast micro-texture",
        negative_prompts: ["timid washed-out palette", "soft pastel tones", "plastic AI skin", "warped hands"],
      },
    },
    {
      id: "elegant",
      label: "Elegant",
      description: "Sophisticated, luxurious, graceful",
      art_direction: {
        photography_type: "high-end fashion editorial photography, telephoto compression, refined luxury commercial finish",
        lighting: "soft diffused rim light with a warm golden glow, gentle falloff into shadow",
        composition: "graceful asymmetrical framing, generous negative space, subject slightly off-center",
        texture: "silky smooth surfaces, subtle satin sheen, fine velvet-like grain",
        negative_prompts: ["cheap plasticky sheen", "cluttered busy staging", "plastic AI skin", "warped hands"],
      },
    },
    {
      id: "tech",
      label: "Tech / Cyber",
      description: "Futuristic, sharp, innovative",
      art_direction: {
        photography_type: "futuristic product photography, macro lens precision, sharp sci-fi commercial finish",
        lighting: "cool blue-tinted rim lighting with neon accent glow, crisp specular highlights",
        composition: "geometric grid-aligned framing, sharp diagonal lines, negative space reserved at frame edges",
        texture: "brushed metal and glass surfaces, subtle holographic sheen, ultra-sharp micro-detail",
        negative_prompts: ["warm rustic tones", "organic soft-focus haze", "plastic AI skin", "warped hands"],
      },
    },
    {
      id: "vintage",
      label: "Vintage",
      description: "Nostalgic, retro, classic",
      art_direction: {
        photography_type: "analog film photography, 35mm grain aesthetic, faded retro commercial finish",
        lighting: "warm golden-hour side light with soft film-halation glow, gentle vignette falloff",
        composition: "centered nostalgic framing with a slight retro tilt, classic film-still balance",
        texture: "visible film grain, faded matte surfaces, subtle scratches and dust specks",
        negative_prompts: ["ultra-clean digital sharpness", "neon cyber tones", "plastic AI skin", "warped hands"],
      },
    },
    {
      id: "natural",
      label: "Natural",
      description: "Organic, earthy, calm",
      art_direction: {
        photography_type: "organic lifestyle photography, natural-light documentary style, earthy commercial finish",
        lighting: "soft filtered window or outdoor daylight, gentle diffused shadows, calm ambient glow",
        composition: "loose organic framing with breathing room, subject nestled among natural textures",
        texture: "raw linen and wood-grain surfaces, matte earthy finish, subtle organic imperfection",
        negative_prompts: ["glossy artificial sheen", "neon saturated color", "plastic AI skin", "warped hands"],
      },
    },
    {
      id: "sport",
      label: "Sport & Movement",
      description: "Dynamic, active, high-energy",
      art_direction: {
        photography_type: "high-speed action photography, telephoto motion-freeze, dynamic sports-commercial finish",
        lighting: "hard stadium-style top light with strong directional contrast, crisp motion highlights",
        composition: "diagonal motion-driven framing, subject captured mid-action, kinetic negative space trailing behind",
        texture: "sweat-sheen skin texture, sharp fabric grain, crisp high-contrast micro-detail",
        negative_prompts: ["static stiff posing", "muted low-energy palette", "plastic AI skin", "warped hands"],
      },
    },
  ],
  post_moods: [
    {
      id: "promo",
      label: "Promo",
      description: "Sales & offers",
      style_ids: ["professional", "playful", "bold", "sport"],
      art_direction: {
        photography_type: "hero product-offer shot with clear focal hierarchy and generous surrounding negative space",
        lighting: "punchy directional spotlight isolating the offer subject, crisp rim highlight",
        composition: "clear uncluttered region reserved in the upper third for the compositor's overlay, subject anchored below",
        texture: "glossy high-energy surfaces, crisp specular sparkle",
        negative_prompts: ["cluttered background chaos", "washed-out low-energy exposure", "distracting secondary subjects"],
      },
    },
    {
      id: "info",
      label: "Info",
      description: "Educational",
      style_ids: ["professional", "minimalist", "elegant", "natural"],
      art_direction: {
        photography_type: "clean explanatory product-detail shot with a clear single focal subject",
        lighting: "even flat diffused light, minimal shadow, neutral clarity",
        composition: "clear uncluttered region on one side for the compositor's overlay, subject balanced on the other",
        texture: "smooth clean surfaces, minimal grain, neutral finish",
        negative_prompts: ["visually busy multi-subject clutter", "harsh dramatic shadow", "distracting background clutter"],
      },
    },
    {
      id: "behind-the-scenes",
      label: "Behind the Scenes",
      description: "Company culture",
      style_ids: ["playful", "elegant", "vintage", "sport"],
      art_direction: {
        photography_type: "candid documentary reportage, unposed, natural workplace moment",
        lighting: "available ambient light, natural window or overhead glow, unforced realism",
        composition: "loose candid framing with a naturally open region for the compositor's overlay, subject slightly off-center",
        texture: "natural skin and fabric texture, subtle ambient grain",
        negative_prompts: ["overly staged studio look", "forced camera-aware posing", "artificial staged backdrop"],
      },
    },
    {
      id: "testimonial",
      label: "Testimonial",
      description: "Customer reviews",
      style_ids: ["professional", "elegant", "vintage", "sport"],
      art_direction: {
        photography_type: "warm environmental portrait of a real customer in context",
        lighting: "soft natural window light with gentle fill, warm approachable glow",
        composition: "clear uncluttered region beside the subject's face for the compositor's overlay, close-mid framing",
        texture: "soft natural skin texture, gentle fabric detail",
        negative_prompts: ["fake forced smiles", "generic stock-photo customer pose", "artificial studio backdrop"],
      },
    },
    {
      id: "quote",
      label: "Quote",
      description: "Inspirational quotes",
      style_ids: ["minimalist", "bold", "vintage", "sport"],
      art_direction: {
        photography_type: "contemplative environmental portrait or evocative scene, quiet reflective mood",
        lighting: "quiet directional light with deep falloff for contemplative contrast",
        composition: "large clear uncluttered region occupying most of the frame for the compositor's overlay, subject small and grounded",
        texture: "soft atmospheric haze, subtle muted grain",
        negative_prompts: ["busy loud composition", "harsh flat lighting", "distracting cluttered background"],
      },
    },
    {
      id: "product-spotlight",
      label: "Product Spotlight",
      description: "Highlighting a feature",
      style_ids: ["minimalist", "bold", "tech", "sport"],
      art_direction: {
        photography_type: "macro product-detail shot isolating a single feature with shallow focus",
        lighting: "focused directional spotlight with clean falloff, crisp highlight on the featured detail",
        composition: "tight close-up framing on the feature with a clear uncluttered region reserved at the frame edge",
        texture: "ultra-sharp material micro-detail, crisp specular highlight",
        negative_prompts: ["distracting cluttered background", "soft unfocused blur on the feature", "generic wide product shot"],
      },
    },
    {
      id: "holiday",
      label: "Holiday",
      description: "Seasonal greetings",
      style_ids: ["playful", "elegant", "vintage", "natural"],
      art_direction: {
        photography_type: "festive seasonal scene with warm celebratory props and atmosphere",
        lighting: "warm string-light glow with soft bokeh sparkle, cozy ambient warmth",
        composition: "clear uncluttered region near the top for the compositor's overlay, festive elements framing the edges",
        texture: "soft twinkling bokeh texture, warm cozy fabric detail",
        negative_prompts: ["generic stock-photo holiday cliches", "cold sterile lighting", "cluttered ornament overload"],
      },
    },
    {
      id: "event",
      label: "Event",
      description: "Webinars & live events",
      style_ids: ["playful", "bold", "vintage", "sport"],
      art_direction: {
        photography_type: "wide establishing shot of a live gathering or stage, crowd-energy context",
        lighting: "stage-style spotlight with dramatic ambient falloff into the crowd",
        composition: "clear uncluttered region reserved above the stage action for the compositor's overlay",
        texture: "crisp stage-light specular detail, subtle atmospheric haze",
        negative_prompts: ["empty lifeless venue", "flat uneventful framing", "generic stock-photo conference cliches"],
      },
    },
    {
      id: "tips",
      label: "Tips & Tricks",
      description: "Helpful advice",
      style_ids: ["minimalist", "tech", "natural", "sport"],
      art_direction: {
        photography_type: "clean instructional close-up demonstrating a single actionable step",
        lighting: "even soft diffused light, clear shadow-free visibility on the demonstrated action",
        composition: "clear uncluttered region beside the action for the compositor's overlay, hands or subject centered",
        texture: "crisp clean surface detail, minimal grain",
        negative_prompts: ["cluttered multi-step confusion", "harsh distracting shadow", "generic stock-photo advice cliche"],
      },
    },
    {
      id: "poll",
      label: "Poll / Question",
      description: "Engagement questions",
      style_ids: ["playful", "tech", "sport"],
      art_direction: {
        photography_type: "expressive close-up portrait capturing a curious or questioning expression",
        lighting: "bright playful front light with a soft catch-light in the eyes",
        composition: "clear uncluttered region beside the expressive face for the compositor's overlay",
        texture: "crisp expressive skin detail, subtle playful sparkle",
        negative_prompts: ["blank disengaged expression", "flat lifeless pose", "generic stock-photo confused-shrug cliche"],
      },
    },
    {
      id: "announcement",
      label: "Announcement",
      description: "Company news",
      style_ids: ["professional", "bold", "tech"],
      art_direction: {
        photography_type: "confident hero shot announcing a milestone, clear singular focal subject",
        lighting: "strong confident key light with crisp defining contrast",
        composition: "clear uncluttered region above or beside the subject for the compositor's overlay, authoritative centered framing",
        texture: "crisp clean commercial surface detail",
        negative_prompts: ["muted uncertain tone", "cluttered busy background", "generic stock-photo press-release cliche"],
      },
    },
    {
      id: "hiring",
      label: "Hiring",
      description: "Job openings",
      style_ids: ["professional", "tech", "sport"],
      art_direction: {
        photography_type: "welcoming workplace environmental shot, approachable team-in-context moment",
        lighting: "bright natural office light, warm approachable fill",
        composition: "clear uncluttered region reserved for the compositor's overlay, team or workspace framing the edges",
        texture: "natural approachable skin and workspace texture",
        negative_prompts: ["stock-photo handshake cliche", "empty sterile office", "fake forced smiles"],
      },
    },
  ],
  text_styles: [
    {
      id: "bold-promo",
      label: "Bold Promo",
      description: "High-impact, heavy sans-serif typography for maximum visibility",
      categories: ["sale", "promo", "offer"],
      preview: {
        font_family: "Impact, 'Arial Black', sans-serif",
        sample_text: "Bold Promo",
        use_case: "Hard-hitting sales and limited-time offers",
      },
      prompt_hints: {
        typography: "ultra-bold high-contrast sans-serif display typography, all-caps emphasis",
        layout: "lead with the main offer text scaling as large as possible, compact support copy",
        emphasis: "highlight the discount percentage, price, or core promotion first",
        avoid: ["tiny offer text", "low-contrast typography", "delicate serif styling", "cluttered text blocks"],
      },
    },
    {
      id: "modern-corporate",
      label: "Modern Corporate",
      description: "Clean, geometric sans-serif for professional trust and clarity",
      categories: ["b2b", "professional", "tech", "finance"],
      preview: {
        font_family: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        sample_text: "Modern Corporate",
        use_case: "Corporate announcements, B2B marketing, and professional insights",
      },
      prompt_hints: {
        typography: "clean modern geometric sans-serif typography with professional spacing",
        layout: "structured left-aligned or centered hierarchy with clear breathing room",
        emphasis: "keep the main message clear and authoritative without aggressive callouts",
        avoid: ["novelty fonts", "sticker-like badges", "chaotic placement", "overdecorated type"],
      },
    },
    {
      id: "raw-brutalist",
      label: "Raw Brutalist",
      description: "Unapologetic, oversized typography that breaks the grid",
      categories: ["streetwear", "underground", "music", "disruptive"],
      preview: {
        font_family: "'Archivo Black', 'Arial Black', sans-serif",
        sample_text: "Raw Brutalist",
        use_case: "Streetwear drops, underground events, and highly disruptive campaigns",
      },
      prompt_hints: {
        typography: "brutalist, ultra-heavy display typography, stretching edge-to-edge",
        layout: "anti-design, bold grid-breaking layout, dense text packing with tight leading",
        emphasis: "make the text feel raw, unpolished, and intensely loud",
        avoid: ["elegant serifs", "safe corporate margins", "gentle pastel colors", "delicate script"],
      },
    },
    {
      id: "retro-vintage",
      label: "Retro Vintage",
      description: "Playful script typography with a bold extruded 3D shadow",
      categories: ["retro", "playful", "vintage", "nostalgia"],
      preview: {
        font_family: "'Bangers', 'Bello', 'Playball', cursive",
        sample_text: "Retro Vintage",
        use_case: "Nostalgic branding, playful promotions, and retro-themed events",
      },
      prompt_hints: {
        typography: "retro, playful script or cursive typography featuring a heavy extruded 3D drop shadow",
        layout: "centered, dynamic composition reminiscent of 70s or 80s vintage sign painting",
        emphasis: "focus on nostalgia, bold flowing lettering, and a playful 3D pop effect",
        avoid: ["stark minimalist tech fonts", "serious corporate serifs", "thin delicate lines", "clean modern geometric layouts"],
      },
    },
    {
      id: "elegant-serif",
      label: "Elegant Serif",
      description: "High-contrast, sophisticated serif typography for a premium, editorial feel",
      categories: ["fashion", "luxury", "editorial", "classic"],
      preview: {
        font_family: "'DM Serif Display', 'Abril Fatface', serif",
        sample_text: "Elegant Serif",
        use_case: "Luxury branding, editorial magazines, and high-end fashion campaigns",
      },
      prompt_hints: {
        typography: "elegant, high-contrast serif typography with a classic, editorial magazine aesthetic",
        layout: "clean, sophisticated spacing with strong alignment and generous margins",
        emphasis: "focus on elegance, refinement, and a premium editorial look",
        avoid: ["distorted internet aesthetics", "heavy brutalist blocks", "playful rounded fonts", "neon colors"],
      },
    },
    {
      id: "classic-journal",
      label: "Classic Journal",
      description: "Traditional typewriter or classic serif for storytelling and quotes",
      categories: ["storytelling", "quotes", "author", "informative"],
      preview: {
        font_family: "'Merriweather', 'Times New Roman', serif",
        sample_text: "Classic Journal",
        use_case: "Long-form captions, inspirational quotes, and thought leadership",
      },
      prompt_hints: {
        typography: "classic legible serif typography optimized for reading medium-length text",
        layout: "book-like or journal-like text blocks with comfortable line height",
        emphasis: "prioritize readability and a calm, authoritative narrative tone",
        avoid: ["distracting neon backgrounds", "ultra-heavy bold fonts", "chaotic varied font sizes"],
      },
    },
    {
      id: "event-poster",
      label: "Event Poster",
      description: "Dynamic, condensed typography built for impact and structure",
      categories: ["events", "webinars", "live", "announcement"],
      preview: {
        font_family: "'Oswald', 'Arial Narrow', sans-serif",
        sample_text: "Event Poster",
        use_case: "Webinar registrations, live event promos, and major keynotes",
      },
      prompt_hints: {
        typography: "bold condensed poster typography with strict supporting text hierarchy (date, time, location)",
        layout: "structured poster composition with a dominant headline and cleanly separated secondary details",
        emphasis: "ensure the event title is unmistakable, with time/date clearly legible below",
        avoid: ["tiny unreadable subtext", "weak headline presence", "unstructured text floating randomly"],
      },
    },
    {
      id: "casual-marker",
      label: "Casual Marker",
      description: "Organic, hand-drawn marker typography for authentic, personal notes",
      categories: ["casual", "notes", "organic", "personal"],
      preview: {
        font_family: "'Permanent Marker', 'Kalam', cursive",
        sample_text: "Casual Marker",
        use_case: "Personal announcements, quick tips, behind-the-scenes, and organic marketing",
      },
      prompt_hints: {
        typography: "casual handwritten marker pen typography, organic strokes, looking authentically hand-drawn",
        layout: "slightly angled or organic layouts, resembling a sticky note or whiteboard message",
        emphasis: "focus on approachability, keeping the text feeling very human and unpolished",
        avoid: ["rigid corporate fonts", "neon glowing effects", "perfectly straight structural layouts", "harsh sharp serifs"],
      },
    },
  ],
  ai_models: {
    image_generation: "gemini-3.1-flash-image-preview",
    text_generation: "gemini-2.5-flash",
    audio_transcription: "gemini-2.5-flash",
  },
  post_formats: [
    { id: "square", value: "1:1", label: "Square", subtitle: "Instagram Post", icon: "Square" },
    { id: "portrait", value: "4:5", label: "Portrait", subtitle: "Instagram Feed", icon: "RectangleVertical" },
    { id: "story", value: "9:16", label: "Story", subtitle: "Instagram/TikTok", icon: "RectangleVertical" },
    { id: "landscape", value: "16:9", label: "Landscape", subtitle: "YouTube/LinkedIn", icon: "RectangleHorizontal" },
    { id: "pinterest", value: "2:3", label: "Pinterest", subtitle: "Pin Post", icon: "RectangleVertical" },
    { id: "facebook", value: "1200:628", label: "Facebook", subtitle: "Link Preview", icon: "RectangleHorizontal" },
  ],
  video_formats: [
    { id: "reel", value: "9:16", label: "Reel / Short", subtitle: "TikTok / Reels", icon: "RectangleVertical" },
    { id: "landscape-video", value: "16:9", label: "Landscape", subtitle: "YouTube / Facebook", icon: "RectangleHorizontal" },
  ]
});

/**
 * Phase 25 (PLAN-05). Stored catalogs predate art_direction, so
 * styleCatalogSchema backfills EMPTY_ART_DIRECTION. This restores the curated
 * defaults for any entry whose art_direction is still entirely empty, matched
 * by id. An entry an admin HAS curated (any non-empty field) is left alone, and
 * an admin-added entry with no default counterpart is returned unchanged.
 */
export function isEmptyArtDirection(a: ArtDirection | undefined | null): boolean {
  if (!a) return true;
  return (
    a.photography_type.trim() === "" &&
    a.lighting.trim() === "" &&
    a.composition.trim() === "" &&
    a.texture.trim() === "" &&
    a.negative_prompts.length === 0
  );
}

export function withDefaultArtDirection(catalog: StyleCatalog): StyleCatalog {
  const defaultStylesById = new Map(DEFAULT_STYLE_CATALOG.styles.map((s) => [s.id, s]));
  const defaultMoodsById = new Map(DEFAULT_STYLE_CATALOG.post_moods.map((m) => [m.id, m]));

  return {
    ...catalog,
    styles: catalog.styles.map((s) => {
      if (!isEmptyArtDirection(s.art_direction)) return s;
      const fallback = defaultStylesById.get(s.id);
      if (!fallback) return s;
      return { ...s, art_direction: fallback.art_direction };
    }),
    post_moods: catalog.post_moods.map((m) => {
      if (!isEmptyArtDirection(m.art_direction)) return m;
      const fallback = defaultMoodsById.get(m.id);
      if (!fallback) return m;
      return { ...m, art_direction: fallback.art_direction };
    }),
  };
}

// Post expiration configuration
export const POST_EXPIRATION_DAYS = 30;
// Days a trashed post is retained before permanent deletion (Phase 11)
export const TRASH_RETENTION_DAYS = 30;

// ── Phase 23 (TYPO-05) — typography JSONB shape ──────────────────────────────
// LAYOUT_ARCHETYPE_IDS_SHARED mirrors server/services/planning-schema.service.ts's
// LAYOUT_ARCHETYPE_IDS. shared/ must not import from server/, so the two lists are
// kept in sync by hand — verify-phase-23.ts asserts both contain the same 3 ids.
export const LAYOUT_ARCHETYPE_IDS_SHARED = ["bottom_band", "top_stack", "centered_hero"] as const;
export type LayoutArchetypeIdShared = typeof LAYOUT_ARCHETYPE_IDS_SHARED[number];

export const typographyFontRecordSchema = z.object({
  role: z.enum(TEXT_BLOCK_ROLES),
  alias: z.string(),
  size_px: z.number().int().positive(),
  line_height_px: z.number().int().positive(),
  lines: z.number().int().nonnegative(),
});

export const typographyScrimSchema = z.object({
  applied: z.literal(true),
  color: z.string(),
  alpha: z.number().min(0).max(1),
  region: z.object({
    left: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});

export const typographyMetaSchema = z.object({
  compositor_version: z.number().int().positive(),
  layout_archetype_id: z.enum(LAYOUT_ARCHETYPE_IDS_SHARED),
  text_blocks: z.array(textBlockSchema).max(3),
  text_color: z.string(),
  fonts: z.array(typographyFontRecordSchema),
  scrim: typographyScrimSchema.nullable(),
  safe_zone: z.object({
    left: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});
export type TypographyMeta = z.infer<typeof typographyMetaSchema>;

// ── Phase 23 (POL-05) — persisted generation parameters shape ───────────────
// Written at generation time; read back by edit.routes.ts and the remake UI
// instead of regex-guessing ai_prompt_used. Every field is optional so a
// partially-populated legacy row still parses.
// Enum values below are inlined rather than reusing generateRequestSchema.shape
// / LOGO_POSITIONS because this schema must be declared above postSchema, which
// in turn is declared above both generateRequestSchema and LOGO_POSITIONS
// further down this file. Values MUST stay in lockstep with those declarations.
export const generationParamsSchema = z.object({
  aspect_ratio: z.enum([
    "1:1", "1:4", "1:8",
    "2:3", "3:2", "3:4",
    "4:1", "4:3", "4:5", "5:4",
    "8:1", "9:16", "16:9", "21:9",
    "1200:628",
  ]).optional(),
  image_resolution: z.enum(["512px", "1K", "2K", "4K"]).optional(),
  video_resolution: z.enum(["720p", "1080p", "4k"]).optional(),
  video_duration: z.enum(["4", "6", "8"]).optional(),
  use_text: z.boolean().optional(),
  text_mode: z.enum(TEXT_RENDER_MODES).optional(),
  text_style_ids: z.array(z.string().min(1)).max(3).optional(),
  use_logo: z.boolean().optional(),
  logo_position: z.enum([
    "top-left", "top-center", "top-right",
    "middle-left", "middle-center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
  ]).optional(),
  post_mood: z.string().optional(),
  content_language: z.enum(SUPPORTED_LANGUAGES).optional(),
  content_type: z.enum(["image", "video", "carousel", "enhancement"]).optional(),
});
export type GenerationParams = z.infer<typeof generationParamsSchema>;

export const postSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  image_url: z.string().nullable(),
  thumbnail_url: z.string().nullable().default(null),
  content_type: z.enum(["image", "video", "carousel", "enhancement"]).default("image"),
  slide_count: z.number().int().positive().nullable(),
  idempotency_key: z.string().uuid().nullable(),
  caption: z.string().nullable(),
  ai_prompt_used: z.string().nullable(),
  base_image_url: z.string().nullable().default(null),
  typography_meta: typographyMetaSchema.nullable().default(null),
  generation_params: generationParamsSchema.nullable().default(null),
  status: z.string(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  trashed_at: z.string().nullable().default(null),
});
export type Post = z.infer<typeof postSchema>;

export const postGalleryItemSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  image_url: z.string().nullable(),
  original_image_url: z.string().nullable(),
  thumbnail_url: z.string().nullable().default(null),
  content_type: z.enum(["image", "video", "carousel", "enhancement"]).default("image"),
  caption: z.string().nullable(),
  ai_prompt_used: z.string().nullable().default(null),
  version_count: z.number().int().nonnegative(),
  slide_count: z.number().int().positive().nullable(),
  status: z.string().default("generated"),
  expires_at: z.string().nullable(),
  trashed_at: z.string().nullable().default(null),
});
export type PostGalleryItem = z.infer<typeof postGalleryItemSchema>;

export const postsPageResponseSchema = z.object({
  posts: z.array(postGalleryItemSchema),
  totalCount: z.number().int().nonnegative(),
});
export type PostsPageResponse = z.infer<typeof postsPageResponseSchema>;

export const cleanupExpiredPostsResponseSchema = z.object({
  success: z.boolean(),
  deletedCount: z.number().int().nonnegative(),
  deletedStorageObjectCount: z.number().int().nonnegative(),
  message: z.string(),
});
export type CleanupExpiredPostsResponse = z.infer<typeof cleanupExpiredPostsResponseSchema>;

// ── Trash (Phase 11) ─────────────────────────────────────────────────────────

export const trashedPostSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  image_url: z.string().nullable(),
  thumbnail_url: z.string().nullable().default(null),
  content_type: z.enum(["image", "video", "carousel", "enhancement"]).default("image"),
  slide_count: z.number().int().positive().nullable(),
  caption: z.string().nullable(),
  trashed_at: z.string(),
  days_remaining: z.number().int().nonnegative(),
});
export type TrashedPost = z.infer<typeof trashedPostSchema>;

export const trashListResponseSchema = z.object({
  posts: z.array(trashedPostSchema),
});
export type TrashListResponse = z.infer<typeof trashListResponseSchema>;

export const postVersionSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  version_number: z.number().int().positive(),
  image_url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
  base_image_url: z.string().nullable().default(null),
  typography_meta: typographyMetaSchema.nullable().default(null),
  edit_prompt: z.string().nullable(),
  // Phase 26 (POL-06): nullable because every pre-Phase-26 row has NULL.
  idempotency_key: z.string().uuid().nullable().default(null),
  created_at: z.string(),
});
export type PostVersion = z.infer<typeof postVersionSchema>;

// ── Carousel Slide (v1.1) ────────────────────────────────────────────────────
// One row per slide in a carousel post. post_id FKs posts.id (ON DELETE CASCADE).
// See supabase migration for RLS (mirrors posts ownership).

export const postSlideSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  slide_number: z.number().int().positive(),
  image_url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
  // Phase 25 (CRSL2-02) — mirrors posts.base_image_url/typography_meta from
  // Phase 23. base_image_url is the raw AI slide AFTER aspect-crop but BEFORE
  // typography + logo. NULL forever for pre-Phase-25 slides (LEGACY branch).
  base_image_url: z.string().nullable().default(null),
  typography_meta: typographyMetaSchema.nullable().default(null),
  created_at: z.string(),
});
export type PostSlide = z.infer<typeof postSlideSchema>;

// ── Carousel Slide Versions (Phase 13) ──────────────────────────────────────
// One row per edit applied to a single slide. Keyed on (post_slide_id, version_number).
// Distinct from post_versions which is global per post_id (image/video only).
export const postSlideVersionSchema = z.object({
  id: z.string().uuid(),
  post_slide_id: z.string().uuid(),
  version_number: z.number().int().positive(),
  image_url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
  // Phase 25 (CRSL2-02) — same two fields as postSlideSchema, so every slide
  // edit persists its own re-composited base + meta, mirroring postVersionSchema.
  base_image_url: z.string().nullable().default(null),
  typography_meta: typographyMetaSchema.nullable().default(null),
  edit_prompt: z.string().nullable(),
  created_at: z.string(),
});
export type PostSlideVersion = z.infer<typeof postSlideVersionSchema>;

export const landingContentSchema = z.object({
  id: z.string().uuid(),
  background_variant: z.enum(["solid", "alternative"]).default("solid"),
  hero_badge_text: z.string(),
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
  ga4_enabled: z.boolean(),
  ga4_configured: z.boolean(),
  facebook_dataset_enabled: z.boolean(),
  facebook_dataset_configured: z.boolean(),
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

export const GHL_STANDARD_MAPPING_PREFIX = "__ghl_standard__:";
export const GHL_STANDARD_FIELD_KEYS = [
  "name",
  "firstName",
  "lastName",
  "email",
  "phone",
] as const;
export type GHLStandardFieldKey = typeof GHL_STANDARD_FIELD_KEYS[number];

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
  custom_field_mappings: z.record(z.string(), z.string()).default({}),
  last_sync_at: z.string().nullable(),
  sync_on_signup: z.boolean().default(false),
  connection_status: z.enum(['connected', 'disconnected', 'error', 'not_configured']),
});
export type AdminGHLStatus = z.infer<typeof adminGHLStatusSchema>;

export const saveGHLSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  api_key: z.string()
    .trim()
    .min(20, "API key looks invalid")
    .regex(/^\S+$/, "API key cannot contain spaces")
    .optional(),
  location_id: z.string().min(1, "Location ID is required").optional(),
  custom_field_mappings: z.record(z.string(), z.string()).optional(),
  sync_on_signup: z.boolean().optional(),
});
export type SaveGHLSettingsRequest = z.infer<typeof saveGHLSettingsRequestSchema>;

export const marketingLeadTrackRequestSchema = z.object({
  content_name: z.string().min(1).optional(),
  content_category: z.string().min(1).optional(),
  fbc: z.string().optional().nullable(),
  fbp: z.string().optional().nullable(),
  phone: z.string().min(3).optional(),
  full_name: z.string().min(1).optional(),
  company_name: z.string().min(1).optional(),
  company_type: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  answers: z.record(z.string(), z.string()).optional(),
});
export type MarketingLeadTrackRequest = z.infer<typeof marketingLeadTrackRequestSchema>;

// ── Telegram Integration ───────────────────────────────────────────────────────

export const telegramIntegrationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  bot_token: z.string().nullable(),
  chat_ids: z.array(z.string()).default([]),
  notify_on_new_signup: z.boolean().default(true),
  last_tested_at: z.string().nullable().optional(),
});
export type TelegramIntegrationSettings = z.infer<typeof telegramIntegrationSettingsSchema>;

export const adminTelegramStatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  bot_token_masked: z.string().nullable(),
  chat_ids: z.array(z.string()),
  notify_on_new_signup: z.boolean(),
  last_tested_at: z.string().nullable(),
  connection_status: z.enum(["connected", "disconnected", "error", "not_configured"]),
});
export type AdminTelegramStatus = z.infer<typeof adminTelegramStatusSchema>;

export const saveTelegramSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  bot_token: z.string().min(1, "Bot token is required").optional(),
  chat_ids: z.array(z.string().min(1)).max(20).optional(),
  notify_on_new_signup: z.boolean().optional(),
});
export type SaveTelegramSettingsRequest = z.infer<typeof saveTelegramSettingsRequestSchema>;

export const testTelegramRequestSchema = z.object({
  bot_token: z.string().min(1).optional(),
  chat_ids: z.array(z.string().min(1)).max(20).optional(),
});
export type TestTelegramRequest = z.infer<typeof testTelegramRequestSchema>;

// -- GA4 Integration ----------------------------------------------------------

export const adminGA4StatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  measurement_id: z.string().nullable(),
  api_secret_masked: z.string().nullable(),
  last_tested_at: z.string().nullable(),
  connection_status: z.enum(["connected", "disconnected", "error", "not_configured"]),
});
export type AdminGA4Status = z.infer<typeof adminGA4StatusSchema>;

export const saveGA4SettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  measurement_id: z.string().min(1).optional(),
  api_secret: z.string().min(1).optional(),
});
export type SaveGA4SettingsRequest = z.infer<typeof saveGA4SettingsRequestSchema>;

export const testGA4RequestSchema = z.object({
  measurement_id: z.string().min(1).optional(),
  api_secret: z.string().min(1).optional(),
});
export type TestGA4Request = z.infer<typeof testGA4RequestSchema>;

// -- Facebook Dataset Integration ---------------------------------------------

export const adminFacebookDatasetStatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  dataset_id: z.string().nullable(),
  access_token_masked: z.string().nullable(),
  test_event_code: z.string().nullable(),
  last_tested_at: z.string().nullable(),
  connection_status: z.enum(["connected", "disconnected", "error", "not_configured"]),
});
export type AdminFacebookDatasetStatus = z.infer<typeof adminFacebookDatasetStatusSchema>;

export const saveFacebookDatasetSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  dataset_id: z.string().min(1).optional(),
  access_token: z.string().min(1).optional(),
  test_event_code: z.string().min(1).optional().nullable(),
});
export type SaveFacebookDatasetSettingsRequest = z.infer<typeof saveFacebookDatasetSettingsRequestSchema>;

export const testFacebookDatasetRequestSchema = z.object({
  dataset_id: z.string().min(1).optional(),
  access_token: z.string().min(1).optional(),
  test_event_code: z.string().min(1).optional().nullable(),
});
export type TestFacebookDatasetRequest = z.infer<typeof testFacebookDatasetRequestSchema>;

// -- Marketing Event Log ------------------------------------------------------

export const marketingDeliveryStatusSchema = z.enum(["queued", "sent", "failed", "skipped"]);
export type MarketingDeliveryStatus = z.infer<typeof marketingDeliveryStatusSchema>;

export const marketingEventSchema = z.object({
  id: z.string().uuid(),
  event_key: z.string().nullable().optional(),
  event_name: z.string(),
  event_source: z.string(),
  user_id: z.string().uuid().nullable().optional(),
  email: z.string().nullable().optional(),
  event_payload: z.record(z.string(), z.unknown()).default({}),
  ga4_status: marketingDeliveryStatusSchema,
  ga4_response: z.unknown().nullable().optional(),
  facebook_status: marketingDeliveryStatusSchema,
  facebook_response: z.unknown().nullable().optional(),
  processed_at: z.string().nullable().optional(),
  created_at: z.string(),
});
export type MarketingEvent = z.infer<typeof marketingEventSchema>;

export const adminMarketingEventsResponseSchema = z.object({
  events: z.array(marketingEventSchema),
  totalCount: z.number().int().nonnegative(),
});
export type AdminMarketingEventsResponse = z.infer<typeof adminMarketingEventsResponseSchema>;

// -- Integration Health (30-day observability) --------------------------------

export const integrationHealthChannelSchema = z.enum(["ga4", "facebook", "ghl", "telegram"]);
export type IntegrationHealthChannel = z.infer<typeof integrationHealthChannelSchema>;

export const integrationHealthStateSchema = z.enum([
  "na",
  "disabled",
  "no_traffic",
  "healthy",
  "degraded",
  "failing",
]);
export type IntegrationHealthState = z.infer<typeof integrationHealthStateSchema>;

export const integrationHealthCellSchema = z.object({
  channel: integrationHealthChannelSchema,
  applicable: z.boolean(),
  state: integrationHealthStateSchema,
  attempts_30d: z.number().int().nonnegative(),
  sent_30d: z.number().int().nonnegative(),
  failed_30d: z.number().int().nonnegative(),
  skipped_30d: z.number().int().nonnegative(),
  queued_30d: z.number().int().nonnegative(),
  success_rate: z.number().min(0).max(1).nullable(),
  last_attempt_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_status: marketingDeliveryStatusSchema.nullable(),
  last_error: z.string().nullable(),
});
export type IntegrationHealthCell = z.infer<typeof integrationHealthCellSchema>;

export const integrationHealthEventSchema = z.object({
  event_name: z.string(),
  channels: z.object({
    ga4: integrationHealthCellSchema,
    facebook: integrationHealthCellSchema,
    ghl: integrationHealthCellSchema,
    telegram: integrationHealthCellSchema,
  }),
  active: z.boolean(),
});
export type IntegrationHealthEvent = z.infer<typeof integrationHealthEventSchema>;

export const integrationHealthChannelSummarySchema = z.object({
  channel: integrationHealthChannelSchema,
  enabled: z.boolean(),
  configured: z.boolean(),
  enabled_at: z.string().nullable(),
  last_sync_at: z.string().nullable(),
});
export type IntegrationHealthChannelSummary = z.infer<typeof integrationHealthChannelSummarySchema>;

export const adminIntegrationsHealthResponseSchema = z.object({
  window_days: z.number().int().positive(),
  generated_at: z.string(),
  channels: z.array(integrationHealthChannelSummarySchema),
  events: z.array(integrationHealthEventSchema),
});
export type AdminIntegrationsHealthResponse = z.infer<typeof adminIntegrationsHealthResponseSchema>;

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
  // Phase 26 (POL-06): mirrors carouselRequestSchema/enhanceRequestSchema.
  idempotency_key: z.string().uuid(),
  reference_text: z.string().optional(),
  reference_images: z.array(z.object({
    mimeType: z.string(),
    data: z.string()
  })).max(4).optional(),
  use_brand_references: z.boolean().optional(),
  post_mood: z.string().min(1, "Select a post mood"),
  use_text: z.boolean().default(true),
  copy_text: z.string().optional(),
  text_blocks: z.array(textBlockSchema).max(3).optional(),
  text_mode: z.enum(TEXT_RENDER_MODES).optional(),
  text_style_id: z.string().min(1).optional(),
  text_style_ids: z.array(z.string().min(1)).max(3).optional(),
  aspect_ratio: z.enum([
    "1:1", "1:4", "1:8",
    "2:3", "3:2", "3:4",
    "4:1", "4:3", "4:5", "5:4",
    "8:1", "9:16", "16:9", "21:9",
    "1200:628",
  ]),
  use_logo: z.boolean().optional(),
  logo_position: z.enum(LOGO_POSITIONS).optional(),
  content_language: z.enum(SUPPORTED_LANGUAGES).default("en"),
  content_type: z.enum(["image", "video", "carousel", "enhancement"]).default("image"),
  image_resolution: z.enum(["512px", "1K", "2K", "4K"]).optional(),
  video_resolution: z.enum(["720p", "1080p", "4k"]).optional(),
  video_duration: z.enum(["4", "6", "8"]).optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const generateResponseSchema = z.object({
  image_url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
  content_type: z.enum(["image", "video", "carousel", "enhancement"]).default("image"),
  caption: z.string(),
  headline: z.string(),
  subtext: z.string(),
  post_id: z.string(),
  expires_at: z.string().nullable(),
});
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

// ── Carousel Request (v1.1) ──────────────────────────────────────────────────
// Request body for POST /api/carousel/generate (Phase 7). Shared brand fields
// mirror the conventions used by generateRequestSchema; per-slide reference
// image handling and text_blocks are Phase 6/7 concerns.

export const carouselRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  slide_count: z.number().int().min(3).max(8),
  aspect_ratio: z.enum(["1:1", "4:5"]),
  idempotency_key: z.string().uuid(),
  content_language: z.enum(SUPPORTED_LANGUAGES).default("en"),
  post_mood: z.string().min(1, "Select a post mood"),
  text_style_id: z.string().min(1).optional(),
  text_style_ids: z.array(z.string().min(1)).max(3).optional(),
  use_logo: z.boolean().optional(),
  logo_position: z.enum(LOGO_POSITIONS).optional(),
});
export type CarouselRequest = z.infer<typeof carouselRequestSchema>;

// ── Enhancement Request (v1.1) ───────────────────────────────────────────────
// Request body for POST /api/enhance (Phase 7). No free-text scenery modifier
// in v1.1 (deferred to v2 per ENHC-V2-01). The 5 MB size limit is enforced at
// the route layer in Phase 7 — not in Zod.

export const enhanceRequestSchema = z.object({
  scenery_id: z.string().min(1),
  idempotency_key: z.string().uuid(),
  image: z.object({
    mimeType: z.string().min(1),
    data: z.string().min(1),
  }),
});
export type EnhanceRequest = z.infer<typeof enhanceRequestSchema>;

export const editPostRequestSchema = z.object({
  post_id: z.string().uuid(),
  edit_prompt: z.string().min(1, "Edit prompt is required"),
  content_language: z.enum(SUPPORTED_LANGUAGES).default("en"),
  source: z.enum(["manual", "quick_remake"]).default("manual"),
  // Phase 26 (POL-06): mirrors carouselRequestSchema/enhanceRequestSchema.
  // Top-level (a sibling of post_id/edit_prompt), NOT inside edit_context —
  // edit_context is a free-form remake-context bag, not the request's identity key.
  idempotency_key: z.string().uuid(),
  edit_context: z.object({
    goal_text: z.string().optional(),
    focus_areas: z.array(z.string()).max(8).optional(),
    focus_details: z.string().optional(),
    text_mode: z.enum(["keep", "improve", "replace", "remove"]).optional(),
    replacement_text: z.string().optional(),
    text_style_id: z.string().min(1).optional(),
    text_style_ids: z.array(z.string().min(1)).max(3).optional(),
    preserve_brand_colors: z.boolean().optional(),
    preserve_layout: z.boolean().optional(),
    extra_notes: z.string().optional(),
    // Phase 23 (POL-05): faithful remake — the client pre-fills these from the
    // post's persisted generation parameters instead of the server guessing.
    aspect_ratio: generationParamsSchema.shape.aspect_ratio,
    use_logo: z.boolean().optional(),
    logo_position: z.enum(LOGO_POSITIONS).optional(),
    // Phase 23 (TYPO-07): true when the user changed ONLY the text step. The
    // server then takes the compositor-only fast path (re-render text over the
    // existing persisted base image, NO AI image call, no re-crop). Ignored
    // when the post has no persisted base image (legacy) or is a video.
    text_only: z.boolean().optional(),
  }).optional(),
});
export type EditPostRequest = z.infer<typeof editPostRequestSchema>;

// ── Carousel Slide Edit Request (Phase 13) ──────────────────────────────────
// Targets POST /api/carousel/slide/edit. Shares edit_context shape with editPostRequestSchema
// but uses slide_id (post_slides.id) instead of post_id as the primary key.
// post_id is included for billing/marketing association and ownership cross-check.
// Phase 26 (POL-06): deliberately has NO idempotency_key — POST /api/carousel/slide/edit
// has no idempotency contract and gains none this phase. Do not "fix" this inconsistency.
export const editSlideRequestSchema = z.object({
  slide_id: z.string().uuid(),
  post_id: z.string().uuid(),
  edit_prompt: z.string().min(1, "Edit prompt is required"),
  content_language: z.enum(SUPPORTED_LANGUAGES).default("en"),
  source: z.enum(["manual", "quick_remake"]).default("manual"),
  edit_context: editPostRequestSchema.shape.edit_context,
});
export type EditSlideRequest = z.infer<typeof editSlideRequestSchema>;

export const editPostResponseSchema = z.object({
  version_id: z.string(),
  version_number: z.number(),
  image_url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
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
  text_model: z.string().nullable().optional(),  // model used for text token accounting
  image_model: z.string().nullable().optional(),  // model used for image token accounting
  // Estimated cost in micro-dollars (1 USD = 1_000_000). e.g. $0.001 → 1000
  cost_usd_micros: z.number().int().nullable(),
  charged_amount_micros: z.number().int().nullable().optional(),
  affiliate_commission_micros: z.number().int().nullable().optional(),
  gross_profit_micros: z.number().int().nullable().optional(),
  platform_net_micros: z.number().int().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(), // Phase 21 GATE-05: { estimated_cost_usd_micros, real_cost_usd_micros }
  created_at: z.string(),
});
export type UsageEvent = z.infer<typeof usageEventSchema>;

// ── Generation Logs (Error Tracking) ───────────────────────────────────────────

export const generationLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  status: z.string().default("failed"),
  error_message: z.string(),
  // NOTE: error_type widened to include the 3 new values from the migration's CHECK constraint.
  error_type: z.enum([
    "text_generation",
    "image_generation",
    "upload",
    "database",
    "unknown",
    "subject_fidelity",
    "text_verification",
    "caption_quality",
  ]).nullable(),
  request_params: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  // ── Phase 16 (v1.3) observability fields (all NULLABLE on the table; OPTIONAL in Zod) ──
  post_id: z.string().uuid().nullable().optional(),
  event_kind: z.enum([
    "text_verification",
    "caption_quality",
    "subject_fidelity",
    "model_fallback",
    "planning_schema_failure", // Phase 22 (PLAN-02)
    "visual_critic", // Phase 24 (CRIT-05)
  ]).nullable().optional(),
  outcome: z.string().nullable().optional(),
  attempt_count: z.number().int().nonnegative().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type GenerationLog = z.infer<typeof generationLogSchema>;

export const adminGenerationLogsResponseSchema = z.object({
  logs: z.array(generationLogSchema),
  total: z.number().int(),
});
export type AdminGenerationLogsResponse = z.infer<typeof adminGenerationLogsResponseSchema>;

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
  denial_reason: z.enum(["inactive_subscription", "usage_budget_reached", "upgrade_required"]).nullable().optional(),
  usage_budget_micros: z.number().int().nullable().optional(),
  usage_budget_remaining_micros: z.number().int().nullable().optional(),
  additional_usage_this_month_micros: z.number().int().optional(),
  usage_alert_reached: z.boolean().optional(),
  usage_budget_reached: z.boolean().optional(),
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
  commission_share_percent: z.number(),
  minimum_payout_micros: z.number().int(),
  auto_payout_enabled: z.boolean(),
  referred_users_count: z.number().int(),
});
export type AffiliateDashboardResponse = z.infer<typeof affiliateDashboardResponseSchema>;

export const affiliateReferralCodeRegex = /^[a-z0-9][a-z0-9_-]{4,63}$/i;

export const updateAffiliateReferralCodeRequestSchema = z.object({
  referral_code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      affiliateReferralCodeRegex,
      "Referral code must be 5-64 characters using letters, numbers, hyphen, or underscore."
    ),
});
export type UpdateAffiliateReferralCodeRequest = z.infer<typeof updateAffiliateReferralCodeRequestSchema>;

export const updateAffiliateReferralCodeResponseSchema = z.object({
  referral_code: z.string(),
});
export type UpdateAffiliateReferralCodeResponse = z.infer<typeof updateAffiliateReferralCodeResponseSchema>;

export const affiliateReferredAccountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  company_name: z.string().nullable(),
  company_type: z.string().nullable(),
  created_at: z.string(),
});
export type AffiliateReferredAccount = z.infer<typeof affiliateReferredAccountSchema>;

export const affiliateReferredAccountsResponseSchema = z.object({
  accounts: z.array(affiliateReferredAccountSchema),
  total_count: z.number().int().nonnegative(),
});
export type AffiliateReferredAccountsResponse = z.infer<typeof affiliateReferredAccountsResponseSchema>;

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
  textInputCostPerMillion: z.number().min(0),
  textInputSellPerMillion: z.number().min(0),
  textOutputCostPerMillion: z.number().min(0),
  textOutputSellPerMillion: z.number().min(0),
  imageInputCostPerMillion: z.number().min(0),
  imageInputSellPerMillion: z.number().min(0),
  imageOutputCostPerMillion: z.number().min(0),
  imageOutputSellPerMillion: z.number().min(0),
  defaultAffiliateCommissionPercent: z.number().min(0).max(100),
  minRechargeMicros: z.number().int(),
  defaultAutoRechargeThresholdMicros: z.number().int(),
  defaultAutoRechargeAmountMicros: z.number().int(),
});
export type MarkupSettings = z.infer<typeof markupSettingsSchema>;

export const updateMarkupSettingsRequestSchema = markupSettingsSchema;
export type UpdateMarkupSettingsRequest = z.infer<typeof updateMarkupSettingsRequestSchema>;
export const billingPlanSchema = z.object({
  id: z.string().uuid(),
  plan_key: z.string(),
  display_name: z.string(),
  active: z.boolean(),
  billing_interval: z.enum(["month", "year"]),
  stripe_product_id: z.string().nullable().optional(),
  stripe_price_id: z.string().nullable().optional(),
  included_credits_micros: z.coerce.number().int(),
  base_price_micros: z.coerce.number().int(),
  overage_enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BillingPlan = z.infer<typeof billingPlanSchema>;

export const userBillingProfileSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  billing_plan_id: z.string().uuid().nullable(),
  stripe_customer_id: z.string().nullable().optional(),
  stripe_subscription_id: z.string().nullable().optional(),
  subscription_status: z.string().nullable().optional(),
  current_period_start: z.string().nullable().optional(),
  current_period_end: z.string().nullable().optional(),
  included_credits_remaining_micros: z.coerce.number().int(),
  pending_overage_micros: z.coerce.number().int(),
  overage_last_billed_at: z.string().nullable().optional(),
  usage_alert_micros: z.coerce.number().int().nullable().optional().default(null),
  usage_budget_micros: z.coerce.number().int().nullable().optional().default(null),
  usage_budget_enabled: z.boolean().optional().default(false),
  created_at: z.string(),
  updated_at: z.string(),
});
export type UserBillingProfile = z.infer<typeof userBillingProfileSchema>;

export const billingLedgerSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  entry_type: z.enum([
    "included_credit_grant",
    "included_credit_usage",
    "overage_accrual",
    "overage_invoice",
    "overage_payment",
    "manual_adjustment",
    "refund",
  ]),
  amount_micros: z.coerce.number().int(),
  balance_included_after_micros: z.coerce.number().int().nullable().optional(),
  pending_overage_after_micros: z.coerce.number().int().nullable().optional(),
  usage_event_id: z.string().uuid().nullable().optional(),
  stripe_invoice_id: z.string().nullable().optional(),
  stripe_payment_intent_id: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  created_at: z.string(),
});
export type BillingLedgerEntry = z.infer<typeof billingLedgerSchema>;

export const billingMeResponseSchema = z.object({
  profile: userBillingProfileSchema,
  plan: billingPlanSchema.nullable(),
  next_overage_billing_at: z.string().nullable(),
  overage_billing_cadence_days: z.number().int().min(1),
  overage_min_invoice_micros: z.number().int().min(0),
  billing_model: z.enum(["credits_topup", "subscription_overage"]),
});
export type BillingMeResponse = z.infer<typeof billingMeResponseSchema>;

export const subscribeRequestSchema = z.object({
  planKey: z.string().min(1).optional(),
});
export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

export const subscribeResponseSchema = z.object({
  url: z.string().url(),
});
export type SubscribeResponse = z.infer<typeof subscribeResponseSchema>;

export const billingPortalResponseSchema = z.object({
  url: z.string().url(),
});
export type BillingPortalResponse = z.infer<typeof billingPortalResponseSchema>;

export const billingLedgerResponseSchema = z.object({
  entries: z.array(billingLedgerSchema),
});
export type BillingLedgerResponse = z.infer<typeof billingLedgerResponseSchema>;

export const billingSpendingControlsSchema = z.object({
  usage_alert_micros: z.number().int().nullable(),
  usage_budget_micros: z.number().int().nullable(),
  usage_budget_enabled: z.boolean(),
  alert_reached: z.boolean(),
  budget_reached: z.boolean(),
  budget_remaining_micros: z.number().int().nullable(),
});
export type BillingSpendingControls = z.infer<typeof billingSpendingControlsSchema>;

export const updateBillingSpendingControlsRequestSchema = z.object({
  usage_alert_micros: z.number().int().min(0).nullable(),
  usage_budget_micros: z.number().int().min(0).nullable(),
  usage_budget_enabled: z.boolean(),
});
export type UpdateBillingSpendingControlsRequest = z.infer<typeof updateBillingSpendingControlsRequestSchema>;

export const billingOverviewResponseSchema = z.object({
  total_available_credits_micros: z.number().int().min(0),
  included_total_micros: z.number().int().min(0),
  included_remaining_micros: z.number().int().min(0),
  included_used_this_month_micros: z.number().int().min(0),
  additional_usage_this_month_micros: z.number().int().min(0),
  overage_accrued_this_month_micros: z.number().int().min(0),
  credit_pack_used_this_month_micros: z.number().int().min(0),
  credit_pack_balance_micros: z.number().int().min(0),
  promotional_credits_micros: z.number().int().min(0),
  gifted_credits_micros: z.number().int().min(0),
  month_start: z.string(),
  month_end: z.string(),
  cycle_resets_at: z.string().nullable(),
  controls: billingSpendingControlsSchema,
  credit_pack_options_micros: z.array(z.number().int().min(1)),
});
export type BillingOverviewResponse = z.infer<typeof billingOverviewResponseSchema>;

export const billingResourceUsageItemSchema = z.object({
  resource_key: z.enum(["generate", "edit", "transcribe"]),
  label: z.string(),
  usage_count: z.number().int().min(0),
  usage_total_micros: z.number().int().min(0),
  unit_price_label: z.string(),
  cost_accrued_micros: z.number().int().min(0),
});
export type BillingResourceUsageItem = z.infer<typeof billingResourceUsageItemSchema>;

export const billingResourceUsageResponseSchema = z.object({
  items: z.array(billingResourceUsageItemSchema),
  total_cost_accrued_micros: z.number().int().min(0),
  month_start: z.string(),
  month_end: z.string(),
});
export type BillingResourceUsageResponse = z.infer<typeof billingResourceUsageResponseSchema>;

export const billingStatementItemSchema = z.object({
  usage_event_id: z.string().uuid(),
  created_at: z.string(),
  event_type: z.enum(["generate", "edit", "transcribe"]),
  post_id: z.string().uuid().nullable(),
  content_type: z.enum(["image", "video", "carousel", "enhancement"]).nullable(),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
  raw_cost_micros: z.number().int().min(0),
  charged_cost_micros: z.number().int().min(0),
  gross_profit_micros: z.number().int().min(0),
  affiliate_commission_micros: z.number().int().min(0),
  platform_net_micros: z.number().int().min(0),
  included_usage_micros: z.number().int().min(0),
  credit_pack_usage_micros: z.number().int().min(0),
  overage_usage_micros: z.number().int().min(0),
});
export type BillingStatementItem = z.infer<typeof billingStatementItemSchema>;

export const billingStatementResponseSchema = z.object({
  items: z.array(billingStatementItemSchema),
  totals: z.object({
    raw_cost_micros: z.number().int().min(0),
    charged_cost_micros: z.number().int().min(0),
    gross_profit_micros: z.number().int().min(0),
    affiliate_commission_micros: z.number().int().min(0),
    platform_net_micros: z.number().int().min(0),
  }),
});
export type BillingStatementResponse = z.infer<typeof billingStatementResponseSchema>;

export const adminBillingSettingsSchema = z.object({
  billing_model: z.enum(["credits_topup", "subscription_overage"]),
  default_plan_key: z.string(),
  overage_billing_cadence_days: z.number().int().min(1),
  overage_min_invoice_micros: z.number().int().min(0),
});
export type AdminBillingSettings = z.infer<typeof adminBillingSettingsSchema>;

export const updateAdminBillingSettingsRequestSchema = adminBillingSettingsSchema;
export type UpdateAdminBillingSettingsRequest = z.infer<typeof updateAdminBillingSettingsRequestSchema>;

export const updateBillingPlanRequestSchema = z.object({
  display_name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  billing_interval: z.enum(["month", "year"]).optional(),
  stripe_product_id: z.string().nullable().optional(),
  stripe_price_id: z.string().nullable().optional(),
  included_credits_micros: z.number().int().min(0).optional(),
  base_price_micros: z.number().int().min(0).optional(),
  overage_enabled: z.boolean().optional(),
});
export type UpdateBillingPlanRequest = z.infer<typeof updateBillingPlanRequestSchema>;


// ── Legacy ────────────────────────────────────────────────────────────────────

export type User = {
  id: string;
  username: string;
  password: string;
};
export type InsertUser = Pick<User, "username" | "password">;

