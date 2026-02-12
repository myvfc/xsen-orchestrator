# XSEN Orchestrator - Quick Reference

## 🚀 Common Commands

### Setup & Installation
```bash
npm install                    # Install dependencies
npm run setup                  # Interactive configuration
npm run migrate                # Run database migration
npm run dev                    # Start development server
npm start                      # Start production server
npm test                       # Run API tests
```

### Railway Commands
```bash
railway login                  # Login to Railway
railway init                   # Initialize project
railway up                     # Deploy to Railway
railway logs                   # View logs
railway logs --follow          # Stream logs
railway variables              # List environment variables
railway run npm run migrate    # Run migration on Railway
railway domain                 # Get deployment URL
```

### Database Commands
```bash
# Connect to Railway Postgres
railway run psql $DATABASE_URL

# Common SQL queries
SELECT * FROM subscriptions;
SELECT * FROM auth_tokens;
SELECT cleanup_expired_tokens();
```

---

## 📡 API Endpoints

### Public
- `GET /health` - Health check

### Webhooks
- `POST /webhooks/stripe` - Stripe webhook handler

### Protected (Require Bearer Token)
- `GET /api/subscription` - Get subscription info
- `GET /api/chat` - Basic tier access
- `GET /api/chat/premium` - Premium tier only
- `POST /api/create-portal-session` - Customer portal

---

## 🔑 Environment Variables

### Required
```bash
DATABASE_URL                   # Auto-provided by Railway
STRIPE_SECRET_KEY             # sk_test_... or sk_live_...
STRIPE_WEBHOOK_SECRET         # whsec_...
STRIPE_PRICE_BASIC           # price_...
STRIPE_PRICE_PREMIUM         # price_...
NODE_ENV                     # development or production
```

### Optional
```bash
PORT                         # Default: 3000
FRONTEND_URL                 # Default: https://boomerbot.fun
ALLOWED_ORIGINS             # CORS origins
```

---

## 🧪 Testing

### Test API Locally
```bash
# Health check
curl http://localhost:3000/health

# Protected endpoint (should fail)
curl http://localhost:3000/api/subscription

# With auth token
curl -H "Authorization: Bearer TOKEN_HERE" \
     http://localhost:3000/api/subscription
```

### Test Stripe Webhooks
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Listen to webhooks
stripe listen --forward-to localhost:3000/webhooks/stripe

# Trigger test event
stripe trigger checkout.session.completed
```

### Run Test Suite
```bash
# Local
node test.js

# Production
TEST_BASE_URL=https://your-app.up.railway.app node test.js
```

---

## 📊 Database Schema

### subscriptions table
```sql
id                      SERIAL PRIMARY KEY
stripe_customer_id      VARCHAR(255) UNIQUE NOT NULL
stripe_subscription_id  VARCHAR(255) UNIQUE NOT NULL
email                   VARCHAR(255) NOT NULL
tier                    VARCHAR(50) NOT NULL  -- 'basic', 'premium'
status                  VARCHAR(50) NOT NULL  -- 'active', 'canceled', 'past_due'
current_period_end      TIMESTAMP
cancel_at_period_end    BOOLEAN DEFAULT false
created_at              TIMESTAMP DEFAULT NOW()
updated_at              TIMESTAMP DEFAULT NOW()
```

### auth_tokens table
```sql
id                      SERIAL PRIMARY KEY
token                   VARCHAR(255) UNIQUE NOT NULL
stripe_customer_id      VARCHAR(255) NOT NULL
expires_at              TIMESTAMP NOT NULL
created_at              TIMESTAMP DEFAULT NOW()
```

---

## 🔄 Stripe Event Flow

```
User Subscribes → Stripe Checkout → checkout.session.completed
                                            ↓
                                    Create subscription record
                                            ↓
                                    Generate auth token
                                            ↓
                                    Store in database
```

### Handled Events
- `checkout.session.completed` - New subscription
- `customer.subscription.created` - Subscription activated
- `customer.subscription.updated` - Changes/renewals
- `customer.subscription.deleted` - Cancellations
- `invoice.payment_succeeded` - Successful payment
- `invoice.payment_failed` - Failed payment

---

## 🛡️ Authentication Flow

```
1. User subscribes via PaymeGPT + Stripe
2. Webhook creates subscription + generates token
3. Client includes token in requests:
   Authorization: Bearer <token>
4. Server validates:
   - Token exists
   - Token not expired
   - Subscription is active
   - Correct tier for endpoint
```

---

## 📝 Useful SQL Queries

### View All Subscriptions
```sql
SELECT email, tier, status, created_at 
FROM subscriptions 
ORDER BY created_at DESC;
```

### Active Subscribers by Tier
```sql
SELECT tier, COUNT(*) as count
FROM subscriptions 
WHERE status = 'active'
GROUP BY tier;
```

### Revenue Calculation
```sql
SELECT 
  tier,
  COUNT(*) as subscribers,
  CASE 
    WHEN tier = 'basic' THEN COUNT(*) * 9.99
    WHEN tier = 'premium' THEN COUNT(*) * 19.99
  END as monthly_revenue
FROM subscriptions 
WHERE status = 'active'
GROUP BY tier;
```

### Recent Subscriptions
```sql
SELECT email, tier, status, created_at
FROM subscriptions
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Find Token for User
```sql
SELECT t.token, t.expires_at, s.email, s.tier
FROM auth_tokens t
JOIN subscriptions s ON t.stripe_customer_id = s.stripe_customer_id
WHERE s.email = 'user@example.com';
```

### Expired Tokens
```sql
SELECT COUNT(*) as expired_count
FROM auth_tokens
WHERE expires_at < NOW();
```

### Clean Up Expired Tokens
```sql
SELECT cleanup_expired_tokens();
```

---

## 🚨 Troubleshooting

### Webhooks Not Working
```bash
# 1. Check Stripe webhook configuration
#    URL: https://your-app.up.railway.app/webhooks/stripe
#    Secret matches: STRIPE_WEBHOOK_SECRET

# 2. Check Railway logs
railway logs --follow

# 3. Test manually
stripe trigger checkout.session.completed
```

### Database Connection Failed
```bash
# 1. Verify DATABASE_URL exists
railway variables | grep DATABASE_URL

# 2. Test connection
railway run npm run migrate

# 3. Check Postgres service status in Railway dashboard
```

### 401 Unauthorized
```bash
# 1. Check token exists
railway run psql $DATABASE_URL -c "SELECT * FROM auth_tokens;"

# 2. Verify subscription status
railway run psql $DATABASE_URL -c "SELECT * FROM subscriptions;"

# 3. Check token expiration
railway run psql $DATABASE_URL -c \
  "SELECT token, expires_at, expires_at > NOW() as is_valid FROM auth_tokens;"
```

---

## 📚 Documentation Links

- [README.md](README.md) - Full documentation
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deployment guide
- [CHANGELOG.md](CHANGELOG.md) - Version history
- [Railway Docs](https://docs.railway.app)
- [Stripe Docs](https://stripe.com/docs)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)

---

## 💡 Tips

- Use Stripe test mode during development
- Monitor Railway logs after deployment
- Set up Stripe webhook monitoring
- Keep `.env` file secure (never commit)
- Run `cleanup_expired_tokens()` periodically
- Test subscription flow before going live
- Use Railway's built-in metrics for monitoring

---

**Built for The Botosphere Sports Entertainment Network (XSEN)**  
**© 2026 Peak Financial Group LLC**
