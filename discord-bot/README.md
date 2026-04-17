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

---

## Subir imágenes y publicar desde Discord

El bot puede recibir archivos adjuntos (imágenes y videos) y publicarlos directamente en las redes sociales.

### Flujo completo — crear y publicar un post con imagen

Adjunta una imagen al mensaje y escribe:

```
Post this to Instagram and Facebook for Daniels Locksmith, publish date tomorrow
```

El bot automáticamente:
1. Descarga la imagen de Discord
2. La sube al almacenamiento R2 de la plataforma
3. Crea un post con la fecha y plataformas indicadas
4. Genera captions con IA para cada plataforma
5. Aprueba y dispara el posting — todo en un solo turn

### Otros comandos con imágenes

```
# Adjuntar media a un post existente
Attach image + "Add this image to post ABC123"

# Solo generar captions sin publicar
"Generate captions for post ABC123 for Facebook, Instagram, and LinkedIn"

# Publicar un post que ya está listo
"Approve and publish post ABC123"

# Publicar con dry run (simula sin enviar)
"Approve and publish post ABC123 with dry run"
```

### Formatos de archivo soportados

| Tipo | Extensiones |
|------|-------------|
| Imágenes | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` |
| Videos | `.mp4`, `.mov`, `.webm`, `.avi` |

Puedes adjuntar hasta 3 archivos por mensaje.

---

## Comandos del agente AI (chat natural)

El agente puede hacer todo lo que hace el dashboard web, desde Discord:

### Posts

```
# Ver posts de hoy
Show me today's posts for Daniels Locksmith

# Crear un post
Create a Facebook post for Unlocked Pros about emergency lockout service, publish April 20

# Actualizar un post
Update post ABC123 title to "Spring Lockout Special"

# Cambiar status
Approve post ABC123
Set post ABC123 to ready

# Ver cola de posting
Show the posting queue
```

### Captions

```
# Generar caption para una plataforma
Generate an Instagram caption for post ABC123

# Generar para varias plataformas a la vez
Generate captions for post ABC123 for Facebook, Instagram, and Google Business
```

### Publicar

```
# Publicar un post inmediatamente
Publish post ABC123

# Publicar todos los posts listos
Run bulk posting

# Publicar en modo prueba (no envía realmente)
Publish post ABC123 dry run
```

### Google Business Profile (GBP)

```
# Crear una oferta GBP
Create a GBP offer for Unlocked Pros — 15% off, valid until May 31, CALL CTA, monthly recurrence

# Crear un evento GBP
Create a GBP event for Elite Team Builders — Spring Open House, April 25 10am to 4pm

# Actualizar una oferta
Update offer ABC123 — pause it
```

### Sistema y reportes

```
# Health check
/status  (slash command)

# Ver posts fallidos
/failed

# Estadísticas
Show me a report for April

# Reparar posts fallidos
Fix failed posts for Daniels Locksmith
```

---

## Arquitectura de la subida de imágenes

```
Discord adjunto → bot.js descarga del CDN de Discord
               → POST /internal/discord/upload-asset (bearer auth)
               → Cloudflare Worker sube a R2 MEDIA bucket
               → Retorna r2_key + url pública
               → bot.js inyecta contexto en el mensaje del agente
               → Agente usa attach_asset_to_post + generate_captions + approve_and_publish
```

El endpoint `/internal/discord/upload-asset` está protegido con el mismo `DISCORD_BOT_SECRET` del KV.
