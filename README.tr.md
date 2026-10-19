<p align="center">
  <a href="https://nami.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Nami logo">
    </picture>
  </a>
</p>
<p align="center">Açık kaynaklı yapay zeka kodlama asistanı.</p>
<p align="center">
  <a href="https://nami.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/nami-ai"><img alt="npm" src="https://img.shields.io/npm/v/nami-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/nami/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/nami/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>


---

### Kurulum

```bash
# YOLO
curl -fsSL https://nami.ai/install | bash

# Paket yöneticileri
npm i -g nami-ai@latest        # veya bun/pnpm/yarn
scoop install nami             # Windows
choco install nami             # Windows
brew install anomalyco/tap/nami # macOS ve Linux (önerilir, her zaman güncel)
brew install nami              # macOS ve Linux (resmi brew formülü, daha az güncellenir)
sudo pacman -S nami            # Arch Linux (Stable)
paru -S nami-bin               # Arch Linux (Latest from AUR)
mise use -g nami               # Tüm işletim sistemleri
nix run nixpkgs#nami           # veya en güncel geliştirme dalı için github:anomalyco/nami
```

> [!TIP]
> Kurulumdan önce 0.1.x'ten eski sürümleri kaldırın.

### Masaüstü Uygulaması (BETA)

Nami ayrıca masaüstü uygulaması olarak da mevcuttur. Doğrudan [sürüm sayfasından](https://github.com/anomalyco/nami/releases) veya [nami.ai/download](https://nami.ai/download) adresinden indirebilirsiniz.

| Platform              | İndirme                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `nami-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `nami-desktop-mac-x64.dmg`     |
| Windows               | `nami-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` veya AppImage       |

```bash
# macOS (Homebrew)
brew install --cask nami-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/nami-desktop
```

#### Kurulum Dizini (Installation Directory)

Kurulum betiği (install script), kurulum yolu (installation path) için aşağıdaki öncelik sırasını takip eder:

1. `$RSMRTK_INSTALL_DIR` - Özel kurulum dizini
2. `$XDG_BIN_DIR` - XDG Base Directory Specification uyumlu yol
3. `$HOME/bin` - Standart kullanıcı binary dizini (varsa veya oluşturulabiliyorsa)
4. `$HOME/.nami/bin` - Varsayılan yedek konum

```bash
# Örnekler
RSMRTK_INSTALL_DIR=/usr/local/bin curl -fsSL https://nami.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://nami.ai/install | bash
```

### Ajanlar

Nami, `Tab` tuşuyla aralarında geçiş yapabileceğiniz iki yerleşik (built-in) ajan içerir.

- **build** - Varsayılan, geliştirme çalışmaları için tam erişimli ajan
- **plan** - Analiz ve kod keşfi için salt okunur ajan
  - Varsayılan olarak dosya düzenlemelerini reddeder
  - Bash komutlarını çalıştırmadan önce izin ister
  - Tanımadığınız kod tabanlarını keşfetmek veya değişiklikleri planlamak için ideal

Ayrıca, karmaşık aramalar ve çok adımlı görevler için bir **genel** alt ajan bulunmaktadır.
Bu dahili olarak kullanılır ve mesajlarda `@general` ile çağrılabilir.

[Ajanlar](https://nami.ai/docs/agents) hakkında daha fazla bilgi edinin.

### Dokümantasyon

Nami'u nasıl yapılandıracağınız hakkında daha fazla bilgi için [**dokümantasyonumuza göz atın**](https://nami.ai/docs).

### Katkıda Bulunma

Nami'a katkıda bulunmak istiyorsanız, lütfen bir pull request göndermeden önce [katkıda bulunma dokümanlarımızı](./CONTRIBUTING.md) okuyun.

### Nami Üzerine Geliştirme

Nami ile ilgili bir proje üzerinde çalışıyorsanız ve projenizin adının bir parçası olarak "nami" kullanıyorsanız (örneğin, "nami-dashboard" veya "nami-mobile"), lütfen README dosyanıza projenin Nami ekibi tarafından geliştirilmediğini ve bizimle hiçbir şekilde bağlantılı olmadığını belirten bir not ekleyin.

---

**Topluluğumuza katılın** [Discord](https://discord.gg/nami) | [X.com](https://x.com/nami)
