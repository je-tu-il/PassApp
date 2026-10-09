# Proxy d'anonymisation de favicons (Raspberry Pi 5)

Ce composant auto-hébergé permet à PassApp de récupérer les icônes de sites sans jamais exposer l'adresse IP publique de votre ordinateur ou téléphone auprès des serveurs tiers.

## Déploiement

1. Copiez ce dossier sur votre Raspberry Pi 5 :
   ```bash
   scp -r deploy/proxy pi@raspberrypi.local:~/passapp-proxy
   ```
2. Placez vos certificats TLS dans `certs/` (`fullchain.pem` et `privkey.pem`).
3. Démarrez le service :
   ```bash
   docker compose up -d
   ```

## Test

```bash
curl -k "https://localhost:8443/favicon?domain=github.com" -o github.ico
```
