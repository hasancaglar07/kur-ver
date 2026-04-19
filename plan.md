\# Kurban Video Doğrulama ve SMS Dağıtım Platformu — Uçtan Uca Uygulama Planı (MVP+)



&#x20; ## Özet



&#x20; - Bu plan, Surec.md içindeki hedefi üretime alınabilir hale getirir: kesim videosu yükleme, AI ile isim/numara

&#x20;   doğrulama, admin onayı, SMS ile kişiye özel video linki gönderimi.

&#x20; - Örnek DB (db.xlsx) yapısına göre süreç NO grup mantığıyla tasarlanır: NO, ÜLKE, İL, BÖLGE, AD, SOYAD, TEL. Örnek

&#x20;   veri 70 kayıt ve her NO için 7 kişi içeriyor.

&#x20; - Örnek video (WhatsApp Video 2026-04-18 at 17.14.15.mp4) teknik olarak ses+görüntü içeriyor; MVP kuralı yine de 1–3

&#x20;   dakika yükleme olacak.

&#x20; - Seçilen kararlar: Cloud, Backblaze + Signed URL, Admin onaylı yarı-otomatik, Exact + Fuzzy fallback, NO bazlı

&#x20;   tekilleştirilmiş SMS, Türkçe öncelikli, Next.js + FastAPI, SMS provider adapter, Süresiz saklama.



&#x20; ## Uygulama Planı (Mimari + İş Akışı)



&#x20; 1. Sistem bileşenleri kurulacak: Next.js (uploader + admin panel), FastAPI (REST API), PostgreSQL (operasyonel

&#x20;    veri), Redis + worker (asenkron pipeline), Backblaze B2 (video storage), Cloud AI API (STT+OCR+metin çıkarımı).

&#x20; 2. Rol modeli uygulanacak: Saha Operatörü (yükleme), Admin (inceleme/SMS), Süper Admin (kullanıcı, ayar, audit

&#x20;    erişimi).

&#x20; 3. Kimlik doğrulama id/pass ile başlayacak, JWT access + refresh kullanılacak, brute-force koruması ve oturum

&#x20;    denetimi eklenecek.

&#x20; 4. DB import modülü geliştirilecek: xlsx/csv import, şema doğrulama, satır bazlı hata raporu, tekrar importta

&#x20;    upsert.

&#x20; 5. Upload akışı tasarlanacak: kullanıcı ÜLKE, İL, BÖLGE, NO girer, 1–3 dk video seçer, sistem dosya formatı/uzunluk/

&#x20;    bitrate temel kontrolü yapar.

&#x20; 6. Video işleme pipeline’ı queue tabanlı çalışacak: upload -> intro prepend -> normalize encode -> AI analiz ->

&#x20;    eşleştirme -> kalite puanı -> review-ready.

&#x20; 7. Intro ekleme kuralı sabit olacak: başa tek bir “hazır intro” varlık dosyası prepend edilir, versiyonlanır, hangi

&#x20;    intro’nun kullanıldığı submission’a yazılır.

&#x20; 8. AI analiz adımları uygulanacak: ses yazımı (Türkçe), karelerden OCR, konuşmadan olası NO ve AD SOYAD varlık

&#x20;    çıkarımı, confidence değerleri.

&#x20; 9. Eşleştirme motoru uygulanacak: önce exact, sonra Türkçe normalize fuzzy (İ/I, Ş/S, Ğ/G, Ü/U, Ö/O, Ç/C), NO ile

&#x20;    aday daraltma, kişi başına match confidence hesaplama.

&#x20; 10. Karar skoru üretilecek: identity\_score (isim/soyisim), no\_score, ocr\_presence, audio\_clarity, video\_clarity

&#x20;    birleşimi ile 0–100 quality\_score.

&#x20; 11. 3 seviye karar bandı kullanılacak: Green >=85, Yellow 60–84, Red <60; final karar her durumda admin onayıyla

&#x20;    verilecek.

&#x20; 12. Admin iş listesi geliştirilecek: submission kartı, transcript özeti, OCR metni, eşleşen/eşleşmeyen isimler, grup

&#x20;    (NO) görünümü, skora göre renk kodu.

&#x20; 13. Admin düzeltme yeteneği eklenecek: eşleşme override, yorum notu, “kabul/red” kararı, işlem audit kaydı.

&#x20; 14. SMS modülü adapter pattern ile geliştirilecek: provider bağımsız arayüz, ilk sürümde mock + gerçek provider

&#x20;    plug-in noktası.

&#x20; 15. SMS alıcı kuralı NO bazlı tekilleştirme olacak: aynı TEL bir kez hedeflenir, her mesaj kaydı delivery durumu ile

&#x20;    tutulur.

&#x20; 16. Video link güvenliği uygulanacak: Backblaze object erişimi public olmayacak, kısa ömürlü signed URL üretilecek,

&#x20;    SMS içinde sadece signed URL paylaşılacak.

&#x20; 17. İzleme ekranı eklenecek: gönderilen SMS, tıklanma durumu (mümkünse tracking redirect ile), hatalı teslimatlar.

&#x20; 18. Operasyonel güvenlik katmanı kurulacak: audit log, rol bazlı endpoint koruması, PII maskeleme (listelerde

&#x20;    telefon son 4 gösterim), admin aksiyon logları.

&#x20; 19. Dayanıklılık ve hata yönetimi eklenecek: retry (3 deneme), dead-letter queue, başarısız iş tekrar tetikleme,

&#x20;    idempotent job tasarımı.

&#x20; 20. Veri yaşam döngüsü süresiz saklama olacak: sıcak depolama + soğuk arşiv tiering, silme yerine arşiv; maliyet

&#x20;    kontrolü için lifecycle policy aktif edilecek.



&#x20; ## Public API / Interface / Type Değişiklikleri



&#x20; | Tür | Sözleşme | Amaç |

&#x20; |---|---|---|

&#x20; | REST | POST /auth/login | Kullanıcı girişi ve token üretimi |

&#x20; | REST | POST /uploads/init | Upload oturumu ve object path üretimi |

&#x20; | REST | POST /uploads/complete | Dosya yüklendi bildirimi, pipeline job başlatma |

&#x20; | REST | GET /submissions | Admin listeleme, filtreleme (durum, bölge, skor) |

&#x20; | REST | GET /submissions/{id} | Detay: transcript, OCR, match sonuçları, skor |

&#x20; | REST | POST /submissions/{id}/review | Admin kabul/red/override kararı |

&#x20; | REST | POST /submissions/{id}/sms/send | NO bazlı tekilleştirilmiş SMS gönderimi |

&#x20; | REST | GET /submissions/{id}/sms | SMS log ve teslim durumları |

&#x20; | REST | POST /db/import | Excel/CSV import ve doğrulama |

&#x20; | Worker | video\_pipeline\_job | Intro + encode + AI + matching + skor |

&#x20; | Worker | sms\_dispatch\_job | SMS batch gönderim ve retry |



&#x20; | Ana Type | Alanlar |

&#x20; |---|---|

&#x20; | DonorRecord | id, no, country, city, region, first\_name, last\_name, phone, source\_batch\_id |

&#x20; | VideoSubmission | id, uploader\_id, country, city, region, no, raw\_object\_key, processed\_object\_key, status,

&#x20; intro\_version, created\_at |

&#x20; | AnalysisResult | submission\_id, transcript\_text, ocr\_text, extracted\_no, extracted\_names\_json, confidence\_json |

&#x20; | MatchResult | submission\_id, donor\_record\_id, match\_type(exact/fuzzy), score, evidence\_source(audio/ocr/both) |

&#x20; | ReviewDecision | submission\_id, reviewer\_id, decision, decision\_note, final\_quality\_score, decided\_at |

&#x20; | SmsMessage | id, submission\_id, phone, template\_id, status, provider\_ref, sent\_at, delivered\_at |

&#x20; | AuditEvent | id, actor\_id, action, entity\_type, entity\_id, metadata\_json, created\_at |



&#x20; ## Test Planı ve Kabul Senaryoları



&#x20; 1. Birim testleri: Türkçe isim normalizasyonu, fuzzy eşik davranışı, NO bazlı aday daraltma, skor hesap fonksiyonu.

&#x20; 2. Entegrasyon testleri: upload->queue->AI->match->review akışının uçtan uca API seviyesinde doğrulanması.

&#x20; 3. Medya testleri: 1–3 dk video kabul, 1 dk altı ve 3 dk üstü red, bozuk dosya red, intro prepend doğrulaması.

&#x20; 4. Eşleşme testleri: exact eşleşme, transkripsiyon hatalı varyasyonlar, OCR kısmi okuma, NO uyuşmazlığı.

&#x20; 5. Admin testleri: override sonrası audit kaydı, red/kabul durum geçişleri, çoklu admin yarış durumları.

&#x20; 6. SMS testleri: tekilleştirme, provider hata retry, duplicate gönderim önleme, signed URL son kullanım.

&#x20; 9. Kabul kriteri: onaylanan bir submission için doğru grup alıcılarına tekilleştirilmiş SMS gitmeli ve linkten video

&#x20; 10. Kabul kriteri: düşük kaliteli/matchsiz submission admin ekranında açık şekilde “manual action required” olarak

&#x20;    görünmeli.



&#x20; ## Teslimat Fazları (Karar Tamamlanmış Uygulama Sırası)



&#x20; 1. Faz 0 (1 hafta): mimari iskelet, auth/RBAC, DB şeması, import modülü, temel admin/uploader ekranları.

&#x20; 2. Faz 1 (1.5 hafta): upload altyapısı, Backblaze entegrasyonu, queue/worker, intro prepend ve transcode.

&#x20; 3. Faz 2 (1.5 hafta): STT+OCR entegrasyonu, varlık çıkarımı, exact+fuzzy match motoru, kalite skoru.

&#x20; 4. Faz 3 (1 hafta): admin review karar akışı, override, audit, SMS adapter ve gönderim ekranı.

&#x20; 5. Faz 4 (1 hafta): güvenlik sertleştirme, performans testleri, hata/retry/alerting, pilot canlı geçiş.

&#x20; 6. Faz 5 (opsiyonel): Vimeo ikinci kanal entegrasyonu, otomatik karar deneyleri, gelişmiş raporlama.



&#x20; ## Varsayımlar ve Seçilen Defaultlar



&#x20; - İlk sürüm web tabanlıdır; mobil uygulama yok, mobil uyumlu web upload vardır.

&#x20; - Intro tek sabit varlık olarak başa eklenir ve sürümlenebilir.

&#x20; - SMS sağlayıcısı başlangıçta adapter üzerinden soyutlanır, canlı provider sonradan bağlanır.

&#x20; - NO bir “kurban grup anahtarı” olarak kabul edilir ve eşleşme bunun etrafında yapılır.

&#x20; - Admin onayı zorunludur; otomatik SMS yoktur.

&#x20; - Veri saklama süresi süresizdir; operasyonel maliyet için sıcak/soğuk depolama katmanı kullanılır.

&#x20; - Örnek videonun 27 sn olması MVP kuralını değiştirmez; üretimde 1–3 dk doğrulaması zorunludur.

