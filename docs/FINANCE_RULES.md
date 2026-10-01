# Finans kuralları

Web arayüzü, REST API ve CLI aynı `FinanceService` servisini kullanır. Servis etkin kaynak işlemlerini zaman damgası sırasıyla yeniden hesaplar; aynı zamandaki işlemlerde sabit veritabanı ekleme sırası kullanılır. Bakiyeler ve gösterge paneli toplamları bu kayıtlardan türetilir. Değiştirilebilir bir önbellek finansal gerçek kabul edilmez. Birden fazla kayıt ve denetim izi içeren yazmalar SQLite işlemi içinde yapılır; geçersiz bir değişiklik tamamen geri alınır.

## Para, para birimi ve tarihler

TRY, USD, EUR ve USDT, **iki ondalık basamaklı** tam sayı alt birimlerle tutulur. Para girdileri ve çıktıları ondalık metindir. Ayrıştırma, toplama ve kur çarpımı tam sayı aritmetiği kullanır. Güvenli tam sayı saklama/toplam sınırını aşan değerler reddedilir. Kur en fazla 12 ondalık basamak kabul eder. Açık kurla dönüşüm en yakın alt birime yuvarlanır; yarım alt birim eşitliği sıfırdan uzağa yuvarlanır. Kur sorgulanmaz veya tahmin edilmez.

Her toplam para birimi başına ayrı hesaplanır. `amountTRY` ve `exchangeRate` bilgileri ilgisiz bakiyeleri kurgusal bir TRY toplamında birleştirmez. Gerçek tüketim, işlemin asıl tutarı ve para biriminde kalır. Hem gerçek TRY tutarı hem kur verildiyse ödeme hesabı için açık gerçek TRY tutarı önceliklidir.

**TRY hesabından** yapılan döviz gideri/iadesi, `amountTRY` veya kurdan hesaplanan TRY tutarıyla açıkça ödenebilir. Bu tutar TRY nakit hesabını veya bağlı TRY borcunu değiştirir; gider/iade asıl para biriminde kalır. Döviz hesabı, TRY bilgisi olsa bile kendi para biriminde hareket eder. Diğer kaynak para birimi uyuşmazlıkları reddedilir. Gelir, borç kullanımı ve ödeme kaynak hesap/borç para birimiyle eşleşmelidir. Farklı para birimli transfer açık `destinationAmount` gerektirir; her hesap kendi para biriminde değişir.

İşlem zamanları ISO UTC olarak saklanır. Yalnızca tarih içeren kayıtlar, filtreler, grafik günleri ve vade durumları varsayılan olarak Europe/Istanbul kullanır. `FINANCE_TIMEZONE`, başka bir IANA saat dilimi seçebilir; API ve CLI için aynı değeri kullanın. Başlangıç günü yerel gece yarısından, bitiş günü o yerel günün sonuna kadar dahildir. Saat dilimli zaman damgaları kendi kesin anını korur.

Açılış bakiyeleri ayrı yürürlük tarihi olmayan, **işlem geçmişinden önceki** başlangıç değerleridir. Daha sonra oluşturulan hesabın açılış bakiyesi eski raporlara da uygulanır. Tarihli bakiye düzeltmesi için başlangıç değerini değiştirmek yerine `ADJUSTMENT` kullanın.

## İşlem etkileri

Nakit hesabı belirtilmezse işlem para birimindeki **atanmamış nakit** bakiyesi kullanılır; banka hesabı oluşturulmaz. Borç hesabının kredi kapasitesi varlık olmaz. Borca bağlı alışveriş/iade, nakit yerine borcu değiştirir.

| Tür                                | Nakit/varlık                                          | Gerçek gider       | Gelir              | Borç                         |
| ---------------------------------- | ----------------------------------------------------- | ------------------ | ------------------ | ---------------------------- |
| `INCOME`                           | Seçilen varlık hesabına veya atanmamış nakde eklenir  | Etkisiz            | Asıl tutar eklenir | Etkisiz                      |
| Nakit ödenen `EXPENSE`             | Gerçek ödeme tutarı hesaptan/atanmamış nakitten düşer | Asıl tutar eklenir | Etkisiz            | Etkisiz                      |
| Borçla finanse edilen `EXPENSE`    | Nakit değişmez                                        | Asıl tutar eklenir | Etkisiz            | Ödeme tutarı eklenir         |
| `DEBT_PAYMENT`                     | Nakit azalır                                          | **Etkisiz**        | Etkisiz            | Ödeme tutarı azalır          |
| `DEBT_USAGE`                       | Borç alınan nakit eklenir                             | **Etkisiz**        | **Etkisiz**        | Tutar eklenir                |
| `TRANSFER`                         | Kaynaktan düşer, hedefe eklenir                       | **Etkisiz**        | **Etkisiz**        | Etkisiz                      |
| `SAVINGS`                          | Nakit birikim hesabına veya sanal birikime taşınır    | **Etkisiz**        | **Etkisiz**        | Etkisiz                      |
| Nakit alışverişin `REFUND` işlemi  | Gerçek iade tutarı nakde eklenir                      | Asıl tutar düşer   | **Etkisiz**        | Etkisiz                      |
| Borçlu alışverişin `REFUND` işlemi | Nakit değişmez                                        | Asıl tutar düşer   | **Etkisiz**        | İade tutarı azalır           |
| Varlıkta `ADJUSTMENT`              | İşaretli tutar eklenir/düşer                          | Etkisiz            | Etkisiz            | Etkisiz                      |
| Borçta `ADJUSTMENT`                | Nakit değişmez                                        | Etkisiz            | Etkisiz            | İşaretli tutar eklenir/düşer |

Normal işlem tutarları pozitif olmalıdır. Düzeltmeler işaretli tutar kabul eder. Birikim, aynı rota üzerinden önceki birikimi çekmek için negatif tutar kabul eder. Çekim sanal birikimi veya birikim hesabını negatife düşüremez. Normal nakit bakiyeleri negatif olabilir; defter verilen bilgiyi kaydeder, başlangıç bakiyesi uydurmaz.

Borç kullanımı/ödeme mevcut bir borçla birlikte varlık hesabı veya atanmamış nakit kullanır. `debtId` borcu, `accountId` nakit hesabını belirler. Kredi kartı/KMH hesabı alışveriş, iade ve borç düzeltmesinde doğrudan kullanılabilir; borç alma veya ödeme için nakit kaynağı değildir. KMH, kredi, kişisel ve diğer borçlarda ödeme/iade, işlemin tarihindeki mevcut borcu aşamaz.

**Kredi kartına para yükleme** de `DEBT_PAYMENT` kullanır; kaynak banka/nakit hesabı `accountId`, kartın bağlı borcu `debtId` alanındadır. `CREDIT_CARD` bakiyesi içeride işaretlidir: pozitif değer kalan borç, negatif değer karta yatırılmış fazla para veya iadeden oluşan kart bakiyesidir. Borcu sıfır olan karta para yüklenebilir. Gelir/gider veya açılış borcu oluşturulmaz. Sonraki alışveriş önce bu kart bakiyesini kullanır; yalnız onu aşan kısım yeni borç olur. İade ve açık borç düzeltmesi de kart bakiyesi oluşturabilir. Karttan banka hesabına gerçekten geri alınan para `DEBT_USAGE` ile kaydedilir; önce kart bakiyesi azalır, aşan kısım varsa yeni borç olur. Bu yalnız gerçekleşmiş hareketin kaydıdır; banka işlemi başlatmaz.

Aynı para birimli transferde alınan ve gönderilen tutarlar eşit olmalıdır. Transfer farklı kaynak ve hedef varlık hesapları gerektirir. Birikim hedefi verilmezse sanal birikim kullanılır. Birikime giriş/çıkış, kullanılabilir nakit ve birikim sınıflamasını değiştirir; aynı para biriminde toplam varlık korunur. Farklı para birimli transfer yalnızca girilen tutarları kullanır; otomatik kur kazancı/zararı hesaplamaz.

## Ölçüt hesaplamaları

Akışlar seçilen rapor dönemini kullanır. Stoklar (nakit, birikim, varlık, borç, net durum) seçilen sona kadar önceki etkin işlemleri de içerir. Açık tarih seçilmediyse etkin döngü varsayılan başlangıç/bitiş sağlar; açık döngünün sabit bitişi yoktur. API'de `all=true`, CLI'da `--all` bu varsayılanı kaldırır. Açık tarih aralığı dönemi daraltır; döngü kimliği o döngünün varsayılan sınırlarını seçer. Döngü/filtre yoksa tüm kayıtlar kullanılır.

| Ölçüt                                 | Her para biriminde ayrı hesaplama                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Kullanılabilir Nakit**              | Etkin, birikim olmayan varlık hesaplarının açılış bakiyesi ve işlem hareketleri + atanmamış nakit. Birikim, borç hesapları ve limit hariçtir. `balances` aynı toplamdır.                                                                                                                                           |
| **Gelir**                             | Dönemdeki `INCOME` asıl tutarları. Borç kullanımı, iade ve iç transferler hariçtir.                                                                                                                                                                                                                                |
| **Gerçek Gider**                      | Dönemdeki `EXPENSE` asıl tutarları **eksi `REFUND` asıl tutarları**. Borçlu alışveriş dahildir. Dönemin iadeleri gideri aşarsa negatif olabilir. Borç ödeme, birikim ve transfer hariçtir.                                                                                                                         |
| **Nakit Çıkışı**                      | Dönemdeki nakit veya kart bakiyesinden ödenen giderler **+ gerçek borç ödemeleri**, ödeme para biriminde brüt toplam. Yeni borçla karşılanan alışveriş kısmı, karta fazla yatırılan tutar, transfer ve birikim aktarımı hariçtir. İadeler bu brüt ölçütten düşülmez. Birikim hesabından doğrudan harcama dahildir. |
| **Borç**                              | Etkin borçların rapor sonundaki pozitif bakiyelerinin toplamı. Her bağlı kredi hesabı yalnızca borç kaydı üzerinden bir kez sayılır. Bir kartın fazla bakiyesi başka borcu azaltmaz.                                                                                                                               |
| **Ödenen Borç** / `debtPayments`      | Dönemdeki `DEBT_PAYMENT` işlemlerinin mevcut pozitif borcu azaltan kısmı. Karta fazla yatırılan tutar, borç iadesi ve negatif düzeltmeler dahil değildir.                                                                                                                                                          |
| **Yeni Borç Kullanımı** / `debtUsage` | Dönemdeki `DEBT_USAGE` ve anapara bileşenli borçlu alışverişlerin pozitif borcu artıran kısmı, borcun para biriminde. Kart bakiyesinden karşılanan tutar yeni borç sayılmaz. Faiz/ücret alışverişleri ve tahakkuk düzeltmeleri bu kullanım ölçütüne dahil değildir.                                                |
| **Birikim** / `savings`               | Birikim hesaplarının mevcut bakiyesi + sanal birikim. Açılış birikimi dahil rapor sonundaki stoktur.                                                                                                                                                                                                               |
| **Birikim Hareketi** / `savingsAdded` | Dönemde kullanılabilir nakitten birikime aktarılanlar − nakde geri çekilenler. Yalnızca birikim havuzları arasında hareket etkisizdir.                                                                                                                                                                             |
| **Net Nakit Akışı**                   | Kullanılabilir nakdi etkileyen dönem hareketleri: nakit gelir/gider/iade, borç alma/ödeme, varlık düzeltmeleri ve birikim giriş/çıkışları. Doğrudan birikim hesabındaki gelir/harcama kullanılabilir nakdi değiştirmez. Birikim olmayan hesaplar arası normal transferler, farklı para biriminde olsa da hariçtir. |
| **Varlıklar**                         | Birikim dahil tüm etkin varlık hesaplarının bakiyesi + atanmamış nakit + sanal birikim + karttaki fazla bakiye. Kart bakiyesi kullanılabilir nakde dahil değildir; kullanılmayan kredi limiti varlık değildir.                                                                                                     |
| **Net Finans Durumu**                 | Rapor sonunda varlıklar − mevcut borç. Para birimleri ayrı kalır.                                                                                                                                                                                                                                                  |
| **Açılış Durumu** / `openingPosition` | Dönem başlangıcından hemen önce varlıklar − borç; aynı açılış değerleri kullanılır. Başlangıç yoksa tüm işlemlerden önceki başlangıç durumudur.                                                                                                                                                                    |
| **Durum Değişimi** / `positionChange` | Bitiş/güncel net finans durumu − açılış durumu. İyileşme para birimi bazında ölçülür.                                                                                                                                                                                                                              |
| **Kategori Toplamları**               | Dönem giderleri − iadeler, kategori ve asıl para birimine göre.                                                                                                                                                                                                                                                    |
| **İş / Kişisel Toplamları**           | Dönem giderleri − iadeler, `scope` ve asıl para birimine göre.                                                                                                                                                                                                                                                     |
| **İşlem Sayısı**                      | Dönemdeki etkin işlem sayısı. Son işlemler, bunların en yeni en fazla 20 tanesidir.                                                                                                                                                                                                                                |

Aynı para biriminde borç ödeme nakdi ve borcu eşit azaltır; gerçek tüketimi ve net finans durumunu değiştirmez. Nakit borç alma varlık ve borcu eşit artırır. Nakit gider varlık ve net durumu azaltır; borçlu alışveriş borcu artırarak net durumu düşürür. İade ilgili tüketim etkisini geri çevirir. Aynı para birimli iç transfer/birikim net durumu korur.

Farklı para birimli transferlerde bakiyeler para birimi bazında hareket ederken normal transfer net nakit akışına dahil edilmez; bu nedenle kullanılabilir nakit değişimi ölçütten farklı olabilir. Açılış bakiyesi düzenlemesi de gelir/gider veya işlem nakit akışı yaratmadan stokları değiştirir.

## Borç ayrıntısı ve kredi hesapları

Borç **güncel bakiyesi**, açılış bakiyesi + tüm etkin borç hareketleridir; yalnız `CREDIT_CARD` için negatif değer kart bakiyesini temsil eder. Ayrıntılar durum nesnesinin sonuna kadar birikimli değerlerdir: `payments` pozitif borcu azaltan ödemeler; `newUsage`, borçlu gider ve pozitif anapara düzeltmesi dahil gerçek pozitif borç artışları; `interest` ve `fees`, `debtComponent` değeri `INTEREST` veya `FEE` olan pozitif tahakkukların tamamıdır. Kart bakiyesinden karşılanan anapara yeni kullanım değildir, ancak faiz/masrafın tamamı ilgili bileşende görünür. Negatif düzeltme/iade bakiyeyi azaltır ama borç ödeme olarak sınıflanmaz. `netChange`, işaretli güncel bakiye − açılış bakiyesidir.

Tahakkuk eden faiz/ücreti uygun bileşenli borç düzeltmesiyle kaydedin. Gider olarak sayılacak gerçek tüketimse o bileşenle borçlu gider kaydedin. Faiz veya ücret otomatik hesaplanmaz. Limit bilgi amaçlıdır; kullanılmayan limit varlık sayılmaz.

Kredi kartı/KMH hesabı atomik olarak bir bağlı borç oluşturur. `currentDebt` o borcun pozitif kısmıdır; `currentBalance` işaretli borcun negatifidir. Kartta 3000 TL varsa `currentBalance=3000.00`, `currentDebt=0.00` ve bağlı borç `currentBalance=-3000.00` olur. Hesap ve borç ekranları bunu **Kart bakiyesi** olarak gösterir. Bankada 5000 TL varken borçsuz karta 3000 TL yatırılması banka bakiyesini 2000 TL, kart bakiyesini 3000 TL yapar; varlık ve net durum 5000 TL, gelir/gider ve ödenen borç sıfırdır. Kartın borcu 1000 TL ise aynı yatırmada ödenen borç 1000 TL, kart bakiyesi 2000 TL olur; nakit çıkışı da yalnız bu gerçek borç ödemesini sayar, net nakit akışı bankadan çıkan 3000 TL'nin tamamını içerir.

Ayrı borçlar da elle oluşturulabilir. Kredi hesabında `openingBalance` negatif olamayan açılış borcudur; oluştururken `currentDebt` bu başlangıcı belirleyebilir. Mevcut borç düzenlemesi ödeme işlemi eklemek yerine başlangıcı hareketlere göre ayarlar. Kart bakiyesi varken zaten sıfır olan `currentDebt` değerini tekrar sıfır göndermek kart bakiyesini silmez; farklı güncel borç açıkça girilirse işaretli gerçek bakiye üzerinden başlangıç yeniden hesaplanır. Hesap türü ve borcun hesap bağlantısı değiştirilemez.

## Döngüler, planlar ve grafikler

Döngüler özel başlangıç/bitiş aralıklarıdır; sınırlar dahildir. Aynı anda tek açık döngü olabilir ve kapalı aralıklar çakışamaz. Açılış/kapanış durumu sınırların çevresindeki defterden türetilir; döngü ayrıca bakiye kopyası tutmaz. Açık döngünün güncel durumu geçici kapanış durumudur.

Düzenli yükümlülük ve abonelikler **plandır**. Beklenen tutarlar gider, borç veya nakit toplamlarına katılmaz. Gerçek bağlı gider, belirli vade/yenileme tarihine ait dönemi ödenmiş yapar. Ödeme, gerçekleşen tutarla normal giderdir; beklenen tutardan farklı olabilir. Ödemeyi silmek ödenmiş durumunu kaldırır; geri yüklemek doğrulama sonrası geri getirir. `pay` ile ödenmiş dönem ikinci kez ödenemez.

Vade durumu ayarlı saat dilimindeki bugüne göre belirlenir: ödenmemiş geçmiş tarih gecikmiş, diğerleri yaklaşandır. Pasif abonelik iptal edilmiş görünür. Sıklık bilgi amaçlıdır: **servis tarihleri ilerletmez, gelecek dönem oluşturmaz, otomatik tahsilat yapmaz**. Sonraki dönem için `dueDate` veya `nextRenewal` elle güncellenir. Geçmiş ödeme dönemleri defterde kalır. Planı silmek/pasifleştirmek gerçek geçmiş işlemleri korur.

Günlük grafik noktaları seçilen gerçek işlem günleridir. Günlük gelir/gider/borç hareketi o güne, nakit bakiyesi o gün sonuna kadar önceki kayıtlara dayanır. Sahte noktalar, örnek alışverişler veya gelecekteki plan tutarları finansal gerçek olmaz. Abonelik/yükümlülük raporları saklanan planları gerçek kayıtlarla birlikte gösterir; kategori ve iş/kişisel raporları kaydedilen işlem sınıflarını kullanır.

## Değişiklikler ve denetim

İşlem ekleme, düzenleme, silme ve geri yükleme defteri doğrular; önce/sonra değerlerini denetim izine kaydeder. Silme geri alınabilirdir; silinmiş işlem hiçbir toplama katılmaz. Bir borç alma kaydını silmek sonraki ödeme için yetersiz borç bırakıyorsa reddedilir. Geri yükleme de aradaki değişiklikler geçmişi geçersiz kılıyorsa reddedilir. Başarısız işlem tamamen geri alınır.

Silinmiş işlemler dahil geçmişte referansı olan hesap/borçlar silinemez; geri yüklemenin anlamı korunur. Bağlı kredi hesabını kaldırmak referansı olmayan borcunu da atomik kaldırır. Planlar kaldırılabilir, önceki gerçek giderler korunur. Tam durum dışa aktarma silinmiş kayıtları, ham kaynak kayıtlarını, hesaplanmış durumu ve denetim izini içerir. Bu inceleme biçimidir; SQLite yedek/geri yüklemenin yerini tutmaz.

Defter; vergi muhasebesi, yatırım fiyatı, alacak, amortisman planı, kur değerleme kazancı/zararı, otomatik tekrar veya banka mutabakatı modellemez. Her finans kaydı kullanıcının açık girdisinden gelir.
