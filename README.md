# Diktafon

**[→ Živé demo](https://frontend-production-cf83.up.railway.app)**

Chytrý hlasový zapisovač rozhovorů s automatickým přepisem a sumarizací. Nahrávej po segmentech, sleduj přepis v reálném čase a získej shrnutí celého sezení.

## Co umí

- Nahrávání s pause/resume, rozdělené do segmentů
- Automatický přepis pomocí OpenAI Whisper (gpt-4o-transcribe)
- Sumarizace každého segmentu i celého sezení (GPT-4o mini)
- Funguje jako PWA — lze nainstalovat na plochu telefonu nebo počítače
- Zamezí uspání obrazovky během nahrávání (Wake Lock API + fallbacky)
- Export sezení do markdown souboru nebo sdílení přes nativní sheet

## Použití

### Jako webová aplikace

Otevři frontend URL v prohlížeči a začni nahrávat tlačítkem mikrofonu.

### Jako aplikace na ploše (doporučeno)

Přidání na plochu umožní spustit Diktafon jako nativní aplikaci bez lišty prohlížeče — ideální pro nahrávání na telefonu.

**iOS (Safari):**
1. Otevři stránku v Safari
2. Klepni na tlačítko Sdílet (čtvereček se šipkou)
3. Vyber **"Přidat na plochu"**
4. Potvrď název a klepni na **Přidat**

**Android (Chrome):**
1. Otevři stránku v Chrome
2. Klepni na tři tečky (menu)
3. Vyber **"Přidat na plochu"** nebo **"Nainstalovat aplikaci"**
4. Potvrď instalaci

**Desktop Chrome / Edge:**
1. Otevři stránku
2. V adresním řádku klikni na ikonu instalace (šipka dolů s monitorem)
3. Klikni na **"Nainstalovat"**

Po instalaci se Diktafon chová jako nativní aplikace — má vlastní okno, ikonu na ploše a funguje přes celou obrazovku.

## Stack

| Část | Technologie |
|------|-------------|
| Frontend | React 19 + Vite + Tailwind CSS 4 |
| Backend | FastAPI + OpenAI API |
| Hosting | Railway (backend) + statický hosting (frontend) |
| Přepis | gpt-4o-transcribe (OpenAI Whisper) |
| Sumarizace | GPT-4o mini |

## Lokální vývoj

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Doplň OPENAI_API_KEY do .env
uvicorn main:app --reload
```

Backend poběží na `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
# Vytvoř .env.local s:
# VITE_BACKEND_URL=http://localhost:8000
npm run dev
```

Frontend poběží na `http://localhost:5173`.

## Deploy

Backend i frontend jsou nasazeny na Railway.

- Backend: `https://api-production-4a78.up.railway.app`
- Frontend: `https://frontend-production-cf83.up.railway.app`

Pro vlastní deploy: backend má připravený `Dockerfile` a `railway.toml`. Frontend se builduje přes `npm run build` a nasadí jako statické soubory.

## Bezpečnost

Backend je chráněn Bearer tokenem a rate limitingem.

**Nastavení:**

1. Vygeneruj tajný token (např. `openssl rand -hex 32`)
2. Nastav ho na backendu: `API_SECRET=<token>`
3. Nastav ho na frontendu: `VITE_API_SECRET=<token>`
4. Volitelně omez CORS na konkrétní URL: `ALLOWED_ORIGINS=https://tvuj-frontend.vercel.app`

Pokud `API_SECRET` není nastaven, autentizace je vypnuta — vhodné pro lokální vývoj.

**Rate limity (per IP):**
- `/sessions` — 20 požadavků/minutu
- `/segments` — 60 požadavků/minutu
- `/sessions/*/summary` — 30 požadavků/minutu

## Poznámky

- Sezení jsou uložena pouze v paměti — restart serveru smaže všechna sezení
- Přepis funguje primárně pro češtinu (nastaveno `language="cs"`)
