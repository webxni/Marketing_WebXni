# WebXni Discord Bot

## Arquitectura

El bot corre en **dos partes separadas**:

```
Discord mensaje → bot.js (servidor/PC) → /api/ai/dispatch (Cloudflare Worker) → respuesta → Discord
```

| Parte | Dónde corre | Qué hace |
|-------|-------------|----------|
| `bot.js` | Tu computadora o servidor | Conecta al Gateway de Discord, escucha mensajes |
| `/api/ai/*` | Cloudflare Workers | Agente AI, herramientas, base de datos |
| Slash commands | Cloudflare Workers | `/ask`, `/status`, `/queue`, `/failed` |

> ⚠️ **Si apagas la computadora, el bot se detiene.** El API de Cloudflare sigue funcionando — solo deja de escuchar mensajes del canal. Las notificaciones automáticas (posting runs, etc.) siguen funcionando desde el Worker.

---

## Configuración rápida (si te cambias de computadora o necesitas reconfigurar)

Corre el script de setup:

```bash
cd discord-bot
bash setup.sh
```

El script hace todo: instala dependencias, crea el `.env`, instala pm2, y arranca el bot.

---

## Variables de entorno (.env)

| Variable | Dónde conseguirla |
|----------|-------------------|
| `DISCORD_BOT_TOKEN` | discord.com/developers → tu app → Bot → Reset Token |
| `DISCORD_BOT_SECRET` | Es el valor de `discord_bot_secret` en KV `settings:system` |
| `DISCORD_OWNER_ID` | `1242861091214721139` (tu Discord user ID) |
| `DISCORD_CHANNEL_ID` | `1242943323828916234` (canal de notificaciones) |
| `API_BASE_URL` | `https://marketing.webxni.com` |

### Recuperar el DISCORD_BOT_SECRET del KV:
```bash
npx wrangler kv key get --binding=KV_BINDING --remote "settings:system"
# Busca el campo "discord_bot_secret" en el JSON
```

---

## Comandos útiles

```bash
# Ver estado del bot
pm2 status webxni-bot

# Ver logs en vivo
pm2 logs webxni-bot

# Reiniciar
pm2 restart webxni-bot

# Detener
pm2 stop webxni-bot

# Arrancar si no está corriendo
pm2 start bot.js --name webxni-bot --time
cd /home/marvinesu/projects/Marketing_WebXni/discord-bot && pm2 start bot.js --name webxni-bot --time

# Que pm2 arranque automáticamente al reiniciar la PC
pm2 startup
pm2 save
```

---

## Invitar el bot al servidor (si se remueve)

```
https://discord.com/api/oauth2/authorize?client_id=1468394932837552248&permissions=274877910016&scope=bot+applications.commands
```

Selecciona tu servidor y autoriza. Necesita:
- Read Messages / View Channels
- Send Messages
- Read Message History

**En el Developer Portal también debe tener habilitado:**
- Bot → Privileged Gateway Intents → **Message Content Intent** ✅

---

## Deploy permanente (para no depender de esta PC)

### Railway (recomendado, ~$5/mes)
```bash
npm install -g @railway/cli
railway login
cd discord-bot
railway init
railway up
```

### Render (gratis con limitaciones)
1. Conecta el repo en render.com
2. Root directory: `discord-bot`
3. Build command: `npm install`
4. Start command: `node bot.js`
5. Agrega las variables de entorno en el dashboard

---

## Cómo funciona el chat

| Desde Discord | Resultado |
|---------------|-----------|
| Cualquier mensaje en el canal configurado | El bot responde con el agente AI |
| DM directo al bot | El bot responde |
| `@webxni` en cualquier canal | El bot responde inline |
| `/ask <pregunta>` | Slash command (funciona aunque el bot.js esté caído) |
| `/status` | Health check del sistema |
| `/queue` | Cola de posts pendientes |
| `/failed` | Posts fallidos |
