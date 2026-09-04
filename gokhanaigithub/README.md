# gokhan.ai — güvenli giriş ve kayıt sistemi

Terminal görünümlü giriş ekranı + kullanıcı yönetimi + giriş kayıtları (IP, ad soyad, e-posta, cihaz).

## Neler var
- **Giriş** — kimlik veya e-posta ile. Şifreler `scrypt` ile hash'lenir, düz metin hiçbir yerde tutulmaz.
- **Kaba kuvvet koruması** — 5 hatalı denemede hesap 15 dakika kilitlenir; IP başına dakikalık istek sınırı.
- **Oturum** — HttpOnly + SameSite=Strict çerez, oturum anahtarı veritabanında yalnızca SHA-256 özeti olarak durur.
- **Zorunlu şifre değişimi** — geçici şifreyle giren kullanıcı kendi şifresini belirlemeden ilerleyemez.
- **Kullanıcı yönetimi** (yönetici) — ekleme, yetki, kapatma, silme, şifre sıfırlama, kilit açma.
- **Giriş kayıtları** (yönetici) — zaman, ad soyad, e-posta, kimlik, IP, cihaz, sonuç; arama ve CSV dışa aktarma.
- **Açık oturumlar** (yönetici) — kim, nereden, hangi cihazla, ne zamana kadar.

## Kurulum
```bash
npm install
export DATABASE_URL="postgresql://kullanici:sifre@sunucu:5432/veritabani"
export ADMIN_USERNAME=gokhan
export ADMIN_EMAIL=ornek@ornek.com
export ADMIN_DISPLAY_NAME="Ad Soyad"
export ADMIN_PASSWORD="ilk-gecici-sifre"   # boş bırakılırsa rastgele üretilir ve log'a yazılır
npm start
```
Tablolar açılışta otomatik oluşturulur. İlk yönetici yalnızca kullanıcı tablosu boşken üretilir.

## Yapay zeka ayarları

Anahtar tanımlanmazsa sistem **demo** cevabı verir — her şey çalışır, hiçbir ücret işlemez.

```bash
export AI_PROVIDER=gemini          # gemini | groq | openrouter | anthropic
export AI_API_KEY=...              # aistudio.google.com üzerinden ücretsiz alınır
export AI_MODEL=gemini-3.6-flash   # boş bırakılırsa sağlayıcının varsayılanı

# isteğe bağlı "gizli mod" — hassas dosyalar ücretli/özel sağlayıcıya gider
export AI_SECURE_PROVIDER=anthropic
export AI_SECURE_API_KEY=...
export AI_SECURE_MODEL=claude-sonnet-5

# kullanıcı başına sınır
export AI_MONTHLY_TOKEN_LIMIT=3000000
export AI_DAILY_REQUEST_LIMIT=300
```

Dosyalar modele ham gönderilmez: Excel/CSV sunucuda tabloya ve sütun özetlerine,
PDF ve Word metne çevrilir. 300 satırlık bir Excel yaklaşık 1.000 token'a iner.

## Ortam değişkenleri
| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantı adresi (zorunlu) |
| `NODE_ENV` | `production` olduğunda çerez `Secure` işaretlenir |
| `PORT` | Varsayılan 3000 |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_DISPLAY_NAME` / `ADMIN_PASSWORD` | İlk yönetici hesabı |

## Sayfalar
| Yol | İçerik |
|---|---|
| `/` | Giriş ekranı |
| `/change.html` | Şifre değiştirme (ilk girişte zorunlu) |
| `/panel.html` | Panel — yönetici için kayıtlar/kullanıcılar/oturumlar, kullanıcı için kendi bilgileri |
| `/healthz` | Sağlık kontrolü |

## Notlar
- Şifre sıfırlama yöneticinin panelden ürettiği geçici şifreyle yapılır; geçici şifre bir kez gösterilir.
- Denetim kayıtları 180 gün saklanır, sonrası otomatik temizlenir.
