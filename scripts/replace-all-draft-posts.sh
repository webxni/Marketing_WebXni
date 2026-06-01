#!/bin/bash
# Replace all draft posts with new ones generated with validation
# WARNING: This will DELETE all draft posts and regenerate them

set -e

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║                                                                    ║"
echo "║  ⚠️  REEMPLAZANDO TODOS LOS POSTS EN DRAFT                        ║"
echo "║                                                                    ║"
echo "║  PASO 1: Listar posts en draft                                    ║"
echo "║  PASO 2: Eliminar (cambiar a cancelled)                           ║"
echo "║  PASO 3: Regenerar para cada cliente                              ║"
echo "║                                                                    ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: List all draft posts
echo "PASO 1: Listando posts en draft..."
echo ""
npx wrangler d1 shell webxni-db --remote << 'SQL'
.mode column
SELECT
  p.id,
  p.title,
  c.name as cliente,
  p.created_at as fecha
FROM posts p
JOIN clients c ON p.client_id = c.id
WHERE p.status='draft'
ORDER BY c.name, p.created_at DESC;
SQL

echo ""
echo "────────────────────────────────────────────────────────────────────"
echo ""
read -p "¿Deseas continuar y ELIMINAR estos posts? (sí/no): " confirm

if [ "$confirm" != "sí" ] && [ "$confirm" != "si" ]; then
  echo "❌ Operación cancelada."
  exit 1
fi

# Step 2: Cancel all draft posts
echo ""
echo "PASO 2: Eliminando posts en draft (cambiar a cancelled)..."
echo ""

npx wrangler d1 shell webxni-db --remote << 'SQL'
UPDATE posts
SET status='cancelled',
    cancelled_reason='Reemplazo con validación (script)'
WHERE status='draft';

SELECT COUNT(*) as posts_eliminados FROM posts WHERE status='cancelled' AND cancelled_reason='Reemplazo con validación (script)';
SQL

echo ""
echo "────────────────────────────────────────────────────────────────────"
echo ""

# Step 3: Get list of affected clients
echo "PASO 3: Obteniendo lista de clientes afectados..."
echo ""

CLIENTS=$(npx wrangler d1 query webxni-db "SELECT DISTINCT c.slug FROM clients c WHERE c.id IN (SELECT DISTINCT client_id FROM posts WHERE status='cancelled' AND cancelled_reason='Reemplazo con validación (script)');" --json | jq -r '.[].slug')

if [ -z "$CLIENTS" ]; then
  echo "❌ No hay clientes para regenerar."
  exit 1
fi

echo "Clientes a regenerar:"
echo "$CLIENTS"
echo ""
echo "────────────────────────────────────────────────────────────────────"
echo ""
echo "PASO 4: REGENERAR POSTS CON VALIDACIÓN"
echo ""
echo "Ejecuta estos comandos en Discord:"
echo ""

for client in $CLIENTS; do
  echo "@webxni /weekly-content client:$client week:this_week"
done

echo ""
echo "────────────────────────────────────────────────────────────────────"
echo ""
echo "✅ Posts en draft eliminados."
echo "⏳ Ahora ejecuta los comandos de arriba en Discord para regenerar."
echo ""
echo "Cada regeneración:"
echo "  • Toma 3-5 minutos por cliente"
echo "  • Valida contenido vs perfil del cliente"
echo "  • Bloquea contenido incorrecto automáticamente"
echo "  • Crea posts nuevos en estado pending_approval"
echo ""
