# Kurban Platformu SaaS Geliştirme Planı (Superadmin + Operator + Analytics)

## 1) Ürün Vizyonu

Bu platform; çoklu ekip/operatörle çalışan kurumların kurban kesim video operasyonunu ölçeklenebilir, denetlenebilir ve ölçülebilir hale getiren bir SaaS ürünüdür.

Ana hedefler:
- Superadmin operatör hesaplarını açar, yetki ve lokasyon atar.
- Operatör sadece atanmış lokasyon kapsamında giriş yapar ve video yükler.
- Her yükleme başlık/not ile kayıt altına alınır.
- Superadmin tüm yüklemeleri, AI başarı oranlarını, süre/kalite metriklerini ve kişi bazlı performansı izler.

## 2) Rol Modeli

- `super_admin`
  - Operatör oluşturma, aktif/pasif etme, lokasyon atama.
  - Tüm video ve performans analitiklerine erişim.
- `admin`
  - Mevcut review/SMS operasyon ekranları.
- `operator`
  - Sadece kendi hesabı ve atanmış lokasyonda upload.

## 3) Veri Modeli Genişletmesi

### User
- `first_name`, `last_name`
- `country`, `city`, `region` (atanmış operasyon lokasyonu)
- `created_by_user_id` (hesabı açan superadmin)

### VideoSubmission
- `title` (video başlığı)
- `note` (operatör notu)

## 4) API Yol Haritası

### 4.1 Superadmin Operator Yönetimi
- `POST /api/superadmin/operators`
  - Operatör hesabı oluşturur.
  - Girdi: ad/soyad, username, password, country/city/region.
- `GET /api/superadmin/operators`
  - Tüm operatörleri listeler.

### 4.2 Upload Akışı
- `POST /api/uploads/init`
  - Mevcut alana ek: `title`, `note`.
  - Operator için lokasyon doğrulama:
    - payload lokasyonu, kullanıcı atanmış lokasyonu ile aynı olmalı.

### 4.3 Superadmin Analytics
- `GET /api/superadmin/analytics/overview`
  - Toplam operator, toplam upload, AI başarı/başarısız oranı, ortalama süre/kalite.
  - Operatör bazlı upload sayısı, ortalama kalite/süre, review_ready ve failed kırılımı.

## 5) Frontend Yol Haritası

### 5.1 Uploader
- `title` ve `note` alanları.
- `getMe()` ile operatör lokasyonunu otomatik doldurma.
- Operatör için lokasyon alanlarını kilitleme.

### 5.2 Superadmin Paneli
- Operatör oluşturma formu.
- Operatör listesi.
- Analytics kartları ve operatör performans tablosu.

## 6) Güvenlik ve Operasyon

- `super_admin` dışındaki roller superadmin endpointlerine erişemez.
- Lokasyon doğrulama backend tarafında zorunlu.
- Audit:
  - `operator_created`
  - `operator_updated` (ileri faz)
  - `analytics_viewed` (opsiyonel)

## 7) Test Planı

- Unit:
  - Operator lokasyon doğrulama.
  - Analytics hesap fonksiyonları.
- API:
  - Superadmin operator create/list.
  - Operator upload init (doğru/yanlış lokasyon).
  - Upload başlık/not persistence.
- UI:
  - Uploader’da title/note gönderimi.
  - Superadmin panelinde operator ve analytics görüntüleme.

## 8) Uygulama Sırası (Adım Adım)

1. DB ve schema genişletme (User + VideoSubmission yeni alanlar).
2. Superadmin operator yönetim API’leri.
3. Upload init’e title/note + lokasyon kuralı.
4. Superadmin analytics API.
5. Uploader UI (title/note + lokasyon kilidi).
6. Admin/Superadmin UI (operator + analytics kartları).
7. Test ve iyileştirme.

## 9) Sonraki Faz (SaaS Satış Hazırlığı)

- Tenant (kurum) modeli ve abonelik paketleri.
- RBAC detaylandırma (izin matrisi).
- API rate limit + güvenlik hardening.
- Billing, sözleşme yönetimi, SLA raporları.
- Çoklu dil + çoklu ülke saat dilimi desteği.
