# Billing - Frontend

## `/billing` Page (`client/src/pages/billing.tsx`)

### Sections

1. **Header** - title "Plans and Usage"
2. **Current plan card** - plan name, status badge, renewal date, usage progress bar, "Manage subscription" button (if subscribed)
3. **Plan cards** - 2-column grid with Free Trial and Pro. "Subscribe" button on non-active plans with `stripe_price_id`

### TanStack Query queries

```tsx
// Subscription + usage
useQuery({ queryKey: ["/api/billing/subscription"] })

// Plan list
useQuery({ queryKey: ["/api/billing/plans"] })
```

### Mutations

```tsx
// Create checkout
useMutation -> POST /api/billing/checkout
  onSuccess: window.location.href = url

// Create portal
useMutation -> POST /api/billing/portal
  onSuccess: window.location.href = url
```

### Success/cancel redirect

After payment, Stripe redirects to `/billing?success=1` or `/billing?canceled=1`. The page can detect these params and show a toast (future improvement).

---

## Sidebar (`app-sidebar.tsx`)

### Added menu item

```tsx
{ title: "Plans", url: "/billing", icon: CreditCard }
```

### Mini usage bar in footer

Shown only when `billing.limit !== null` (free trial or limited plan). Displays color-coded progress bar (violet normally, red when exhausted).

---

## Handle 402 in frontend (future improvement)

In `post-creator-dialog.tsx`, when receiving a 402 API error:

```tsx
if (error.message.startsWith("402:")) {
  toast({
    title: "Limit reached",
    description: "You used all your generations. Upgrade to continue.",
    action: <Button onClick={() => navigate("/billing")}>View plans</Button>
  });
}
```
