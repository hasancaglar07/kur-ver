# Kullanıcı Odaklı Geliştirme Planı

## Hedef
KurbanOps panelinde operatör ve yönetim kullanıcılarının işi daha az adımda, daha az hata ile ve daha hızlı tamamlaması.

## Öncelik 1: Akış Netliği ve Güven
- Her kritik ekranda (login, uploader, admin) tek bir sonraki adımı görünür yap.
- Oturum geçersizliğini sessiz hata yerine otomatik yönlendirme ile çöz.
- API hatalarını teknik olmayan, aksiyona dönük mesajlarla göster.

## Öncelik 2: Operatör Verimliliği
- Yükleme formunda adım ilerleme çubuğu ve kalan adım göstergesi kullan.
- NO alanında erken doğrulama ile boş/yanlış gönderimleri azalt.
- Başarılı yükleme sonrası formu bir sonraki kayıt için hızlıca hazırla.

## Öncelik 3: Yönetim Operasyon Hızı
- İnceleme kuyruğuna auto-refresh + manuel yenileme ekle.
- Son güncelleme zamanını görünür tut.
- Filtre kullanımı ve hızlı aksiyonları (Önizle/Detay/SMS) tek satır akışında koru.

## Öncelik 4: Ölçümleme (Bir Sonraki Sprint)
- Event takibi: `login_success`, `upload_init`, `upload_success`, `review_decision`, `sms_send`.
- KPI: yükleme tamamlama süresi, form hata oranı, inceleme kuyruğu bekleme süresi.
- Haftalık rapor: operatör bazlı yükleme kalitesi ve tekrar deneme oranı.

## Öncelik 5: UX Derinleştirme (Bir Sonraki Sprint)
- Rol bazlı kişiselleştirilmiş ana sayfa (operatör: son yüklemeler, yönetim: kritik kuyruk).
- Detay sayfasında karar destek paneli (eşleşme güveni + önerilen aksiyon).
- Mobilde kritik akışlar için sadeleştirilmiş compact görünüm.

## Bu turda tamamlananlar
- API hata mesajları kullanıcı dostu hale getirildi.
- Oturum kontrolü ve kullanıcı/rol etiketi üst kabuğa eklendi.
- Uploader: NO format doğrulaması, ilerleme çubuğu, başarı sonrası hızlı devam akışı eklendi.
- Admin: auto-refresh, manuel yenileme ve son güncelleme bilgisi eklendi.
