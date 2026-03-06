# Analytics SQL Queries

Run these in the Supabase SQL Editor to analyze API costs.

---

## Total Cost Per User

```sql
SELECT
  user_id,
  COUNT(*) AS total_events,
  SUM(CASE WHEN event_type = 'generate' THEN 1 ELSE 0 END) AS generates,
  SUM(CASE WHEN event_type = 'edit'     THEN 1 ELSE 0 END) AS edits,
  SUM(cost_usd_micros) / 1000000.0 AS total_cost_usd
FROM usage_events
WHERE cost_usd_micros IS NOT NULL
GROUP BY user_id
ORDER BY total_cost_usd DESC;
```

---

## Average Cost Per Event Type

```sql
SELECT
  event_type,
  COUNT(*) AS events,
  ROUND(AVG(cost_usd_micros) / 1000000.0, 6) AS avg_cost_usd,
  ROUND(AVG(text_input_tokens))  AS avg_text_input_tokens,
  ROUND(AVG(text_output_tokens)) AS avg_text_output_tokens,
  ROUND(AVG(image_input_tokens)) AS avg_image_input_tokens
FROM usage_events
WHERE cost_usd_micros IS NOT NULL
GROUP BY event_type;
```

---

## Daily Cost (Last 30 Days)

```sql
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS events,
  SUM(cost_usd_micros) / 1000000.0 AS daily_cost_usd
FROM usage_events
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day DESC;
```

---

## Platform Total Cost (All Time)

```sql
SELECT
  COUNT(*) AS total_events,
  SUM(cost_usd_micros) / 1000000.0 AS total_cost_usd,
  MIN(created_at) AS first_event,
  MAX(created_at) AS last_event
FROM usage_events
WHERE cost_usd_micros IS NOT NULL;
```

---

## Most Expensive Single Events

```sql
SELECT
  id,
  user_id,
  event_type,
  text_input_tokens,
  image_input_tokens,
  cost_usd_micros / 1000000.0 AS cost_usd,
  created_at
FROM usage_events
ORDER BY cost_usd_micros DESC NULLS LAST
LIMIT 20;
```
