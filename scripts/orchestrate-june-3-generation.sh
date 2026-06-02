#!/bin/bash
# Master orchestration script for June 3 generation
# Workflow: Research → Strategy → Content Creation → Review
# Monitors agent work and updates progress in real-time

set -e

cat << 'EOF'
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║              🎯 JUNE 3 CONTENT GENERATION ORCHESTRATION                   ║
║                                                                            ║
║  Workflow:                                                                 ║
║  1. Delete all draft posts                                                ║
║  2. Client Research Agent → Research active clients                        ║
║  3. Strategy Agent → Create content strategy                               ║
║  4. Social Copy Agent → Generate social posts (with validation)            ║
║  5. Blog Writer Agent → Generate blog posts (with validation)              ║
║  6. Editorial Review Agent → Quality review & validation audit             ║
║  7. Monitor & Update → Real-time progress tracking                         ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
EOF

echo ""
echo "⏳ PHASE 1: Delete Draft Posts"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run the replace-all-draft-posts script
echo "Ejecutando: ./scripts/replace-all-draft-posts.sh"
echo ""

# Create a temporary file for the response
TEMP_RESPONSE=$(mktemp)

# Run the script and capture responses
{
  # List draft posts
  npx wrangler d1 shell webxni-db --remote << 'SQL'
.mode column
SELECT
  COUNT(*) as total_draft,
  (SELECT COUNT(DISTINCT client_id) FROM posts WHERE status='draft') as affected_clients
FROM posts p
WHERE p.status='draft';
SQL

  echo ""
  echo "Eliminando posts en draft..."

  # Delete draft posts
  npx wrangler d1 shell webxni-db --remote << 'SQL'
UPDATE posts
SET status='cancelled',
    cancelled_reason='Regenerate for June 3 (agent-orchestrated)'
WHERE status='draft';

SELECT COUNT(*) as cancelled_posts FROM posts WHERE status='cancelled' AND cancelled_reason='Regenerate for June 3 (agent-orchestrated)';
SQL

} | tee "$TEMP_RESPONSE"

DRAFT_COUNT=$(grep "total_draft" "$TEMP_RESPONSE" | head -1 | awk '{print $2}')
AFFECTED_CLIENTS=$(grep "affected_clients" "$TEMP_RESPONSE" | head -1 | awk '{print $2}')

echo ""
echo "✅ Phase 1 Complete: $DRAFT_COUNT draft posts eliminated"
echo "   Affected clients: $AFFECTED_CLIENTS"
echo ""

rm "$TEMP_RESPONSE"

# Phase 2: Client Research
echo "⏳ PHASE 2: Client Research Agent"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔍 Starting: Client Research Agent"
echo "   Task: Research active clients (SEO, competitors, market trends)"
echo "   Duration: ~5 minutes"
echo ""
echo "In Discord, execute:"
echo "   @webxni /agency-run agent:client-research"
echo ""
echo "⏳ Waiting for agent to complete..."
echo "   (This takes ~5 minutes)"
echo ""

# Phase 3: Strategy Agent
echo ""
echo "⏳ PHASE 3: Strategy Agent"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Starting: Strategy Agent"
echo "   Task: Analyze research, create content strategy"
echo "   Duration: ~3 minutes"
echo ""
echo "In Discord, execute:"
echo "   @webxni /agency-run agent:strategy"
echo ""
echo "⏳ Waiting for agent to complete..."
echo ""

# Phase 4: Social Copy Agent
echo ""
echo "⏳ PHASE 4: Social Copy Agent (WITH VALIDATION)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📱 Starting: Social Copy Agent"
echo "   Task: Generate social posts for all clients"
echo "   Validation: ENABLED (blocks wrong industry content)"
echo "   Duration: ~5-10 minutes"
echo ""
echo "In Discord, execute:"
echo "   @webxni /agency-run agent:social-copy"
echo ""
echo "Expected behavior:"
echo "  ✅ Posts generated for each client"
echo "  ✅ Validation checks industry match"
echo "  ✅ Wrong content is BLOCKED automatically"
echo "  ✅ Posts saved in pending_approval status"
echo ""
echo "⏳ Monitoring generation..."
echo ""

# Phase 5: Blog Writer Agent
echo ""
echo "⏳ PHASE 5: Blog Writer Agent (WITH VALIDATION)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Starting: Blog Writer Agent"
echo "   Task: Generate SEO-optimized blog posts"
echo "   Validation: ENABLED (checks industry + services)"
echo "   Duration: ~5-10 minutes"
echo ""
echo "In Discord, execute:"
echo "   @webxni /agency-run agent:blog-writer"
echo ""
echo "Expected output:"
echo "  ✅ Blog title + body + excerpt"
echo "  ✅ SEO metadata (keywords, meta description)"
echo "  ✅ Featured image prompts for designer"
echo "  ✅ Distribution captions for social cross-posting"
echo ""
echo "⏳ Monitoring generation..."
echo ""

# Phase 6: Editorial Review Agent
echo ""
echo "⏳ PHASE 6: Editorial Review Agent"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔍 Starting: Editorial Review Agent"
echo "   Task: Quality check + validation audit"
echo "   Checks:"
echo "     ✓ Industry match (locksmith vs remodeling, etc.)"
echo "     ✓ Service validation (only services client offers)"
echo "     ✓ Content quality (fluff, weak CTAs, etc.)"
echo "     ✓ Forbidden topic blocking"
echo "   Duration: ~10 minutes"
echo ""
echo "In Discord, execute:"
echo "   @webxni /agency-run agent:editorial-review"
echo ""
echo "Results:"
echo "  ✅ View findings: https://marketing.webxni.com/agency/findings"
echo "  ✅ Filter: agent_slug = editorial-review"
echo "  ✅ Look for: severity = warning (issues found)"
echo ""

# Phase 7: Monitoring & Validation
echo ""
echo "⏳ PHASE 7: Monitor & Validate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Monitoring Dashboards:"
echo ""
echo "1. GENERATION LOGS:"
echo "   https://marketing.webxni.com/agency/logs"
echo "   Filter: status=info (successful) or BLOCK (validation blocks)"
echo ""
echo "2. VALIDATION RESULTS:"
echo "   https://marketing.webxni.com/agency/findings"
echo "   Filter: agent_slug=editorial-review"
echo ""
echo "3. APPROVAL QUEUE:"
echo "   https://marketing.webxni.com/approvals"
echo "   View: Posts waiting for your approval"
echo ""
echo "4. AGENT STATUS:"
echo "   In Discord: @webxni /agency-status"
echo "   Shows: All agents running, pending tasks, etc."
echo ""

# Final steps
echo ""
echo "🎯 FINAL STEPS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "After all agents complete:"
echo ""
echo "1. REVIEW VALIDATION RESULTS"
echo "   $ npx wrangler d1 shell webxni-db --remote"
echo "   > SELECT validation_passed, COUNT(*) FROM generation_validation_results"
echo "     WHERE generated_at > unixepoch('now', '-3600')"
echo "     GROUP BY validation_passed;"
echo "   Expected: validation_passed=1 should be >95%"
echo ""
echo "2. APPROVE POSTS"
echo "   https://marketing.webxni.com/approvals"
echo "   Review each post:"
echo "     ✓ Content matches client industry"
echo "     ✓ Services mentioned are in client profile"
echo "     ✓ No forbidden topics"
echo "     ✓ Quality is good"
echo "   Click: Approve"
echo ""
echo "3. VERIFY NO WRONG CONTENT"
echo "   Query:"
echo "   $ npx wrangler d1 shell webxni-db --remote"
echo "   > SELECT COUNT(*) as suspicious FROM posts"
echo "     WHERE created_at > unixepoch('now', '-3600')"
echo "     AND (title LIKE '%kitchen%' OR title LIKE '%remodel%')"
echo "     AND client_id IN (SELECT id FROM clients WHERE industry='locksmith');"
echo "   Expected: 0"
echo ""

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                            ║"
echo "║  📋 WORKFLOW READY TO EXECUTE                                             ║"
echo "║                                                                            ║"
echo "║  Next steps (in Discord):                                                 ║"
echo "║  1. @webxni /agency-run agent:client-research                             ║"
echo "║  2. @webxni /agency-run agent:strategy                                    ║"
echo "║  3. @webxni /agency-run agent:social-copy                                 ║"
echo "║  4. @webxni /agency-run agent:blog-writer                                 ║"
echo "║  5. @webxni /agency-run agent:editorial-review                            ║"
echo "║                                                                            ║"
echo "║  Then: Approve posts in dashboard                                         ║"
echo "║  Total time: ~45 minutes for all agents to complete                       ║"
echo "║                                                                            ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
