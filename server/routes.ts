import type { Express } from "express";
import { createServer, type Server } from "http";
import { createServerSupabase } from "./supabase";
import { randomUUID } from "crypto";
import { generateRequestSchema } from "../shared/schema";

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
      const { reference_text, post_profile, copy_text, aspect_ratio } = parseResult.data;

      const contextPrompt = `You are an expert Art Director and Social Media Strategist. 

Context about the brand:
- Brand name: ${brand.company_name}
- Industry/Niche: ${brand.company_type}
- Brand colors: Primary ${brand.color_1}, Secondary ${brand.color_2}, Accent ${brand.color_3}
- Brand mood: ${brand.mood}

The user wants a "${post_profile}" style image for social media.
The text they want on the image is: "${copy_text}"
${reference_text ? `Additional visual reference: "${reference_text}"` : ""}
Aspect ratio: ${aspect_ratio}

Your task:
1. Analyze the text and split it into a short punchy "headline" (max 6 words) and a "subtext" (the supporting message).
2. Write a highly descriptive prompt for an image generation model that incorporates the brand colors (${brand.color_1}, ${brand.color_2}, ${brand.color_3}) and ${brand.mood} mood. The prompt should describe a visually stunning social media graphic.
3. Write an engaging social media caption with relevant hashtags.

Output JSON exactly like this (no markdown, just raw JSON):
{
  "headline": "...",
  "subtext": "...",
  "image_prompt": "...",
  "caption": "..."
}`;

      const geminiTextUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${profile.api_key}`;

      const textResponse = await fetch(geminiTextUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: contextPrompt }] }],
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

      const imagePrompt = `Create a professional social media graphic. ${contextJson.image_prompt}. 
The image MUST include this text rendered clearly and prominently on it:
Main headline text: "${contextJson.headline}"
Subtext: "${contextJson.subtext}"
Make sure the text is large, readable, and well-positioned. Use colors ${brand.color_1}, ${brand.color_2}, ${brand.color_3}. Style: ${brand.mood}, ${post_profile}.`;

      const geminiImageUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${profile.api_key}`;

      const imageResponse = await fetch(geminiImageUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  return httpServer;
}
