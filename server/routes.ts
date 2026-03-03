import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { createServerSupabase, createAdminSupabase } from "./supabase";
import { randomUUID } from "crypto";
import { generateRequestSchema, editPostRequestSchema, checkoutRequestSchema, updateAppSettingsSchema } from "../shared/schema";
import { checkQuota, recordUsageEvent } from "./quota";
import { stripe, getOrCreateStripeCustomer, createCheckoutSession, createBillingPortalSession, handleStripeWebhook } from "./stripe";

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

  return {
    ...DEFAULT_APP_SETTINGS,
    ...(data || {}),
  };
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
      "Disallow: /billing",
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

      // Quota check — affiliates are exempt (they use their own API key)
      if (!isAffiliate) {
        const quota = await checkQuota(user.id);
        if (!quota.allowed) {
          return res.status(402).json({
            error: "quota_exceeded",
            message: "Você atingiu o limite de gerações do seu plano. Faça upgrade para continuar.",
            used: quota.used,
            limit: quota.limit,
            plan: quota.plan,
          });
        }
      }

      const parseResult = generateRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ") });
      }
      const { reference_text, reference_images, post_profile, copy_text, aspect_ratio, use_logo, logo_position } = parseResult.data;

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
- Brand mood: ${brand.mood}
${brand.logo_url ? `- Brand logo URL: ${brand.logo_url}` : ""}

The user wants a "${post_profile}" style image for social media.
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
   - The ${brand.mood} mood
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
Make sure the text is large, readable, and well-positioned. Use colors ${brand.color_1}, ${brand.color_2}, ${brand.color_3}. Style: ${brand.mood}, ${post_profile}. The composition must fit the ${aspect_ratio} aspect ratio perfectly.${logoInstruction}`;

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

      // Record usage event — only after post is successfully saved
      await recordUsageEvent(user.id, post!.id, "generate", {
        text_input_tokens:   textUsage?.promptTokenCount,
        text_output_tokens:  textUsage?.candidatesTokenCount,
        image_input_tokens:  imageUsage?.promptTokenCount,
        image_output_tokens: imageUsage?.candidatesTokenCount,
      });

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

      // Quota check — affiliates are exempt (they use their own API key)
      if (!isAffiliate) {
        const quota = await checkQuota(user.id);
        if (!quota.allowed) {
          return res.status(402).json({
            error: "quota_exceeded",
            message: "Você atingiu o limite de gerações do seu plano. Faça upgrade para continuar.",
            used: quota.used,
            limit: quota.limit,
            plan: quota.plan,
          });
        }
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
- Mood: ${brand.mood}

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

      // Record usage event with token counts and estimated cost
      await recordUsageEvent(user.id, post_id, "edit", {
        image_input_tokens: editUsage?.promptTokenCount,
        image_output_tokens: editUsage?.candidatesTokenCount,
      });

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
    const [usersRes, postsRes, brandsRes, usageRes, subscriptionsRes, plansRes] = await Promise.all([
      sb.from("profiles").select("id, is_admin, created_at", { count: "exact" }),
      sb.from("posts").select("id, created_at", { count: "exact" }),
      sb.from("brands").select("id", { count: "exact" }),
      sb.from("usage_events").select("user_id, cost_usd_micros"),
      sb.from("user_subscriptions").select("user_id, status, plan_id"),
      sb.from("subscription_plans").select("id, monthly_limit"),
    ]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const newUsersToday = (usersRes.data || []).filter(u => new Date(u.created_at) >= today).length;
    const newPostsToday = (postsRes.data || []).filter(p => new Date(p.created_at) >= today).length;
    const totalCostUsdMicros = (usageRes.data || []).reduce((s, e) => s + (e.cost_usd_micros ?? 0), 0);
    const activeSubscribers = (subscriptionsRes.data || []).filter(s => s.status === "active").length;
    const trialingUsers = (subscriptionsRes.data || []).filter(s => s.status === "trialing").length;
    const totalUsageEvents = (usageRes.data || []).length;
    const planLimitMap = Object.fromEntries((plansRes.data || []).map(p => [p.id, p.monthly_limit ?? null]));
    const userEventCount: Record<string, number> = {};
    for (const e of (usageRes.data || [])) {
      userEventCount[e.user_id] = (userEventCount[e.user_id] || 0) + 1;
    }
    const quotaExhausted = (subscriptionsRes.data || []).filter(s => {
      if (s.status !== "trialing") return false;
      const limit = planLimitMap[s.plan_id ?? ""] ?? null;
      if (limit === null) return false;
      return (userEventCount[s.user_id] || 0) >= limit;
    }).length;
    res.json({
      totalUsers: usersRes.count || 0,
      totalPosts: postsRes.count || 0,
      totalBrands: brandsRes.count || 0,
      newUsersToday,
      newPostsToday,
      totalUsageEvents,
      totalCostUsdMicros,
      activeSubscribers,
      trialingUsers,
      quotaExhausted,
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
      { data: subscriptions },
      { data: plans },
      { data: usageEvents },
    ] = await Promise.all([
      sb.auth.admin.listUsers(),
      sb.from("profiles").select("id, is_admin, is_affiliate, created_at"),
      sb.from("brands").select("user_id, company_name"),
      sb.from("posts").select("user_id"),
      sb.from("user_subscriptions").select("user_id, status, plan_id"),
      sb.from("subscription_plans").select("id, display_name, monthly_limit"),
      sb.from("usage_events").select("user_id, event_type, cost_usd_micros"),
    ]);
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
    const brandMap = Object.fromEntries((brands || []).map(b => [b.user_id, b]));
    const planMap = Object.fromEntries((plans || []).map(p => [p.id, { name: p.display_name, limit: p.monthly_limit ?? null }]));
    const subMap = Object.fromEntries((subscriptions || []).map(s => [s.user_id, s]));
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
      plan_name: planMap[subMap[u.id]?.plan_id ?? ""]?.name ?? null,
      monthly_limit: planMap[subMap[u.id]?.plan_id ?? ""]?.limit ?? null,
      subscription_status: subMap[u.id]?.status ?? null,
      generate_count: usageMap[u.id]?.generate ?? 0,
      edit_count: usageMap[u.id]?.edit ?? 0,
      total_cost_usd_micros: usageMap[u.id]?.cost ?? 0,
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

  // ── App Settings (White-Label) ───────────────────────────────────────────────

  // Public: get app settings
  app.get("/api/settings", async (_req, res) => {
    const sb = createAdminSupabase();
    const { data, error } = await sb.from("app_settings").select("*").single();
    if (error) {
      // Return default settings if no record exists
      return res.json({
        id: null,
        app_name: "Xareable",
        app_tagline: "AI-Powered Social Media Content Creation",
        app_description: null,
        logo_url: null,
        favicon_url: null,
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
    res.json(data);
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

      // Quota check — affiliates are exempt (they use their own API key)
      if (!isAffiliate) {
        const quota = await checkQuota(user.id);
        if (!quota.allowed) {
          return res.status(402).json({
            error: "quota_exceeded",
            message: "Você atingiu o limite de gerações do seu plano. Faça upgrade para continuar.",
            used: quota.used,
            limit: quota.limit,
            plan: quota.plan,
          });
        }
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

      // Record usage event with token counts
      const transcribeUsage = data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      await recordUsageEvent(user.id, null, "transcribe", {
        text_input_tokens:  transcribeUsage?.promptTokenCount,
        text_output_tokens: transcribeUsage?.candidatesTokenCount,
      });

      return res.json({ text: transcription.trim() });
    } catch (error: any) {
      console.error("Transcribe error:", error);
      return res.status(500).json({
        message: error.message || "An unexpected error occurred during transcription",
      });
    }
  });

  // ── Billing endpoints ────────────────────────────────────────────────────────

  // List available plans
  app.get("/api/billing/plans", async (_req, res) => {
    const sb = createAdminSupabase();
    const { data, error } = await sb
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("price_cents", { ascending: true });
    if (error) return res.status(500).json({ message: error.message });
    res.json({ plans: data });
  });

  // Current user's subscription + usage
  app.get("/api/billing/subscription", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const sb = createAdminSupabase();
    const { data: sub } = await sb
      .from("user_subscriptions")
      .select("*, subscription_plans(*)")
      .eq("user_id", user.id)
      .single();

    const plan = (sub as any)?.subscription_plans ?? null;
    const quota = await checkQuota(user.id);

    res.json({
      plan,
      subscription: sub ? { ...sub, subscription_plans: undefined } : null,
      used: quota.used,
      limit: quota.limit,
    });
  });

  // Create Stripe Checkout session
  app.post("/api/billing/checkout", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const parseResult = checkoutRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "priceId is required" });
    }
    const { priceId } = parseResult.data;

    try {
      const customerId = await getOrCreateStripeCustomer(user.id, user.email!);
      const url = await createCheckoutSession(customerId, priceId, user.id);
      res.json({ url });
    } catch (err: any) {
      console.error("Checkout error:", err);
      res.status(500).json({ message: err.message || "Failed to create checkout session" });
    }
  });

  // Create Stripe Billing Portal session
  app.post("/api/billing/portal", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required" });

    const supabase = createServerSupabase(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ message: "Invalid authentication" });

    const sb = createAdminSupabase();
    const { data: sub } = await sb
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    if (!sub?.stripe_customer_id) {
      return res.status(400).json({ message: "No Stripe customer found. Subscribe to a plan first." });
    }

    try {
      const url = await createBillingPortalSession(sub.stripe_customer_id);
      res.json({ url });
    } catch (err: any) {
      console.error("Portal error:", err);
      res.status(500).json({ message: err.message || "Failed to create portal session" });
    }
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
