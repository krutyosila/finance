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

Kur ve TRY tutarı elle girilir. Planlı ödemeler otomatik muhasebeleşmez. USDT dahil tutarlar iki ondalık basamakla tutulur. Açılış bakiyeleri defterin başlangıç durumudur; ayrıca bir geçerlilik tarihi taşımaz. Yedek geri yükleme aynı kaynak yolu ve şema için desteklenir. Detaylar [finans kurallarında](FINANCE_RULES.md) ve [kullanım kılavuzunda](../README.md).
