# n8n-nodes-sip

[![Node.js Package](https://github.com/exaland/n8n-nodes-sip/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/exaland/n8n-nodes-sip/actions/workflows/npm-publish.yml)

[![Docker](https://github.com/exaland/n8n-nodes-sip/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/exaland/n8n-nodes-sip/actions/workflows/docker-publish.yml)

Module communautaire n8n pour déclencher des appels SIP via un **SIP worker HTTP**.

Ce package contient :

- un node n8n `SIP Call` ;
- des credentials `SIP Worker API` ;
- un worker Express d'exemple ;
- des points `Make Call`, `Hang Up`, `Send DTMF`, `Get Status`.

> SIP.js fonctionne principalement avec SIP over WebSocket et WebRTC. Pour n8n, il est préférable de garder n8n comme orchestrateur et de gérer SIP/WebRTC dans un service séparé.

## Installation locale

```bash
npm install
npm run build
```

Dans n8n self-hosted, installe le package comme community node ou copie-le dans le dossier custom nodes selon ton déploiement.

## Lancer le worker d'exemple

```bash
cd worker
npm install
SIP_WORKER_API_KEY=secret npm run dev
```

Puis dans n8n :

- Worker Base URL: `http://localhost:3008`
- API Key: `secret`

## Endpoints du worker

```http
POST /calls
GET /calls/:callId
POST /calls/:callId/hangup
POST /calls/:callId/dtmf
```

## Prochaine étape pour appels réels

Dans `worker/src/server.ts`, remplacer la simulation par SIP.js :

1. créer un `UserAgent` SIP.js ;
2. se connecter au serveur WSS du PBX/provider ;
3. créer un `Inviter` pour l'appel sortant ;
4. connecter les événements SIP.js aux statuts `ringing`, `answered`, `completed`, `failed` ;
5. gérer l'audio avec WebRTC ou déléguer l'audio à une passerelle SIP/RTP adaptée au serveur.

## Exemple workflow n8n

1. Trigger manuel ou webhook
2. Node `SIP Call` → `Make Call`
3. Node `Wait`
4. Node `SIP Call` → `Get Status`
