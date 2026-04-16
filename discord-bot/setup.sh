#!/bin/bash
# WebXni Discord Bot — Script de configuración
# Corre esto en una computadora nueva o si necesitas reconfigurar
# Uso: cd discord-bot && bash setup.sh

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BOLD}=== WebXni Discord Bot — Setup ===${NC}\n"

# ── 1. Dependencias ────────────────────────────────────────────────────────────
echo -e "${BOLD}[1/5] Instalando dependencias...${NC}"
npm install
echo -e "${GREEN}✓ Dependencias instaladas${NC}\n"

# ── 2. Verificar/crear .env ────────────────────────────────────────────────────
echo -e "${BOLD}[2/5] Configurando .env...${NC}"

if [ -f ".env" ]; then
  echo -e "${YELLOW}⚠ Ya existe un .env. Revisando que tenga todas las variables...${NC}"
else
  echo -e "Creando .env desde el template..."
  cp .env.example .env
fi

# Función para leer o pedir una variable
get_env_var() {
  local VAR_NAME=$1
  local PROMPT=$2
  local DEFAULT=$3

  # Leer valor actual del .env si existe
  CURRENT=$(grep "^${VAR_NAME}=" .env 2>/dev/null | cut -d'=' -f2- | tr -d '"')

  if [ -n "$CURRENT" ] && [ "$CURRENT" != "" ]; then
    echo -e "  ${GREEN}✓${NC} ${VAR_NAME} ya está configurado"
    return
  fi

  if [ -n "$DEFAULT" ]; then
    echo -e "  ${YELLOW}→${NC} ${VAR_NAME} usando valor por defecto: ${DEFAULT}"
    # Agregar o actualizar en .env
    if grep -q "^${VAR_NAME}=" .env; then
      sed -i "s|^${VAR_NAME}=.*|${VAR_NAME}=${DEFAULT}|" .env
    else
      echo "${VAR_NAME}=${DEFAULT}" >> .env
    fi
  else
    echo -e "  ${RED}?${NC} ${PROMPT}"
    read -p "  → " VALUE
    if [ -n "$VALUE" ]; then
      if grep -q "^${VAR_NAME}=" .env; then
        sed -i "s|^${VAR_NAME}=.*|${VAR_NAME}=${VALUE}|" .env
      else
        echo "${VAR_NAME}=${VALUE}" >> .env
      fi
      echo -e "  ${GREEN}✓${NC} ${VAR_NAME} guardado"
    else
      echo -e "  ${YELLOW}⚠${NC} ${VAR_NAME} dejado en blanco — edita .env manualmente"
    fi
  fi
}

echo ""
echo "Valores conocidos (hardcoded):"
get_env_var "DISCORD_OWNER_ID"   ""  "1242861091214721139"
get_env_var "DISCORD_CHANNEL_ID" ""  "1242943323828916234"
get_env_var "API_BASE_URL"       ""  "https://marketing.webxni.com"

echo ""
echo "Valores que necesitas ingresar manualmente:"
echo -e "  ${YELLOW}Tip:${NC} DISCORD_BOT_TOKEN → discord.com/developers → tu app → Bot → Reset Token"
get_env_var "DISCORD_BOT_TOKEN" "Pega tu bot token:" ""

echo ""
echo -e "  ${YELLOW}Tip:${NC} DISCORD_BOT_SECRET → corre este comando en el proyecto principal:"
echo -e "  ${BOLD}npx wrangler kv key get --binding=KV_BINDING --remote \"settings:system\"${NC}"
echo -e "  Busca el campo \"discord_bot_secret\" en el JSON"
get_env_var "DISCORD_BOT_SECRET" "Pega el discord_bot_secret del KV:" ""

echo ""

# ── 3. Verificar Node.js ───────────────────────────────────────────────────────
echo -e "${BOLD}[3/5] Verificando Node.js...${NC}"
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
if [ "$NODE_VERSION" = "not found" ]; then
  echo -e "${RED}✗ Node.js no está instalado. Instala desde nodejs.org${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js ${NODE_VERSION}${NC}\n"

# ── 4. Instalar y configurar pm2 ───────────────────────────────────────────────
echo -e "${BOLD}[4/5] Configurando pm2...${NC}"

if ! command -v pm2 &>/dev/null; then
  echo "Instalando pm2 globalmente..."
  npm install -g pm2
fi

# Detener instancia anterior si existe
pm2 stop webxni-bot 2>/dev/null || true
pm2 delete webxni-bot 2>/dev/null || true

echo -e "${GREEN}✓ pm2 listo${NC}\n"

# ── 5. Arrancar el bot ────────────────────────────────────────────────────────
echo -e "${BOLD}[5/5] Arrancando el bot...${NC}"
pm2 start bot.js --name webxni-bot --time
pm2 save

echo ""
echo -e "${GREEN}${BOLD}✅ Bot arrancado correctamente${NC}"
echo ""
echo -e "Comandos útiles:"
echo -e "  ${BOLD}pm2 status${NC}              → ver estado"
echo -e "  ${BOLD}pm2 logs webxni-bot${NC}     → ver logs en vivo"
echo -e "  ${BOLD}pm2 restart webxni-bot${NC}  → reiniciar"
echo ""
echo -e "Para que arranque automáticamente al reiniciar la PC:"
echo -e "  ${BOLD}pm2 startup${NC}  (copia y ejecuta el comando que te muestra)"
echo -e "  ${BOLD}pm2 save${NC}"
echo ""

# Verificar que realmente conectó
sleep 3
STATUS=$(pm2 describe webxni-bot 2>/dev/null | grep "status" | head -1)
echo -e "Estado pm2: ${STATUS}"
