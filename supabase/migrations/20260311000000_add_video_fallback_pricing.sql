-- Add video fallback pricing 
insert into public.platform_settings (setting_key, setting_value)
values
  (
    'video_fallback_pricing',
    '{"cost_micros":1200000,"sell_micros":3600000,"description":"Fallback pricing for video events without token metadata"}'::jsonb
  )
on conflict (setting_key) do nothing;
