# Kurulum (Diger Projeyi Bozmadan)

Bu repo icin ayri compose dosyalari hazirlandi:
- `docker-compose.dokploy.yml` (Dokploy import icin)
- `docker-compose.server.yml` (dogrudan sunucuda docker compose icin)

## 1) Dokploy'da yeni uygulama olustur (opsiyonel)
- App name: `kurban-prod`
- Source: bu repo
- Compose file: `docker-compose.dokploy.yml`

## 1B) Sunucuda dogrudan calistirma (kullanilan yol)
- `/opt/kurban` dizininde:
- `docker compose --env-file .env.prod -f docker-compose.server.yml up -d --build`

## 2) Domainleri ayir
- `frontend` servisi: `kurban.verenel.com.tr`
- `backend` servisi: `api.verenel.com.tr`

Bu yapi ile mevcut uygulama/domain'lere dokunulmaz.

## 3) Environment variables gir
Degerleri `.env.dokploy.example` dosyasina gore Dokploy UI'dan ekle:
- `SECRET_KEY` (zorunlu)
- `SIGNED_URL_SECRET` (zorunlu)
- `PUBLIC_WATCH_BASE_URL` = `https://api.verenel.com.tr`
- `NEXT_PUBLIC_API_BASE` = `https://api.verenel.com.tr/api`
- `STORAGE_PROVIDER` = `local` veya `b2`
- B2 kullanilacaksa:
  - `B2_ENDPOINT_URL`
  - `B2_REGION`
  - `B2_ACCESS_KEY_ID`
  - `B2_SECRET_ACCESS_KEY`
  - `B2_BUCKET`
  - `B2_RAW_PREFIX`
  - `B2_PROCESSED_PREFIX`
  - `B2_WATCH_URL_TTL_SECONDS`
  - `B2_ARCHIVE_YEARS` (varsayilan 5)
  - `B2_OBJECT_LOCK_ENABLED` / `B2_OBJECT_LOCK_MODE` (opsiyonel)
- AI keyleri (opsiyonel ama gercek analiz icin gerekli)

## 4) Deploy et
- Dokploy kullaniyorsan deploy tetikle.
- Dogrudan sunucuda ise `docker compose ... up -d --build` calistir.
- `frontend`, `backend`, `backend-worker`, `redis` servislerinin hepsi `running` olmali.

## 5) Neden diger proje etkilenmez?
- Compose proje adi ayri: `kurban-prod`
- Host port publish yok (sadece reverse proxy/domain uzerinden yayin)
- Volume adlari ayri: `kurban_data`, `kurban_redis`

## Notlar
- `docker-compose.server.yml` yolunda DB dosyasi bind mount ile calisir:
  - Yerel `backend/kurban.db` deploy edilince sunucuda da ayni dosya kullanilir.
- Frontend API adresi build aninda `NEXT_PUBLIC_API_BASE` ile sabitlenir.
