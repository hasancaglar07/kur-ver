# Kurban Platform Geliştirme Task Listesi

## P0 (Başlatıldı)

- [x] Task 1: Planı analiz et ve mevcut kod durumunu çıkar.
- [x] Task 2: Seçili kişilere SMS için backend bulk endpoint (`send-selected`) ekle.
- [x] Task 3: SMS idempotency + retry mekanizmasını endpointlere uygula.
- [x] Task 4: Frontend’de seçili kişi SMS akışını tek backend çağrısına taşı.
- [ ] Task 5: Yeni SMS davranışı için backend testleri ekle ve çalıştır. (Test eklendi, ortamda `pytest` yok)

## P0 (Sıradaki)

- [x] Task 6: İsim eşleşmesi için manuel düzeltme (override) API + UI.
- [x] Task 7: AI isim confidence alanlarını ekle, düşük güvenli isimleri işaretle.
- [x] Task 8: Pipeline’ı Redis tabanlı job queue’ye taşı (thread yerine worker kuyruğu).
- [x] Task 9: Hata izleme/log paneli altyapısı.

## P1 (Planlandı)

- [x] Task 10: Gelişmiş filtreleme (tarih, bölge, NO, kalite, SMS).
- [x] Task 11: SMS gönderim merkezi ve yeniden dene ekranı.
- [x] Task 12: Import kalite kontrolü (E.164, mükerrer/eksik raporu).

## SaaS Genişleme (Yeni)

- [x] Task 13: Superadmin kapsamı için detaylı plan dokümanı oluştur.
- [x] Task 14: User ve Submission modelini profil/lokasyon + title/note alanlarıyla genişlet.
- [x] Task 15: Superadmin operatör yönetimi API (create/list) ekle.
- [x] Task 16: Operator upload lokasyon kuralı + title/note persistence ekle.
- [x] Task 17: Superadmin analitik overview endpointi + admin UI entegrasyonu ekle.
- [x] Task 18: Operator aktif/pasif ve şifre reset akışı.
- [x] Task 19: Operatör bazlı detay analytics sayfası.
- [x] Task 20: Organization (tenant) modeli + org bazlı veri izolasyonu (user/submission/donor/analytics/audit/import/pipeline).
