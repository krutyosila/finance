# API

Yerel temel adres **http://127.0.0.1:4317**, HTTPS sunucu örneği **https://finance.example.com**. Node.js her iki modda da `127.0.0.1` adresine bağlanır. `FINANCE_PORT`, farklı bir loopback portu seçebilir. Web arayüzü, CLI ve API uçları aynı `FinanceService` servisini kullanır. İstek gövdelerini `Content-Type: application/json` ile JSON nesnesi olarak gönderin.

`FINANCE_PUBLIC_URL` tanımlanmamışsa yerel mod kullanılır. Host başlığı `localhost`, `127.0.0.1` veya `[::1]` ile 4317 ya da 5173 portunu kullanmalıdır; ayrıca açıkça ayarlanan `FINANCE_PORT` kabul edilir. Tarayıcı kaynakları da bu adres ve portlarda HTTP kullanmalıdır. Uzak kaynaklar ve siteler arası tarayıcı istekleri HTTP 403 alır. CORS joker kaynak kabul etmez. curl gibi yerel betikler Origin göndermeyebilir.

Sunucu modunda `FINANCE_PUBLIC_URL` HTTPS kaynağına ayarlanır. Nginx loopback üzerinden aynı Host başlığını ve `X-Forwarded-Proto: https` gönderir; yalnızca loopback proxy'ye güvenilir. Origin gönderilirse ayarlanan HTTPS kaynağıyla aynı olmalıdır. POST/PATCH/DELETE gibi değiştiren isteklerde bu Origin zorunludur. Finans uçları ayrıca yönetici oturumu gerektirir. Kaynak/domain/HTTPS kontrolleri sağlık ve giriş uçlarında da uygulanır. API yanıtları `Cache-Control: no-store` taşır.

Başarılı istek JSON döndürür. Oluşturma HTTP 201; okuma, düzenleme ve silme 200 döndürür. Geçersiz alanlar 400, gerekli/başarısız giriş 401, kaynak denetimleri 403, bulunamayan kayıt/yol 404, engellenen etkin bakım 409 ve giriş/oturum hız sınırı 429 döndürür. Hata biçimi:

```json
{ "error": "Tutar en fazla iki ondalık basamaklı metin olmalıdır" }
```

## Yönetici oturumu

| Yöntem | Yol                  | Gövde/sonuç                                                                  |
| ------ | -------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/auth/session`  | Giriş gerekliliği ve mevcut oturum                                           |
| POST   | `/api/auth/login`    | `{ "email": "admin@example.com", "password": "..." }` → oturum               |
| POST   | `/api/auth/logout`   | Mevcut oturumu iptal eder; sunucu modunda giriş gerekir                      |
| POST   | `/api/auth/password` | `{ "currentPassword": "...", "newPassword": "..." }` → `{ "changed": true }` |

Parola değişimi mevcut yetkili oturumu ve mevcut parolayı gerektirir; yeni parola en az 8 karakterdir. Başarıda tüm oturumlar iptal edilir ve güvenli çerez temizlenir. Yerel modda bu uç 403 döndürür. Logout tekrarlanabilir; geçersiz oturum için de çerezi temizler.

Yanıt biçimi `{ "required": true, "authenticated": true, "user": { "email": "admin@example.com", "role": "ADMIN" } }` olur. Giriş yoksa `authenticated: false`, `user: null` döner. Yerel modda `required: false` olur. Kullanıcı kaydı veya API token oluşturma ucu yoktur; yönetici [sunucuda parola dosyasıyla](DEPLOYMENT.md) oluşturulur.

Sunucu oturumu varsayılan 12 saat sürer. Mobil ve bilgisayarda aynı anda giriş yapılabilir; aynı IP adresini kullanmak oturumları birleştirmez. Yeni giriş yalnız aynı tarayıcının önceki çerezindeki oturumu değiştirir. Çıkış yalnız kullanılan tarayıcının oturumunu iptal eder; diğer cihaz açık kalır. Aynı tarayıcıdaki sekmeler giriş ve çıkışı paylaşır. Oturum süresi cihaz başına ayrı hesaplanır ve hizmet yeniden başlatılınca oturumlar korunur. Parola değişimi veya yönetici parola sıfırlaması tüm cihazların oturumlarını iptal eder.

Tarayıcıya `__Host-finance_session` çerezi Secure, HttpOnly, SameSite=Strict ve Path=/ olarak gönderilir. Oturum belirteçleri auth veritabanında hash olarak tutulur. Finans verileri tarayıcı depolarında saklanmaz. Programatik HTTPS istekleri de giriş çerezini ve değiştiren isteklerde doğru Origin'i göndermelidir; parolayı kaynak koduna veya komut geçmişine yazmayın.

## Finans durumu ve raporlar

| Yöntem | Yol                      | Sonuç                                                        |
| ------ | ------------------------ | ------------------------------------------------------------ |
| GET    | `/api/health`            | `{ "status": "ok", "local": true }`; sunucuda `local: false` |
| GET    | `/api/context`           | Finans durumu                                                |
| GET    | `/api/ai/context`        | Yerel ajanlar için aynı finans durumu                        |
| GET    | `/api/reports`           | Dönem/döngüyle filtrelenmiş aynı durum                       |
| GET    | `/api/audit?entityId=ID` | Denetim kayıtları; tümü için `entityId` alanını atlayın      |

İsteğe bağlı filtreler: `cycleId`, `from`, `to`, `all=true`. Tarihler `YYYY-MM-DD` veya saat dilimi içeren ISO zaman damgalarıdır. Yalnızca tarih içeren aralıklar varsayılan olarak Europe/Istanbul kullanır (`FINANCE_TIMEZONE` ile değiştirilebilir); bitiş günü tamamen dahildir. Akışlar seçilen dönemden, bakiyeler ve net durum o dönemin sonuna kadar önceki kayıtlardan hesaplanır. Açık tarihler yoksa etkin döngü varsayılandır. `all=true` bu varsayılanı kaldırır; tüm geçmişi seçer, `from`/`to` ile daraltılabilir. Açık `cycleId`, o döngünün varsayılan sınırlarını seçer.

Durum nesnesi şu alanları içerir: `generatedAt`, `currentCycle`, `accounts`, `balances`, `metrics`, `income`, `expenses`, `cashOutflow`, `debts`, `debtPayments`, `debtUsage`, `savings`, `subscriptions`, `recurringObligations`, `categoryTotals`, `recentTransactions`, `netFinancialPosition`, `transactionCount`, `unassignedCash`, `charts.daily`, `period`, `openingPosition`, `positionChange`, `scopeTotals`. Ölçütler kullanılabilir nakit, gelir, gerçek gider, brüt nakit çıkışı, borç, borç ödemesi, yeni borç kullanımı, mevcut birikim, birikim hareketi, net nakit akışı, varlık ve net finans durumunu içerir. Kesin tanımlar [FINANCE_RULES.md](FINANCE_RULES.md) dosyasındadır.

Para toplamları, para biriminden ondalık metne eşlemedir: `{ "TRY": "100.00", "USD": "24.10" }`. Eksik anahtar, o para biriminde katkı yapan kayıt olmadığını belirtir. Tamamen boş toplam `{}` olur. Kullanılmış para birimindeki sıfır sonuç `"0.00"` olarak döner. Açık dönüşüm verilmeden farklı para birimlerini birleştirmeyin.

## İşlemler ve OpenAI yorumlama

| Yöntem | Yol                               | Gövde/sonuç                                                                           |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/api/transactions`               | İşlem dizisi                                                                          |
| GET    | `/api/transactions/:id`           | Silinmiş kayıt dahil tek işlem                                                        |
| POST   | `/api/transactions`               | Yapılandırılmış işlem → kaydedilmiş işlem                                             |
| PATCH  | `/api/transactions/:id`           | Kısmi alanlar → güncellenmiş işlem                                                    |
| DELETE | `/api/transactions/:id`           | Geri alınabilir silme → `{ "deleted": true, "id": "..." }`                            |
| POST   | `/api/transactions/:id/restore`   | Geri yükleme → doğrulanmış etkin işlem                                                |
| POST   | `/api/transactions/:id/duplicate` | Kopyalama → mevcut zamana ait yeni işlem                                              |
| POST   | `/api/parse`                      | `{ "text": "450 market" }` → yalnızca taslak                                          |
| POST   | `/api/ai/transaction`             | `{ "text": "450 market", "requestId": "BENZERSIZ_KIMLIK" }` → kayıt veya onay bilgisi |

Liste filtreleri: `search`, `type`, `currency`, `category`, `accountId`, `scope`, `from`, `to`, `deleted=true`. Varsayılan yalnızca etkin işlemlerdir. `deleted=true` yalnızca silinmiş işlemleri döndürür.

Yapılandırılmış işlem alanları:

| Alan                                     | Anlamı                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `type`                                   | `INCOME`, `EXPENSE`, `DEBT_PAYMENT`, `DEBT_USAGE`, `TRANSFER`, `SAVINGS`, `REFUND`, `ADJUSTMENT` |
| `amount`                                 | Zorunlu ondalık metin; işaretli düzeltme/birikim çekimi dışında pozitif                          |
| `currency`                               | Zorunlu `TRY`, `USD`, `EUR`, `USDT`                                                              |
| `description`                            | Zorunlu, boş olmayan açıklama                                                                    |
| `timestamp`                              | İsteğe bağlı ISO tarih/zaman damgası; varsayılan mevcut zaman                                    |
| `amountTRY`                              | İsteğe bağlı/null gerçek TL tutarı                                                               |
| `exchangeRate`                           | İsteğe bağlı/null, bir birim işlem para birimi için pozitif ondalık TL kuru                      |
| `category`                               | İsteğe bağlı metin; verilmezse işlem türüne uygun kategori                                       |
| `accountId`                              | İsteğe bağlı/null kaynak veya ödeme hesabı; hesapsız nakit atanmaz                               |
| `destinationAccountId`                   | Transfer veya birikim hedefi                                                                     |
| `destinationAmount`                      | Farklı para birimli transferde açıkça girilen alınan tutar                                       |
| `debtId`                                 | Kullanım/ödeme veya borçla finanse edilen alışveriş/iade için mevcut borç                        |
| `counterparty`, `paymentMethod`, `notes` | İsteğe bağlı/null metin                                                                          |
| `scope`                                  | Varsayılan `PERSONAL` veya `BUSINESS`                                                            |
| `debtComponent`                          | Varsayılan `PRINCIPAL`, `INTEREST`, `FEE`                                                        |
| `obligationId`, `subscriptionId`         | Gerçek gideri tek bir planlı kayda bağlar                                                        |

Metin yerine `24.1` gibi JSON sayıları kabul edilmez. Tüm desteklenen para birimleri iki ondalık basamak kullanır. Kur uydurmayın. Farklı para birimli transfer için `destinationAmount`, TRY hesabından döviz harcaması için açık gerçek TRY ödeme tutarı gerekir.

Yapılandırılmış istek örneği:

```sh
curl -s http://127.0.0.1:4317/api/transactions \
  -H 'Content-Type: application/json' \
  -d '{"type":"EXPENSE","amount":"24.00","currency":"USD","description":"Alan adı yenileme","scope":"BUSINESS"}'
```

Yalnızca gerçek işleminizi ifade eden eklemeleri çalıştırın. Başlangıçta örnek kayıt oluşturulmaz.

`POST /api/parse` hiçbir şey kaydetmez; `{ text, draft, certain, issues }` döndürür. `POST /api/ai/transaction`, sınıflandırma ve referanslar kesin olduğunda HTTP 201 ile `{ saved: true, transaction }` döndürür. Aksi halde HTTP 200 ve `{ saved: false, confirmation: { text, draft, certain, issues } }` döner; hiçbir işlem oluşturulmaz. Onay formunu gösterin, ardından kullanıcının seçtiği alanları `POST /api/transactions` ile gönderin.

Her iki metin ucu OpenAI kullanır, eski yerel ayrıştırıcıya dönmez. Not 1–2000 karakter, `requestId` 8–128 ASCII harf/rakam/alt çizgi/tire olmalıdır. Aynı kimlik ve not başarılı kayıt sonucunu tekrar döndürür; farklı notla aynı kimlik 409 alır. İşlem ve tekrar koruma kaydı aynı SQLite transaction'ında yazılır. Belirsizlik/provider hatasında finans kaydı oluşmaz. Model erişim hataları 502, bağlantı/eksik yapılandırma 503, AI eşzamanlılık veya sağlayıcı kota sınırı 429 olur; sağlayıcının hata gövdesi gösterilmez.

## Bütün kayıt türleri için AI planı

| Yöntem | Yol                     | Gövde/sonuç                                                                                         |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/api/ai/entry`         | `{ "text": "..." }` → `{ text, certain, issues, items }`, yalnız önizleme                           |
| POST   | `/api/ai/entry/confirm` | `{ "plan": PLAN, "requestId": "..." }` → kaydedilen kayıt kimlikleri veya tamamlanması gereken plan |

Not 1–12.000 karakter, plan en fazla 25 kayıt içerir. Her item `{ "key": "benzersiz_anahtar", "kind": "account", "data": { ... } }` biçimindedir. Türler `transaction`, `account`, `debt`, `obligation`, `subscription`, `cycle`; data alanları ilgili yapılandırılmış oluşturma uçlarıyla aynıdır. Bağımsız hesap/borcun açılış bakiyesi (kredi hesabında `currentDebt` de kullanılabilir), abonelik/düzenli ödemenin tutarı, sıklığı ve tarihi zorunludur. Transaction tarihi verilmemişse toplu hareketlerin ortak kayıt zamanı, cycle başlangıcı verilmemişse mevcut zaman kullanılır.

Para hareketlerine bağlı yeni banka/nakit/cüzdan/birikim account taslağında eksik `openingBalance`, `0.00` kayıt başlangıcı ve bunu açıklayan `notes` ile önizlemede tamamlanır. Kullanıcının verdiği açılış bakiyesi korunur. Ad+para biriminde benzersiz mevcut hesap bulunursa otomatik hesap taslağı kaldırılır ve bağlı `@key` referansları mevcut ID'ye çevrilir; mevcut bakiye ezilmez. Birden fazla uygun mevcut hesap varsa plan belirsiz olur. Aynı kurumun farklı dövizleri ayrı hesaplardır.

Döviz çevrimi `TRANSFER` olarak kaynak tutar/para birimi ve gerçek net `destinationAmount` ile temsil edilir. TRY hedefinde açık net `exchangeRate` varsa eksik hedef tutar tam sayı para aritmetiğiyle hesaplanır; kur/hedef tutar çelişkisi veya eksik gerçek karşılık `issues` üretir. Sonraki transferin tutarı çevrim karşılığı olarak kabul edilmez. Para gelişi → döviz transferi → sonraki transfer ayrı işlemlerdir; transferler gelir/gider üretmez.

Mevcut kayıtlar gerçek kimlikleriyle, aynı plan içindeki kayıtlar `@key` ile bağlanır. `accountId`, `destinationAccountId`, `debtId`, `obligationId`, `subscriptionId` türleri doğrulanır. Kredi hesabının otomatik oluşan borcu `debtId: "@kart_key"` ile kullanılabilir. Planın sırası bağlantı sırasından farklı olabilir; tanımlar önce, para hareketleri muhasebe tarih sırasıyla işlenir. Mevcut veya planda tekrarlanan tanımlar reddedilir; farklı tür/para birimindeki aynı isimli hesap ve borçlar ayrıdır. Bağlı gerçek abonelik/düzenli ödemesinde eksik `accountId`, `category`, `scope` tanımdan yerelde devralınır ve önizlemede gösterilir; açıkça belirtilmiş değerler korunur. Onay `paySubscription`/`payObligation` kontrollerini uygular ve aynı dönemin ikinci ödemesini reddeder.

Önizleme HTTP 200 ile döner ve hiçbir kayıt, audit veya receipt bırakmaz. `certain: false` veya dolu `issues` varsa kullanıcıdan ek bilgi alın; ilk notu ve ek açıklamaları birleştirerek yeniden `/api/ai/entry` gönderin. Tam planda kullanıcı onayından sonra `/confirm` çağırın. Başarı HTTP 201 ve `{ "saved": true, "records": [{ "key": "...", "kind": "...", "id": "..." }] }` döndürür. Muhasebe/eksik alan hatası HTTP 200 ve `{ "saved": false, "confirmation": PLAN }` döndürür; hiçbir öğe kaydedilmez. Geçersiz plan zarfı/alan veya istek kimliği HTTP 400 döndürür.

Onay tek atomik işlemde kayıtları, audit ve tekrar koruma makbuzunu yazar. `requestId` 8–128 ASCII harf/rakam/alt çizgi/tiredir. Aynı kimlik ve aynı plan önceki sonucu döndürür; farklı plan 409 alır. Kimlikler eski tek işlem AI makbuzlarından ayrı `plan:` ad alanında tutulur. Provider tamamlandıktan sonra oturum yeniden doğrulanır; oturumu iptal edilmiş kullanıcıya özel plan döndürülmez. Onayda oturum yazma işleminin içinde de doğrulanır.

Yeni plan isteği yalnız metin, hesap/borç/abonelik/düzenli ödeme adları, isteğe özel kısa referans kimlikleri, tür/para birimi ve yerel tarih/saat dilimi ile açık dönem adı/kimliğini OpenAI'a gönderir. Sunucu bu kısa kimlikleri aynı yorumlama isteğine ait referans eşlemesinden gerçek kimliklere çevirir; onay planı gerçek kimlik veya @key içerir. Bilinmeyen ya da belirsiz bağlantı tahmin edilmez. Mevcut bakiyeler/ücretler, tüm defter ve kimlik bilgileri gönderilmez. Planlı kayıt tanımı gerçekleşmiş gider oluşturmaz; gerçekleşmiş ödeme açıkça istenmişse ilgili ID'ye bağlı transaction oluşturulur. Silme/düzenleme veya banka/dosya içe aktarma bu akışta yoktur.

## OpenAI ayarları

| Yöntem | Yol                     | Gövde/sonuç                                                                        |
| ------ | ----------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/api/settings/ai`      | `{ "provider": "openai", "configured": false, "model": "gpt-5.4-mini" }`           |
| PATCH  | `/api/settings/ai`      | `{ "apiKey": "...", "model": "gpt-5.4-mini" }` → aynı durum biçimi                 |
| POST   | `/api/settings/ai/test` | Model erişimini test eder → `{ "ok": true, "provider": "openai", "model": "..." }` |

Sunucu modunda bu uçlar yönetici oturumu ve mutasyonlarda tam Origin ister. Anahtar hiçbir yanıtta dönmez. PATCH en az bir alan ister; `apiKey` gönderilmezse mevcut anahtar korunur. Model Responses/Structured Outputs desteklemelidir. Model erişimi testi `/v1/models/{model}` kullanır; finans notu göndermez. Yorumlama isteği not ve sınırlı hesap/borç referanslarını gönderir; bütün defter/bakiyeler gönderilmez.

## Hesaplar, borçlar, düzenli yükümlülükler ve abonelikler

Her temel yol GET (liste), POST (oluşturma), PATCH `/:id` (kısmi düzenleme) ve DELETE `/:id` (silme) destekler:

| Temel yol            | Oluşturma alanları                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/api/accounts`      | Zorunlu `name`, `type`, `currency`; isteğe bağlı `owner`, `openingBalance`, `creditLimit`, `currentDebt`, `notes`            |
| `/api/debts`         | Zorunlu `name`, `type`, `currency`; isteğe bağlı `openingBalance`, `creditLimit`, `accountId`, `notes`                       |
| `/api/recurring`     | Zorunlu `name`, `amount`, `currency`, `frequency`, `dueDate`; isteğe bağlı `category`, `accountId`, `active`, `scope`        |
| `/api/subscriptions` | Zorunlu `service`, `amount`, `currency`, `frequency`, `nextRenewal`; isteğe bağlı `category`, `accountId`, `active`, `scope` |

Hesap türleri: `BANK`, `CASH`, `CREDIT_CARD`, `OVERDRAFT`, `WALLET`, `SAVINGS`. Borç türleri: `CREDIT_CARD`, `OVERDRAFT`, `LOAN`, `PERSONAL`, `OTHER`. Sıklıklar: `WEEKLY`, `MONTHLY`, `QUARTERLY`, `YEARLY`. Para alanları ondalık metindir; nullable alanlar null olabilir. Plan tarihleri `YYYY-MM-DD` biçimindedir. Kapsam `PERSONAL`/`BUSINESS`, `active` ise JSON boolean kullanır.

Hesap/borç yanıtları hesaplanmış güncel bakiyeleri içerir. Açılış bakiyeleri işlem değil, başlangıç değerleridir. Kredi kartı ve KMH hesabı bağlı borcu atomik olarak oluşturur. Limit varlık yaratmaz. Geçmiş kayıtlarda referansı olan hesap/borçlar, referanslar giderilmeden silinemez.

Kredi kartına para yatırma `DEBT_PAYMENT`, kaynak banka/nakit hesabı `accountId` ve kartın bağlı borcu `debtId` kullanır. Yalnız `CREDIT_CARD` için borcu aşan tutar kart bakiyesine dönüşür: hesapta pozitif `currentBalance`, sıfır `currentDebt`; bağlı borçta negatif `currentBalance` döner. Toplam borç yalnız pozitif borçları, varlıklar kart bakiyesini de içerir; kullanılabilir nakit kart bakiyesini içermez. `debtPayments` ve ödeme kaynaklı `cashOutflow` yalnız gerçek borç azaltımıdır. Kart bakiyesinden karşılanan alışveriş kısmı `cashOutflow` olur; yeni borç sayılmaz. Açılış borcu girdileri negatif olamaz; KMH ve diğer borçların fazla ödeme koruması devam eder.

`POST /api/recurring/:id/pay` ve `POST /api/subscriptions/:id/pay`, yapılandırılmış işlem nesnesi kabul eder, gerçek bağlı gider oluşturur ve HTTP 201 ile döndürür. Planlanan tutarlar kendiliğinden gider olmaz. Durum yaklaşan, ödenmiş, gecikmiş veya abonelikte iptal edilmiş olabilir. Pasifleştirme geçmiş giderleri silmez.

## Döngüler ve bakım

| Yöntem | Yol                   | Gövde/sonuç                                                                         |
| ------ | --------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/cycles`         | Tüm döngüler                                                                        |
| POST   | `/api/cycles`         | `{ "name": "Döngüm", "start": "2026-09-30T00:00:00+03:00" }`; ikisi de isteğe bağlı |
| POST   | `/api/cycles/:id/end` | `{ "end": "2026-10-29T23:59:59+03:00" }`; bitiş isteğe bağlı                        |
| POST   | `/api/backup`         | Tutarlı SQLite yedeği → `{ "path": "/tam/yol/...sqlite" }`                          |
| POST   | `/api/export`         | Tam durum ve CSV → `{ "snapshot": "/tam/yol/...json", "csv": "/tam/yol/...csv" }`   |

Yedekleme ve dışa aktarma gövde gerektirmez. Geri yükleme, uygulama durduktan sonra CLI ile yapılır: `npm run finance -- restore-backup PATH`. Yan dosya doğrulaması, güvenlik yedeği, durdurma ve çıktı konumları için [README.md](../README.md) dosyasına bakın.
