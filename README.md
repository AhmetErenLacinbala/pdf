# Kâğıt PDF Editor

Tamamen tarayıcıda çalışan Vite + React PDF düzenleyici. PDF dosyaları sunucuya gönderilmez.

## Yerel geliştirme

```bash
npm ci
npm run dev
```

## VPS kurulumu

GitHub Actions, `main` dalına yapılan her push sonrasında çoklu mimari Docker imajını
`ghcr.io/<kullanıcı>/<repo>:latest` adresine gönderir. VPS'teki Watchtower bu etiketi
izleyerek uygulamayı otomatik günceller.

1. `.env.example` dosyasını VPS'te `.env` adıyla kopyalayın.
2. `IMAGE_NAME`, `DOMAIN` ve mevcut Traefik/Watchtower değerlerini düzenleyin.
3. Traefik ağının mevcut olduğunu doğrulayın: `docker network inspect proxy`.
4. İlk kurulumu başlatın: `docker compose up -d`.

GHCR paketi private ise VPS'te `read:packages` yetkili bir token ile bir kez giriş yapın:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u GITHUB_KULLANICI_ADI --password-stdin
docker compose pull
docker compose up -d
```

Mevcut Watchtower servisiniz `--label-enable` kullanıyorsa uygulama hazırdır; compose
dosyasındaki `com.centurylinklabs.watchtower.enable=true` etiketi eklenmiştir. Watchtower
scope kullanıyorsa `.env` içindeki `WATCHTOWER_SCOPE` değeri mevcut instance ile aynı olmalıdır.
Private GHCR imajları için Watchtower'ın Docker giriş bilgilerini içeren `config.json`
dosyasına erişimi olmalıdır.
