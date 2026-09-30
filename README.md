# Still Finance

Yerelde veya kendi HTTPS sunucunuzda çalışan kişisel finans uygulaması. Web arayüzü, REST API ve komut satırı aynı SQLite muhasebe servisini kullanır. Yerel kullanımda internet gerekmez; sunucu kullanımında telefon/bilgisayar aynı sunucu defterine bağlanır. Bulut veritabanı, AI aboneliği veya internetten kur alma yoktur. Başlangıçta örnek finans kaydı oluşturulmaz.

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

Hedef yönetici e-postası **admin@example.com**. Yönetici oluşturmak veya parolayı sıfırlamak için parolayı komut satırına/ortam örneğine yazmayın. Yalnızca sahibi tarafından okunabilen, komutu çalıştıran kullanıcıya ait tek satırlı bir parola dosyası kullanın; parola en az 16 karakter olmalıdır:

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

**Ne oldu?** alanına Türkçe finans metni yazın veya CLI kullanın:

```sh
npm run finance -- add "450 market"
npm run finance -- add "128000 ödeme geldi"
npm run finance -- parse "24 USD domain yenilendi" --json
```

Bu örnekleri yalnızca gerçek işlemlerinizi ifade ediyorsa çalıştırın. Yerel ayrıştırıcı yaygın finans ifadelerini tanır. Belirsiz kayıtlar web arayüzünde onay formuna gider. CLI ise `{ "saved": false, "confirmation": ... }` döndürür, **2** çıkış koduyla biter ve hiçbir şey kaydetmez. Doğru alanları siz seçerek yapılandırılmış işlem gönderin. Borç kaydı eşleşen mevcut bir borç gerektirir; birden fazla eşleşme varsa onay gerekir.

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

Otomatik testler ayrı geçici veritabanları kullanır. Muhasebe anlamlarını, ortak servis/API/CLI davranışını, ayrıştırıcı onayını, silme/geri yüklemeyi, dışa aktarmayı ve yedek güvenliğini doğrular. `data/finance.sqlite` dosyasını örnek kayıtlarla doldurmazlar.

Ayrıştırıcı belirli Türkçe ifadelerle sınırlı ve deterministiktir. Banka içe aktarma, dış AI bağlantısı, otomatik kur, yatırım değerleme, otomatik defter eşitleme, disk verisi şifreleme veya otomatik planlı tahsilat yoktur. Uygulama tek yöneticiye yönelik bir SQLite defteridir. Grafikler ve raporlar yalnızca sizin girdiğiniz gerçek kayıtları kullanır.
