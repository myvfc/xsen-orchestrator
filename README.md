# XSEN Orchestrator

**Subscription Management & User Authentication Server**

A Node.js/Express server that handles Stripe subscriptions, user authentication, and tier-based access control for The Botosphere Sports Entertainment Network (XSEN).

## Features

- ✅ Stripe webhook integration for subscription lifecycle management
- ✅ Token-based authentication system
- ✅ Tier-based access control (Basic, Premium)
- ✅ Railway Postgres database integration
- ✅ Automatic subscription status updates
- ✅ Customer portal session creation
- ✅ Security middleware (Helmet, CORS)
- ✅ Graceful shutdown handling

## Architecture

```
PaymeGPT Widget → Stripe Checkout → Stripe Webhooks → Orchestrator
                                                            ↓
                                                    Railway Postgres
                                                            ↓
                                                    User Auth & Access
```

## Prerequisites

- Node.js 18+ 
- Railway account
- Stripe account
- Railway Postgres database

## Quick Start

### 1. Clone & Install

```bash
git clone <your-repo>
cd xsen-orchestrator
npm install
```

### 2. Set Up Railway Project

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login to Railway
railway login

# Link to your project (or create new)
railway link

# Add Postgres plugin
railway add postgresql
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Stripe keys from https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Your Stripe price IDs
STRIPE_PRICE_BASIC=price_...
STRIPE_PRICE_PREMIUM=price_...

# Frontend URL
FRONTEND_URL=https://boomerbot.fun

# CORS origins
ALLOWED_ORIGINS=https://boomerbot.fun,https://thebotosphere.com
```

Add these to Railway:

```bash
railway variables set STRIPE_SECRET_KEY=sk_test_...
railway variables set STRIPE_WEBHOOK_SECRET=whsec_...
railway variables set STRIPE_PRICE_BASIC=price_...
railway variables set STRIPE_PRICE_PREMIUM=price_...
railway variables set FRONTEND_URL=https://boomerbot.fun
railway variables set NODE_ENV=production
railway variables set ALLOWED_ORIGINS=https://boomerbot.fun
```

### 4. Run Database Migration

**Local (for testing):**
```bash
npm run migrate
```

**On Railway:**
```bash
railway run npm run migrate
```

### 5. Deploy to Railway

```bash
railway up
```

Your orchestrator will be live at: `https://your-service.up.railway.app`

## Stripe Configuration

### 1. Create Products & Prices

In [Stripe Dashboard](https://dashboard.stripe.com/products):

1. Create "Boomer Bot Basic" product
   - Price: $9.99/month
   - Copy the Price ID (starts with `price_`)
   
2. Create "Boomer Bot Premium" product
   - Price: $19.99/month
   - Copy the Price ID

### 2. Set Up Webhook

In [Stripe Webhooks](https://dashboard.stripe.com/webhooks):

1. Click "Add endpoint"
2. Endpoint URL: `https://your-service.up.railway.app/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the "Signing secret" → Add to Railway as `STRIPE_WEBHOOK_SECRET`

### 3. Test Webhook

Use Stripe CLI:
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

## PaymeGPT Widget Setup

Configure your PaymeGPT widget with:

1. **Enable Paywall Mode**: ✅
2. **Stripe Publishable Key**: `pk_test_...` (from Stripe)
3. **Price IDs**: Use the price IDs you created
4. **Metadata**: Pass tier information
   ```javascript
   metadata: {
     tier: 'premium',
     product: 'boomer_bot'
   }
   ```

## API Endpoints

### Public Endpoints

- `GET /health` - Health check

### Webhook Endpoints

- `POST /webhooks/stripe` - Stripe webhook handler

### Protected Endpoints (Require Bearer Token)

- `GET /api/subscription` - Get current subscription info
- `GET /api/chat` - Basic tier access
- `GET /api/chat/premium` - Premium tier only
- `POST /api/create-portal-session` - Generate Stripe customer portal URL

### Authentication

All protected endpoints require a Bearer token:

```bash
Authorization: Bearer <token>
```

Tokens are automatically generated when a subscription is created via Stripe.

## Database Schema

### Tables

**subscriptions**
- Stores Stripe subscription data
- Links customers to their tiers and status

**auth_tokens**
- JWT-like tokens for API access
- 30-day expiration (configurable)
- One token per customer

## Development

### Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Run migration
npm run migrate

# Start server with auto-reload
npm run dev
```

Server runs on `http://localhost:3000`

### Testing Stripe Integration

Use [Stripe test cards](https://stripe.com/docs/testing):

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires authentication**: `4000 0025 0000 3155`

## Monitoring

### Check Logs

```bash
# Railway logs
railway logs

# Follow logs in real-time
railway logs --follow
```

### Database Queries

```bash
# Connect to Railway Postgres
railway run psql $DATABASE_URL
```

Useful queries:

```sql
-- View all subscriptions
SELECT * FROM subscriptions ORDER BY created_at DESC;

-- View active subscriptions
SELECT email, tier, status FROM subscriptions WHERE status = 'active';

-- View auth tokens
SELECT t.token, s.email, t.expires_at 
FROM auth_tokens t 
JOIN subscriptions s ON t.stripe_customer_id = s.stripe_customer_id;

-- Cleanup expired tokens
SELECT cleanup_expired_tokens();
```

## Troubleshooting

### Webhook Not Receiving Events

1. Check Stripe webhook configuration
2. Verify `STRIPE_WEBHOOK_SECRET` is correct
3. Check Railway logs: `railway logs`
4. Test with Stripe CLI: `stripe listen --forward-to <your-url>/webhooks/stripe`

### Authentication Failing

1. Verify token is being sent in `Authorization` header
2. Check token hasn't expired (30 days default)
3. Verify subscription status is `active`
4. Check database: `SELECT * FROM auth_tokens WHERE token = 'xxx';`

### Database Connection Issues

1. Verify `DATABASE_URL` is set (Railway auto-provides this)
2. Test connection: `railway run npm run migrate`
3. Check Railway Postgres plugin is active

## Security Notes

- Never commit `.env` file
- Use environment variables for all secrets
- Verify Stripe webhook signatures (automatically done)
- Token expiration enforced
- CORS configured for specific origins
- Helmet.js security headers enabled

## Tier System

### Basic Tier ($9.99/month)
- Standard chat access
- Search history
- Community support

### Premium Tier ($19.99/month)
- Everything in Basic
- Priority support
- Advanced analytics
- Early access to new features

## Future Enhancements

- [ ] Email notifications for subscription events
- [ ] Usage tracking per tier
- [ ] Rate limiting per tier
- [ ] Admin dashboard
- [ ] Analytics integration
- [ ] Multi-product support
- [ ] Referral system

## Support

For issues or questions:
- Email: support@thebotosphere.com
- GitHub Issues: [Create issue](https://github.com/your-repo/issues)

## License

MIT License - Peak Financial Group LLC

---

**Built by Kevin for The Botosphere Sports Entertainment Network (XSEN)**

**Infrastructure**: Railway, Stripe, PostgreSQL  
**Version**: 1.0.0
