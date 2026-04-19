# Agent Çalışma Kuralları

## 1) Build/Test Politikası
- Her kod değişikliğinden sonra **otomatik build alma**.
- Build, test, lint gibi kontrolleri **yalnızca kullanıcı açıkça isterse** çalıştır.
- Kullanıcı "hata var" veya "kontrol et" derse ilgili komutu o zaman çalıştır.

## 2) İletişim
- Cevaplar Türkçe olacak.
- Gereksiz uzun açıklama yapma; kısa ve net yaz.
- Değişiklikten önce ne yapacağını 1-2 cümleyle belirt.

## 3) Uygulama Akışı
- Önce istenen değişikliği uygula.
- Doğrulama komutlarını varsayılan olarak atla.
- Kullanıcı isterse doğrulama adımını ayrıca çalıştır.

## 4) Güvenli Değişiklik
- Kullanıcının açık isteği olmadan dosya silme, resetleme, geri alma yapma.
- Mevcut davranışı bozabilecek büyük refactor yerine hedefe yönelik minimal değişiklik yap.
