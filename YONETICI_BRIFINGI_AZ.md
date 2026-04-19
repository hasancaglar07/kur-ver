# VERENEL KURBAN VİDEO PLATFORMU
## Yönetici Brifingi (A-Z Plan)

### 1) Yönetici Özeti
Verenel Kurban Video Platformu; kurban kesim videolarının sahadan alınması, doğrulanması ve bağışçıya güvenli şekilde ulaştırılması için geliştirilmiş uçtan uca dijital operasyon sistemidir.  
Amaç: Hızı artırmak, hatayı azaltmak, bağışçı memnuniyetini yükseltmek ve süreci kurumsal olarak denetlenebilir hale getirmek.

### 2) Çözülen Temel Problemler
- Manuel takip nedeniyle gecikme
- Yanlış no / yanlış kişi eşleşmesi riski
- Operasyon ekipleri arasında dağınık iletişim
- Standartsız SMS ve link paylaşımı
- Arşiv ve geçmiş kayıt yönetiminde zorluk

### 3) Platformun Üstün Özellikleri
- Rol bazlı operasyon: Operatör / Admin / Süper Admin
- AI destekli doğrulama: OCR + transcript + veritabanı kıyaslaması
- Uyum skoru ve kalite skoru ile karar desteği
- Hata önleme kuralı: Kritik uyumsuzlukta onay engeli
- Kısa ve paylaşılabilir izleme linki üretimi
- Premium, mobil uyumlu izleme sayfası
- SMS gönderim altyapısına hazır akış
- Backblaze B2 ile uzun süreli video arşivleme
- Log ve izlenebilirlik: işlemlerin denetlenebilir olması

### 4) Uçtan Uca İş Akışı
1. Operatör videoyu yükler, temel bilgileri girer.
2. Sistem AI analizini çalıştırır.
3. Admin panelinde AI-DB uyum kontrolü görüntülenir.
4. Hata varsa admin düzeltir (özellikle no ve eşleşme alanları).
5. Kayıt onaylanır, kısa izleme linki üretilir.
6. SMS içeriği link ile hazırlanır ve gönderime alınır.
7. Bağışçı videoyu mobil/web üzerinden izler.
8. Video arşivde güvenli şekilde saklanır.

### 5) Rol ve Yetki Matrisi
#### Operatör
- Video yükleme
- İlk bilgi girişi
- Kayıt oluşturma

#### Admin
- Kayıt inceleme
- No/ad-soyad düzeltme
- Onay verme
- SMS önizleme ve gönderim başlatma

#### Süper Admin
- Kullanıcı ve rol yönetimi
- Sistem ayarları
- Operasyon ve kalite metriklerinin takibi
- Denetim/log kontrolü

### 6) AI Kontrol Modeli (Basit Anlatım)
- Sistem videodan metin/konuşma sinyali çıkarır.
- Bu verileri mevcut donor kayıtlarıyla karşılaştırır.
- Sonuçta 3 ana çıktı üretir:
  - AI kalite skoru
  - AI-DB uyum skoru
  - Eşleşen aday sayısı
- Bu skorlar, adminin onay kararını hızlandırır.

### 7) Hata Yönetimi Politikası
- No farklıysa uyarı zorunlu gösterilir.
- Kritik uyumsuzlukta direkt onay önerilmez.
- Admin düzeltmeden gönderim yapılmaz.
- Amaç: yanlış kişiye video teslim riskini minimize etmek.

### 8) Bağışçı Deneyimi
- Kısa, temiz ve güven veren URL
- WhatsApp/SMS paylaşımına uygun yapı
- Hızlı açılan, premium izleme sayfası
- Marka görünürlüğü (logo, OG image, favicon)

### 9) Altyapı ve Arşiv
- Video saklama: Backblaze B2
- Uzun dönem arşiv hedeflerine uygun maliyet/ölçek
- API üzerinden güvenli erişim linki üretimi
- Yüksek trafik dönemlerinde ölçeklenebilir mimari

### 10) Operasyonel KPI Önerileri
- Video teslim süresi (yüklemeden SMS’e)
- İlk seferde doğru eşleşme oranı
- Admin düzeltme ihtiyacı oranı
- Hatalı gönderim oranı
- Bağışçı izleme/erişim oranı
- SMS teslim ve tıklama oranı

### 11) Kurumsal Kazanımlar
- Daha hızlı ve standart operasyon
- Daha düşük hata maliyeti
- Daha yüksek bağışçı güveni
- Daha güçlü kurumsal itibar
- Denetlenebilir, raporlanabilir süreç yönetimi

### 12) Yol Haritası (Aşamalandırılmış)
#### Faz 1 - Stabilizasyon
- No doğrulama uyarılarının netleştirilmesi
- Admin onay kurallarının güçlendirilmesi
- SMS şablon standardizasyonu

#### Faz 2 - Ölçekleme
- Operasyon panelinde ileri raporlama
- Kullanıcı bazlı performans metrikleri
- Toplu işlem hız optimizasyonları

#### Faz 3 - Kurumsal Genişleme
- Gelişmiş dashboard ve yönetici ekranları
- Bölgesel operasyon karşılaştırmaları
- Süreç zekası ve tahminleme (AI destekli)

### 13) Sonuç Cümlesi (Yönetici Sunumu İçin)
Bu platform, kurban video teslim sürecini manuel ve riskli yapıdan çıkarıp; AI destekli, hız odaklı, denetlenebilir ve kurumsal ölçekte güven üreten bir dijital operasyon modeline dönüştürmektedir.

---

## Hızlı Paylaşım Metni (Mail/WhatsApp)
Verenel Kurban Video Platformu; operatörden admin onayına, kısa güvenli link üretiminden SMS teslimine kadar tüm kurban video sürecini tek sistemde yönetir. AI destekli kontrol katmanı sayesinde yanlış eşleşme riskini azaltır, admin düzeltme adımlarını netleştirir ve bağışçıya premium bir izleme deneyimi sunar. Backblaze B2 arşiv yapısıyla uzun dönem saklama hedeflerini destekler. Sonuç olarak operasyon hızlanır, hata maliyeti düşer, bağışçı güveni artar.
