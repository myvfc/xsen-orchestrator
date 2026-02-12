const { Pool } = require('pg');

// Railway automatically provides DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Connection event handlers
pool.on('connect', () => {
  console.log('✅ Connected to Railway Postgres');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

// Test query helper
pool.testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database test query successful:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Database test query failed:', error);
    return false;
  }
};

module.exports = pool;
