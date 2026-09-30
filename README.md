# Still Finance

Yerelde veya kendi HTTPS sunucunuzda çalışan kişisel finans uygulaması. Web arayüzü, REST API ve komut satırı aynı SQLite muhasebe servisini kullanır. Yerelde elle kayıt ve rapor için internet gerekmez; sunucu kullanımında telefon/bilgisayar aynı sunucu defterine bağlanır. AI hızlı giriş OpenAI API anahtarı ve internet gerektirir; API kullanımı OpenAI hesabınıza ücret yansıtabilir. İnternetten kur alınmaz. Başlangıçta örnek finans kaydı oluşturulmaz.

Kaynak deposu: [krutyosila/finance](https://github.com/krutyosila/finance). Kaynak kodu MIT lisanslıdır; kişisel veritabanları, oturumlar, parolalar, ortam dosyaları ve yedekler açık kaynak depoya dahil değildir. [Sunucu kurulum kılavuzu](docs/DEPLOYMENT.md), `finance.example.com` hedefi için şablonları açıklar. Bu belgede hedef adres bulunması, dağıtımın tamamlandığı anlamına gelmez.

## Kurulum ve çalıştırma

Node.js 22.13 veya daha yeni bir sürüm kullanın. Proje klasöründe:

```sh
npm install
npm run dev
```

**http://127.0.0.1:5173** adresini açın. Yerel API **http://127.0.0.1:4317** adresinde çalışır. İkisi de yalnızca bu bilgisayardan erişilebilen loopback arayüzüne bağlanır. Terminali açık tutun. İkisini durdurmak için aynı terminalde **Ctrl+C** tuşlarına basın.

Derlenmiş uygulamayı çalıştırmak için:

```sh
npm run build
npm start
```

Ardından **http://127.0.0.1:4317** adresini açın. **Ctrl+C** ile durdurun. Her iki başlatma şekli de veritabanı şemasını otomatik oluşturur. İsterseniz `npm run db:migrate` ile ayrıca başlatabilirsiniz.

Veritabanı bu proje içindeki **`data/finance.sqlite`** dosyasıdır. SQLite çalışırken `finance.sqlite-wal` ve `finance.sqlite-shm` dosyaları da oluşabilir. Açık veritabanını dosya olarak kopyalamak yerine aşağıdaki yedek komutunu kullanın. API çalışırken `data/api.pid` oluşturur; bu dosya geri yüklemeyi korur. Ayrı bir veritabanı seçmek için API veya CLI başlatırken `FINANCE_DB=/tam/yol/data/finance.sqlite` kullanabilirsiniz. `FINANCE_PORT` farklı bir yerel API portu seçer; geliştirme sırasında Vite proxy adresini de aynı porta ayarlayın.

İlk çalıştırmada işlem, hesap, borç, finans döngüsü, abonelik ve düzenli yükümlülük sayıları sıfırdır. Kendi bilgilerinizi kendiniz girin. Hesap veya döngü oluşturmadan da işlem ekleyebilirsiniz; hesapsız nakit hareketleri görünür bir **atanmamış nakit** bakiyesinde tutulur.

## HTTPS sunucusu ve giriş

`FINANCE_PUBLIC_URL` tanımlanmadığında yerel mod kullanılır; tarayıcıdan parola istenmez ve API yalnızca loopback'e bağlanır. Bu değişken `https://finance.example.com` gibi bir HTTPS kaynağına ayarlanırsa finans uçları yönetici oturumu gerektirir. Kayıt olma ve açık hesap oluşturma yoktur. Nginx/Hestia HTTPS trafiğini içerideki `127.0.0.1:4317` API'sine taşır; Node.js halka açık bir adrese bağlanmaz.

Hedef yönetici e-postası **admin@example.com**. Yönetici oluşturmak veya parolayı sıfırlamak için parolayı komut satırına/ortam örneğine yazmayın. Yalnızca sahibi tarafından okunabilen, komutu çalıştıran kullanıcıya ait tek satırlı bir parola dosyası kullanın; parola en az 8 karakter olmalıdır:

```sh
chmod 600 /özel/yol/admin-parola.txt
FINANCE_AUTH_DB=/özel/yol/auth.sqlite npm run admin -- --email admin@example.com --password-file /özel/yol/admin-parola.txt
FINANCE_AUTH_DB=/özel/yol/auth.sqlite npm run admin -- --email admin@example.com --password-file /özel/yol/admin-parola.txt --reset
```

Sunucuda finans dosyası **`/var/lib/finance/data/finance.sqlite`**, kimlik dosyası **`/var/lib/finance/data/auth.sqlite`**, gizli ortam dosyası **`/etc/finance/finance.env`** olarak ayrılır. Auth dosyası tuzlanmış parola hash'ini ve hash'lenmiş oturum belirteçlerini tutar; finans yedeği/dışa aktarması kimlik verisini içermez. `--reset` eski oturumları iptal eder. Parola dosyasını Git'e eklemeyin; güvenli parola yöneticisine aktardıktan sonra tek seferlik dosyayı kaldırın. Sunucuda root parolası/SSH anahtarı GitHub Actions'a verilmez.

Yerel bilgisayardaki ve sunucudaki SQLite defterleri otomatik eşitlenmez. Sunucudaki veriyi CLI ile yönetmek için komutu sunucuda, doğru `FINANCE_DB` ile çalıştırın. Normal güncellemeler finans kayıtlarını sıfırlamaz.

## Telefona veya bilgisayara yükleme

HTTPS uygulamasını bir PWA olarak yükleyebilirsiniz. Destekleyen tarayıcıda **Uygulamayı yükle** düğmesini kullanın. iPhone/iPad Safari'de **Paylaş → Ana Ekrana Ekle**, Android Chrome'da tarayıcının yükleme seçeneğini kullanın. Bu özellik üretim derlemesinde çalışır; geliştirme sunucusu service worker kaydetmez.

Çevrimdışıyken yalnızca uygulama kabuğu ve **Bağlantı gerekli** bilgilendirmesi kullanılabilir. Finans API yanıtları, bakiyeler ve işlemler tarayıcı önbelleğine, localStorage veya IndexedDB'ye kaydedilmez. Çevrimdışı finans okuma/yazma veya sonradan gönderilecek işlem kuyruğu yoktur. Ayrıntılar [PWA.md](docs/PWA.md) dosyasında.

## Hızlı kayıt

**Ayarlar → OpenAI bağlantısı** bölümünde anahtarınızı ekleyin, modeli seçin ve **Bağlantıyı test et** düğmesiyle erişimi doğrulayın. Model menüsünde **GPT-5.4 Mini** (varsayılan `gpt-5.4-mini`), **GPT-5.4 Nano** ve **GPT-5.4** seçenekleri bulunur. **Diğer model** ile özel bir model adı girebilirsiniz; kayıtlı özel adlar korunur. Bu menü tüm erişilebilir modellerin listesi değildir. Seçtiğiniz model hesabınızda erişilebilir olmalı, Responses API ve Structured Outputs desteklemelidir. Seçim yalnız **Ayarları kaydet** ile uygulanır. Test anahtar/model erişimini kontrol eder; yorumlama veya kota garantisi vermez. Anahtar giriş kutusu tekrar doldurulmaz ve API anahtarı tarayıcıya geri verilmez. Boş bırakarak yalnız modeli değiştirebilirsiniz. **Ayarlar → Giriş şifresi** bölümünde mevcut parolanızı doğrulayarak en az 8 karakterli yeni parola belirleyebilirsiniz; bütün oturumlar kapanır.

**Ne oldu?** alanına Türkçe finans metni veya çok satırlı liste yazın. AI; gelir/gider/transfer gibi işlemleri, hesapları, borç tanımlarını, abonelikleri, düzenli ödemeleri ve yeni finans dönemlerini birlikte hazırlayabilir. Örneğin:

```text
Garanti banka hesabımda başlangıç bakiyesi 25000 TL var.
Netflix aboneliğim aylık 300 TL, her ayın 15'inde yenileniyor ve Garanti'den ödeniyor.
Kiram aylık 15000 TL, sonraki ödeme 5 Ekim 2026.
Ali'ye başlangıçta 2000 TL kişisel borcum var.
```

Önce **Önizle**, sonra bütün kayıtları ve bağlantılarını gözden geçirip **Tüm kayıtları onayla ve kaydet** düğmesini kullanın. Bir not en fazla 12.000 karakter ve 25 kayıt içerebilir. Eksik tutar, para birimi veya yenileme/vade tarihi uydurulmaz; **Eksik ayrıntıları yazın** alanında tamamlayın. Aynı alanda düzeltme de yapabilirsiniz; **Önizlemeyi güncelle** ilk notunuzu ve önceki ek bilgileri korur. Yeni hesap, aynı plandaki abonelik veya işlemde kullanılabilir. Kredi kartı/KMH hesabının bağlı borcunu muhasebe servisi kendisi oluşturur.

Bir para hareketinde adı geçen hesap yoksa AI onu da önerir; benzersiz mevcut hesapları tekrar kullanır. Yalnız bu hareketler için oluşturulan yeni banka/nakit/cüzdan/birikim hesabı, geçmiş açılış bakiyesi belirtilmediyse **0 kayıt başlangıcı** ile açılır ve bu varsayım önizlemede görünür. Önceki bakiyeniz varsa ek bilgiyle belirtin. Bağımsız hesap/bakiye ve kredi/borç tanımlarında açık başlangıç bakiyesi hâlâ gereklidir.

“Paribu'ya 2500 dolar geldi; 100000 TL'ye çevirdim ve 90000 TL'sini VakıfBank'a aktardım” notu, gerekirse Paribu USD/TRY ve VakıfBank TRY hesaplarını, ardından gelir → döviz çevrimi → banka aktarımını hazırlar. Yeni kayıt başlangıcıyla Paribu'da 10000 TRY kalır; transferler gelir veya gider sayılmaz. Çevrim toplamı verilmediyse AI gerçek net karşılığı sorar; sonraki transfer tutarını çevrim toplamı olarak kullanmaz. Açık net TRY kuru verilirse hedef tutar yerelde kesin hesaplanır; piyasa kuru alınmaz.

Abonelik veya düzenli ödeme tanımı, gerçek harcama değildir. “Netflix aylık 300 TL” bir plan; “Netflix'e 300 TL ödedim” bir giderdir. Bağlı gerçek ödemede farklı ayrıntı belirtmediyseniz planın hesap, kategori ve kapsamı kullanılır; bu bilgiler önizlemede görünür. Aynı ödeme dönemi tekrar ödenmiş olarak kaydedilemez. Onaylanan toplu plan tek seferde kaydedilir; bir kayıtta hata varsa hiçbir kayıt eklenmez. Para hareketleri tarih sırasına göre doğrulanır. Önizleme kayıt veya denetim izi oluşturmaz. Aynı ad/tür/para birimindeki mevcut tanımların tekrar oluşturulması engellenir. AI üzerinden mevcut kayıt silme/düzenleme, banka bağlantısı veya dosya içe aktarma desteklenmez.

CLI ile bütün kayıt türleri için önce önizleme alın, sonra plan nesnesini onaylayın:

```sh
npm run finance -- ai preview "Garanti banka hesabımın başlangıç bakiyesi 25000 TL" --json
npm run finance -- ai confirm --data PLAN_JSON --request-id BENZERSIZ_KIMLIK --json
```

`PLAN_JSON`, önizlemenin döndürdüğü tam JSON planıdır. Eksik veya geçersiz onay hiçbir şey kaydetmez ve CLI 2 koduyla biter. Onayda aynı kimlik ve aynı plan tekrar gönderilirse önceki başarılı sonuç döner; aynı kimlikle farklı plan 409 hatası verir.

Eski tek işlem CLI komutları da kullanılabilir:

```sh
npm run finance -- add "450 market"
npm run finance -- add "128000 ödeme geldi"
npm run finance -- parse "24 USD domain yenilendi" --json
```

Bu örnekleri yalnızca gerçek işlemlerinizi ifade ediyorsa çalıştırın. Eski `add` komutunda metni OpenAI yorumlar; tek açık işlem sunucudaki muhasebe kontrollerinden geçip doğrudan kaydedilir. Belirsiz veya birden fazla ayrı işlemde CLI `{ "saved": false, "confirmation": ... }` döndürür, **2** çıkış koduyla biter ve hiçbir şey kaydetmez. Doğru alanları seçerek yapılandırılmış işlem gönderin veya yeni `ai preview` akışını kullanın. Borç hareketi eşleşen mevcut veya aynı toplu planda tanımlanan borç gerektirir. Anahtar yoksa, bağlantı/biçim/kota hatasında kayıt yapılmaz; eski ayrıştırıcıya dönülmez.

OpenAI'a yazdığınız not, mevcut hesap/borç adları ve kimlikleri, türleri ve para birimleri ile güncel yerel tarih gönderilir. Yeni toplu akış ayrıca abonelik/düzenli ödeme adları ve kimlikleri ile para birimlerini ve varsa açık finans döneminin adını/kimliğini gönderir. Bütün işlem defteri, mevcut bakiyeler/abonelik ücretleri, e-posta ve giriş parolanız gönderilmez. İstek `store: false` kullanır; bu seçenek bütün sağlayıcı veri saklama politikalarının kapatılması anlamına gelmez. Uygulama [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) ile izinli işlem alanlarını alır. Model komut çalıştıramaz ve finans kurallarını değiştiremez.

Tarayıcı aynı planın başarısız onay isteğini yeniden gönderirken istek kimliğini korur. Sunucu başarılı kayıt sonucunu finans SQLite dosyasında atomik saklar; aynı kimlik ve not yeni işlem oluşturmaz. CLI ile kontrollü tekrar için `add "450 market" --request-id BENZERSIZ_KIMLIK` kullanın. Ayrı yeni kimlik yeni işlem anlamına gelir.

Anahtar özel 600 izinli `ai-config.json` dosyasında tutulur; varsayılan yer finans veritabanının klasörüdür. `FINANCE_AI_CONFIG` ile ayrı güvenli JSON yolu belirlenebilir. Sunucu modunda kaynak/release ağacının dışında olmalıdır; yerelde proje içindeki `data/` kullanılabilir. `OPENAI_API_KEY` ortam anahtarı dosyada anahtar yoksa kullanılabilir; panelde kaydedilen anahtar önceliklidir. Finans export'u ve finans/auth SQLite yedekleri bu anahtarı içermez. Yapılandırmayı ayrıca özel yedekleyin veya kurtarma sonrasında anahtarı panelden tekrar girin. Dosya düz metindir; disk şifrelemesi sağlamaz.

Kur tahmin etmeyin. Gerçek TL tutarı veya kur girmediğiniz sürece `24 USD`, USD olarak kalır. Para değerlerini `"24.10"` gibi en fazla iki ondalık basamaklı **metin** olarak girin. API çıktıları da ondalık metin kullanır. Bu uygulamada USDT de iki ondalık basamakla tutulur. Hesaplama ayrıntıları için [finans kurallarına](docs/FINANCE_RULES.md) bakın.

## Komut satırı

CLI, web uygulaması açıkken de aynı veritabanını kullanabilir. Makine tarafından okunabilir temiz çıktı için **`--json`** ekleyin. Projedeki npm ayarı komut başlığını susturur; bu komut doğrudan temiz JSON verir:

```sh
npm run finance -- context --json
```

Başarılı komutlar **0**, hatalar **1** çıkış kodu döndürür. Hatalar stderr kanalına yazılır. Belirsiz metin eklemesi stdout kanalında onay bilgisiyle **2** döndürür. JSON modunda hata çıktısı `error` alanı olan bir JSON nesnesidir. Yapılandırılmış girdi için **`--data`** veya **`--json-input`** kullanın; `--json` yalnızca çıktıyı yönetir.

Okuma komutları:

```sh
npm run finance -- status
npm run finance -- today
npm run finance -- context --json
npm run finance -- context --all --json
npm run finance -- report --from 2026-09-01 --to 2026-09-30
npm run finance -- report --cycle-id CYCLE_ID --json
npm run finance -- transactions --search market --currency TRY
npm run finance -- transactions --type EXPENSE --category Market --account-id ACCOUNT_ID --scope PERSONAL
npm run finance -- transactions --from 2026-09-01 --to 2026-09-30
npm run finance -- transactions --deleted --json
npm run finance -- accounts
npm run finance -- debts
npm run finance -- recurring
npm run finance -- subscriptions
npm run finance -- cycles
npm run finance -- audit --entity-id RECORD_ID --json
npm run finance -- help
```

`today`, yalnızca tarih içeren filtreler, vade durumları ve grafik günleri varsayılan olarak **Europe/Istanbul** saat dilimini kullanır. İsterseniz API ve CLI için aynı `FINANCE_TIMEZONE` IANA saat dilimini belirleyin. `--to`, seçilen günün tamamını içerir. Kesin sınırlar için saat dilimi içeren zaman damgaları kullanın. Açık bir tarih seçilmediğinde context/report/status akışları mevcut döngüyü kullanır; bakiyeler rapor sonuna kadar biriken durumu gösterir. Tüm geçmiş için `--all` ekleyin; `--from`/`--to` ile daraltabilirsiniz. `--cycle-id` seçilen döngünün varsayılan sınırlarını kullanır.

İşlem komutları:

```sh
npm run finance -- add --data '{"type":"EXPENSE","amount":"24.10","currency":"USD","description":"Alan adı yenileme","category":"Alan adı","scope":"BUSINESS"}' --json
npm run finance -- edit TRANSACTION_ID --data '{"amount":"25.00","category":"Alan adı"}'
npm run finance -- delete TRANSACTION_ID
npm run finance -- restore TRANSACTION_ID
npm run finance -- duplicate TRANSACTION_ID
```

Düzenleme, işlem alanlarının bir kısmını değiştirebilir. Silme geri alınabilir ve işlemi tüm finans toplamlarından çıkarır. Geri yükleme tüm defteri yeniden doğrular; bağlı borç ödemeleri geçersiz bir silmeyi veya geri yüklemeyi engelleyebilir. `tx edit|delete|restore|duplicate ID` ve `transactions edit|delete|restore|duplicate ID` aynı işlemleri yapar.

Hesaplar, borçlar, yükümlülükler ve abonelikler **`create --data JSON`**, **`edit ID --data JSON`** ve **`delete ID`** komutlarını destekler. `account`, `debt`, `subscription` tekil adları da kullanılabilir:

```sh
npm run finance -- accounts create --data '{"name":"Bankam","type":"BANK","currency":"TRY","openingBalance":"0.00"}'
npm run finance -- accounts edit ACCOUNT_ID --data '{"notes":"Kendi hesabım"}'
npm run finance -- accounts delete ACCOUNT_ID
npm run finance -- debts create --data '{"name":"Kredim","type":"LOAN","currency":"TRY","openingBalance":"1000.00"}'
npm run finance -- debts edit DEBT_ID --data '{"notes":"Kişisel kredi"}'
npm run finance -- debts delete DEBT_ID
npm run finance -- recurring create --data '{"name":"İnternet","amount":"300.00","currency":"TRY","frequency":"MONTHLY","dueDate":"2026-10-15"}'
npm run finance -- recurring edit OBLIGATION_ID --data '{"active":false}'
npm run finance -- recurring delete OBLIGATION_ID
npm run finance -- subscriptions create --data '{"service":"Servisim","amount":"12.00","currency":"USD","frequency":"YEARLY","nextRenewal":"2027-09-30","scope":"BUSINESS"}'
npm run finance -- subscriptions edit SUBSCRIPTION_ID --data '{"active":false}'
npm run finance -- subscriptions delete SUBSCRIPTION_ID
```

Bu örnekler otomatik çalıştırılmaz. Açılış bakiyeleri, işlemlerden önceki gerçek başlangıç durumunuzu tanımlar. Kredi kartı ve KMH hesapları bağlı borç oluşturur; kullanılabilir kredi limitleri varlıklara dahil edilmez. Geçmiş kayıtlarda referansı olan hesap veya borçlar silinemez.

Gerçek bir planlı ödeme için **`pay ID --data JSON`** kullanın. Muhasebe servisi gerçek gider oluşturur; girdi, yapılandırılmış `add` ile aynı işlem nesnesidir:

```sh
npm run finance -- recurring pay OBLIGATION_ID --data '{"type":"EXPENSE","amount":"300.00","currency":"TRY","description":"İnternet ödendi"}'
npm run finance -- subscriptions pay SUBSCRIPTION_ID --data '{"type":"EXPENSE","amount":"12.00","currency":"USD","description":"Yenileme ödendi"}'
npm run finance -- cycle start --name "Döngüm" --start 2026-09-30T00:00:00+03:00
npm run finance -- cycle end CYCLE_ID --end 2026-10-29T23:59:59+03:00
```

Döngü adı, başlangıcı ve bitişi isteğe bağlıdır; tarih verilmezse mevcut zaman kullanılır. `cycle list`, `cycles` ile eşdeğerdir.

## Yedekleme ve geri yükleme

```sh
npm run finance -- backup
```

**`backups/finance-YYYY-MM-DD-HHmm.sqlite`** altında tutarlı bir SQLite yedeği ve eşleşen **`.sqlite.metadata.json`** yan dosyası oluşturur. Aynı dakikada tekrarlanan veya eşzamanlı yedekler numaralı son ek alır. Yedek, WAL içindeki tamamlanmış kayıtları da içerir. SQLite dosyasıyla yan dosyayı birlikte saklayın; yan dosya şemayı ve kaynak veritabanı yolunu doğrular.

Geri yüklemeden önce uygulamayı **Ctrl+C** ile durdurun. Diğer CLI komutlarını da durdurun. Ardından:

```sh
npm run finance -- restore-backup backups/finance-YYYY-MM-DD-HHmm.sqlite
```

Geri yükleme; çalışan API, bozuk SQLite, farklı şema veya farklı veritabanı yoluna ait yedeği reddeder. Önce mevcut veritabanını yedekler ve saklanan `safetyBackup` yolunu döndürür. Sonra WAL dosyasını checkpoint ile temizler ve veritabanını atomik olarak değiştirir. Geri yüklenen durumu kontrol edene kadar güvenlik yedeğini saklayın. `npm run dev` veya `npm start` ile yeniden başlatın.

Çökme sonrası `data/api.pid` kalırsa işlem numarasının hâlâ çalışıp çalışmadığı kontrol edilir. Okunamayan işaret dosyası için uygulamayı durdurup eski dosyayı kaldırmanız gerekir. Başlatma sırasında sert kapanma nedeniyle `data/api.pid.claim` kalırsa tüm API süreçlerinin durduğunu kontrol edip bu başlatma kilidini kaldırın. Aynı veritabanı, farklı port veya sembolik yolla da olsa, yalnızca tek API tarafından açılabilir. Bu komut farklı bir yola geri yükleme veya eski şemaları dönüştürme yapmaz. Yedek ve dışa aktarma dosyaları yereldir ve şifrelenmez; kontrolünüzdeki bir konumda saklayın.

## Dışa aktarma

```sh
npm run finance -- export
```

**`exports/financial_snapshot.json`** ve **`exports/transactions.csv`** dosyalarını atomik olarak yazar. JSON; tüm saklanan finans kayıtlarını, silinmiş kayıtları, denetim izini ve bir AI asistanının okuyabileceği güncel hesaplanmış durumu içerir. CSV, silinmiş işlemleri de içerir. Para değerleri gerçek ondalık metin olarak korunur; elektronik tabloda formül olabilecek açıklama/kategori gibi metinler düz metin olarak kaçırılır. Bu komut önceki iki dışa aktarma dosyasını değiştirir; finans kayıtlarını değiştirmez.

## API ve doğrulama

[API.md](docs/API.md), `GET /api/ai/context` ve `POST /api/ai/transaction` dahil uçları açıklar. Yerel modda uzak kaynaklar reddedilir; sunucu modunda yalnızca ayarlanan HTTPS kaynağı ve yönetici oturumu kabul edilir. CLI, dosyaya erişimi olan güvenilir yerel kullanıcı için çalışır; tarayıcı parolası CLI için otomatik yetki sınırı değildir.

```sh
npm test
npm run typecheck
npm run build
```

Otomatik testler ayrı geçici veritabanları ve kontrollü sağlayıcı yanıtları kullanır. Muhasebe anlamlarını, API/CLI AI davranışını, belirsizlik ve çift kayıt korumasını, anahtar gizliliğini, parola değişimini, silme/geri yüklemeyi, dışa aktarmayı ve yedek güvenliğini doğrular. Gerçek OpenAI hesabına ücretli test isteği göndermezler; `data/finance.sqlite` dosyasını örnek kayıtlarla doldurmazlar.

AI yorumları hatalı olabilir; kaydedilen işlemleri kontrol edip düzenleyebilirsiniz. Banka içe aktarma, otomatik kur, yatırım değerleme, otomatik defter eşitleme, disk verisi şifreleme veya otomatik planlı tahsilat yoktur. Uygulama tek yöneticiye yönelik bir SQLite defteridir. Grafikler ve raporlar yalnızca sizin girdiğiniz gerçek kayıtları kullanır.
