# Verenel Kurban Video Platformu - Yönetici Sunumu

Bu belge, Verenel Kurban Video Platformu'nun operasyonel ve teknolojik özelliklerini anlatan 10 slaytlık bir A-Z sunum planıdır.

---

## Slayt 1: Başlık & Vizyon
**Başlık:** Verenel Kurban Video Platformu
**Alt Başlık:** Sahadan Bağışçıya Uzanan, Akıllı, Güvenli ve Hızlı Dijital Teslim Sistemi.

**Ekrandaki Görsel/İçerik:**
* Platformun logosu ve modern, güven veren bir dijital arayüz görseli veya kurban organizasyonundan samimi ama kurumsal bir kare.

**Konuşma Notu:**
"Değerli yönetim kurulu üyeleri ve yöneticilerim, bugün sizlere kurban organizasyonlarındaki en kritik süreçlerden biri olan 'video teslim operasyonunu' baştan sona değiştiren, kurumsal ölçekte bir çözüm sunuyoruz. Bu platform sadece videoları ileten bir araç değil; hızla çalışan, hataları yapay zeka ile önleyen ve bağışçı tarafında maksimum güven oluşturan uçtan uca dijital bir yönetim sistemidir."

---

## Slayt 2: Mevcut Sürecin Zorlukları (Problem)
**Başlık:** Neden Yeni Bir Sisteme İhtiyacımız Var?

**Maddeler:**
* Manuel Whatsapp ve liste takibinin getirdiği yavaşlık ve kaos.
* Yanlış numara veya yanlış bağışçı eşleşmesi riski.
* Operasyon sahası ile merkez yönetim arasındaki iletişimsizlik.
* Güven vermeyen, standart dışı SMS ve video izleme süreçleri.
* Uzun vadeli, güvenli ve izlenebilir bir video arşivinin olmaması.

**Konuşma Notu:**
"Mevcut manuel süreçlerimiz, özellikle yoğun kurban operasyonlarında ciddi riskler taşıyor. WhatsApp grupları üzerinden veya excel listeleriyle yapılan takipler hem yavaş hem de karmaşık. En kötüsü de yanlış videonun yanlış bağışçıya gitme ihtimali kurum itibarımızı zedeleyecek en büyük risklerden biri. Bu kaosu merkezi, ölçülebilir bir sisteme taşımamız şart."

---

## Slayt 3: Çözümümüz ve Temel Mimari
**Başlık:** Çözüm: Uçtan Uca Dijital Akış

**Maddeler:**
* **Operatör:** Sahada videoyu yükler ve ilk veriyi girer.
* **Sistem (AI):** Otomatik yapay zeka doğrulama katmanını çalıştırır.
* **Admin:** Uyum skoruna bakar, düzeltme yapar ve onaylar.
* **Teslimat:** SMS otomatik hazırlandıktan sonra bağışçı videoya kısa linkle erişir.

**Konuşma Notu:**
"Peki biz ne öneriyoruz? Tamamen rol bazlı, sınırları net çizilmiş bir iş akışı. Sahadaki operatör sadece videoyu yükler ve temel bilgiyi girer. Sistemimiz arkada AI kontrollerini yapar, merkezdeki admin önüne kalite skorlarıyla düşürür. Admin onayladığı an, hazır şablonlarla SMS tetiklenir. Tek platform, üç net adım: Yükle, doğrula, teslim et."

---

## Slayt 4: Sistemin Güç Merkezi: AI Destekli Doğrulama
**Başlık:** Yapay Zeka (AI) Doğrulama Katmanı

**Maddeler:**
* **OCR:** Videodaki tabelalardan ve görsel metinlerden yazı okunur.
* **Transcript:** Videodaki konuşmalar metne dökülür ve analiz edilir.
* **Eşleşme:** Bu AI verileri, kendi veritabanımızdaki (DB) bağışçı kayıtlarıyla kıyaslanır.
* **Çıktılar:** AI-DB Uyum Skoru, Kalite Skoru ve Eşleşen Aday listesi.

**Konuşma Notu:**
"Bu platformu standart bir web sisteminden ayıran en büyük özellik Yapay Zeka entegrasyonudur. Sistemimiz, operatör yükleme yaptığı an devreye giriyor. Videodaki yazıları (tabela, kağıt) okuyor, konuşmaları metne döküyor ve anında kendi bağışçı kayıtlarımızla eşleştiriyor. İnsan gözünden kaçabilecek veya yoğunlukta atlanabilecek detaylar, 'Uyum Skoru' ile onay ekranına yansıyarak admine güçlü bir karar desteği sağlıyor."

---

## Slayt 5: Hata Önleme: Sıfır Tolerans Politikası
**Başlık:** "Numara Yanlışsa Onay Yok" İlkesi

**Maddeler:**
* Operatör hatalı bölge/numara girerse zorunlu uyarı mekanizması çalışır.
* Yapay Zeka isim-numara tutarsızlığı tespit ederse kritik uyarı çıkarır.
* Admin bu uyarıyı dikkate alıp düzeltme yapmadan "Onay" aksiyonunu ilerletemez.
* Amaç: Yanlış kişiye yanlış video teslim riskini minimize etmek.

**Konuşma Notu:**
"En çok korktuğumuz şey yanlış videonun teslimidir. Biz bu ihtimali sistemsel olarak engelliyoruz. Eğer girilen kurban numarası ile isim eşleşmiyorsa veya bölge yanlışsa, sistem kırmızı alarmlar üretiyor. Admin bu hatayı inceleyip, düzeltmeden kesinlikle 'Onay Ver' butonuna basamıyor. Yani hatalı içerik operasyon barajına takılıyor, dışarı çıkamıyor."

---

## Slayt 6: Rol Bazlı Yetki Yönetimi
**Başlık:** Güvenlik ve Disiplin: Kim Ne Yapabilir?

**Maddeler:**
* **Operatör:** Sadece video yükleyebilir, yeni kayıt oluşturabilir (veri girişi).
* **Admin:** Gelen kayıtları inceler, tutarsızlığı düzeltir, onaylar ve SMS sürecini başlatır.
* **Süper Admin:** Kullanıcı yetkilerini belirler, sistem kurallarını koyar ve tüm operasyonel logları/raporları denetler.

**Konuşma Notu:**
"Kurumsal operasyon disiplini gerektirir. Sistemde karmaşaya yer yok. Operatör yüklemeyi yapar, başka bir şeye karışamaz. Admin kontrolünü yapıp onaylamaktan sorumludur, yanlışlıkları o düzeltir. Süper Admin ise tüm operasyonun tepeden yöneticisidir, yetkileri belirler ve logları, yani kimin ne zaman, hangi işlemi yaptığını detaylıca takip eder."

---

## Slayt 7: Eşsiz Bağışçı Deneyimi
**Başlık:** Premium İzleme ve SMS Teslimatı

**Maddeler:**
* Kurumsal standartlara uyan otomatik, anında SMS gönderimi.
* Uzun karmaşık linkler yerine, güven veren, paylaşmaya uygun, kısa URL yapısı.
* Hızlı açılan, mobil ve masaüstü uyumlu, temiz izleme sayfası.
* Marka kimliğini güçlendiren detaylar: Özel logo, OG(sosyal medya) görseli ve favicon.

**Konuşma Notu:**
"İşin bağışçı tarafında ise bambaşka bir deneyim sunuyoruz. Artık bağışçının önüne uzun, karmaşık, güvensiz görünen linkler gitmiyor. Açtığında kurumsal kimliğimizi yansıtan, hem telefonda hem bilgisayarda çok şık duran premium bir video sayfasına ulaşıyor. Tıkladığında hızlıca açılıyor ve isterse bu gururu ailesiyle Whatsapp'tan anında paylaşabiliyor. O anki tatmin, sonraki bağış kararlarının en büyük anahtarıdır."

---

## Slayt 8: Uzun Süreli ve Uygun Maliyetli Arşiv
**Başlık:** Mevsimlik Değil, Kalıcı Sistem: Backblaze B2

**Maddeler:**
* Videoların ölçeklenebilir ve güvenli Backblaze B2 altyapısında saklanması.
* Kurumumuzun uzun dönemli arşiv politikalarına yüksek uyumluluk.
* Uzun vadede diğer depolama çözümlerinden çok daha uygun maliyet.
* Yüksek trafik durumunda dahi çökmeden çalışan kesintisiz erişim (API mimarisi).

**Konuşma Notu:**
"Videoların sonradan kaybolması, silinmesi veya ulaşılamaması büyük bir derttir. Altyapımızı Backblaze B2 üzerine konumlandırdık. Bu bize ne sağlıyor? Çok uygun maliyetle devasa veri yüklerini yıllarca güvenle saklamamızı sağlıyor. Kurban bayramındaki o büyük anlık yoğunluklarda bile sistemimiz çökmeden hizmet verebilecek."

---

## Slayt 9: Denetlenebilirlik ve Canlı Operasyon
**Başlık:** Ölçülebilirlik & Süreklilik

**Maddeler:**
* **Metrikler:** Ortalama teslim süresi, onay başarı oranı, admin müdahale sıklığı.
* **Denetim:** Platform üzerindeki her hareket (log) kayıt altındadır, geçmişe dönük izlenebilir.
* **Süreklilik:** Kampanya devam ederken bile sistemi durdurmadan yeni güncellemelerin güvenle uygulanabilmesi.

**Konuşma Notu:**
"Yöneticiler olarak neyi yanlış yaptığımızı operasyon anında görebilmeliyiz. Platform bize bu ölçülebilirliği veriyor. Gelen videoların yüzde kaçı ilk seferde doğru çıkmış, ortalama teslimatımız kaç dakikaya düşmüş, hepsini raporlayabileceğiz. Ayrıca bu sistemi kurup bırakmıyoruz; kesintisiz yayın mimarisi sayesinde süreç işlerken, durdurmadan iyileştirmeler yapabileceğiz."

---

## Slayt 10: Kapanış ve Hedefimiz
**Başlık:** Sonuca Doğru: Operasyonu Hızlandır, Güveni Büyüt

**Maddeler:**
* Kaos yerine standart işleyiş, hata yerine AI doğrulaması.
* Operasyon zamanından büyük oranda tasarruf.
* Bağışçı nazarında yüksek kurumsal güven algısı.
* Ölçeklenebilirlik, profesyonellik ve uzun ömürlü altyapı.

**Konuşma Notu:**
"Sonuç olarak, karşımızda duran yapı teknik bir yazılımdan ibaret değil. Bu, sahadaki emeğin ziyan olmamasını sağlayan, insan hatasını yapay zeka ile perdeleyen, bağışçı ile aramızdaki güven bağını premium bir sunumla pekiştiren büyük bir operasyonel yönetim modelidir. Verenel Kurban Video Platformu ile süreci hatadan arındırıp yüksek performansa ulaştırıyoruz. Vakit ayırdığınız için teşekkür ederim."
