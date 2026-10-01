# Açık sayfayı aşağı çekerek yenileme

Mobilde, sayfanın en üstündeyken içerik alanını bir parmakla aşağı çekip bırakmak açık sayfanın tüm kaynaklarını yeniler. Mevcut sayfa, filtreler, rapor sekmesi ve düzenlenen ayar taslakları korunur. Gösterge son istek de tamamlanana kadar görünür; hata halinde eski içerik korunur ve yeniden deneme sunulur.

Hareket yatay, yukarı yönlü, çok parmaklı veya iptal edilmişse yenileme başlamaz. Form kontrolleri, kaydırılabilir alt alanlar, açık diyalog/menü, klavye odağı, yakınlaştırma, çevrimdışı durum ve devam eden yenileme bu hareketi engeller. Gösterge üst başlığın altında sabit durur; sayfanın yüksekliğini veya alt menünün konumunu değiştirmez.

Kaynaklar beklenebilir yeniden yükleme işlevlerini sayfa sağlayıcısına kaydeder. Kök finans bağlamı ile açık sayfa kaynakları birlikte başlatılır ve tüm sonuçlar beklenir. Eski sayfa/filtre/istek yanıtları daha yeni veriyi ezemez. Ayar formu temizse yenilenen model gösterilir; kullanıcı yazmaya başladıysa taslak korunur.

Doğrulama: hareket durum makinesi testleri, kaynak bekleme ve eski yanıt testleri, sentetik API yanıtlarıyla mobil tarayıcı akışları; hata ve gecikmede filtre/form korunumu. Kullanıcının önceki yayın yetkisiyle doğrulanmış sürüm canlıya alınır.
