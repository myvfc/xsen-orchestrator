require('dotenv').config();
const { Client } = require('pg');

async function fixDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔌 Connecting to Railway Postgres...');
    await client.connect();
    console.log('✅ Connected');

    console.log('📝 Making email column nullable...');
    await client.query('ALTER TABLE subscriptions ALTER COLUMN email DROP NOT NULL;');
    console.log('✅ Email column updated');

    console.log('📝 Making tier column nullable...');
    await client.query('ALTER TABLE subscriptions ALTER COLUMN tier DROP NOT NULL;');
    console.log('✅ Tier column updated');

    console.log('\n✅ Database schema fixed! You can now accept Stripe Pricing Table subscriptions.');

  } catch (error) {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

fixDatabase();
