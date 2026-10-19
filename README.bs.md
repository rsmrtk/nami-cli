<p align="center">
  <a href="https://nami.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Nami logo">
    </picture>
  </a>
</p>
<p align="center">Nami je open source AI agent za programiranje.</p>
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

### Instalacija

```bash
# YOLO
curl -fsSL https://nami.ai/install | bash

# Package manageri
npm i -g nami-ai@latest        # ili bun/pnpm/yarn
scoop install nami             # Windows
choco install nami             # Windows
brew install anomalyco/tap/nami # macOS i Linux (preporučeno, uvijek ažurno)
brew install nami              # macOS i Linux (zvanična brew formula, rjeđe se ažurira)
sudo pacman -S nami            # Arch Linux (Stable)
paru -S nami-bin               # Arch Linux (Latest from AUR)
mise use -g nami               # Bilo koji OS
nix run nixpkgs#nami           # ili github:anomalyco/nami za najnoviji dev branch
```

> [!TIP]
> Ukloni verzije starije od 0.1.x prije instalacije.

### Desktop aplikacija (BETA)

Nami je dostupan i kao desktop aplikacija. Preuzmi je direktno sa [stranice izdanja](https://github.com/anomalyco/nami/releases) ili sa [nami.ai/download](https://nami.ai/download).

| Platforma             | Preuzimanje                        |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `nami-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `nami-desktop-mac-x64.dmg`     |
| Windows               | `nami-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, ili AppImage       |

```bash
# macOS (Homebrew)
brew install --cask nami-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/nami-desktop
```

#### Instalacijski direktorij

Instalacijska skripta koristi sljedeći redoslijed prioriteta za putanju instalacije:

1. `$RSMRTK_INSTALL_DIR` - Prilagođeni instalacijski direktorij
2. `$XDG_BIN_DIR` - Putanja usklađena sa XDG Base Directory specifikacijom
3. `$HOME/bin` - Standardni korisnički bin direktorij (ako postoji ili se može kreirati)
4. `$HOME/.nami/bin` - Podrazumijevana rezervna lokacija

```bash
# Primjeri
RSMRTK_INSTALL_DIR=/usr/local/bin curl -fsSL https://nami.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://nami.ai/install | bash
```

### Agenti

Nami uključuje dva ugrađena agenta između kojih možeš prebacivati tasterom `Tab`.

- **build** - Podrazumijevani agent sa punim pristupom za razvoj
- **plan** - Agent samo za čitanje za analizu i istraživanje koda
  - Podrazumijevano zabranjuje izmjene datoteka
  - Traži dozvolu prije pokretanja bash komandi
  - Idealan za istraživanje nepoznatih codebase-ova ili planiranje izmjena

Uključen je i **general** pod-agent za složene pretrage i višekoračne zadatke.
Koristi se interno i može se pozvati pomoću `@general` u porukama.

Saznaj više o [agentima](https://nami.ai/docs/agents).

### Dokumentacija

Za više informacija o konfiguraciji Nami-a, [**pogledaj dokumentaciju**](https://nami.ai/docs).

### Doprinosi

Ako želiš doprinositi Nami-u, pročitaj [upute za doprinošenje](./CONTRIBUTING.md) prije slanja pull requesta.

### Gradnja na Nami-u

Ako radiš na projektu koji je povezan s Nami-om i koristi "nami" kao dio naziva, npr. "nami-dashboard" ili "nami-mobile", dodaj napomenu u svoj README da projekat nije napravio Nami tim i da nije povezan s nama.

---

**Pridruži se našoj zajednici** [Discord](https://discord.gg/nami) | [X.com](https://x.com/nami)
