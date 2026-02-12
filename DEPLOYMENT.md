# XSEN Orchestrator - Deployment Guide

## Railway Deployment Steps

### Step 1: Prepare Stripe

1. **Create Products & Prices**
   - Go to https://dashboard.stripe.com/products
   - Click "Add product"
   - Create "Boomer Bot Basic" - $9.99/month recurring
   - Create "Boomer Bot Premium" - $19.99/month recurring
   - Copy both Price IDs (format: `price_xxxxx`)

2. **Get API Keys**
   - Go to https://dashboard.stripe.com/apikeys
   - Copy "Secret key" (starts with `sk_test_` or `sk_live_`)
   - Keep "Publishable key" for PaymeGPT widget

### Step 2: Deploy to Railway

#### Option A: Deploy from GitHub

1. **Push code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/xsen-orchestrator.git
   git push -u origin main
   ```

2. **Deploy via Railway Dashboard**
   - Go to https://railway.app
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will auto-detect Node.js and deploy

#### Option B: Deploy via Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

### Step 3: Add Railway Postgres

```bash
# Via CLI
railway add

# Select "PostgreSQL" from the list
```

Or via Dashboard:
- Open your project
- Click "New" → "Database" → "Add PostgreSQL"

### Step 4: Set Environment Variables

```bash
# Required variables
railway variables set STRIPE_SECRET_KEY=sk_test_xxxxx
railway variables set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
railway variables set STRIPE_PRICE_BASIC=price_xxxxx
railway variables set STRIPE_PRICE_PREMIUM=price_xxxxx
railway variables set NODE_ENV=production
railway variables set FRONTEND_URL=https://boomerbot.fun
railway variables set ALLOWED_ORIGINS=https://boomerbot.fun,https://thebotosphere.com
```

Or via Dashboard:
- Go to your service → "Variables" tab
- Add each variable

**Note**: Railway automatically provides `DATABASE_URL` - don't set it manually

### Step 5: Run Database Migration

```bash
# Connect to Railway and run migration
railway run npm run migrate
```

You should see:
```
✅ Connected successfully
📄 Running migration...
✅ Migration completed successfully
📊 Created tables:
   - auth_tokens
   - subscriptions
```

### Step 6: Configure Stripe Webhook

1. **Get your Railway URL**
   ```bash
   railway domain
   # Returns: your-service-xxxxx.up.railway.app
   ```

2. **Add webhook in Stripe**
   - Go to https://dashboard.stripe.com/webhooks
   - Click "Add endpoint"
   - Endpoint URL: `https://your-service-xxxxx.up.railway.app/webhooks/stripe`
   - Description: "XSEN Orchestrator"
   - Events to send:
     - ✅ checkout.session.completed
     - ✅ customer.subscription.created
     - ✅ customer.subscription.updated
     - ✅ customer.subscription.deleted
     - ✅ invoice.payment_succeeded
     - ✅ invoice.payment_failed
   - Click "Add endpoint"

3. **Copy webhook secret**
   - Click on your new webhook
   - Click "Reveal" under "Signing secret"
   - Copy the secret (starts with `whsec_`)
   - Update Railway:
   ```bash
   railway variables set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
   ```

### Step 7: Test the Deployment

```bash
# Test health endpoint
curl https://your-service.up.railway.app/health

# Should return:
# {"status":"ok","timestamp":"...","database":"connected","service":"XSEN Orchestrator"}
```

Or run the test suite:
```bash
TEST_BASE_URL=https://your-service.up.railway.app node test.js
```

### Step 8: Monitor Deployment

```bash
# View logs
railway logs

# Follow logs in real-time
railway logs --follow
```

Look for:
```
✅ Connected to Railway Postgres
🚀 XSEN Orchestrator running on port XXXX
📍 Environment: production
🔐 Stripe webhooks: POST /webhooks/stripe
💚 Health check: GET /health
```

## PaymeGPT Widget Configuration

Now configure your PaymeGPT widget:

1. **Widget Settings**
   - Enable Paywall: ✅
   - Stripe Publishable Key: `pk_test_xxxxx` (from Stripe dashboard)

2. **Product Configuration**
   - Basic Tier:
     - Name: "Boomer Bot Basic"
     - Price ID: `price_xxxxx` (your basic price ID)
     - Price: $9.99/month
   - Premium Tier:
     - Name: "Boomer Bot Premium"  
     - Price ID: `price_xxxxx` (your premium price ID)
     - Price: $19.99/month

3. **Metadata** (optional)
   ```javascript
   {
     "tier": "premium",
     "product": "boomer_bot",
     "source": "boomerbot.fun"
   }
   ```

## Testing the Full Flow

### 1. Test Subscription Creation

1. Go to your PaymeGPT widget on boomerbot.fun
2. Select a tier (use Stripe test card: `4242 4242 4242 4242`)
3. Complete checkout
4. Check Railway logs for:
   ```
   📥 Received event: checkout.session.completed
   ✅ New checkout completed: test@example.com
   🔑 Generated auth token for test@example.com [Tier: premium]
   ```

### 2. Verify Database

```bash
railway run psql $DATABASE_URL
```

```sql
-- Check subscription was created
SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 1;

-- Check token was generated
SELECT t.token, s.email, s.tier 
FROM auth_tokens t 
JOIN subscriptions s ON t.stripe_customer_id = s.stripe_customer_id 
ORDER BY t.created_at DESC LIMIT 1;
```

### 3. Test API Authentication

Copy the token from the database, then:

```bash
# Test authenticated request
curl -H "Authorization: Bearer YOUR_TOKEN_HERE" \
     https://your-service.up.railway.app/api/subscription
```

Should return:
```json
{
  "customer": "cus_xxxxx",
  "email": "test@example.com",
  "tier": "premium",
  "status": "active",
  "expiresAt": "2026-03-01T...",
  "cancelAtPeriodEnd": false
}
```

## Troubleshooting

### Webhook Not Receiving Events

**Check 1**: Verify webhook URL in Stripe
```bash
railway domain
# Make sure this matches your Stripe webhook URL
```

**Check 2**: Test webhook manually
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Test webhook
stripe trigger checkout.session.completed \
  --forward-to https://your-service.up.railway.app/webhooks/stripe
```

**Check 3**: Review logs
```bash
railway logs --follow
# Look for "📥 Received event" messages
```

### Database Connection Failing

**Check 1**: Verify Postgres is attached
```bash
railway variables
# Should show DATABASE_URL
```

**Check 2**: Test connection
```bash
railway run npm run migrate
```

**Check 3**: Check Postgres plugin status
- Go to Railway dashboard
- Check Postgres service is running

### 401 Unauthorized Errors

**Check 1**: Verify token exists
```bash
railway run psql $DATABASE_URL -c "SELECT * FROM auth_tokens;"
```

**Check 2**: Check token expiration
```sql
SELECT token, expires_at, 
       CASE WHEN expires_at < NOW() THEN 'EXPIRED' ELSE 'VALID' END as status
FROM auth_tokens;
```

**Check 3**: Verify subscription is active
```sql
SELECT email, status FROM subscriptions WHERE status != 'active';
```

## Production Checklist

Before going live:

- [ ] Switch Stripe to live mode (use `sk_live_` key)
- [ ] Update PaymeGPT with live publishable key (`pk_live_`)
- [ ] Update webhook to use live mode endpoint
- [ ] Set production environment variables
- [ ] Configure custom domain in Railway
- [ ] Update `FRONTEND_URL` and `ALLOWED_ORIGINS`
- [ ] Set up monitoring/alerting
- [ ] Test complete subscription flow
- [ ] Test subscription cancellation
- [ ] Test payment failure handling
- [ ] Document customer support procedures

## Maintenance

### Clean Up Expired Tokens

```bash
railway run psql $DATABASE_URL -c "SELECT cleanup_expired_tokens();"
```

### Monitor Active Subscriptions

```sql
SELECT 
  status, 
  COUNT(*) as count,
  SUM(CASE WHEN tier = 'basic' THEN 1 ELSE 0 END) as basic_count,
  SUM(CASE WHEN tier = 'premium' THEN 1 ELSE 0 END) as premium_count
FROM subscriptions 
GROUP BY status;
```

### Revenue Metrics

```sql
SELECT 
  tier,
  COUNT(*) as subscribers,
  CASE 
    WHEN tier = 'basic' THEN COUNT(*) * 9.99
    WHEN tier = 'premium' THEN COUNT(*) * 19.99
  END as mrr
FROM subscriptions 
WHERE status = 'active'
GROUP BY tier;
```

## Support

- Railway Dashboard: https://railway.app
- Stripe Dashboard: https://dashboard.stripe.com
- Railway Docs: https://docs.railway.app
- Stripe Docs: https://stripe.com/docs

---

**Need Help?** Check Railway logs first, then Stripe webhook logs.
