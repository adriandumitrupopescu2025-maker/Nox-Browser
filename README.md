# Nox Browser

**Nox Browser** este un browser web minimalist și manager local de fișiere construit pe **Electron**, conceput pentru a maximiza spațiul util pe verticală și a oferi control complet asupra datelor personale, fără telemetrie sau servicii cloud obligatorii.

## Caracteristici principale

* **Layout cu benzi laterale înguste (`44px`):** Tab-uri verticale pe marginea stângă, marcaje și foldere verticale pe marginea dreaptă, lăsând întreaga zonă centrală disponibilă pentru conținut.
* **Bară superioară ascunsă la cerere:** Bara de navigare și adrese este extinsă implicit, dar poate fi ascunsă sau reafisată printr-un singur clic pe butonul din colțul stânga-sus (`▲` / `▼`) sau cu scurtătura `Ctrl + L`.
* **Zoom inteligent per domeniu:** Reglaj din butoanele panoului (`-` / `+` / `↺`), prin scurtături (`Ctrl + +`, `Ctrl + -`, `Ctrl + 0`) sau `Ctrl + rotița mouse-ului`, cu memorare automată per domeniu și valoare implicită configurabilă în Setări.
* **Split-View nativ:** Împărțire rapidă a tab-ului activ pe verticală (`✂️V`) sau orizontală (`✂️H`), fiecare panou având navigare proprie.
* **Manager de fișiere integrat:** Navigare directă în folderele locale cu suport drag-and-drop între directoare.
* **Ad-Blocker și teme:** Blocare integrată a reclamelor (activabilă/dezactivabilă din meniu) și comutare rapidă între tema **Dark** și **Light**.
* **Parole criptate local & Istoric:** Salvare și completare automată a parolelor criptate local, cu vizualizare și copiere din tab dedicat.
* **Sincronizare opțională Self-Hosted (PHP / MySQL):** Posibilitate de sincronizare a marcajelor, setărilor și parolelor criptate folosind propriul server PHP/MySQL.

## Structura proiectului

```text
nox-browser/
├── nox-browser-react/        # Aplicația desktop Electron
│   ├── build/                # Resurse grafice (icon.png)
│   ├── index.html            # Structura interfeței și modalul de setări
│   ├── main.js               # Procesul principal Electron și handlerele IPC
│   ├── password-preload.js   # Script preload pentru capturare/autofill parole
│   ├── renderer.js           # Logica UI, tab-uri, split-view, zoom și sync
│   ├── styles.css            # Stiluri și teme Dark / Light
│   └── package.json          # Dependințe și configurare build
└── nox-sync/                 # Server opțional de sincronizare (PHP + MySQL)
    ├── nox-sync.sql          # Structura bazei de date (tabelul user_sync_state)
    └── sync.php              # Endpoint API pentru Push / Pull

==============================================================================
## Previzualizare

### Fereastra principală (benzi laterale verticale)
![Nox Browser — Fereastra principală](screenshots/01.png,02.png)

### Split-View & Manager local de fișiere
![Nox Browser — Split-View și Manager de fișiere](screenshots/03.png)

### Manager local de fișiere & Dark theme
![Nox Browser — Manager local de fișiere și Dark theme](screenshots/04.png)

### Settings
![Nox Browser — Setări Browser](screenshots/05.png)

==============================================================================
## Compilare și sincronizare bază de date

### Compilare din sursă (Electron)
1. Intră în folderul aplicației și instalează dependențele:
   ```bash
   cd nox-browser-react
   npm install

2. Rulează aplicația în modul de dezvoltare sau generează pachetele cu electron-builder:
    ```bash
    npm start
    npm run build:deb
    npm run build:rpm
    npm run dist:win

================================================================================
### Sincronizare opțională cu bază de date (PHP + MySQL)

Aplicația funcționează complet local, dar opțional poți activa sincronizarea marcajelor, setărilor și parolelor criptate pe propriul server:

    Creează o bază de date MySQL și importă schema din nox-sync/nox-sync.sql

    Pune fișierul nox-sync/sync.php pe un server web cu PHP + extensia MySQL (mysqli/PDO) și configurează credențialele bazei de date în el.

    Introdu URL-ul endpoint-ului sync.php în setările de sincronizare din Nox Browser.
