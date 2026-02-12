// migrate-nullable.js - Run this on Railway to make email/tier nullable
const { Client } = require('pg');

async function makeColumnsNullable() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected');

    console.log('📝 Making email column nullable...');
    await client.query('ALTER TABLE subscriptions ALTER COLUMN email DROP NOT NULL;');
    console.log('✅ Email column is now nullable');

    console.log('📝 Making tier column nullable...');
    await client.query('ALTER TABLE subscriptions ALTER COLUMN tier DROP NOT NULL;');
    console.log('✅ Tier column is now nullable');

    console.log('\n✅ Migration complete! Columns are now nullable.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

makeColumnsNullable();
