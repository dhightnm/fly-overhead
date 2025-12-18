-- Migration 010: ensure user subscription flags exist
ALTER TABLE IF EXISTS users
ADD COLUMN IF NOT EXISTS is_efb BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_api BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_is_efb ON users(is_efb);
CREATE INDEX IF NOT EXISTS idx_users_is_api ON users(is_api);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);

COMMENT ON COLUMN users.is_efb IS 'User has active EFB subscription';
COMMENT ON COLUMN users.is_api IS 'User has active API subscription';
COMMENT ON COLUMN users.stripe_customer_id IS 'Stripe customer ID for payment processing';
