#!/bin/bash
# Deploy all client profile validation migrations to production D1
# CRITICAL: Run this BEFORE pushing code to production
# Usage: ./scripts/deploy-migrations.sh

set -e

echo "=== WebXni AI Agency — Deploying Database Migrations ==="
echo ""
echo "⚠️  CRITICAL: Running migrations on PRODUCTION database"
echo "⚠️  Make sure you have a backup before proceeding!"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler not found. Install with: npm install -g wrangler"
    exit 1
fi

# Verify we're in the right directory
if [ ! -f "db/schema.sql" ]; then
    echo "❌ Must run from project root directory"
    exit 1
fi

echo "Running migrations in sequence..."
echo ""

# Run each migration
migrations=(
    "0036_client_services"
    "0037_client_service_areas"
    "0038_client_profile_validation_rules"
    "0039_generation_validation_results"
    "0040_discord_context_memory"
)

for migration in "${migrations[@]}"; do
    echo "📋 Running migration: $migration"

    migration_file="db/migrations/${migration}.sql"

    if [ ! -f "$migration_file" ]; then
        echo "❌ Migration file not found: $migration_file"
        exit 1
    fi

    npx wrangler d1 execute webxni-db --file="$migration_file" --remote

    if [ $? -eq 0 ]; then
        echo "✅ Migration $migration completed successfully"
    else
        echo "❌ Migration $migration FAILED"
        exit 1
    fi

    echo ""
done

echo "🎉 All migrations completed successfully!"
echo ""
echo "Next steps:"
echo "  1. Verify tables were created: npx wrangler d1 shell webxni-db --remote"
echo "     Then run: .tables"
echo "  2. Push code to production: git push origin main"
echo "  3. Restart Discord bot: pm2 restart webxni-bot"
echo "  4. Test validation: @webxni /weekly-content client:test-client"
