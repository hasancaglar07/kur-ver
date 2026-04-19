# Kurban Platform — UX/UI Geliştirme Planı

## Mevcut Durum Özeti

Platform işlevsel ancak görsel olarak düz, kişiliksiz ve kullanıcı güvenini tam olarak inşa edemiyor.
Tüm sayfalar aynı beyaz kart / gri border / siyah buton kombinasyonuyla yapılmış.
Hiyerarşi zayıf, sayfalar arası geçişlerde tutarsızlıklar var.

---

## Kritik UX Sorunları (Öncelik Sırası)

### 🔴 Öncelik 1 — Kullanıcı Güveni & Okunabilirlik

1. **Sidebar Navigation — Görsel Hiyerarşi Yok**
   - "Öncelikli" / "Diğer" ayrımı metin olarak var ama görsel olarak hissedilmiyor
   - Aktif sayfa belirteci çok soluk: sadece hafif gri arka plan, yetersiz
   - Sidebar logo alanı çok büyük yer kaplıyor (min-height: 96px), kullanışlı nav alanını çalıyor
   - **Çözüm:** Aktif item'a belirgin sol border (3px primary renk) + hafif primer renk bg

2. **Topbar — Bilgi Hiyerarşisi Eksik**
   - "Çalışma Alanı" + sayfa adı küçük ve soluk; kullanıcı nerede olduğunu kaybedebiliyor
   - Kullanıcı adı sadece md+ ekranda görünüyor, mobilde kaybolıyor
   - Logout butonu siyah ve baskın; diğer aksiyonlarla çakışıyor
   - **Çözüm:** Breadcrumb-tarzı sayfa başlığı, kullanıcı avatarı/monogram

3. **Login Sayfası — Rol Seçimi Anlaşılmazlık**
   - 3 preset kartı eşit ağırlıkta görünüyor; operatör en çok kullanan rol ama öne çıkmıyor
   - "SEÇİLİ" text badge sağda küçük; seçim durumu yeterince baskın değil
   - Klavye kısayolları hint metin çok küçük (13px) ve soluk renk
   - Şifre alanında "show/hide" toggle yok
   - **Çözüm:** Seçili karta tam-renkli border + solid indicator; şifre toggle

4. **Uploader — Form Akışı**
   - "Adım 01 / 02" numaraları var ama görsel step indicator (progress bar veya step dots) yok
   - File input browser-default görünümde; kurumsal bir platformda tutarsız
   - Dosya seçilince sadece metin çıkıyor; önizleme veya güçlü görsel feedback yok
   - Submit butonu her zaman mevcut ama disabled halde neden disabled olduğu yazılmıyor
   - **Çözüm:** Custom file upload zone (drag & drop alan), adım progress indicator

5. **Home / Dashboard — Düşük Bilgi Yoğunluğu**
   - "Merhaba X" başlığı iyi ama altındaki kart grid düz ve generik
   - Son 5 işlem listesi her satır eşit ağırlıkta; başarılı vs hatalı renk ayrımı yok
   - Workflow steps (3 kart) statik ve decorative; kullanıcıya aksiyon sunmuyor
   - Ops istatistikleri (kuyruk/hata sayısı) küçük badge'de kaybolmuş
   - **Çözüm:** Stats mini-dashboard, son işlemlerde renk kodlaması

### 🟡 Öncelik 2 — Görsel Tutarlılık

6. **Renk Tutarsızlığı**
   - #111111, #1A1E20, #202427, #2F3437, #3C4144 — hepsi "koyu metin" için kullanılıyor
   - Badge font-size: 16px, 7px/13px padding → saas-badge çok büyük ve ağır
   - info/success/warn/error badge'ler renk körü için sadece renge güveniyor
   - **Çözüm:** Renk tokenları CSS variable'larına indirilmeli; badge boyutları normalize

7. **Typography Hiyerarşisi**
   - H1/H2/H3 boyutları sayfa bazında tutarsız
   - Stats page'de H2 = "text-sm font-semibold uppercase" → çok küçük section başlığı
   - Uploader'da section heading "text-[16px] font-semibold" vs home'da "text-lg"
   - **Çözüm:** Tip scale standartlaştırılmalı

8. **Border Radius Karışıklığı**
   - rounded-[8px], rounded-[10px], rounded-[12px], rounded-[14px], rounded-[16px] hepsi aynı sayfada
   - **Çözüm:** 3 boyut standardı: sm=6px, md=10px, lg=14px

9. **Boşluk (Spacing) Tutarsızlığı**
   - p-4/p-5/p-6/p-8 kart padding'leri tutarsız
   - space-y-4 vs space-y-6 vs space-y-8 section aralıkları karışık

### 🟢 Öncelik 3 — Kullanıcı Deneyimi İyileştirmeleri

10. **Skeleton Loading Eksikliği**
    - Tüm sayfalarda veri yüklenirken ekran boş; layout jump var
    - Home page "Kullanıcı verisi okunuyor" spinner küçük ve belirsiz
    - Stats page hiç loading state yok
    - **Çözüm:** Skeleton screen component'ları

11. **Admin Queue — Tablo Okunabilirliği**
    - Her satırda çok fazla badge (status + quality + risk + SMS state)
    - Renk yoğunluğu dikkat dağıtıcı; önemli olan satır kaybolabiliyor
    - **Çözüm:** Badge önceliklendirme; primary status öne, secondary fold

12. **Mobil Deneyim**
    - Mobile hamburger açılınca nav dropdown şeklinde topbar'ın altına açılıyor — drawer animation yok
    - Sidebar mobile'da tamamen kaybolıyor, alt nav bar alternatifi yok
    - Touch target boyutları yetersiz (bazı butonlar 28-32px height)

13. **Empty States**
    - "Başarısız kayıt bulunamadı" gibi boş durumlar plain metin
    - İkon ve yönlendirici CTA eksik

14. **Focus States**
    - Input focus: sadece border rengi değişiyor, ring çok soluk
    - Keyboard navigation için visible focus ring daha belirgin olmalı

---

## Uygulama Planı

### Aşama 1: Temel Tutarlılık (globals.css)
- [ ] CSS token standardizasyonu (renk, radius, spacing)
- [ ] Badge boyutlarını küçült (compact badge variant)
- [ ] Skeleton animation class ekle

### Aşama 2: Navigation & Layout
- [ ] Sidebar aktif item: sol border + primer bg
- [ ] Topbar: breadcrumb + kullanıcı monogram avatar
- [ ] Mobile: smooth drawer açılış animasyonu

### Aşama 3: Login Sayfası
- [ ] Seçili rol kart: daha baskın visual treatment
- [ ] Şifre toggle butonu
- [ ] Klavye hint daha okunaklı

### Aşama 4: Uploader Sayfası
- [ ] Custom drag & drop file zone
- [ ] Step progress indicator (3 adım)
- [ ] File seçimi görsel feedback iyileştirme
- [ ] Disabled submit butonu neden disabled açıklama

### Aşama 5: Home Dashboard
- [ ] Stats satırı (kuyruk, hata, toplam) daha prominent
- [ ] Son işlemler: renk kodlaması (başarılı yeşil, hata kırmızı)
- [ ] Workflow adımları daha dinamik

### Aşama 6: Admin Stats
- [ ] MetricCard daha büyük trend indicator
- [ ] Tablolarda satır hover belirginleştirme
- [ ] Section spacing artırma

### Aşama 7: Empty States & Loading
- [ ] Skeleton component
- [ ] Empty state component (ikon + mesaj + CTA)

---

## Değiştirilmeyecek Şeyler (İyi Çalışıyor)
- OKLCH renk sistemi temeli — sağlam
- Outfit + JetBrains Mono font çifti — iyi
- Genel light theme — operasyon ortamı için doğru
- Keyboard navigation (J/K/1-2-3) — korunmalı
- Toast notification sistemi — iyi çalışıyor
- Responsive grid yapısı — temel sağlam
