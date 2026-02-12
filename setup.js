#!/usr/bin/env node

/**
 * XSEN Orchestrator - Interactive Setup Script
 * Helps configure the project for first-time deployment
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  log('\n╔════════════════════════════════════════════════════════╗', 'blue');
  log('║   XSEN Orchestrator - Interactive Setup               ║', 'blue');
  log('║   Subscription Management & Authentication Server      ║', 'blue');
  log('╚════════════════════════════════════════════════════════╝\n', 'blue');

  log('This script will help you configure your environment variables.\n', 'bright');

  const config = {};

  // Database URL
  log('━━━ Database Configuration ━━━', 'yellow');
  log('For Railway deployment, DATABASE_URL is auto-provided.');
  log('For local testing, get it from Railway dashboard.\n');
  
  const dbUrl = await question('DATABASE_URL (press Enter to skip): ');
  if (dbUrl.trim()) {
    config.DATABASE_URL = dbUrl.trim();
  }

  // Stripe Configuration
  log('\n━━━ Stripe Configuration ━━━', 'yellow');
  log('Get your keys from: https://dashboard.stripe.com/apikeys\n');

  const stripeKey = await question('STRIPE_SECRET_KEY (sk_test_... or sk_live_...): ');
  if (!stripeKey.trim()) {
    log('❌ Stripe secret key is required!', 'red');
    process.exit(1);
  }
  config.STRIPE_SECRET_KEY = stripeKey.trim();

  const webhookSecret = await question('STRIPE_WEBHOOK_SECRET (whsec_...): ');
  if (webhookSecret.trim()) {
    config.STRIPE_WEBHOOK_SECRET = webhookSecret.trim();
  }

  log('\n━━━ Stripe Product Configuration ━━━', 'yellow');
  log('Create products in: https://dashboard.stripe.com/products\n');

  const priceBasic = await question('STRIPE_PRICE_BASIC (price_...): ');
  if (priceBasic.trim()) {
    config.STRIPE_PRICE_BASIC = priceBasic.trim();
  }

  const pricePremium = await question('STRIPE_PRICE_PREMIUM (price_...): ');
  if (pricePremium.trim()) {
    config.STRIPE_PRICE_PREMIUM = pricePremium.trim();
  }

  // Application Settings
  log('\n━━━ Application Settings ━━━', 'yellow');

  const nodeEnv = await question('NODE_ENV (development/production) [development]: ');
  config.NODE_ENV = nodeEnv.trim() || 'development';

  const port = await question('PORT [3000]: ');
  config.PORT = port.trim() || '3000';

  const frontendUrl = await question('FRONTEND_URL [https://boomerbot.fun]: ');
  config.FRONTEND_URL = frontendUrl.trim() || 'https://boomerbot.fun';

  const allowedOrigins = await question('ALLOWED_ORIGINS (comma-separated) [https://boomerbot.fun]: ');
  config.ALLOWED_ORIGINS = allowedOrigins.trim() || 'https://boomerbot.fun';

  // Generate .env file
  log('\n━━━ Generating Configuration ━━━\n', 'yellow');

  let envContent = '# XSEN Orchestrator - Environment Variables\n';
  envContent += `# Generated on ${new Date().toISOString()}\n\n`;

  envContent += '# Database (Railway auto-provides this)\n';
  if (config.DATABASE_URL) {
    envContent += `DATABASE_URL=${config.DATABASE_URL}\n`;
  } else {
    envContent += '# DATABASE_URL=postgresql://...\n';
  }

  envContent += '\n# Stripe Configuration\n';
  envContent += `STRIPE_SECRET_KEY=${config.STRIPE_SECRET_KEY}\n`;
  if (config.STRIPE_WEBHOOK_SECRET) {
    envContent += `STRIPE_WEBHOOK_SECRET=${config.STRIPE_WEBHOOK_SECRET}\n`;
  } else {
    envContent += '# STRIPE_WEBHOOK_SECRET=whsec_...\n';
  }

  envContent += '\n# Stripe Product Prices\n';
  if (config.STRIPE_PRICE_BASIC) {
    envContent += `STRIPE_PRICE_BASIC=${config.STRIPE_PRICE_BASIC}\n`;
  } else {
    envContent += '# STRIPE_PRICE_BASIC=price_...\n';
  }
  if (config.STRIPE_PRICE_PREMIUM) {
    envContent += `STRIPE_PRICE_PREMIUM=${config.STRIPE_PRICE_PREMIUM}\n`;
  } else {
    envContent += '# STRIPE_PRICE_PREMIUM=price_...\n';
  }

  envContent += '\n# Application Settings\n';
  envContent += `NODE_ENV=${config.NODE_ENV}\n`;
  envContent += `PORT=${config.PORT}\n`;
  envContent += `FRONTEND_URL=${config.FRONTEND_URL}\n`;
  envContent += `ALLOWED_ORIGINS=${config.ALLOWED_ORIGINS}\n`;

  // Write .env file
  const envPath = path.join(__dirname, '.env');
  fs.writeFileSync(envPath, envContent);

  log('✅ Configuration file created: .env', 'green');

  // Display next steps
  log('\n╔════════════════════════════════════════════════════════╗', 'green');
  log('║   Setup Complete! Next Steps:                         ║', 'green');
  log('╚════════════════════════════════════════════════════════╝\n', 'green');

  log('1. Install dependencies:', 'bright');
  log('   npm install\n');

  log('2. Run database migration:', 'bright');
  log('   npm run migrate\n');

  log('3. Start development server:', 'bright');
  log('   npm run dev\n');

  log('4. Test the server:', 'bright');
  log('   node test.js\n');

  log('5. Deploy to Railway:', 'bright');
  log('   railway up\n');

  log('6. Set Railway environment variables:', 'bright');
  log('   railway variables set STRIPE_SECRET_KEY=...');
  log('   railway variables set STRIPE_WEBHOOK_SECRET=...');
  log('   (See DEPLOYMENT.md for full list)\n');

  log('📚 Documentation:', 'blue');
  log('   - README.md - General overview');
  log('   - DEPLOYMENT.md - Deployment guide');
  log('   - Check Stripe dashboard for webhook setup\n');

  log('Need help? Check the docs or contact support.\n', 'yellow');

  rl.close();
}

main().catch(error => {
  log(`\n❌ Setup failed: ${error.message}`, 'red');
  process.exit(1);
});
