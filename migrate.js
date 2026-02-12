require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔌 Connecting to Railway Postgres...');
    await client.connect();
    console.log('✅ Connected successfully');

    // Read the schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('📄 Running migration...');
    await client.query(schema);
    console.log('✅ Migration completed successfully');

    // Verify tables were created
    const result = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);

    console.log('\n📊 Created tables:');
    result.rows.forEach(row => {
      console.log(`   - ${row.tablename}`);
    });

    // Check indexes
    const indexResult = await client.query(`
      SELECT DISTINCT tablename, indexname
      FROM pg_indexes 
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `);

    console.log('\n🔍 Created indexes:');
    indexResult.rows.forEach(row => {
      console.log(`   - ${row.indexname} on ${row.tablename}`);
    });

    console.log('\n✅ Database migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
