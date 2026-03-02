import type { Express } from "express";
import { createServer, type Server } from "http";
import { createServerSupabase, createAdminSupabase } from "./supabase";
import { randomUUID } from "crypto";
import { generateRequestSchema, editPostRequestSchema } from "../shared/schema";

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
        .select("api_key")
        .eq("id", user.id)
        .single();

      if (!profile?.api_key) {
        return res.status(400).json({ message: "No API key configured. Please add your Gemini API key in Settings." });
      }

      const { data: brand } = await supabase
        .from("brands")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (!brand) {
        return res.status(400).json({ message: "No brand profile found. Please complete onboarding." });
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

      const geminiTextUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${profile.api_key}`;

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

      const geminiImageUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

      const imageResponse = await fetch(geminiImageUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": profile.api_key,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: imagePrompt }] }],
        }),
      });

      if (!imageResponse.ok) {
        const errorData = await imageResponse.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to generate image";
        console.error("Gemini image API error:", errorMsg);
        return res.status(500).json({ message: `Image Generation Error: ${errorMsg}` });
      }

      const imageData = await imageResponse.json();
      const candidates = imageData.candidates?.[0]?.content?.parts;

      if (!candidates) {
        return res.status(500).json({ message: "No image generated. The model may not support image output with your current API key." });
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
      }

      return res.json({
        image_url: publicUrl,
        caption: contextJson.caption,
        headline: contextJson.headline,
        subtext: contextJson.subtext,
        post_id: post?.id || "",
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

      // Get user API key and brand
      const [profileRes, brandRes] = await Promise.all([
        supabase.from("profiles").select("api_key").eq("id", user.id).single(),
        supabase.from("brands").select("*").eq("user_id", user.id).single(),
      ]);

      if (!profileRes.data?.api_key) {
        return res.status(400).json({ message: "No API key configured" });
      }
      if (!brandRes.data) {
        return res.status(400).json({ message: "No brand profile found" });
      }

      const brand = brandRes.data;

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

      // Fetch the current image
      const imageResponse = await fetch(currentImageUrl);
      if (!imageResponse.ok) {
        return res.status(500).json({ message: "Failed to fetch current image" });
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      const imageBase64 = Buffer.from(imageBuffer).toString("base64");

      // Call Gemini for image editing with multi-turn conversation
      const editPrompt = `You are editing an existing social media image.

Brand context:
- Brand name: ${brand.company_name}
- Industry: ${brand.company_type}
- Brand colors: ${brand.color_1}, ${brand.color_2}, ${brand.color_3}
- Mood: ${brand.mood}

User's edit request: ${edit_prompt}

Please modify the image according to the request while maintaining the brand's visual identity and colors.`;

      const geminiImageUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

      const editResponse = await fetch(geminiImageUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": profileRes.data.api_key,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: editPrompt },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!editResponse.ok) {
        const errorData = await editResponse.json().catch(() => null);
        const errorMsg = errorData?.error?.message || "Failed to edit image";
        console.error("Gemini edit API error:", errorMsg);
        return res.status(500).json({ message: `Image Edit Error: ${errorMsg}` });
      }

      const editData = await editResponse.json();
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
    const [usersRes, postsRes, brandsRes] = await Promise.all([
      sb.from("profiles").select("id, is_admin, created_at", { count: "exact" }),
      sb.from("posts").select("id, created_at", { count: "exact" }),
      sb.from("brands").select("id", { count: "exact" }),
    ]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const newUsersToday = (usersRes.data || []).filter(u => new Date(u.created_at) >= today).length;
    const newPostsToday = (postsRes.data || []).filter(p => new Date(p.created_at) >= today).length;
    res.json({
      totalUsers: usersRes.count || 0,
      totalPosts: postsRes.count || 0,
      totalBrands: brandsRes.count || 0,
      newUsersToday,
      newPostsToday,
    });
  });

  // Admin: get all users
  app.get("/api/admin/users", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const sb = createAdminSupabase();
    const { data: authUsers } = await sb.auth.admin.listUsers();
    const { data: profiles } = await sb.from("profiles").select("id, is_admin, api_key, created_at");
    const { data: brands } = await sb.from("brands").select("user_id, company_name");
    const { data: posts } = await sb.from("posts").select("user_id");
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
    const brandMap = Object.fromEntries((brands || []).map(b => [b.user_id, b]));
    const postCountMap: Record<string, number> = {};
    for (const p of (posts || [])) postCountMap[p.user_id] = (postCountMap[p.user_id] || 0) + 1;
    const users = (authUsers?.users || []).map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      is_admin: profileMap[u.id]?.is_admin || false,
      has_api_key: !!profileMap[u.id]?.api_key,
      brand_name: brandMap[u.id]?.company_name || null,
      post_count: postCountMap[u.id] || 0,
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

      const { data: profile } = await supabase
        .from("profiles")
        .select("api_key")
        .eq("id", user.id)
        .single();

      if (!profile?.api_key) {
        return res.status(400).json({ message: "No API key configured. Please add your Gemini API key in Settings." });
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

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${profile.api_key}`;

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

      return res.json({ text: transcription.trim() });
    } catch (error: any) {
      console.error("Transcribe error:", error);
      return res.status(500).json({
        message: error.message || "An unexpected error occurred during transcription",
      });
    }
  });

  return httpServer;
}
