# Frontend Pages - Pay-Per-Use System

## New Pages

### 1. client/src/pages/credits.tsx
**Replaces**: `billing.tsx`

**Sections**:
1. **Credit Balance Card**
   - Current balance in USD (large display)
   - Free generations remaining badge
   - "Add Credits" button (primary CTA)

2. **Auto-Recharge Settings**
   - Toggle switch to enable/disable
   - Threshold input ($5 default)
   - Amount input ($10 default)
   - Save button

3. **Purchase Credits Modal**
   - Preset buttons: $10, $25, $50, $100
   - Custom amount input (min $10 for first, then min $10 increments above $10)
   - Shows: "You'll receive $X.XX in credits"
   - Stripe Checkout redirect

4. **Recent Transactions Table**
   - Columns: Date, Type, Amount, Balance After
   - Pagination (20 per page)
   - Filter by type (purchase, usage, refund)

**Component Structure**:
```tsx
export default function CreditsPage() {
  const { data: credits } = useQuery('/api/credits');
  const { data: transactions } = useQuery('/api/credits/transactions');
  const purchaseMutation = useMutation(purchaseCredits);

  return (
    <div className="space-y-6">
      <BalanceCard credits={credits} />
      <AutoRechargeSettings credits={credits} />
      <TransactionsTable transactions={transactions} />
      <PurchaseCreditsModal />
    </div>
  );
}
```

---

### 2. client/src/pages/affiliate-dashboard.tsx
**Accessed by**: Users with `is_affiliate = true`

**Sections**:
1. **Stripe Connect Status**
   - If not connected: "Connect Stripe" button + onboarding explanation
   - If connected: "View Payouts" button (opens Stripe Express dashboard)

2. **Commission Stats Cards**
   - Total Earned (all-time)
   - Pending Payout
   - Total Paid Out
   - Referred Users Count

3. **Referral Link**
   - Copy-to-clipboard input: `https://xareable.com?ref={userId}`
   - QR code generator button

4. **Commission History Table**
   - Columns: Date, Customer, Usage Type, Base Cost, Commission, Status
   - Shows last 50 commissions

5. **Payout Settings**
   - Minimum payout threshold ($50 default)
   - Auto-payout toggle

**Component Structure**:
```tsx
export default function AffiliateDashboard() {
  const { data: affiliate } = useQuery('/api/affiliate/dashboard');
  const connectMutation = useMutation(createStripeConnect);
  const loginMutation = useMutation(getStripeLoginLink);

  if (!affiliate?.stripe_connect_onboarded) {
    return <StripeConnectOnboarding />;
  }

  return (
    <div className="space-y-6">
      <StatsCards stats={affiliate} />
      <ReferralLink userId={user.id} />
      <CommissionHistory />
      <PayoutSettings />
    </div>
  );
}
```

---

### 3. client/src/pages/admin-pricing.tsx
**Accessed by**: Admin users only

**Sections**:
1. **Markup Configuration**
   - Regular User Markup Slider (1.0x - 10.0x)
   - Affiliate Customer Markup Slider (1.0x - 10.0x)
   - Live preview: "If Gemini costs $0.01, regular user pays $0.03"

2. **Credit Purchase Limits**
   - Minimum first recharge ($10 default)
   - Minimum top-up ($10 default)
   - Maximum per transaction (optional)

3. **Auto-Recharge Defaults**
   - Default threshold ($5)
   - Default amount ($10)

4. **Free Generations**
   - Free generations per new user (1 default)

5. **Save Changes Button**

**Component Structure**:
```tsx
export default function AdminPricing() {
  const { data: settings } = useQuery('/api/admin/markup-settings');
  const updateMutation = useMutation(updateMarkupSettings);

  return (
    <form onSubmit={handleSave}>
      <MarkupSlider
        label="Regular User Markup"
        value={regularMarkup}
        onChange={setRegularMarkup}
      />
      <MarkupSlider
        label="Affiliate Customer Markup"
        value={affiliateMarkup}
        onChange={setAffiliateMarkup}
      />
      <PricingPreview
        basePrice={0.01}
        regularMarkup={regularMarkup}
        affiliateMarkup={affiliateMarkup}
      />
      <Button type="submit">Save Changes</Button>
    </form>
  );
}
```

---

## Modified Pages

### 4. client/src/pages/dashboard.tsx
**Add**: Estimated cost display before generation

**Before Generate Button**:
```tsx
<div className="flex items-center gap-2 text-sm text-muted-foreground">
  <Info className="w-4 h-4" />
  <span>Estimated cost: ${estimatedCost.toFixed(3)}</span>
</div>
```

**After insufficient credits error**:
```tsx
{error?.code === 'insufficient_credits' && (
  <Alert variant="destructive">
    <AlertTitle>Insufficient Credits</AlertTitle>
    <AlertDescription>
      You need ${error.estimated_cost} but have ${error.balance}.
      <Button variant="link" onClick={openAddCreditsModal}>
        Add Credits
      </Button>
    </AlertDescription>
  </Alert>
)}
```

---

## Modified Components

### 5. client/src/components/app-sidebar.tsx
**Replace**: Generation counter with credit balance

**Old**:
```tsx
<div className="sidebar-footer">
  <span>Gerações: {used}/{limit}</span>
  <Progress value={usagePercent} />
</div>
```

**New**:
```tsx
<div className="sidebar-footer p-4 space-y-2">
  <div className="flex items-center justify-between">
    <span className="text-sm text-muted-foreground">Saldo:</span>
    <span className="font-semibold text-lg">
      ${(balanceMicros / 1_000_000).toFixed(2)}
    </span>
  </div>
  {freeGenerationsRemaining > 0 && (
    <Badge variant="secondary" className="w-full justify-center">
      {freeGenerationsRemaining} geração grátis
    </Badge>
  )}
  <Button
    size="sm"
    className="w-full"
    onClick={() => navigate('/credits')}
  >
    <Plus className="w-4 h-4 mr-2" />
    Adicionar Créditos
  </Button>
</div>
```

---

### 6. client/src/components/post-creator-dialog.tsx
**Add**: Credit check before opening dialog

```tsx
const { data: creditStatus } = useQuery({
  queryKey: ['/api/credits/check', 'generate'],
});

useEffect(() => {
  if (isOpen && !creditStatus?.allowed && creditStatus?.free_generations_remaining === 0) {
    toast({
      title: 'Créditos insuficientes',
      description: `Você precisa de $${creditStatus.estimated_cost} mas tem $${creditStatus.balance}.`,
      action: <Button onClick={openAddCreditsModal}>Adicionar</Button>
    });
    setIsOpen(false);
  }
}, [isOpen, creditStatus]);
```

---

## New Modals

### 7. client/src/components/add-credits-modal.tsx
**Trigger**: "Add Credits" button in sidebar, credits page, error toasts

**Features**:
- Preset buttons: $10, $25, $50, $100, $250
- Custom amount input (validated min/max)
- Stripe Checkout redirect
- Shows current balance
- Auto-closes on navigation to Stripe

```tsx
export function AddCreditsModal({ open, onClose }) {
  const [customAmount, setCustomAmount] = useState(10);
  const { data: credits } = useQuery('/api/credits');
  const purchaseMutation = useMutation(purchaseCredits);

  const presets = [10, 25, 50, 100, 250];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar Créditos</DialogTitle>
          <DialogDescription>
            Saldo atual: ${(credits?.balance_micros / 1_000_000 || 0).toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {presets.map(amount => (
            <Button
              key={amount}
              variant="outline"
              onClick={() => purchaseMutation.mutate(amount * 1_000_000)}
            >
              ${amount}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Valor personalizado</Label>
          <Input
            type="number"
            min={10}
            value={customAmount}
            onChange={e => setCustomAmount(Number(e.target.value))}
          />
        </div>

        <Button
          onClick={() => purchaseMutation.mutate(customAmount * 1_000_000)}
          disabled={purchaseMutation.isPending}
        >
          {purchaseMutation.isPending && <Loader2 className="animate-spin" />}
          Continuar para pagamento
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Routing Updates

### client/src/App.tsx
```tsx
// Replace /billing with /credits
<Route path="/credits" component={CreditsPage} />

// Add affiliate route
<Route path="/affiliate" component={AffiliateDashboard} />

// Add admin pricing
<Route path="/admin/pricing" component={AdminPricing} />
```

---

## Utility Functions

### client/src/lib/credits.ts
```typescript
export function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export function parseDollarsToMicros(dollars: number): number {
  return Math.round(dollars * 1_000_000);
}

export function validateRechargeAmount(
  amountMicros: number,
  minMicros: number
): { valid: boolean; error?: string } {
  if (amountMicros < minMicros) {
    return {
      valid: false,
      error: `Minimum ${formatMicros(minMicros)} required`
    };
  }
  return { valid: true };
}
```
