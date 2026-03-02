# Post Versioning & Image Editing Feature

## 🎨 Overview

This feature allows users to edit generated images using AI and maintain a complete version history (v1, v2, v3...) for each post.

## ✨ Features

- **AI-Powered Image Editing**: Use Gemini 3.1 Flash Image to edit existing images with text prompts
- **Version Stack**: All versions are preserved and accessible
- **Version Navigation**: Navigate between original and edited versions using arrows
- **Version Labels**: Clear labels (Original, v1, v2, v3...)
- **Non-Destructive**: Original image is always preserved

## 🗄️ Database Schema

### New Table: `post_versions`

```sql
create table public.post_versions (
  id uuid primary key,
  post_id uuid references posts,
  version_number integer not null,
  image_url text not null,
  edit_prompt text,
  created_at timestamp,
  unique(post_id, version_number)
);
```

## 🔧 Setup Instructions

### 1. Database Migration

Run the migration SQL in your Supabase SQL Editor:

```bash
# File: migration-add-versions.sql
```

Or if starting fresh, use the updated `supabase-setup.sql`

### 2. Backend

The backend automatically includes:
- `POST /api/edit-post` endpoint
- Image fetching and conversion to base64
- Gemini API integration for image editing
- Version number tracking
- Storage upload for new versions

### 3. Frontend

The UI includes:
- Edit button in Post Viewer Dialog
- Edit prompt input
- Version navigation (prev/next arrows)
- Version counter (e.g., "2 / 4")
- Version label badge (Original, v1, v2...)
- Loading states during generation

## 📱 User Flow

1. **View Post**: Click on any post to open the viewer dialog
2. **Edit Image**: Click "Edit Image" button
3. **Describe Changes**: Type what you want to change (e.g., "change background to blue")
4. **Generate**: Click "Generate Edit"
5. **Review**: New version appears automatically
6. **Navigate**: Use arrows to switch between versions
7. **Download**: Download any version by navigating to it and clicking Download

## 🎯 Example Edit Prompts

- "Change the background color to dark blue"
- "Make the text larger and bolder"
- "Add a subtle gradient overlay"
- "Remove the logo and add decorative elements"
- "Change the mood to more professional"
- "Add a call-to-action button at the bottom"

## 🔌 API Reference

### POST `/api/edit-post`

**Request Body:**
```json
{
  "post_id": "uuid",
  "edit_prompt": "string"
}
```

**Response:**
```json
{
  "version_id": "uuid",
  "version_number": 1,
  "image_url": "https://..."
}
```

**Errors:**
- `401`: Authentication required
- `404`: Post not found
- `400`: No API key or invalid request
- `500`: Generation or upload error

## 🧪 Technical Details

### Version Storage

- Version 0 = Original image (stored in `posts.image_url`)
- Version 1+ = Edited versions (stored in `post_versions` table)
- Each version has its own image file in Supabase Storage

### Image Editing Process

1. Fetch latest version image from URL
2. Convert to base64
3. Send to Gemini with edit prompt + image
4. Receive edited image in base64
5. Upload to Storage
6. Save version record in database

### Brand Context

Edit prompts automatically include brand context:
- Brand name
- Industry/niche
- Brand colors
- Brand mood

This ensures edits maintain brand consistency.

## 🚀 Future Enhancements

- [ ] Duplicate version as new post
- [ ] Compare versions side-by-side
- [ ] Batch edit multiple posts
- [ ] Edit presets (common modifications)
- [ ] Version naming/tagging
- [ ] Rollback to specific version
- [ ] Delete individual versions
- [ ] Export version history

## 📝 Notes

- Each edit consumes Gemini API credits
- Images are stored permanently in Supabase Storage
- Versions are deleted when parent post is deleted (cascade)
- Maximum 20 versions recommended per post
