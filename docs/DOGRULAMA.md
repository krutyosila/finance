# Teslim doğrulaması

1 Ekim 2026, Europe/Istanbul.

- `npm test`: 11 test dosyasında 151 test geçti.
- `npm run build`: TypeScript kontrolü ve Vite üretim derlemesi başarılı.
- Web arayüzü: Türkçe hızlı giriş, belirsiz işlem onayı, açıklama düzenleme, çoğaltma, silme, geri yükleme ve hesap oluşturma geçici veritabanında doğrulandı.
- 375 piksel görünümde genel bakış, onay formu ve işlemler sayfası kontrol edildi. Sayfa genişliği 375 piksel; işlem tablosu kendi alanında yatay kayıyor.
- Gerçek CLI ve API geçici veritabanında aynı işlem ve bakiyeleri döndürdü. CLI yedekleme ve dışa aktarma komutları çalıştırıldı.
- Yedekten geri yükleme, eşzamanlı yedekleme, çalışan API koruması ve sembolik yol koruması otomatik testlerde doğrulandı.
- Yerel uygulama `127.0.0.1:5173`, API `127.0.0.1:4317` üzerinde başlatıldı.
- Yerel kullanım veritabanı: proje kökündeki `data/finance.sqlite`.
- Teslim anında doğrudan SQL sayımları: işlemler, hesaplar, borçlar, yükümlülükler, abonelikler, döngüler ve denetim kaydı tablolarının **her birinde 0 kayıt**. SQLite bütünlük kontrolü: `ok`.
- Teslim veritabanında API ve CLI finansal toplamları eşleşti. Hiçbir finans kaydı eklenmedi.

Tüm yazma denemeleri ayrı geçici veritabanlarında yapıldı. Bu kayıtlar kişisel kullanım veritabanına aktarılmadı.

Sunucu giriş testleri HTTPS/origin kısıtlarını, güvenli cookie'yi, süre sonunu, scrypt parolaları, yanlış parola sınırını, kota dolduğunda dahi çıkışı ve yanlış veritabanı yolunda iki veri deposunun korunmasını doğruladı. PWA testleri API yanıtlarının önbellekten dışlanmasını, geç gelen yanıtların çıkıştan sonra kullanılmamasını, sekmeler arası çıkışı ve odak dönüşünde geçerli oturumdaki formun korunmasını doğruladı.

## HTTPS dağıtım doğrulaması

- Sunucuda aynı 151 test ve üretim derlemesi geçti. Diğer uygulamaların Node sürümü değiştirilmedi.
- Gerçek HTTPS sağlık isteği 200; girişsiz finans isteği 401 ve `Cache-Control: no-store`; HTTP isteği HTTPS'ye 301 döndü.
- Yönetici girişi, çıkış ve ikinci sekmedeki finans ekranının kapanması tarayıcıda doğrulandı. Finans API ve sunucu CLI sonuçları, isteğe özgü oluşturulma saati dışında aynıydı.
- Manifest, 512 piksel ikon ve ayrı pencere kurulum ayarları gerçek adreste erişilebilir. 375 piksel telefon görünümü ve işlem önizlemesi kontrol edildi; deneme işlemi kaydedilmedi.
- Kaynak güncellemesi GitHub'dan alındı; finans ve kimlik yedeklerinden sonra test edilmiş üretim sürümüne geçildi. Son kontrolde yedi finans tablosunun her birinde 0 kayıt, ayrı kimlik deposunda 1 yönetici ve iki SQLite bütünlük kontrolünde `ok` sonucu vardı.
- Finans ve kimlik dosyaları `finance` kullanıcısına ait 600 izinli dosyalardır. Ortam dosyası root:600; bir kerelik sunucu parola dosyası kaldırıldı.

Bu doğrulamalar gerçek finans verisi içermez. Açık kaynak örnekleri örnek alan adı ve e-posta kullanır; gerçek sunucu adresi, yönetici bilgileri, parolalar ve veritabanları depoya eklenmez. GitHub Actions iş akışı tanımlıdır; hesabın çalıştırma yetkisi ayrıca gereklidir.

Kur ve TRY tutarı elle girilir. Planlı ödemeler otomatik muhasebeleşmez. USDT dahil tutarlar iki ondalık basamakla tutulur. Açılış bakiyeleri defterin başlangıç durumudur; ayrıca bir geçerlilik tarihi taşımaz. Yedek geri yükleme aynı kaynak yolu ve şema için desteklenir. Detaylar [finans kurallarında](FINANCE_RULES.md) ve [kullanım kılavuzunda](../README.md).

## Mobil arayüz güncellemesi — 1 Ekim 2026

- `npm test`: 26 dosyada 399 test geçti. Yerel bağlantı açan testler sandbox dışında doğrulandı.
- `npm run build`: TypeScript kontrolü ve üretim derlemesi geçti.
- `scripts/check-mobile-ui.mjs`, derlenmiş üretim önizlemesinde 1.552 tarayıcı kontrolünü hatasız tamamladı. Boyutlar: 320×568, 375×667, 390×844, 430×932, 768×1024, 844×390, 932×430 ve 1280×900.
- Sekiz ekran, bütün rapor sekmeleri, uzun kesintisiz adlar, büyük tutarlar ve birden fazla para birimiyle sayfa/panel/form genişlikleri kontrol edildi. İşlem ve rapor tablolarında mobil yatay kaydırma kalmadı.
- Alt menüden bütün ekranlarda ana sayfaya dönüş, yuvarlak + düğmesi, yalnız modal içindeki AI girişi, AI önizlemesi, elle giriş, hesap/borç/ödeme/abonelik formları, geçmiş, silme ve dönem pencereleri kontrol edildi.
- Menü ve modal kapatma, klavye odağı, formun alt düğmelerine dikey kaydırmayla ulaşma, giriş ve bağlantı hatası ekranları doğrulandı.
- Dört kenarda güvenli alan boşluğu simüle edildi; kaydırılan modal başlığı çentik boşluğunun altında kaldı. 390 ve 1280 piksel genişliklerde yalnız `visualViewport` yüksekliği/üst konumu değiştirilerek klavye açılmasına benzer durum doğrulandı.
- PWA önbellek geçişi testi önce eski sürümde hata verdi, ardından güncel sürümde geçti. Yeni manifest ve çevrimdışı ekran yenilenir; eski uygulama önbelleği temizlenir, diğer uygulamaların önbelleği korunur ve özel API istekleri önbelleği kullanmaz.
- Her ekran boyutunda tarayıcıdaki kurulum yönlendirmesi, tam ekran açılışında kurulu durumu ve tarayıcıdan tam ekrana geçişte kurulu durumuna güncelleme doğrulandı.

Tarayıcı kontrolleri sentetik API yanıtları kullanır; gerçek finans veritabanına veya OpenAI'ye istek göndermez. Güvenli alan, klavye ve kurulum modu tarayıcıda simüle edilir; fiziksel telefon/PWA kurulumu bu kontrollerin kapsamı dışındadır.

Yeniden çalıştırmak için bir uygulama önizlemesi açıp `MOBILE_QA_URL=http://127.0.0.1:4173 node scripts/check-mobile-ui.mjs` kullanın. Script mevcut Playwright kurulumunu veya Codex'in paketli tarayıcı çalışma ortamını kullanır; farklı bir kurulum için `PLAYWRIGHT_MODULE` verilebilir. Ekran görüntüleri ve JSON raporu geçici klasörde saklanır.
