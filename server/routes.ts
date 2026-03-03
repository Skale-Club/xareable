import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { createServerSupabase, createAdminSupabase } from "./supabase";
import { randomUUID } from "crypto";
import { uploadFile } from "./storage";
import {
  DEFAULT_STYLE_CATALOG,
  affiliateDashboardResponseSchema,
  generateRequestSchema,
  editPostRequestSchema,
  markupSettingsSchema,
  purchaseCreditsRequestSchema,
  styleCatalogSchema,
  updateMarkupSettingsRequestSchema,
  updateAutoRechargeRequestSchema,
  updateAppSettingsSchema,
} from "../shared/schema";
import {
  checkCredits,
  deductCredits,
  getCreditsState,
  getMinimumRechargeMicros,
  recordUsageEvent,
} from "./quota";
import {
  stripe,
  createCreditCheckoutSession,
  createStripeConnectAccount,
  createStripeConnectLoginLink,
  syncAffiliateStripeStatus,
  handleStripeWebhook,
} from "./stripe";

const DEFAULT_APP_SETTINGS = {
  app_name: "Xareable",
  app_tagline: "AI-Powered Social Media Content Creation",
  app_description: "Create stunning social media images and captions with AI, tailored to your brand identity.",
  favicon_url: null as string | null,
  logo_url: null as string | null,
  primary_color: "#8b5cf6",
  meta_title: "Xareable - AI Social Media Content Creator",
  meta_description: "Create stunning social media images and captions with AI, tailored to your brand identity.",
  og_image_url: null as string | null,
  terms_url: null as string | null,
  privacy_url: null as string | null,
  updated_at: new Date().toISOString(),
};

function getSiteOrigin(req: Request) {
  const forwardedHost = req.get("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = (forwardedProto || req.protocol || "https").split(",")[0].trim();

  if (!host) {
    return "https://localhost";
  }

  return `${protocol}://${host}`;
}

async function getPublicAppSettings() {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("app_settings")
    .select("app_name, app_tagline, app_description, favicon_url, logo_url, primary_color, meta_title, meta_description, og_image_url, terms_url, privacy_url, updated_at")
    .single();
  const { data: landingContent } = await sb
    .from("landing_content")
    .select("icon_url")
    .single();

  return {
    ...DEFAULT_APP_SETTINGS,
    ...(data || {}),
    favicon_url: landingContent?.icon_url || data?.favicon_url || DEFAULT_APP_SETTINGS.favicon_url,
  };
}

async function getPlatformNumericSetting(
  settingKey: string,
  field: "amount" | "multiplier",
  fallback: number,
): Promise<number> {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("platform_settings")
    .select("setting_value")
    .eq("setting_key", settingKey)
    .single();

  const value = data?.setting_value as Record<string, unknown> | null;
  const raw = value?.[field];

  return typeof raw === "number" ? raw : fallback;
}

async function getMarkupSettingsPayload() {
  const payload = {
    regularMultiplier: await getPlatformNumericSetting("markup_regular", "multiplier", 3),
    affiliateMultiplier: await getPlatformNumericSetting("markup_affiliate", "multiplier", 4),
    minRechargeMicros: await getPlatformNumericSetting("min_recharge_micros", "amount", 10_000_000),
    defaultAutoRechargeThresholdMicros: await getPlatformNumericSetting("default_auto_recharge_threshold", "amount", 5_000_000),
    defaultAutoRechargeAmountMicros: await getPlatformNumericSetting("default_auto_recharge_amount", "amount", 10_000_000),
  };

  return markupSettingsSchema.parse(payload);
}

async function getStyleCatalogPayload() {
  const sb = createAdminSupabase();
  const { data } = await sb
    .from("platform_settings")
    .select("setting_value")
    .eq("setting_key", "style_catalog")
    .single();

  const value = data?.setting_value;
  const parsed = styleCatalogSchema.safeParse(value);

  if (!parsed.success) {
    return DEFAULT_STYLE_CATALOG;
  }

  return parsed.data;
}

async function requireAdmin(req: any, res: any): Promise<{ userId: string } | null> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) { res.status(401).json({ message: "Authentication required" }); return null; }
  const supabase = createServerSupabase(token);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) { res.status(401).json({ message: "Invalid authentication" }); return null; }
  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) { res.status(403).json({ message: "Admin access required" }); return null; }
  return { userId: user.id };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.get("/robots.txt", async (req, res) => {
    const origin = getSiteOrigin(req);
    const lines = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /admin",
      "Disallow: /affiliate",
      "Disallow: /credits",
      "Disallow: /dashboard",
      "Disallow: /login",
      "Disallow: /onboarding",
      "Disallow: /posts",
      "Disallow: /settings",
      `Sitemap: ${origin}/sitemap.xml`,
    ];

    res.type("text/plain").send(lines.join("\n"));
  });

  app.get("/sitemap.xml", async (req, res) => {
    const origin = getSiteOrigin(req);
    const settings = await getPublicAppSettings();
    const sb = createAdminSupabase();
    const { data: landingContent } = await sb
      .from("landing_content")
      .select("updated_at")
      .single();

    const publicUrls = [
      {
        loc: `${origin}/`,
        lastmod: landingContent?.updated_at || settings.updated_at,
        changefreq: "weekly",
        priority: "1.0",
      },
    ];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...publicUrls.map(
        (entry) => [
          "  <url>",
          `    <loc>${entry.loc}</loc>`,
          `    <lastmod>${entry.lastmod}</lastmod>`,
          `    <changefreq>${entry.changefreq}</changefreq>`,
          `    <priority>${entry.priority}</priority>`,
          "  </url>",
        ].join("\n"),
      ),
      "</urlset>",
    ].join("\n");

    res.type("application/xml").send(xml);
  });

  app.get("/site.webmanifest", async (_req, res) => {
    const settings = await getPublicAppSettings();
    const manifest = {
      name: settings.app_name,
      short_name: settings.app_name,
      description:
        settings.app_description ||
        settings.app_tagline ||
        settings.meta_description,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: settings.primary_color || DEFAULT_APP_SETTINGS.primary_color,
      icons: [
        {
          src: settings.favicon_url || "/favicon.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
    };

    res
      .type("application/manifest+json")
      .send(JSON.stringify(manifest, null, 2));
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    });
  });

  app.get("/api/style-catalog", async (_req, res) => {
    const catalog = await getStyleCatalogPayload();
    res.json(catalog);
  });

  app.get("/api/admin/style-catalog", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const catalog = await getStyleCatalogPayload();
    res.json(catalog);
  });

  app.patch("/api/admin/style-catalog", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const parseResult = styleCatalogSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", "),
      });
    }

    const sb = createAdminSupabase();
    const payload = parseResult.data;

    const { data, error } = await sb
      .from("platform_settings")
      .upsert(
        {
          setting_key: "style_catalog",
          setting_value: payload,
          updated_by: admin.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      )
      .select("setting_value")
      .single();

    if (error) {
      return res.status(500).json({ message: error.message });
    }

    res.json(styleCatalogSchema.parse(data.setting_value));
  });

  app.post("/api/generate", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const supabase = createServerSupabase(token);
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return res.status(401).json({ message: "Invalid authentication" });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_affiliate, api_key")
        .eq("id", user.id)
        .single();

      const isAffiliate = profile?.is_affiliate === true;

      let geminiApiKey: string;
      if (isAffiliate) {
        if (!profile?.api_key) {
          return res.status(400).json({ message: "Como afiliado, configure sua Gemini API Key nas configurações antes de gerar." });
        }
        geminiApiKey = profile.api_key;
      } else {
        const serverKey = process.env.GEMINI_API_KEY;
        if (!serverKey) {
          return res.status(500).json({ message: "Gemini API key not configured on the server." });
        }
        geminiApiKey = serverKey;
      }

      const { data: brand } = await supabase
        .from("brands")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (!brand) {
        return res.status(400).json({ message: "No brand profile found. Please complete onboarding." });
      }

      const creditStatus = !isAffiliate
        ? await checkCredits(user.id, "generate")
        : null;

      if (creditStatus && !creditStatus.allowed) {
        return res.status(402).json({
          error: "insufficient_credits",
          message: "Insufficient credits. Add credits to continue.",
          balance_micros: creditStatus.balance_micros,
          estimated_cost_micros: creditStatus.estimated_cost_micros,
        });
      }

      const parseResult = generateRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ") });
      }
      const { reference_text, reference_images, post_mood, copy_text, aspect_ratio, use_logo, logo_position } = parseResult.data;
      const styleCatalog = await getStyleCatalogPayload();
      const brandStyle = styleCatalog.styles.find((item) => item.id === brand.mood);
      const selectedPostMood = styleCatalog.post_moods.find((item) => item.id === post_mood);
      const brandStyleLabel = brandStyle?.label || brand.mood;
      const postMoodLabel = selectedPostMood?.label || post_mood;

      const logoPositionDescription: Record<string, string> = {
        "top-left": "top-left corner",
        "top-center": "top center",
        "top-right": "top-right corner",
        "middle-left": "middle-left side",
        "middle-center": "center of the image",
        "middle-right": "middle-right side",
        "bottom-left": "bottom-left corner",
        "bottom-center": "bottom center",
        "bottom-right": "bottom-right corner",
      };

      const contextPrompt = `You are an expert Art Director and Social Media Strategist.

Context about the brand:
- Brand name: ${brand.company_name}
- Industry/Niche: ${brand.company_type}
- Brand colors: Primary ${brand.color_1}, Secondary ${brand.color_2}, Accent ${brand.color_3}
- Brand style: ${brandStyleLabel}
${brand.logo_url ? `- Brand logo URL: ${brand.logo_url}` : ""}

The user wants a "${postMoodLabel}" post mood for this social media image.
${copy_text ? `The text they want on the image is: "${copy_text}"` : "Create an engaging text for the image based on the brand context."}
${reference_text ? `User's visual direction: "${reference_text}"` : ""}
${reference_images && reference_images.length > 0 ? `The user has provided ${reference_images.length} reference image(s). Analyze these images and incorporate their visual style, composition, color schemes, and design elements into your recommendations.` : ""}
${use_logo && brand.logo_url ? `IMPORTANT: The user wants their brand logo included in the ${logoPositionDescription[logo_position || "bottom-right"]} of the image. Make sure to describe the logo placement in your image prompt.` : ""}
Aspect ratio: ${aspect_ratio}

Your task:
1. ${reference_images && reference_images.length > 0 ? "First, analyze the provided reference images and extract key visual elements, styles, and composition patterns." : ""}
2. Analyze the text and split it into a short punchy "headline" (max 6 words) and a "subtext" (the supporting message).
3. Write a highly descriptive prompt for an image generation model that incorporates:
   - The brand colors (${brand.color_1}, ${brand.color_2}, ${brand.color_3})
   - The ${brandStyleLabel} brand style
   - The ${postMoodLabel} post mood
   ${reference_images && reference_images.length > 0 ? "   - Visual style and elements from the reference images" : ""}
4. Write an engaging social media caption with relevant hashtags. IMPORTANT: Format the caption with proper paragraph breaks using newline characters (\n\n) between different ideas or sections. Each paragraph should be 1-2 sentences. Add hashtags at the end separated by a blank line.

Output JSON exactly like this (no markdown, just raw JSON):
{
  "headline": "...",
  "subtext": "...",
  "image_prompt": "...",
  "caption": "..."
}`;

      const geminiTextUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

      // Build parts array for Gemini API
      const textRequestParts: any[] = [{ text: contextPrompt }];

      // Add reference images if provided
      if (reference_images && reference_images.length > 0) {
        reference_images.forEach(img => {
          textRequestParts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data
            }
          });
        });
      }

      const textResponse = await fetch(geminiTextUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: textRequestParts }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!textResponse.ok) {
        const errorData = await textResponse.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to generate content context";
        console.error("Gemini text API error:", errorMsg);
        return res.status(500).json({ message: `AI Error: ${errorMsg}` });
      }

      const textData = await textResponse.json();
      const textUsage = textData.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      const textContent = textData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        return res.status(500).json({ message: "No response from AI text model" });
      }

      let contextJson: {
        headline: string;
        subtext: string;
        image_prompt: string;
        caption: string;
      };

      try {
        contextJson = JSON.parse(textContent);
      } catch {
        console.error("Failed to parse AI response:", textContent);
        return res.status(500).json({ message: "Failed to parse AI response" });
      }

      // Convert aspect ratio to dimensions for the API
      const aspectRatioDimensions: Record<string, { width: number; height: number }> = {
        "1:1": { width: 1024, height: 1024 },
        "4:5": { width: 1024, height: 1280 },
        "9:16": { width: 720, height: 1280 },
        "16:9": { width: 1280, height: 720 },
        "2:3": { width: 1024, height: 1536 },
        "1200:628": { width: 1200, height: 628 },
      };

      const dimensions = aspectRatioDimensions[aspect_ratio] || { width: 1024, height: 1024 };

      const logoInstruction = use_logo && brand.logo_url
        ? ` IMPORTANT: Include the brand logo in the ${logoPositionDescription[logo_position || "bottom-right"]} of the image. The logo should be clearly visible but not overpowering, sized appropriately for a professional social media graphic.`
        : "";

      const imagePrompt = `Create a professional social media graphic with aspect ratio ${aspect_ratio} (${dimensions.width}x${dimensions.height}). ${contextJson.image_prompt}.
The image MUST include this text rendered clearly and prominently on it:
Main headline text: "${contextJson.headline}"
Subtext: "${contextJson.subtext}"
Make sure the text is large, readable, and well-positioned. Use colors ${brand.color_1}, ${brand.color_2}, ${brand.color_3}. Brand style: ${brandStyleLabel}. Post mood: ${postMoodLabel}. The composition must fit the ${aspect_ratio} aspect ratio perfectly.${logoInstruction}`;

      const geminiImageUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent";

      const imageResponse = await fetch(geminiImageUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: imagePrompt }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      });

      if (!imageResponse.ok) {
        const errorData = await imageResponse.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to generate image";
        console.error("Gemini image API error:", errorMsg);
        return res.status(500).json({ message: `Image Generation Error: ${errorMsg}` });
      }

      const imageData = await imageResponse.json();
      const imageUsage = imageData.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      const candidates = imageData.candidates?.[0]?.content?.parts;

      if (!candidates) {
        return res.status(500).json({ message: "No image generated. The model may not support image output." });
      }

      const imagePart = candidates.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("image/"),
      );

      if (!imagePart?.inlineData?.data) {
        return res.status(500).json({
          message: "No image was returned by the AI. Try a different prompt or check your API key permissions.",
        });
      }

      const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
      const fileName = `${user.id}/generated/${randomUUID()}.png`;

      const { error: uploadError } = await supabase.storage
        .from("user_assets")
        .upload(fileName, imageBuffer, {
          contentType: imagePart.inlineData.mimeType || "image/png",
          upsert: false,
        });

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        return res.status(500).json({ message: `Upload failed: ${uploadError.message}` });
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("user_assets").getPublicUrl(fileName);

      const { data: post, error: postError } = await supabase
        .from("posts")
        .insert({
          user_id: user.id,
          image_url: publicUrl,
          caption: contextJson.caption,
          ai_prompt_used: contextJson.image_prompt,
          status: "generated",
        })
        .select()
        .single();

      if (postError) {
        console.error("Post insert error:", postError);
        return res.status(500).json({ message: "Failed to save post. Please try again." });
      }

      // Record usage event only after the post is saved, then charge credits.
      const usageEvent = await recordUsageEvent(user.id, post!.id, "generate", {
        text_input_tokens:   textUsage?.promptTokenCount,
        text_output_tokens:  textUsage?.candidatesTokenCount,
        image_input_tokens:  imageUsage?.promptTokenCount,
        image_output_tokens: imageUsage?.candidatesTokenCount,
      });

      if (!isAffiliate) {
        await deductCredits(
          user.id,
          usageEvent.id,
          usageEvent.cost_usd_micros,
          creditStatus!.markup_multiplier,
        );
      }

      return res.json({
        image_url: publicUrl,
        caption: contextJson.caption,
        headline: contextJson.headline,
        subtext: contextJson.subtext,
        post_id: post!.id,
      });
    } catch (error: any) {
      console.error("Generate error:", error);
      return res.status(500).json({
        message: error.message || "An unexpected error occurred during generation",
      });
    }
  });

  app.post("/api/edit-post", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const supabase = createServerSupabase(token);
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return res.status(401).json({ message: "Invalid authentication" });
      }

      const parseResult = editPostRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ") });
      }
      const { post_id, edit_prompt } = parseResult.data;

      // Verify post ownership
      const { data: post } = await supabase
        .from("posts")
        .select("*")
        .eq("id", post_id)
        .eq("user_id", user.id)
        .single();

      if (!post) {
        return res.status(404).json({ message: "Post not found or access denied" });
      }

      const { data: editProfile } = await supabase
        .from("profiles")
        .select("is_affiliate, api_key")
        .eq("id", user.id)
        .single();

      const isAffiliate = editProfile?.is_affiliate === true;

      let geminiApiKey: string;
      if (isAffiliate) {
        if (!editProfile?.api_key) {
          return res.status(400).json({ message: "Como afiliado, configure sua Gemini API Key nas configurações antes de editar." });
        }
        geminiApiKey = editProfile.api_key;
      } else {
        const serverKey = process.env.GEMINI_API_KEY;
        if (!serverKey) {
          return res.status(500).json({ message: "Gemini API key not configured on the server." });
        }
        geminiApiKey = serverKey;
      }

      // Get brand
      const { data: brandData } = await supabase
        .from("brands")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (!brandData) {
        return res.status(400).json({ message: "No brand profile found" });
      }

      const creditStatus = !isAffiliate
        ? await checkCredits(user.id, "edit")
        : null;

      if (creditStatus && !creditStatus.allowed) {
        return res.status(402).json({
          error: "insufficient_credits",
          message: "Insufficient credits. Add credits to continue.",
          balance_micros: creditStatus.balance_micros,
          estimated_cost_micros: creditStatus.estimated_cost_micros,
        });
      }

      const brand = brandData;

      // Get the latest version number (or use base image)
      const { data: versions } = await supabase
        .from("post_versions")
        .select("version_number, image_url")
        .eq("post_id", post_id)
        .order("version_number", { ascending: false })
        .limit(1);

      const latestVersion = versions?.[0];
      const currentImageUrl = latestVersion?.image_url || post.image_url;
      const nextVersionNumber = (latestVersion?.version_number || 0) + 1;

      if (!currentImageUrl) {
        return res.status(400).json({ message: "No image found to edit" });
      }

      // Fetch the current image and detect its content type
      const imageResponse = await fetch(currentImageUrl);
      if (!imageResponse.ok) {
        return res.status(500).json({ message: "Failed to fetch current image" });
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      const imageBase64 = Buffer.from(imageBuffer).toString("base64");
      const imageMimeType = imageResponse.headers.get("content-type")?.split(";")[0] || "image/png";

      // Call Gemini for image editing
      const editPrompt = `You are editing an existing social media image.

Brand context:
- Brand name: ${brand.company_name}
- Industry: ${brand.company_type}
- Brand colors: ${brand.color_1}, ${brand.color_2}, ${brand.color_3}
- Style: ${brand.mood}

User's edit request: ${edit_prompt}

Please modify the image according to the request while maintaining the brand's visual identity and colors.`;

      const geminiImageUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent";

      const editResponse = await fetch(geminiImageUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: editPrompt },
                {
                  inlineData: {
                    mimeType: imageMimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      });

      if (!editResponse.ok) {
        const errorData = await editResponse.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to edit image";
        console.error("Gemini edit API error:", errorMsg);
        return res.status(500).json({ message: `Image Edit Error: ${errorMsg}` });
      }

      const editData = await editResponse.json();
      const editUsage = editData.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      const candidates = editData.candidates?.[0]?.content?.parts;

      if (!candidates) {
        return res.status(500).json({ message: "No edited image generated" });
      }

      const imagePart = candidates.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("image/"),
      );

      if (!imagePart?.inlineData?.data) {
        return res.status(500).json({ message: "No image was returned by the AI" });
      }

      const newImageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
      const fileName = `${user.id}/generated/${randomUUID()}.png`;

      const { error: uploadError } = await supabase.storage
        .from("user_assets")
        .upload(fileName, newImageBuffer, {
          contentType: "image/png",
          upsert: false,
        });

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        return res.status(500).json({ message: `Upload failed: ${uploadError.message}` });
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("user_assets").getPublicUrl(fileName);

      // Insert new version
      const { data: newVersion, error: versionError } = await supabase
        .from("post_versions")
        .insert({
          post_id: post_id,
          version_number: nextVersionNumber,
          image_url: publicUrl,
          edit_prompt: edit_prompt,
        })
        .select()
        .single();

      if (versionError) {
        console.error("Version insert error:", versionError);
        return res.status(500).json({ message: "Failed to save version" });
      }

      const usageEvent = await recordUsageEvent(user.id, post_id, "edit", {
        image_input_tokens: editUsage?.promptTokenCount,
        image_output_tokens: editUsage?.candidatesTokenCount,
      });

      if (!isAffiliate) {
        await deductCredits(
          user.id,
          usageEvent.id,
          usageEvent.cost_usd_micros,
          creditStatus!.markup_multiplier,
        );
      }

      return res.json({
        version_id: newVersion.id,
        version_number: newVersion.version_number,
        image_url: publicUrl,
      });
    } catch (error: any) {
      console.error("Edit error:", error);
      return res.status(500).json({
        message: error.message || "An unexpected error occurred during editing",
      });
    }
  });

  // Admin: get platform stats
  app.get("/api/admin/stats", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const sb = createAdminSupabase();
    const [usersRes, postsRes, brandsRes, usageRes, creditsRes] = await Promise.all([
      sb.from("profiles").select("id, is_admin, created_at", { count: "exact" }),
      sb.from("posts").select("id, created_at", { count: "exact" }),
      sb.from("brands").select("id", { count: "exact" }),
      sb.from("usage_events").select("user_id, cost_usd_micros"),
      sb.from("user_credits").select("user_id, balance_micros, lifetime_purchased_micros, free_generations_used, free_generations_limit"),
    ]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const newUsersToday = (usersRes.data || []).filter(u => new Date(u.created_at) >= today).length;
    const newPostsToday = (postsRes.data || []).filter(p => new Date(p.created_at) >= today).length;
    const totalCostUsdMicros = (usageRes.data || []).reduce((s, e) => s + (e.cost_usd_micros ?? 0), 0);
    const creditCustomers = (creditsRes.data || []).filter(c => (c.lifetime_purchased_micros ?? 0) > 0).length;
    const freeUsers = (creditsRes.data || []).filter(c => (c.free_generations_used ?? 0) < (c.free_generations_limit ?? 0)).length;
    const totalUsageEvents = (usageRes.data || []).length;
    const lowBalanceUsers = (creditsRes.data || []).filter(c => {
      const freeRemaining = (c.free_generations_limit ?? 0) - (c.free_generations_used ?? 0);
      return freeRemaining <= 0 && (c.balance_micros ?? 0) <= 0;
    }).length;
    res.json({
      totalUsers: usersRes.count || 0,
      totalPosts: postsRes.count || 0,
      totalBrands: brandsRes.count || 0,
      newUsersToday,
      newPostsToday,
      totalUsageEvents,
      totalCostUsdMicros,
      activeSubscribers: creditCustomers,
      trialingUsers: freeUsers,
      quotaExhausted: lowBalanceUsers,
    });
  });

  // Admin: get all users
  app.get("/api/admin/users", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const sb = createAdminSupabase();
    const [
      { data: authUsers },
      { data: profiles },
      { data: brands },
      { data: posts },
      { data: credits },
      { data: usageEvents },
    ] = await Promise.all([
      sb.auth.admin.listUsers(),
      sb.from("profiles").select("id, is_admin, is_affiliate, referred_by_affiliate_id, created_at"),
      sb.from("brands").select("user_id, company_name"),
      sb.from("posts").select("user_id"),
      sb.from("user_credits").select("user_id, balance_micros, lifetime_purchased_micros, free_generations_used, free_generations_limit"),
      sb.from("usage_events").select("user_id, event_type, cost_usd_micros"),
    ]);
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
    const brandMap = Object.fromEntries((brands || []).map(b => [b.user_id, b]));
    const creditMap = Object.fromEntries((credits || []).map(c => [c.user_id, c]));
    const postCountMap: Record<string, number> = {};
    for (const p of (posts || [])) postCountMap[p.user_id] = (postCountMap[p.user_id] || 0) + 1;
    const usageMap: Record<string, { generate: number; edit: number; cost: number }> = {};
    for (const e of (usageEvents || [])) {
      if (!usageMap[e.user_id]) usageMap[e.user_id] = { generate: 0, edit: 0, cost: 0 };
      if (e.event_type === "generate") usageMap[e.user_id].generate++;
      if (e.event_type === "edit") usageMap[e.user_id].edit++;
      usageMap[e.user_id].cost += e.cost_usd_micros ?? 0;
    }
    const users = (authUsers?.users || []).map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      is_admin: profileMap[u.id]?.is_admin || false,
      is_affiliate: profileMap[u.id]?.is_affiliate || false,
      brand_name: brandMap[u.id]?.company_name || null,
      post_count: postCountMap[u.id] || 0,
      plan_name: (creditMap[u.id]?.lifetime_purchased_micros ?? 0) > 0 ? "Credits" : "Free",
      generate_count: usageMap[u.id]?.generate ?? 0,
      edit_count: usageMap[u.id]?.edit ?? 0,
      total_cost_usd_micros: usageMap[u.id]?.cost ?? 0,
      balance_micros: creditMap[u.id]?.balance_micros ?? 0,
      free_generations_remaining: Math.max(
        (creditMap[u.id]?.free_generations_limit ?? 0) - (creditMap[u.id]?.free_generations_used ?? 0),
        0,
      ),
      referred_by_affiliate_id: profileMap[u.id]?.referred_by_affiliate_id ?? null,
    }));
    res.json({ users });
  });

  // Admin: toggle admin status
  app.patch("/api/admin/users/:id/admin", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.params;
    const { is_admin } = req.body;
    if (id === admin.userId) return res.status(400).json({ message: "Cannot change your own admin status" });
    const sb = createAdminSupabase();
    const { error } = await sb.from("profiles").update({ is_admin: !!is_admin }).eq("id", id);
    if (error) return res.status(500).json({ message: error.message });
    res.json({ success: true });
  });

  // Admin: toggle affiliate status
  app.patch("/api/admin/users/:id/affiliate", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.params;
    const { is_affiliate } = req.body;
    const sb = createAdminSupabase();
    const { error } = await sb.from("profiles").update({ is_affiliate: !!is_affiliate }).eq("id", id);
    if (error) return res.status(500).json({ message: error.message });
    res.json({ success: true });
  });

  // Admin: run migration to add color_4 column
  app.post("/api/admin/migrate-colors", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const sb = createAdminSupabase();

    try {
      // Add color_4 column if it doesn't exist
      const { error: error1 } = await sb.rpc("exec", {
        sql: "ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;"
      });

      // Note: ALTER COLUMN cannot be run via RPC easily, so we'll try a workaround
      // Check if color_3 has NOT NULL constraint
      const { data: columns, error: checkError } = await sb
        .from("information_schema.columns")
        .select("is_nullable")
        .eq("table_schema", "public")
        .eq("table_name", "brands")
        .eq("column_name", "color_3")
        .single();

      if (checkError) {
        console.log("Check error (may be expected):", checkError.message);
      }

      res.json({
        success: true,
        message: "Migration attempted. If color_4 column was added successfully, the app is ready.",
        color_3_nullable: columns?.is_nullable,
        note: "If color_3 is still NOT NULL, run this SQL in Supabase Dashboard: ALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;"
      });
    } catch (err: any) {
      res.status(500).json({
        message: err.message,
        note: "Please run this SQL manually in Supabase Dashboard SQL Editor:\n\nALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;\nALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;"
      });
    }
  });

  // Public: get landing page content
  app.get("/api/landing/content", async (req, res) => {
    const sb = createAdminSupabase();
    const { data, error } = await sb.from("landing_content").select("*").single();
    if (error) {
      // Return default content if no record exists
      return res.json({
        id: null,
        hero_headline: "Create and Post Stunning Social Posts in Seconds",
        hero_subtext: "Generate brand-consistent social media images and captions with AI. Just type your message, pick a style, and let the AI do the rest.",
        hero_cta_text: "Start Creating for Free",
        hero_secondary_cta_text: "See How It Works",
        features_title: "Everything You Need to Automate Content",
        features_subtitle: "From brand setup to publish-ready graphics, every feature is designed to save you time and keep your content on-brand.",
        how_it_works_title: "How It Works",
        how_it_works_subtitle: "Three simple steps from idea to publish-ready social media content.",
        testimonials_title: "Loved by Marketers",
        testimonials_subtitle: "See what our users are saying about their experience.",
        cta_title: "Ready to Automate Your Content?",
        cta_subtitle: "Join thousands of marketers who create branded social media content in seconds, not hours.",
        cta_button_text: "Get Started Free",
        logo_url: null,
        icon_url: null,
        updated_at: new Date().toISOString(),
        updated_by: null,
      });
    }
    res.json(data);
  });

  // Admin: update landing page content
  app.patch("/api/admin/landing/content", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const sb = createAdminSupabase();

    // Check if content exists
    const { data: existing } = await sb.from("landing_content").select("id").single();

    if (existing) {
      // Update existing content
      const { data, error } = await sb.from("landing_content")
        .update({
          ...req.body,
          updated_at: new Date().toISOString(),
          updated_by: admin.userId,
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) return res.status(500).json({ message: error.message });
      res.json(data);
    } else {
      // Insert new content
      const { data, error } = await sb.from("landing_content")
        .insert({
          ...req.body,
          updated_at: new Date().toISOString(),
          updated_by: admin.userId,
        })
        .select()
        .single();
      if (error) return res.status(500).json({ message: error.message });
      res.json(data);
    }
  });

  // Admin: upload landing page logo
  app.post("/api/admin/landing/upload-logo", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    try {
      const { file, contentType } = req.body;
      if (!file || !contentType) {
        return res.status(400).json({ message: "Missing file or contentType" });
      }

      // Validate content type
      const validTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/jpg"];
      if (!validTypes.includes(contentType)) {
        return res.status(400).json({ message: "Invalid file type. Only SVG, PNG, and JPEG are supported." });
      }

      const sb = createAdminSupabase();
      const fileBuffer = Buffer.from(file, "base64");

      const publicUrl = await uploadFile(
        sb,
        "user_assets",
        "landing",
        fileBuffer,
        contentType
      );

      // Update landing_content with new logo
      const { data: existing } = await sb.from("landing_content").select("id").single();
      if (existing) {
        await sb.from("landing_content")
          .update({
            logo_url: publicUrl,
            updated_at: new Date().toISOString(),
            updated_by: admin.userId,
          })
          .eq("id", existing.id);
      }

      res.json({ logo_url: publicUrl });
    } catch (error: any) {
      console.error("Logo upload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Admin: upload landing page icon/favicon
  app.post("/api/admin/landing/upload-icon", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    try {
      const { file, contentType } = req.body;
      if (!file || !contentType) {
        return res.status(400).json({ message: "Missing file or contentType" });
      }

      // Validate content type
      const validTypes = ["image/svg+xml", "image/png", "image/x-icon", "image/vnd.microsoft.icon"];
      if (!validTypes.includes(contentType)) {
        return res.status(400).json({ message: "Invalid file type. Only SVG, PNG, and ICO are supported." });
      }

      const sb = createAdminSupabase();
      const fileBuffer = Buffer.from(file, "base64");

      const publicUrl = await uploadFile(
        sb,
        "user_assets",
        "landing",
        fileBuffer,
        contentType
      );

      // Update landing_content with new icon
      const { data: existing } = await sb.from("landing_content").select("id").single();
      if (existing) {
        await sb.from("landing_content")
          .update({
            icon_url: publicUrl,
            updated_at: new Date().toISOString(),
            updated_by: admin.userId,
          })
          .eq("id", existing.id);
      }

      const { data: existingSettings } = await sb.from("app_settings").select("id").single();
      if (existingSettings) {
        await sb.from("app_settings")
          .update({
            favicon_url: publicUrl,
            updated_at: new Date().toISOString(),
            updated_by: admin.userId,
          })
          .eq("id", existingSettings.id);
      }

      res.json({ icon_url: publicUrl });
    } catch (error: any) {
      console.error("Icon upload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/settings/upload-og-image", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    try {
      const { file, contentType } = req.body;
      if (!file || !contentType) {
        return res.status(400).json({ message: "Missing file or contentType" });
      }

      const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
      if (!validTypes.includes(contentType)) {
        return res.status(400).json({ message: "Invalid file type. Only PNG, JPEG, and WEBP are supported." });
      }

      const sb = createAdminSupabase();
      const fileBuffer = Buffer.from(file, "base64");

      const publicUrl = await uploadFile(
        sb,
        "user_assets",
        "app-settings",
        fileBuffer,
        contentType
      );

      const { data: existing } = await sb.from("app_settings").select("id").single();

      if (existing) {
        await sb.from("app_settings")
          .update({
            og_image_url: publicUrl,
            updated_at: new Date().toISOString(),
            updated_by: admin.userId,
          })
          .eq("id", existing.id);
      } else {
        await sb.from("app_settings")
          .insert({
            og_image_url: publicUrl,
            updated_at: new Date().toISOString(),
            updated_by: admin.userId,
          });
      }

      res.json({ og_image_url: publicUrl });
    } catch (error: any) {
      console.error("OG image upload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── App Settings (White-Label) ───────────────────────────────────────────────

  // Public: get app settings
  app.get("/api/settings", async (_req, res) => {
    const sb = createAdminSupabase();
    const { data: landingContent } = await sb.from("landing_content").select("icon_url").single();
    const { data, error } = await sb.from("app_settings").select("*").single();
    if (error) {
      // Return default settings if no record exists
      return res.json({
        id: null,
        app_name: "Xareable",
        app_tagline: "AI-Powered Social Media Content Creation",
        app_description: null,
        logo_url: null,
        favicon_url: landingContent?.icon_url || null,
        primary_color: "#8b5cf6",
        secondary_color: "#ec4899",
        meta_title: "Xareable - AI Social Media Content Creator",
        meta_description: "Create stunning social media images and captions with AI, tailored to your brand identity.",
        og_image_url: null,
        terms_url: null,
        privacy_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: null,
      });
    }
    res.json({
      ...data,
      favicon_url: landingContent?.icon_url || data.favicon_url,
    });
  });

  // Admin: update app settings
  app.patch("/api/admin/settings", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const parseResult = updateAppSettingsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ") });
    }

    const sb = createAdminSupabase();

    // Check if settings exist
    const { data: existing } = await sb.from("app_settings").select("id").single();

    if (existing) {
      // Update existing settings
      const { data, error } = await sb.from("app_settings")
        .update({
          ...parseResult.data,
          updated_at: new Date().toISOString(),
          updated_by: admin.userId,
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) return res.status(500).json({ message: error.message });
      res.json(data);
    } else {
      // Insert new settings
      const { data, error } = await sb.from("app_settings")
        .insert({
          ...parseResult.data,
          updated_at: new Date().toISOString(),
          updated_by: admin.userId,
        })
        .select()
        .single();
      if (error) return res.status(500).json({ message: error.message });
      res.json(data);
    }
  });

  // Transcribe audio using Gemini API
  app.post("/api/transcribe", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const supabase = createServerSupabase(token);
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return res.status(401).json({ message: "Invalid authentication" });
      }

      const { data: transcribeProfile } = await supabase
        .from("profiles")
        .select("is_affiliate, api_key")
        .eq("id", user.id)
        .single();

      const isAffiliate = transcribeProfile?.is_affiliate === true;

      const creditStatus = !isAffiliate
        ? await checkCredits(user.id, "transcribe")
        : null;

      if (creditStatus && !creditStatus.allowed) {
        return res.status(402).json({
          error: "insufficient_credits",
          message: "Insufficient credits. Add credits to continue.",
          balance_micros: creditStatus.balance_micros,
          estimated_cost_micros: creditStatus.estimated_cost_micros,
        });
      }

      let geminiApiKey: string;
      if (isAffiliate) {
        if (!transcribeProfile?.api_key) {
          return res.status(400).json({ message: "Como afiliado, configure sua Gemini API Key nas configurações." });
        }
        geminiApiKey = transcribeProfile.api_key;
      } else {
        const serverKey = process.env.GEMINI_API_KEY;
        if (!serverKey) {
          return res.status(500).json({ message: "Gemini API key not configured on the server." });
        }
        geminiApiKey = serverKey;
      }

      const { audioData, mimeType } = req.body;

      if (!audioData) {
        return res.status(400).json({ message: "Audio data is required" });
      }

      // Default to webm if mimeType not provided
      const audioMimeType = mimeType || "audio/webm";

      const prompt = `Transcribe the following audio recording. 

Requirements:
1. Provide an accurate transcription of all speech in the audio.
2. Do not include timestamps or speaker labels.
3. If the audio contains multiple sentences or thoughts, present them as a natural paragraph.
4. If the audio is unclear or has background noise, make your best effort to transcribe what is being said.
5. Only output the transcribed text, nothing else.

Output just the transcribed text:`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: audioMimeType,
                    data: audioData,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to transcribe audio";
        console.error("Gemini transcription API error:", errorMsg);
        return res.status(500).json({ message: `Transcription Error: ${errorMsg}` });
      }

      const data = await response.json();
      const transcription = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!transcription) {
        return res.status(500).json({ message: "No transcription returned by the AI" });
      }

      const transcribeUsage = data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      const usageEvent = await recordUsageEvent(user.id, null, "transcribe", {
        text_input_tokens:  transcribeUsage?.promptTokenCount,
        text_output_tokens: transcribeUsage?.candidatesTokenCount,
      });

      if (!isAffiliate) {
        await deductCredits(
          user.id,
          usageEvent.id,
          usageEvent.cost_usd_micros,
          creditStatus!.markup_multiplier,
        );
      }

      return res.json({ text: transcription.trim() });
    } catch (error: any) {
      console.error("Transcribe error:", error);
      return res.status(500).json({
        message: error.message || "An unexpected error occurred during transcription",
      });
    }
  });

  // ── Billing endpoints ────────────────────────────────────────────────────────

  app.get("/api/credits", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    try {
      const data = await getCreditsState(user.id, "generate");
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: error.message || "Failed to load credits" });
    }
  });

  app.get("/api/credits/transactions", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const sb = createAdminSupabase();
    const { data, error } = await sb
      .from("credit_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ message: error.message });
    return res.json({ transactions: data || [] });
  });

  app.get("/api/credits/check", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const operation = typeof req.query.operation === "string" ? req.query.operation : "generate";
    const normalizedOperation =
      operation === "edit" || operation === "transcribe" ? operation : "generate";

    try {
      const status = await checkCredits(user.id, normalizedOperation);
      return res.json(status);
    } catch (error: any) {
      return res.status(500).json({ message: error.message || "Failed to check credits" });
    }
  });

  app.post("/api/credits/purchase", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const parseResult = purchaseCreditsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid amountMicros" });
    }

    const minRechargeMicros = await getMinimumRechargeMicros();
    if (parseResult.data.amountMicros < minRechargeMicros) {
      return res.status(400).json({
        error: "below_minimum_purchase",
        message: `Minimum recharge is ${minRechargeMicros}`,
      });
    }

    try {
      const url = await createCreditCheckoutSession(
        user.id,
        user.email || "",
        parseResult.data.amountMicros,
      );
      return res.json({ url });
    } catch (error: any) {
      return res.status(500).json({ message: error.message || "Failed to create checkout session" });
    }
  });

  app.patch("/api/credits/auto-recharge", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const parseResult = updateAutoRechargeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid auto-recharge settings" });
    }

    const sb = createAdminSupabase();
    const { enabled, thresholdMicros, amountMicros } = parseResult.data;

    const { error } = await sb
      .from("user_credits")
      .update({
        auto_recharge_enabled: enabled,
        auto_recharge_threshold_micros: thresholdMicros,
        auto_recharge_amount_micros: amountMicros,
      })
      .eq("user_id", user.id);

    if (error) return res.status(500).json({ message: error.message });

    const data = await getCreditsState(user.id, "generate");
    return res.json(data);
  });

  app.get("/api/affiliate/dashboard", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const sb = createAdminSupabase();
    const { data: profile } = await sb
      .from("profiles")
      .select("is_affiliate")
      .eq("id", user.id)
      .single();

    if (profile?.is_affiliate) {
      try {
        await syncAffiliateStripeStatus(user.id);
      } catch {}
    }

    const { data: settings } = await sb
      .from("affiliate_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const { count: referredUsersCount } = await sb
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("referred_by_affiliate_id", user.id);

    const payload = affiliateDashboardResponseSchema.parse({
      is_affiliate: profile?.is_affiliate === true,
      stripe_connect_account_id: settings?.stripe_connect_account_id ?? null,
      stripe_connect_onboarded: settings?.stripe_connect_onboarded ?? false,
      total_commission_earned_micros: settings?.total_commission_earned_micros ?? 0,
      total_commission_paid_micros: settings?.total_commission_paid_micros ?? 0,
      pending_commission_micros: settings?.pending_commission_micros ?? 0,
      minimum_payout_micros: settings?.minimum_payout_micros ?? 50_000_000,
      auto_payout_enabled: settings?.auto_payout_enabled ?? true,
      referred_users_count: referredUsersCount ?? 0,
    });

    return res.json(payload);
  });

  app.post("/api/affiliate/connect", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_affiliate")
      .eq("id", user.id)
      .single();

    if (!profile?.is_affiliate) {
      return res.status(403).json({ message: "Affiliate access required" });
    }

    try {
      const url = await createStripeConnectAccount(user.id, user.email || "");
      return res.json({ url });
    } catch (error: any) {
      return res.status(500).json({ message: error.message || "Failed to create Stripe Connect onboarding link" });
    }
  });

  app.get("/api/affiliate/connect/login", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    try {
      const url = await createStripeConnectLoginLink(user.id);
      return res.json({ url });
    } catch (error: any) {
      return res.status(400).json({ message: error.message || "Affiliate Stripe dashboard unavailable" });
    }
  });

  app.get("/api/admin/markup-settings", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    return res.json(await getMarkupSettingsPayload());
  });

  app.patch("/api/admin/markup-settings", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const parseResult = updateMarkupSettingsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid pricing settings payload" });
    }

    const sb = createAdminSupabase();
    const payload = parseResult.data;

    const updates = [
      {
        setting_key: "markup_regular",
        setting_value: {
          multiplier: payload.regularMultiplier,
          description: "Regular user pay-per-use markup",
        },
      },
      {
        setting_key: "markup_affiliate",
        setting_value: {
          multiplier: payload.affiliateMultiplier,
          description: "Referred customer pay-per-use markup",
        },
      },
      {
        setting_key: "min_recharge_micros",
        setting_value: {
          amount: payload.minRechargeMicros,
          description: "Minimum manual top-up",
        },
      },
      {
        setting_key: "default_auto_recharge_threshold",
        setting_value: {
          amount: payload.defaultAutoRechargeThresholdMicros,
          description: "Default threshold",
        },
      },
      {
        setting_key: "default_auto_recharge_amount",
        setting_value: {
          amount: payload.defaultAutoRechargeAmountMicros,
          description: "Default top-up amount",
        },
      },
    ];

    const { error } = await sb
      .from("platform_settings")
      .upsert(
        updates.map((item) => ({
          ...item,
          updated_by: admin.userId,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "setting_key" },
      );

    if (error) {
      return res.status(500).json({ message: error.message });
    }

    return res.json(await getMarkupSettingsPayload());
  });

  // Stripe webhook — must use raw body for signature verification
  app.post("/api/stripe/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return res.status(500).json({ message: "Webhook secret not configured" });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody,
        sig,
        webhookSecret,
      );
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    try {
      await handleStripeWebhook(event);
    } catch (err: any) {
      console.error("Webhook handler error:", err);
      return res.status(500).json({ message: "Webhook processing failed" });
    }

    res.json({ received: true });
  });

  return httpServer;
}
