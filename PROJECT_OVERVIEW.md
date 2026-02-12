# XSEN Orchestrator - Project Overview

## 📦 Complete Subscription Management System

This is a **production-ready** subscription orchestration server that integrates PaymeGPT → Stripe → Railway Postgres for The Botosphere Sports Entertainment Network (XSEN).

---

## 🎯 What This Does

1. **Receives Stripe Webhooks** when users subscribe via PaymeGPT
2. **Creates Database Records** for subscriptions in Railway Postgres
3. **Generates Auth Tokens** for API access (30-day expiration)
4. **Validates Requests** with tier-based access control
5. **Syncs Subscription Status** in real-time with Stripe
6. **Manages Cancellations & Failures** automatically

---

## 📁 Project Structure

```
xsen-orchestrator/
├── server.js              # Main Express server with webhooks & auth
├── db.js                  # PostgreSQL connection handler
├── schema.sql             # Database schema (tables, indexes, functions)
├── migrate.js             # Database migration script
├── setup.js               # Interactive configuration wizard
├── test.js                # API endpoint test suite
├── package.json           # Dependencies and scripts
├── railway.json           # Railway deployment config
├── .env.example           # Environment variables template
├── .gitignore            # Git ignore rules
├── README.md             # Complete documentation
├── DEPLOYMENT.md         # Step-by-step deployment guide
├── QUICKREF.md           # Quick reference cheat sheet
├── CHANGELOG.md          # Version history
└── LICENSE               # MIT License
```

---

## 🚀 Quick Start (5 Minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
npm run setup
# Interactive wizard will guide you through configuration
```

### 3. Set Up Railway
```bash
railway login
railway init
railway add postgresql
railway up
```

### 4. Run Database Migration
```bash
railway run npm run migrate
```

### 5. Configure Stripe Webhook
- Get your Railway URL: `railway domain`
- Add webhook in Stripe: `https://your-app.up.railway.app/webhooks/stripe`
- Copy webhook secret → Add to Railway variables

### 6. Test
```bash
npm test
```

**Done!** Your subscription system is live.

---

## 💡 Key Features

### ✅ Automatic Subscription Sync
- Webhook handles all Stripe events
- Real-time status updates
- Cancellation handling
- Payment failure detection

### ✅ Token-Based Authentication
- Auto-generated on subscription creation
- 30-day expiration
- One token per customer
- Secure Bearer token validation

### ✅ Tier-Based Access Control
- Basic tier: $9.99/month
- Premium tier: $19.99/month
- Middleware enforces tier requirements
- Easy to add new tiers

### ✅ Production Ready
- Security headers (Helmet)
- CORS configuration
- Error handling
- Graceful shutdown
- Database connection pooling

### ✅ Developer Friendly
- Interactive setup script
- Comprehensive tests
- Detailed documentation
- Railway optimized
- Easy debugging

---

## 🔄 Data Flow

```
┌─────────────┐
│ PaymeGPT    │
│ Widget      │
└──────┬──────┘
       │
       │ User subscribes
       ▼
┌─────────────┐
│   Stripe    │
│  Checkout   │
└──────┬──────┘
       │
       │ checkout.session.completed
       ▼
┌─────────────┐
│  Webhook    │
│  Handler    │
└──────┬──────┘
       │
       ├─► Create subscription record
       │
       ├─► Generate auth token
       │
       └─► Store in Railway Postgres
       
┌─────────────┐
│   Client    │
│   Request   │
└──────┬──────┘
       │
       │ Authorization: Bearer <token>
       ▼
┌─────────────┐
│    Auth     │
│ Middleware  │
└──────┬──────┘
       │
       ├─► Validate token
       │
       ├─► Check subscription status
       │
       ├─► Verify tier access
       │
       └─► Grant/Deny access
```

---

## 🗄️ Database Schema

### subscriptions
Stores Stripe subscription data linked to tiers and status.

**Key Fields:**
- `stripe_customer_id` - Unique Stripe customer ID
- `stripe_subscription_id` - Stripe subscription ID
- `email` - Customer email
- `tier` - 'basic' or 'premium'
- `status` - 'active', 'canceled', 'past_due', etc.
- `current_period_end` - Subscription renewal date

### auth_tokens
Authentication tokens for API access.

**Key Fields:**
- `token` - Cryptographically secure random token
- `stripe_customer_id` - Links to subscriptions table
- `expires_at` - Token expiration (30 days)

**Indexes:** Optimized for fast lookups on customer ID, email, token

---

## 🔐 Security Features

- ✅ Stripe webhook signature verification
- ✅ Helmet.js security headers
- ✅ CORS configuration
- ✅ Environment variable protection
- ✅ Token expiration enforcement
- ✅ SQL injection prevention (parameterized queries)
- ✅ Database connection pooling
- ✅ Graceful error handling

---

## 📊 Supported Stripe Events

The webhook handler processes these events:

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Create subscription + token |
| `customer.subscription.created` | Activate subscription |
| `customer.subscription.updated` | Update tier/status |
| `customer.subscription.deleted` | Mark as canceled |
| `invoice.payment_succeeded` | Activate subscription |
| `invoice.payment_failed` | Mark as past_due |

---

## 🛠️ API Endpoints

### Public
- `GET /health` - Health check & database status

### Webhooks
- `POST /webhooks/stripe` - Stripe event handler

### Protected (Require Auth Token)
- `GET /api/subscription` - Get subscription details
- `GET /api/chat` - Basic tier access
- `GET /api/chat/premium` - Premium tier only
- `POST /api/create-portal-session` - Stripe customer portal

---

## 📈 Scaling & Performance

- **Connection Pooling**: Max 20 concurrent DB connections
- **Automatic Retries**: Railway handles failed deployments
- **Zero-Downtime Deploys**: Railway blue-green deployments
- **Database Indexes**: Optimized for fast queries
- **Token Cleanup**: Automated expired token removal
- **Health Monitoring**: Built-in health check endpoint

---

## 🧪 Testing

### Unit Tests
```bash
npm test
```
Tests all API endpoints (public, protected, tier-based)

### Stripe Webhook Testing
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
stripe trigger checkout.session.completed
```

### Database Testing
```bash
railway run psql $DATABASE_URL -c "SELECT * FROM subscriptions;"
```

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Complete feature documentation |
| `DEPLOYMENT.md` | Step-by-step deployment guide |
| `QUICKREF.md` | Command & endpoint cheat sheet |
| `CHANGELOG.md` | Version history |
| `schema.sql` | Database schema with comments |
| `.env.example` | Environment variable template |

---

## 🎓 Learning Resources

**Stripe Integration:**
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Subscription Lifecycle](https://stripe.com/docs/billing/subscriptions/overview)
- [Test Cards](https://stripe.com/docs/testing)

**Railway Platform:**
- [Railway Docs](https://docs.railway.app)
- [Postgres Plugin](https://docs.railway.app/databases/postgresql)
- [Environment Variables](https://docs.railway.app/develop/variables)

**Node.js/Express:**
- [Express Middleware](https://expressjs.com/en/guide/using-middleware.html)
- [PostgreSQL Node](https://node-postgres.com/)
- [Error Handling](https://expressjs.com/en/guide/error-handling.html)

---

## 🔮 Roadmap

### v1.1.0 (Next)
- Email notifications for subscription events
- Usage tracking per tier
- Rate limiting based on tier
- Enhanced logging

### v1.2.0
- Admin dashboard
- Analytics integration
- Multi-product support
- Promo code system

### v2.0.0
- Referral system
- Team subscriptions
- Usage-based billing
- Advanced analytics

---

## 🆘 Support & Troubleshooting

### Common Issues

**Webhooks not working?**
1. Check Stripe webhook URL matches Railway domain
2. Verify `STRIPE_WEBHOOK_SECRET` is correct
3. Review Railway logs: `railway logs --follow`

**Database connection failed?**
1. Ensure Railway Postgres plugin is active
2. Run: `railway run npm run migrate`
3. Check `DATABASE_URL` exists in variables

**401 Unauthorized?**
1. Verify token exists in database
2. Check token hasn't expired
3. Confirm subscription status is 'active'

### Get Help
- Check [DEPLOYMENT.md](DEPLOYMENT.md) for detailed guides
- Review [QUICKREF.md](QUICKREF.md) for quick answers
- Examine Railway logs for errors
- Test with Stripe CLI for webhook issues

---

## 💼 Business Context

**Built for:** The Botosphere Sports Entertainment Network (XSEN)  
**Owner:** Peak Financial Group LLC  
**Primary Use:** Boomer Bot subscription management  
**Tiers:**
- Basic ($9.99/mo): Standard OU sports chat
- Premium ($19.99/mo): Advanced features + priority support

**Integration Points:**
- PaymeGPT widget (payment collection)
- Stripe (payment processing)
- Railway Postgres (data storage)
- XSEN chatbots (authentication)

---

## 🎉 Ready to Deploy!

This is a **complete, production-ready** system. Everything you need is included:

✅ Server code  
✅ Database schema  
✅ Migration scripts  
✅ Test suite  
✅ Documentation  
✅ Deployment config  
✅ Security features  
✅ Error handling  

**Just add your API keys and deploy!**

---

**Questions?** Check the documentation files or contact support.

**© 2026 Peak Financial Group LLC - All Rights Reserved**
