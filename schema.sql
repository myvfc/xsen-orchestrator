-- ============================================================
-- XSEN Orchestrator - Railway Postgres Schema
-- ============================================================
-- This schema manages user subscriptions, authentication tokens,
-- and integrates with Stripe for payment processing
-- ============================================================

-- Drop tables if they exist (for clean reinstall)
DROP TABLE IF EXISTS auth_tokens CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;

-- ============================================================
-- SUBSCRIPTIONS TABLE
-- Stores Stripe subscription data and user tier information
-- ============================================================

CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  stripe_customer_id VARCHAR(255) UNIQUE NOT NULL,
  stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  tier VARCHAR(50) NOT NULL DEFAULT 'basic',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Comments for documentation
COMMENT ON TABLE subscriptions IS 'Stores user subscription data synced from Stripe';
COMMENT ON COLUMN subscriptions.tier IS 'Subscription tier: basic, premium';
COMMENT ON COLUMN subscriptions.status IS 'Stripe status: active, canceled, past_due, trialing, incomplete';
COMMENT ON COLUMN subscriptions.cancel_at_period_end IS 'If true, subscription will cancel at period end';

-- ============================================================
-- AUTH_TOKENS TABLE
-- Stores authentication tokens for API access
-- ============================================================

CREATE TABLE auth_tokens (
  id SERIAL PRIMARY KEY,
  token VARCHAR(255) UNIQUE NOT NULL,
  stripe_customer_id VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customer 
    FOREIGN KEY (stripe_customer_id) 
    REFERENCES subscriptions(stripe_customer_id) 
    ON DELETE CASCADE
);

-- Add unique constraint to ensure one active token per customer
CREATE UNIQUE INDEX idx_one_token_per_customer ON auth_tokens(stripe_customer_id);

COMMENT ON TABLE auth_tokens IS 'Authentication tokens for API access';
COMMENT ON COLUMN auth_tokens.token IS 'Cryptographically secure random token';
COMMENT ON COLUMN auth_tokens.expires_at IS 'Token expiration timestamp (typically 30 days from creation)';

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================

-- Subscriptions table indexes
CREATE INDEX idx_subscriptions_email ON subscriptions(email);
CREATE INDEX idx_subscriptions_customer ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_tier ON subscriptions(tier);

-- Auth tokens table indexes
CREATE INDEX idx_tokens_customer ON auth_tokens(stripe_customer_id);
CREATE INDEX idx_tokens_token ON auth_tokens(token);
CREATE INDEX idx_tokens_expires ON auth_tokens(expires_at);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_subscriptions_updated_at 
  BEFORE UPDATE ON subscriptions 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CLEANUP FUNCTION
-- Delete expired tokens (run this periodically via cron)
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM auth_tokens 
  WHERE expires_at < CURRENT_TIMESTAMP;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_tokens IS 'Deletes expired authentication tokens';

-- ============================================================
-- INITIAL DATA / SEED (Optional)
-- ============================================================

-- You can add test data here if needed
-- Example:
-- INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status)
-- VALUES ('cus_test123', 'sub_test123', 'test@example.com', 'premium', 'active');

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Run these to verify the schema was created correctly:

-- Check tables
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check indexes
-- SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public';

-- Count records (should be 0 initially)
-- SELECT 'subscriptions' as table_name, COUNT(*) FROM subscriptions
-- UNION ALL
-- SELECT 'auth_tokens', COUNT(*) FROM auth_tokens;

-- ============================================================
-- GRANTS (if needed for specific users)
-- ============================================================

-- Railway handles this automatically, but if you need custom users:
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

-- ============================================================
-- END OF SCHEMA
-- ============================================================
