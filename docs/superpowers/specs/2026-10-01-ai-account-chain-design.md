# AI ile hesaplar ve bağlı para hareketleri

Kullanıcının mevcut evrensel AI girişine verdiği açık kapsam düzeltmesi: adı geçen hesap yoksa oluştur; para gelişini, döviz çevrimini ve hesaplar arası aktarımı aynı nottan birlikte işle. Mevcut önizleme ve kullanıcı onayı korunur.

Paribu örneği üç hareket içerir: Paribu USD'ye 2500 USD gelir, Paribu USD'den Paribu TRY'ye gerçek TL karşılığıyla döviz transferi, Paribu TRY'den VakıfBank TRY'ye 90000 TRY transfer. Gelir yalnız ilk harekettir; transferler yeni gelir veya gider değildir. Her hesap tek para birimindedir; aynı kurumun USD ve TRY hesapları ayrı takip edilir.

Mevcut hesaplar ad ve para birimiyle bulunup tekrar kullanılır. Tek bir uygun mevcut hesap varsa modelin yeni hesap taslağı da yerel olarak o hesaba bağlanır. Birden fazla uygun hesap varsa seçim sorulur. Kullanıcının kendi hesaplarının para birimlerini değiştirmek veya mevcut bakiyesini ezmek bu kapsamda değildir.

Yeni bir hesap yalnız bu nottaki hareketleri kaydetmek için oluşturuluyorsa, belirtilmeyen açılış bakiyesi kayıt başlangıcı olarak 0 olur. Bu varsayım önizlemede not olarak açıkça görünür; geçmiş bakiye ek bilgiyle düzeltilebilir. Açıkça verilen açılış bakiyesi korunur. Bağımsız hesap/bakiye ve kredi/borç tanımlarında mevcut açık bakiye şartı devam eder. Gelen 2500 USD açılışa ayrıca yazılmaz.

İlk örnekte çevrimden elde edilen toplam TL bilinmiyor. 90000 TRY sonraki transfer tutarıdır; çevrim toplamı veya kalan değildir. AI bütün bilinen taslakları koruyup net TL karşılığını sorar. Döviz transferi hedef TRY ise açıkça verilen kaynak döviz başına TRY kuru mevcut tam sayı para aritmetiğiyle hedef tutara çevrilebilir. Çelişkili kur ve hedef tutar onayı engeller. Güncel piyasa kuru kullanılmaz.

Tanımlar hareketlerden önce oluşturulur; hareketler tarih sırası ve eşit tarihlerde anlatım sırasıyla kaydedilir. Tarihsiz hareketler tek ortak kayıt zamanını kullanır. Tüm işlemler atomiktir ve mevcut tekrar korumasını kullanır; önizleme hiçbir kalıcı değişiklik yapmaz.

Önizlemede hesap bağlantıları para birimini gösterir. Tamamlanan örnekte 100000 TRY karşılık verilirse yeni hesap bakiyeleri Paribu USD 0, Paribu TRY 10000 ve VakıfBank TRY 90000 olmalıdır. Önceden bulunan bakiyeler bu hareketlerle birlikte korunur.

Motorun muhasebe kuralları, veritabanı ve işlem türü değişmez. Hesap oluşturmanın mevcut alan/para doğrulaması saf bir yardımcı olarak paylaşılır; hesap yeniden kullanılmadan önce de uygulanır. Modelin açık bakiyesi veya limiti mevcut hesabın başlangıcıyla çelişirse seçim/netleştirme istenir; başka tür tahminiyle ikinci hesap oluşturulmaz. Genel AI anlamanın sınırsız olduğu iddia edilmez; eksik ve çelişkili bilgi soru olarak kalır. Sentetik testler kişisel veya canlı finans kayıtlarına yazılmaz.
