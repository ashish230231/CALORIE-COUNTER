# Calorie Counter

A self-hosted calorie and nutrition tracker that runs entirely on your own computer.
One `docker compose` command starts everything: the web UI, the API and a Postgres database.
Your data never leaves your machine.

- **About 13,700 foods with complete nutrient profiles** from USDA FoodData Central: lab-analysed Foundation Foods, SR Legacy and FNDDS dishes. That covers calories, macros, vitamins, minerals, fatty acids and amino acids.
- **Precise:** values are stored per 100 g and scaled exactly to what you log, using real household portions (cups, slices, pieces).
- **Personal targets:** calories come from Mifflin-St Jeor × your activity level and goal; vitamin and mineral targets come from the official Dietary Reference Intakes.
- Custom foods, a recipe builder, barcode lookup (Open Food Facts), water and weight tracking, and trends.
- Automatic daily database backups to the `backups/` folder, plus JSON export and restore.

---

## 1. Requirements

- **Docker** with Docker Compose v2:
  - Windows or macOS: install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
  - Linux: install Docker Engine and the Compose plugin.
- About 1 GB of free disk space.
- An internet connection **on first start only**. The app downloads about 13 MB of USDA data once.

Check that Docker works:

```bash
docker --version
docker compose version
```

## 2. Start the app

Open a terminal in this folder (the one containing `docker-compose.yml`) and run:

```bash
docker compose up -d --build
```

Then open **http://localhost:8080** in your browser.

On the very first start the app downloads and imports the USDA food database. This takes about 1–2 minutes, and a progress bar appears at the top of the page. You can follow it with:

```bash
docker compose logs -f backend
```

When you see `Imported 5,432 foods`, the import is finished. Press `Ctrl+C` to stop following the logs; the app keeps running.

## 3. Everyday commands

| What | Command |
| --- | --- |
| Start (in the background) | `docker compose up -d` |
| Stop (**keeps all your data**) | `docker compose down` |
| See what's running | `docker compose ps` |
| View logs | `docker compose logs -f` |
| Restart | `docker compose restart` |
| Update after changing the code | `docker compose up -d --build` |

The containers restart automatically when Docker starts, so after a reboot the app is back at http://localhost:8080 once Docker Desktop is running.

> ⚠️ **Never run `docker compose down -v`** unless you really want to wipe everything.
> The `-v` flag deletes the database volume, which holds your diary, foods and profile.

## 4. Your data and backups

All data lives in a Docker volume named `calorie-counter_pgdata`. It survives stops, restarts, reboots and updates.

**Automatic backups:** the `backup` service writes a full database dump to the `backups/` folder once a day and keeps the newest 7. Each file is about 5 MB.

Make a backup right now:

```bash
docker compose exec db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backups/manual-backup.dump
```

Restore a backup. **This replaces the current data:**

```bash
# macOS / Linux / Git Bash / WSL
sh scripts/restore.sh backups/calorie-20261008T164915Z.dump
```

```powershell
# Windows PowerShell
docker compose stop backend backup
Get-Content backups\calorie-20261008T164915Z.dump -AsByteStream -Raw | docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose start backend backup
```

**JSON export:** go to *Settings → Export my data*. You get a portable file with your profile, diary, weights, water, custom foods and recipes. *Restore from JSON* merges it back in without creating duplicates. Use this to move to another computer.

## 5. Configuration (optional)

Every setting has a default. To change one, copy `.env.example` to `.env`, edit it, then run `docker compose up -d`.

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_PORT` | `8080` | Port the app is served on |
| `POSTGRES_PASSWORD` | `calorie` | Database password (the database is not exposed outside Docker) |
| `USDA_AUTO_IMPORT` | `true` | Import the USDA data on first start |
| `OPENFOODFACTS_ENABLED` | `true` | Allow barcode lookups (sends only the barcode) |
| `BACKUP_INTERVAL_HOURS` | `24` | How often automatic backups run |
| `BACKUP_KEEP` | `7` | How many automatic backups to keep |

## 6. Troubleshooting

**Port 8080 is already in use.** Set `APP_PORT=8090` in `.env`, run `docker compose up -d`, then open http://localhost:8090.

**The food database didn't load (no internet / firewall).** Download these three files from https://fdc.nal.usda.gov/download-datasets on any computer and put them in the `data/usda/` folder:

- `FoodData_Central_foundation_food_csv_2026-04-30.zip`
- `FoodData_Central_sr_legacy_food_csv_2018-04.zip`
- `FoodData_Central_survey_food_csv_2024-10-31.zip`

Then click **Settings → Retry import**, or run `docker compose restart backend`.

**Something looks broken.** Check the container status and the logs:

```bash
docker compose ps
docker compose logs backend --tail 100
```

**Start completely fresh.** ⚠️ This deletes all your data, so export a backup first:

```bash
docker compose down -v
docker compose up -d --build
```

## 7. What's inside

| Service | Tech | Purpose |
| --- | --- | --- |
| `frontend` | React + TypeScript + Vite, served by nginx | The UI on port 8080; proxies `/api` to the backend |
| `backend` | Python FastAPI + asyncpg | API, USDA importer, nutrition maths |
| `db` | PostgreSQL 17 | All data; full-text and fuzzy search indexes |
| `backup` | `pg_dump` loop | Daily backups into `./backups` |

Data sources: [USDA FoodData Central](https://fdc.nal.usda.gov/) (public domain) and [Open Food Facts](https://world.openfoodfacts.org/) (ODbL). This app is not medical advice.
