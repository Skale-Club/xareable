# Error Logging for Image Generation

## Proposed Changes

### `supabase/migrations/`
#### [NEW] `20260304000005_create_generation_logs_table.sql`
- Create a new table `generation_logs` to capture failed post generations.
- Columns: `id` (uuid), `user_id` (uuid), `status` (text/varchar), `error_message` (text), `created_at` (timestamp). Include RLS policies if necessary, or let it be accessible by server role only.

### `shared/schema.ts`
#### [MODIFY] `schema.ts`
- Add `generationLogSchema` Zod validation for consistency.

### `server/routes.ts`
#### [MODIFY] `routes.ts`
- Update `/api/generate` endpoint. Inside the `catch(error: any)` block, invoke Supabase to insert a new row in the `generation_logs` table before sending the 500 status response to the user. Do the same for specific Gemini API errors (e.g. `!textResponse.ok` or `!imageResponse.ok`).

## Verification Plan

### Manual Verification
1. Execute the new migration using Supabase CLI or psql.
2. Trigger an explicit generation error (e.g., using an invalid image aspect ratio test or invalid prompt).
3. Check the `generation_logs` table in the database to confirm the failure was logged successfully.
