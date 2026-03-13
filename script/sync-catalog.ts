import 'dotenv/config';
import { createAdminSupabase } from '../server/supabase.js';
import { DEFAULT_STYLE_CATALOG } from '../shared/schema.js';

async function sync() {
  console.log('Syncing default catalog to platform_settings...');
  const sb = createAdminSupabase();
  const { data, error } = await sb
    .from('platform_settings')
    .update({ setting_value: DEFAULT_STYLE_CATALOG })
    .eq('setting_key', 'style_catalog');

  if (error) {
    console.error('Failed to sync catalog:', error);
  } else {
    console.log('Successfully synced style catalog to DB!');
  }
}

sync();
