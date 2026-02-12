// clear-database.js - Clear all subscription data
require('dotenv').config();
const { Client } = require('pg');

async function clearDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected');

    console.log('🗑️ Clearing all subscription and token data...');
    await client.query('TRUNCATE subscriptions, auth_tokens CASCADE;');
    console.log('✅ Database cleared successfully!');
    console.log('');
    console.log('All old subscriptions and tokens have been deleted.');
    console.log('You can now do a fresh test subscription.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

clearDatabase();
