# Gerçek model değerlendirmesi

`scripts/ai-evaluate.ts`, yapılandırılmış OpenAI modeliyle 25 bağımsız Türkçe finans senaryosunu yorumlar. Bu ücretli değerlendirme `npm test` içine dahil değildir. Birim ve entegrasyon testlerinin yanında modelin metni nasıl yorumladığını ve ortaya çıkan planın finans sonucunu denetler.

Her senaryo ayrı `FinanceService(':memory:')` kullanır. Sunucu finans veya kimlik veritabanları açılmaz; mevcut AI yapılandırması yalnız uygulamanın kendi istemcisi aracılığıyla okunur. Sağlayıcıya giden bütün hesap, borç ve plan referansları kurgusaldır. Anahtar ve yapılandırma içeriği yazdırılmaz. Hatalı senaryoda yalnız hata ve kurgusal plan yazdırılır.

Önizlemenin kayıt, denetim izi veya onay makbuzu yazmadığı bütün senaryolarda kontrol edilir. Kesin planlar bellekte onaylanır ve aynı istek kimliğiyle tekrarın hiçbir şeyi çoğaltmadığı doğrulanır. Belirsiz planların onaylanamadığı ve bütün kayıtların değişmeden kaldığı kontrol edilir. Doğrulamalar, modelin ürettiği key adları veya açıklama üslubu yerine saklanan tür, tutar, ilişki, alan ve bakiyeleri karşılaştırır.

## Çalıştırma

Node 22 ve projenin bağımlılıkları gereklidir. Anahtar önceden uygulamanın güvenli AI yapılandırmasında bulunmalıdır. Canlı sunucuda uygulamanın servis kullanıcısı ve mevcut ortamı kullanılabilir; kaynak geçici bir klasörde çalıştırılabilir. Açılan finans veritabanı her durumda bellektedir.

```sh
node --import tsx scripts/ai-evaluate.ts --list
node --import tsx scripts/ai-evaluate.ts --check-fixtures
node --import tsx scripts/ai-evaluate.ts
node --import tsx scripts/ai-evaluate.ts --case=paribu_missing_fx_total
```

`--list` ve `--check-fixtures` hiçbir API çağrısı yapmaz. `--case=ID` birden fazla verilebilir. Varsayılan eşzamanlılık 2, zaman sınırı uygulamayla aynı 20000 milisaniyedir. `--concurrency=1` seri çalıştırır. `--timeout-ms=NUMBER` yalnız teşhis için 1–120000 arasında değiştirilebilir; daha uzun bir zaman sınırıyla geçen senaryo canlıdaki 20 saniye sınırını geçtiğini kanıtlamaz. Çalıştırıcı kendiliğinden tekrar denemez ve herhangi bir senaryo başarısızsa sıfır olmayan çıkış kodu döndürür.

## Kapsam

| Alan                      | Senaryolar ve beklenen sonuç                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hesaplar                  | BANK, CASH, WALLET, SAVINGS; açılış bakiyesi gelir sayılmaz; sahibi ve notu saklanır.                                                                                                             |
| Kredi hesapları           | CREDIT_CARD ve OVERDRAFT; limit ve mevcut borç saklanır, yalnız bir bağlı borç oluşur.                                                                                                            |
| Borçlar                   | LOAN, PERSONAL, OTHER; açılış borcu, limit ve not. Kredi kartı/KMH ilişkisi hesapla otomatik kurulur. Kredi kullanımı ve ödeme gelir/gider sayılmaz. Faiz ve masraf doğru bileşene gider.         |
| Hareketler                | INCOME, EXPENSE, DEBT_PAYMENT, DEBT_USAGE, TRANSFER, SAVINGS, REFUND, ADJUSTMENT; dört döviz, ondalık tutar, gerçek TL tahsilatı ve açık kur.                                                     |
| Hareket alanları          | Tarih/saat dilimi, kategori, kapsam, karşı taraf, ödeme yöntemi, not, kaynak/hedef hesap, borç, abonelik ve düzenli ödeme ilişkileri.                                                             |
| Birikim                   | Ayırma ve negatif çekim; hem nakit hem birikim bakiyeleri doğru değişir.                                                                                                                          |
| Düzenli ödeme ve abonelik | Haftalık, aylık, üç aylık ve yıllık; açık vade/yenileme günü, kategori, iş/kişisel kapsam, pasif abonelik. Tanım gider değildir. Mevcut planın hesabı/kategori/kapsamı gerçek ödemeye devralınır. |
| Finans dönemi             | Altı türü içeren tek plan, açık yerel dönem tarihi ve varsayılan başlangıç. Tarihsiz hareketler yeni dönemin içinde kalır.                                                                        |
| Döviz ve hesap zinciri    | Eksik ve tamamlanmış Paribu örneği, belirtilen kalan, mevcut hesapların korunması, açık net kur, EUR→USD ve USDT→TRY net tutarları. Transferler gelir/gider oluşturmaz.                           |
| Eksik ve belirsiz bilgi   | Eksik net döviz karşılığı, aynı adı taşıyan hesaplar, desteklenmeyen GBP, eksik yenileme günü ve borç tutarı. Bilinen taslaklar korunur, kayıt yapılmaz.                                          |

Bu matris desteklenen finans alanlarından temsili uçtan uca örnekleri kapsar. Bütün olası doğal dil ifadelerini veya sonraki model yanıtlarının aynı olacağını kanıtlamaz. Bilinmeyen veri için açıklama isteme ve sunucu doğrulaması gereklidir. Kimlik bilgisi, ayar değiştirme, silme ve kaydedilmiş veriyi düzenleme oluşturma planının kapsamı dışındadır.

## 1 Ekim 2026 doğrulaması

Son sürüm, yapılandırılmış gerçek OpenAI modeliyle 25/25 senaryoyu geçti. Uygulamayla aynı 20 saniye sınırı ve 2 eşzamanlı istek kullanıldı; başarısız çağrılar kendiliğinden tekrarlanmadı. Bütün finans kayıtları yalnız bellek içindeydi.

İlk değerlendirmelerde yakalanan bağlantı, birikim çekim yönü, eksi düzeltme tutarı, ödeme ayrıntısı devralma ve bilinen taslakların korunması hataları düzeltildi. Mevcut kayıtlara kısa, isteğe özel referans eşlemeleri eklendi; belirsiz eşlemeler engellendi. Ayrıca varsayılan dönem başlangıcı ile tarihsiz hareketlerin aynı zamanı kullanması ve hatalı veri türlerinin kayıttan önce reddedilmesi otomatik regresyon testleriyle doğrulandı.
