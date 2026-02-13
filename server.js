require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('./db');
const crypto = require('crypto');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Trust Railway proxy
app.set('trust proxy', 1);

// Stripe webhook requires raw body - MUST be before express.json()
app.post('/webhooks/stripe', 
  express.raw({ type: 'application/json' }), 
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body, 
        sig, 
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`📥 Received event: ${event.type} [${event.id}]`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutComplete(event.data.object);
          break;
        
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionUpdate(event.data.object);
          break;
        
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object);
          break;
        
        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object);
          break;
        
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;

        default:
          console.log(`ℹ️ Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Regular JSON parsing for other routes
app.use(express.json());

// ============================================================
// STRIPE WEBHOOK HANDLERS
// ============================================================

// Simple in-memory cache for emails from checkout sessions
const emailCache = new Map();

async function handleCheckoutComplete(session) {
  const {
    customer,
    subscription,
    customer_email,
    customer_details,
    metadata
  } = session;

  console.log(`✅ Checkout completed for customer: ${customer}`);

  if (!subscription) {
    console.warn('⚠️ Checkout session has no subscription - might be one-time payment');
    return;
  }

  // Get email
  const email = customer_email || customer_details?.email;
  
  if (email) {
    console.log(`📧 Caching email for customer ${customer}: ${email}`);
    // Store email in cache for when subscription.created fires
    emailCache.set(customer, email);
    
    // Also try to save immediately if we get subscription data
    // But don't fail if subscription doesn't exist yet
    console.log('⏳ Waiting for subscription.created event to complete the record...');
  }
}

async function saveCompleteSubscription(customerId, subscriptionId, email, tier, stripeSubscription) {
  const query = `
    INSERT INTO subscriptions 
      (stripe_customer_id, stripe_subscription_id, email, tier, status, current_period_end)
    VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
    ON CONFLICT (stripe_customer_id) 
    DO UPDATE SET
      stripe_subscription_id = $2,
      email = $3,
      tier = $4,
      status = $5,
      current_period_end = to_timestamp($6),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  const values = [
    customerId,
    subscriptionId,
    email,
    tier,
    stripeSubscription.status,
    stripeSubscription.current_period_end
  ];

  const result = await pool.query(query, values);
  
  if (result.rows.length > 0) {
    console.log(`✅ Subscription saved: ${email} - ${tier} - ${stripeSubscription.status}`);
    
    // Generate auth token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO auth_tokens (token, stripe_customer_id, expires_at) 
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_customer_id) 
       DO UPDATE SET token = $1, expires_at = $3, created_at = CURRENT_TIMESTAMP`,
      [token, customerId, expiresAt]
    );

    console.log(`🔑 Generated auth token for ${email} [Tier: ${tier}]`);
  }
}

// Helper function to create or update subscription
async function createOrUpdateSubscription(customerId, subscriptionId, email, tier, status, periodEnd) {
  // Deprecated - using saveCompleteSubscription instead
  console.log('⚠️ createOrUpdateSubscription called but deprecated');
}

async function handleSubscriptionUpdate(subscription) {
  // Get all data from the subscription object in the webhook payload
  const tier = determineTierFromPrice(subscription.items.data[0]?.price?.id);
  const customerId = subscription.customer;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  const periodEnd = subscription.current_period_end;
  const cancelAtPeriodEnd = subscription.cancel_at_period_end;
  
  console.log(`🔄 Processing subscription from webhook payload: ${subscriptionId}`);
  console.log(`   Customer: ${customerId}, Tier: ${tier}, Status: ${status}`);
  
  // Check if we already have this subscription
  const existingCheck = await pool.query(
    'SELECT email FROM subscriptions WHERE stripe_customer_id = $1',
    [customerId]
  );
  
  if (existingCheck.rows.length > 0) {
    // Update existing record
    const query = `
      UPDATE subscriptions 
      SET 
        tier = $1,
        status = $2,
        current_period_end = to_timestamp($3),
        cancel_at_period_end = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE stripe_customer_id = $5
      RETURNING *
    `;

    const result = await pool.query(query, [
      tier,
      status,
      periodEnd,
      cancelAtPeriodEnd,
      customerId
    ]);

    if (result.rows.length > 0) {
      const sub = result.rows[0];
      console.log(`✅ Updated subscription: ${sub.email} - ${sub.tier} - ${sub.status}`);
      
      // Generate token if active/trialing and doesn't exist
      if (status === 'active' || status === 'trialing') {
        await ensureAuthToken(customerId, sub.email);
      }
    }
  } else {
    // New subscription - get email from cache or customer object
    let email = emailCache.get(customerId);
    
    if (!email) {
      console.log('📧 Email not in cache, checking customer object in webhook...');
      // The subscription webhook doesn't include customer details, so we have to try one fetch
      try {
        // Wait a bit for customer to exist
        await new Promise(resolve => setTimeout(resolve, 3000));
        const customer = await stripe.customers.retrieve(customerId);
        email = customer.email;
        console.log(`📧 Retrieved email: ${email}`);
      } catch (error) {
        console.warn(`⚠️ Could not fetch customer email: ${error.message}`);
        // Save without email, can update later
        email = null;
      }
    } else {
      console.log(`📧 Using cached email: ${email}`);
      // Clear from cache after using
      emailCache.delete(customerId);
    }
    
    // Save with data from webhook payload
    const query = `
      INSERT INTO subscriptions 
        (stripe_customer_id, stripe_subscription_id, email, tier, status, current_period_end, cancel_at_period_end)
      VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7)
      ON CONFLICT (stripe_customer_id) 
      DO UPDATE SET
        stripe_subscription_id = $2,
        email = COALESCE($3, subscriptions.email),
        tier = $4,
        status = $5,
        current_period_end = to_timestamp($6),
        cancel_at_period_end = $7,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(query, [
      customerId,
      subscriptionId,
      email,
      tier,
      status,
      periodEnd,
      cancelAtPeriodEnd
    ]);

    if (result.rows.length > 0) {
      const sub = result.rows[0];
      console.log(`✅ Created subscription: ${sub.email || 'NO_EMAIL'} - ${sub.tier} - ${sub.status}`);
      
      // Generate token if active/trialing
      if ((status === 'active' || status === 'trialing') && email) {
        await ensureAuthToken(customerId, email);
      }
    }
  }
}

// Helper to ensure auth token exists
async function ensureAuthToken(customerId, email) {
  const tokenCheck = await pool.query(
    'SELECT token FROM auth_tokens WHERE stripe_customer_id = $1',
    [customerId]
  );
  
  if (tokenCheck.rows.length === 0) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO auth_tokens (token, stripe_customer_id, expires_at) 
       VALUES ($1, $2, $3)`,
      [token, customerId, expiresAt]
    );

    console.log(`🔑 Generated auth token for ${email}`);
  }
}

async function handleSubscriptionDeleted(subscription) {
  const result = await pool.query(
    `UPDATE subscriptions 
     SET status = 'canceled', updated_at = CURRENT_TIMESTAMP 
     WHERE stripe_subscription_id = $1
     RETURNING email`,
    [subscription.id]
  );

  if (result.rows.length > 0) {
    console.log(`❌ Subscription canceled: ${result.rows[0].email}`);
  }
}

async function handlePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;
  
  if (!subscriptionId) {
    console.log('ℹ️ Payment succeeded but no subscription (one-time payment?)');
    return;
  }

  const result = await pool.query(
    `UPDATE subscriptions 
     SET status = 'active', updated_at = CURRENT_TIMESTAMP 
     WHERE stripe_subscription_id = $1
     RETURNING email`,
    [subscriptionId]
  );

  if (result.rows.length > 0) {
    console.log(`💰 Payment succeeded for ${result.rows[0].email}`);
  }
}

async function handlePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;
  
  if (!subscriptionId) return;

  const result = await pool.query(
    `UPDATE subscriptions 
     SET status = 'past_due', updated_at = CURRENT_TIMESTAMP 
     WHERE stripe_subscription_id = $1
     RETURNING email`,
    [subscriptionId]
  );

  if (result.rows.length > 0) {
    console.log(`⚠️ Payment failed for ${result.rows[0].email}`);
  }
}

// Helper function to determine tier from Stripe price ID
function determineTierFromPrice(priceId) {
  if (!priceId) return 'basic';
  
  const priceTierMap = {
    [process.env.STRIPE_PRICE_BASIC]: 'basic',
    [process.env.STRIPE_PRICE_PREMIUM]: 'premium',
  };
  
  return priceTierMap[priceId] || 'basic';
}

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

async function verifySubscription(req, res, next) {
  const authToken = req.headers['authorization']?.replace('Bearer ', '');

  if (!authToken) {
    return res.status(401).json({ 
      error: 'No authorization token provided',
      message: 'Include Bearer token in Authorization header'
    });
  }

  try {
    const query = `
      SELECT 
        t.token,
        t.expires_at,
        s.stripe_customer_id,
        s.email,
        s.tier,
        s.status,
        s.current_period_end,
        s.cancel_at_period_end
      FROM auth_tokens t
      JOIN subscriptions s ON t.stripe_customer_id = s.stripe_customer_id
      WHERE t.token = $1
    `;

    const result = await pool.query(query, [authToken]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const authData = result.rows[0];

    if (new Date(authData.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Token expired' });
    }

    if (authData.status !== 'active' && authData.status !== 'trialing') {
      return res.status(403).json({ 
        error: 'Subscription not active',
        status: authData.status,
        message: authData.status === 'past_due' 
          ? 'Payment failed - please update payment method'
          : 'Subscription is not active'
      });
    }

    // Attach user info to request
    req.user = {
      customerId: authData.stripe_customer_id,
      email: authData.email,
      tier: authData.tier,
      subscriptionStatus: authData.status,
      expiresAt: authData.current_period_end,
      cancelAtPeriodEnd: authData.cancel_at_period_end
    };

    next();
  } catch (error) {
    console.error('❌ Auth verification error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Tier-specific middleware
function requireTier(requiredTier) {
  const tierHierarchy = { basic: 1, premium: 2 };
  
  return (req, res, next) => {
    const userTierLevel = tierHierarchy[req.user.tier] || 0;
    const requiredTierLevel = tierHierarchy[requiredTier] || 0;

    if (userTierLevel < requiredTierLevel) {
      return res.status(403).json({
        error: 'Insufficient subscription tier',
        currentTier: req.user.tier,
        requiredTier: requiredTier
      });
    }

    next();
  };
}

// ============================================================
// API ROUTES
// ============================================================

// Exchange email for auth token (public endpoint)
app.post('/api/exchange-email', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    // Get the MOST RECENT auth token for this email
    const result = await pool.query(
      `SELECT t.token, t.expires_at, s.email, s.tier, s.status
       FROM auth_tokens t
       JOIN subscriptions s ON t.stripe_customer_id = s.stripe_customer_id
       WHERE s.email = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Subscription not found',
        message: 'No active subscription found for this email. Please try again in a moment.'
      });
    }

    const authData = result.rows[0];

    // Check if subscription is active or trialing
    if (authData.status !== 'active' && authData.status !== 'trialing') {
      return res.status(403).json({
        error: 'Subscription not active',
        message: `Subscription status: ${authData.status}`
      });
    }

    // Return the token and user info
    res.json({
      token: authData.token,
      email: authData.email,
      tier: authData.tier,
      status: authData.status,
      expiresAt: authData.expires_at
    });

  } catch (error) {
    console.error('❌ Error exchanging email:', error);
    res.status(500).json({ error: 'Failed to exchange email' });
  }
});

// Exchange Stripe checkout session for auth token (public endpoint)
app.post('/api/exchange-session', async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  try {
    // Retrieve the checkout session from Stripe
    console.log('🔍 Retrieving session:', session_id);
    const session = await stripe.checkout.sessions.retrieve(session_id);

    // Get email - either from session directly or from customer object
    let email = session.customer_email;
    
    if (!email && session.customer) {
      const customer = await stripe.customers.retrieve(session.customer);
      email = customer.email;
    }

    if (!email) {
      return res.status(400).json({ 
        error: 'No customer email found in session'
      });
    }

    console.log('📧 Found email from session:', email);

    // Look up the auth token by email (more reliable than customer ID during webhook processing)
    const result = await pool.query(
      `SELECT t.token, t.expires_at, s.email, s.tier, s.status
       FROM auth_tokens t
       JOIN subscriptions s ON t.stripe_customer_id = s.stripe_customer_id
       WHERE s.email = $1`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Token not found',
        message: 'Subscription is still being processed. Please wait a moment and try again.'
      });
    }

    const authData = result.rows[0];

    console.log(`✅ Session exchanged for ${email}`);

    // Return the token and user info
    res.json({
      token: authData.token,
      email: authData.email,
      tier: authData.tier,
      status: authData.status,
      expiresAt: authData.expires_at
    });

  } catch (error) {
    console.error('❌ Error exchanging session:', error);
    res.status(500).json({ error: 'Failed to exchange session' });
  }
});

// Health check (public)
app.get('/health', async (req, res) => {
  const dbHealthy = await pool.testConnection();
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    database: dbHealthy ? 'connected' : 'disconnected',
    service: 'XSEN Orchestrator'
  });
});

// Get user subscription info (protected)
app.get('/api/subscription', verifySubscription, async (req, res) => {
  res.json({
    customer: req.user.customerId,
    email: req.user.email,
    tier: req.user.tier,
    status: req.user.subscriptionStatus,
    expiresAt: req.user.expiresAt,
    cancelAtPeriodEnd: req.user.cancelAtPeriodEnd
  });
});

// Example protected endpoint - basic tier
app.get('/api/chat', verifySubscription, async (req, res) => {
  res.json({
    message: 'Chat access granted',
    user: req.user,
    features: ['basic_chat', 'search_history']
  });
});

// Example protected endpoint - premium tier only
app.get('/api/chat/premium', verifySubscription, requireTier('premium'), async (req, res) => {
  res.json({
    message: 'Premium chat access granted',
    user: req.user,
    features: ['premium_chat', 'priority_support', 'advanced_analytics']
  });
});

// Create portal session for subscription management
app.post('/api/create-portal-session', verifySubscription, async (req, res) => {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.customerId,
      return_url: process.env.FRONTEND_URL || 'https://boomerbot.fun',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('❌ Error creating portal session:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// ============================================================
// SERVER STARTUP
// ============================================================

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Test database connection
    await pool.testConnection();
    
    // Auto-migrate: Make email and tier nullable
    console.log('🔧 Running auto-migration...');
    try {
      await pool.query('ALTER TABLE subscriptions ALTER COLUMN email DROP NOT NULL;');
      console.log('✅ Email column is now nullable');
    } catch (error) {
      if (error.message.includes('does not exist')) {
        console.log('ℹ️ Email column already nullable');
      } else {
        console.log('⚠️ Email migration warning:', error.message);
      }
    }
    
    try {
      await pool.query('ALTER TABLE subscriptions ALTER COLUMN tier DROP NOT NULL;');
      console.log('✅ Tier column is now nullable');
    } catch (error) {
      if (error.message.includes('does not exist')) {
        console.log('ℹ️ Tier column already nullable');
      } else {
        console.log('⚠️ Tier migration warning:', error.message);
      }
    }
    
    // CLEANUP DISABLED - was causing server crashes
    // Will debug separately
    console.log('ℹ️ Duplicate cleanup disabled for now');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔐 Stripe webhooks: POST /webhooks/stripe`);
      console.log(`💚 Health check: GET /health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});
