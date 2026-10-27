# Zetaris platform

This repository contains two related pieces: a UPSC Mains Answer Evaluator (React/Vite frontend, FastAPI backend and Scout intent sidecar) and the local Zetaris Lightning platform it can connect to. The evaluator can run independently of the Zetaris Docker stack; JDBC-backed evaluation history is optional.

## UPSC Mains Answer Evaluator

The application evaluates a candidate answer on clarity of thought, depth of analysis, and language and expression. The frontend sends the question and answer separately to FastAPI. Every request passes through Scout before the backend runs a workflow. Scout signs an execution contract; FastAPI verifies its signature, expiry, user and allowed capabilities before calling the evaluator. Unsupported or blocked requests do not reach the model.

### Architecture

![UPSC Mains Evaluator architecture](<UPSC Mains Evaluator Architecture Flow.png>)

```text
Browser (Vite :5173)
    └── POST /agent/message ──> FastAPI (:8000)
                                  ├── Scout sidecar (:8765): route, guard, signed contract
                                  ├── Model provider: evaluate and return criterion scores/feedback
                                  └── Optional Zetaris JDBC history
```

The frontend uses backend mode by default and expects FastAPI at `http://localhost:8000`. For local sample mode, explicitly set `VITE_USE_MOCK=true`; sample results are generated in the browser and are not AI evaluations.

### Main directories

| Path | Purpose |
|---|---|
| `frontend/` | React, TypeScript and Vite user interface; form, score cards, evidence, suggestions and result mapping. |
| `backend/app/api/` | FastAPI endpoints for agent messages, health and runtime configuration. |
| `backend/app/schemas/` | Pydantic request and response contracts. |
| `backend/app/services/` | Agent workflow, rubric evaluation, in-memory evaluation lookup and history service. |
| `backend/app/integrations/` | Scout client, model providers, Meterless Runtime and Zetaris JDBC/history clients. |
| `backend/app/tests/` | Mocked API, history, provider and integration tests. The Scout live test is opt-in. |
| `scout/src/` | Scout intent routing, safety checks, contract signing and local HTTP sidecar. |
| `scout/test/`, `scout/evals/` | Scout unit tests and routing evaluation harness. |
| `jdbc/` | Zetaris Lightning JDBC driver used by the backend. |
| `patches/` | Original project patch files; these are not needed to run the application. |
| `docker-compose.yml`, `init/`, `initdb/`, `conf/`, `caddy/` | Local Zetaris platform stack and its initialization/configuration. |

### Requirements

- Node.js 20.19+ (or 22.12+) and npm for the Vite frontend; Node.js 18.19+ and npm for Scout.
- Python with the dependencies in `backend/requirements.txt`, plus a working JDK 17 for the Zetaris JDBC integration.
- A model provider configured for the backend. Meterless Runtime is the default provider in code; the NVIDIA-compatible provider is also supported.
- Scout and FastAPI must share the same `SCOUT_SIGNING_SECRET`. Keep provider tokens and signing secrets in local configuration only; never put them in frontend `VITE_` variables or commit them.
- Optional: a reachable Zetaris Lightning JDBC endpoint if evaluation history persistence is enabled.

### Local setup and run (Windows PowerShell)

Use three terminals from the repository root. Keep existing `.env` files; do not replace them with examples if they contain your local configuration.

**1. Scout sidecar**

```powershell
cd C:\Users\hanut\Downloads\zetaris-platform\scout
npm.cmd install
$env:SCOUT_SIGNING_SECRET = "<the same local secret configured for FastAPI>"
npm.cmd run serve
```

Scout listens on `127.0.0.1:8765` by default. Set the same signing secret in `backend/.env` (key `SCOUT_SIGNING_SECRET`) before starting the backend. The value is a secret; do not paste it into source files or share it.

**2. FastAPI backend**

Configure `backend/.env` with the local provider settings and shared Scout signing secret. Meterless Runtime settings can also be managed through the runtime API endpoints listed below. Then run:

```powershell
cd C:\Users\hanut\Downloads\zetaris-platform\backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` for the API documentation. `GET /health` checks that the process is running; `GET /agent/health` reports Scout and model-runtime connectivity. `GET /health/zetaris` performs a JDBC discovery probe and should only be used when Zetaris is available.

**3. Frontend**

```powershell
cd C:\Users\hanut\Downloads\zetaris-platform\frontend
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The example config selects backend mode and `http://localhost:8000`. Vite reads environment files at startup; restart it after changing `.env.local`. FastAPI CORS allows the Vite origins `localhost:5173` and `127.0.0.1:5173`.

Command Prompt users can use `copy .env.example .env.local` instead of PowerShell's `Copy-Item`, and `npm.cmd` for npm commands.

### API contract and evaluation behavior

The browser calls `POST /agent/message` with this shape:

```json
{
  "message": "Evaluate my UPSC Mains answer",
  "question": "The UPSC question text",
  "answer": "The candidate's answer text",
  "user_id": "anonymous-browser-id"
}
```

The `message` phrase is an intent seed recognized by Scout; keep it unchanged for evaluation requests. The backend accepts questions up to 2,000 characters and answers up to 8,000 characters. Subject, marks and word-limit controls help the frontend but are not part of the backend evaluation request.

On success, `evaluation` contains an `evaluation_id`, `overall_score`, `max_score`, and criterion entries with `key`, `label`, `score`, `feedback`, `evidence` and `suggestions`. Each criterion score is out of 10. The frontend maps those backend fields into the result view and shows persistence status when provided. It converts blocked, clarification, routing and model errors into user-facing messages rather than rendering incomplete scores.

The backend also supports Scout-routed explanation, improvement-suggestion and history requests. Follow-up explanation/improvement calls reference an earlier `evaluation_id`; the current frontend focuses on the evaluation workflow.

The browser-generated `user_id` scopes history requests; it is not authentication. Evaluation lookup is in memory and is cleared when the backend restarts. Zetaris history persistence is separately controlled by `ZETARIS_HISTORY_ENABLED` (disabled by default) and requires a working Lightning JDBC configuration and a valid history table setting. The evaluation can still be returned when history saving is unavailable; the response reports whether it was saved.

### Meterless Runtime and provider settings

The backend exposes these runtime endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /agent/runtime/provider` | Show the configured provider identity/default URL. |
| `GET /agent/runtime/status` | Check whether the Meterless Runtime is configured and reachable. |
| `GET /agent/runtime/models` | List available Meterless model ids. |
| `PUT /agent/runtime/config` | Save local runtime URL, token and model settings. |
| `POST /agent/runtime/auto-detect` | Probe for a compatible runtime. |
| `POST /agent/runtime/test-generation` | Send a small runtime connectivity/generation check. |

The configured runtime token is stored in ignored backend-local state when set through the API. Environment configuration is available for headless runs. Never configure credentials in the frontend. A successful mocked test does not establish that a real provider is online.

### Checks

Run from each package directory:

```powershell
# Frontend type check and production build
cd frontend
npm.cmd run typecheck
npm.cmd run build

# Backend tests (review local backend configuration first; the Scout live test is opt-in)
cd ..\backend
python -m pytest

# Scout unit tests and official routing harness
cd ..\scout
npm.cmd test
npm.cmd run evals
```

`frontend` also has `npm run check:backend`. It always checks local request/response mapping and, if a backend answers, runs live checks that include a synthetic evaluation request. That live check may call the configured model provider and should only be run when that is intended.

### Troubleshooting

| Symptom | Check |
|---|---|
| “Backend address is not configured” | Restart Vite; backend mode now defaults to `http://localhost:8000`. If `.env.local` defines `VITE_API_BASE_URL`, ensure it has the backend origin only (no `/agent/message`). |
| Browser CORS error | Use `http://localhost:5173` or `http://127.0.0.1:5173`; restart FastAPI after backend CORS changes. |
| `503` from `/agent/message` | Check `/agent/health`, Scout availability, and that Scout/backend signing secrets match. |
| Model unavailable | Check `/agent/runtime/status` and provider credentials/configuration; do not put tokens in frontend config. |
| Evaluation returned but not saved | Check `ZETARIS_HISTORY_ENABLED`, JDBC connection settings, table configuration and the response's `persistence` status. |

---

The remainder of this README documents the local Zetaris Lightning Docker Compose platform, which is separate from the evaluator services above.

The platform as seven containers on one machine, managed with Docker Compose. No cluster, no build step.

```
postgres --(healthy)--> driver --(healthy)--> api --(healthy)--> ui
     +-- init --(completed)--+                            +----> bootstrap
```

| Service | Ports | What it is |
|---|---|---|
| `postgres` | internal | metastore and audit databases |
| `init` | -- | one-shot: volume ownership and the shared keypair |
| `driver` | 10000, 4040 (local only) | the query engine; creates the organisation and its administrator on first start |
| `api` | 8888, 8889 (local only) | REST API |
| `ui` | 3000 | the web interface |
| `bootstrap` | -- | one-shot: the sample data |

`init` and `bootstrap` finish as `Exited (0)`. That is success; they are setup jobs, not services.

## Install

Ten minutes of work, plus twenty waiting for a download and a first start.

**1. Install Docker.** Docker Desktop on macOS or Windows, `docker-ce` on Linux. In its settings give Docker **8 GB of memory** and 4 CPUs -- the default is usually less, and the query engine will not start without it.

**2. Unzip the download.**

```bash
unzip zetaris-platform.zip
cd zetaris-platform
```

**3. Sign in to the image registry.** Paste the command from the Zetaris Cloud download page — it carries your username and password, so there is nothing to type.

```bash
docker login zetarishackathon.azurecr.io
```

**4. Check the machine can run it.**

```bash
./preflight.sh
```

Fix anything it reports as FAIL before going on — it is checking the things that otherwise fail twenty minutes later with an error that does not mention them, the registry sign-in above among them.

**5. Set an administrator password before starting.** Edit `ZETARIS_ADMIN_PASSWORD` in your local `.env` and choose a unique password — at least 8 characters with a lower case letter, an upper case letter, a digit, and one of `$ @ ! % * ? &`. Other punctuation is rejected, and the rejection does not appear until several minutes into the first start. Keep `.env` private; it contains credentials and is excluded by `.gitignore`.

**6. Download the images.** About 4 GB, so 5-15 minutes:

```bash
docker compose pull
```

**7. Start it.**

```bash
docker compose up -d
```

The first start takes 5-10 minutes. `init` and `bootstrap` ending as `Exited (0)` is success -- they are setup jobs, not services.

**8. Check it worked.**

```bash
./verify.sh
```

Nine checks, ending with a query that travels the whole stack. It also tells you when the slow first-start step has finished.

**9. Open <http://localhost:3000>** and sign in with the administrator email and password configured in your local `.env`. Change the password from the user menu, top right, next to Sign out if you want to rotate it.

### On a server instead

A machine other than your own needs HTTPS: the interface uses browser APIs that exist only in a secure context, and `localhost` is the sole exception. Over plain HTTP anywhere else, sign-in fails with `crypto.randomUUID is not a function`.

Steps 1-4 are the same. Then:

```bash
cp .env.server.example .env
# set ZETARIS_ADMIN_PASSWORD -- there is no default in this file, because it puts the
#   platform on a public address -- and replace <public-ip> in the three addresses with
# this machine's public IP, hyphenated: 54.1.2.3 becomes 54-1-2-3
docker compose pull
docker compose up -d
```

Open 80 and 443 to the internet. Any name ending `.<ip>.sslip.io` resolves through public DNS with no record to create, so Caddy obtains a real certificate on first start, and the platform is at `https://lightning.<public-ip>.sslip.io`.

For a private address that no certificate authority can validate, set `CADDY_GLOBAL_OPTIONS=local_certs`. Caddy signs its own and the browser warns once.

### If something fails

`./verify.sh` names the component. The usual causes:

| What you see | Cause |
|---|---|
| `pull access denied` | step 4 was skipped |
| driver never becomes healthy | Docker has too little memory -- run `./preflight.sh` |
| `crypto.randomUUID is not a function` | reached over plain HTTP at something other than localhost |
| `bootstrap: still running` | not finished yet; it loads the sample data |
| no `NY_TAXI` or `TPCDS_DB` | the machine could not reach S3 -- see `sample-data-seed.log` in the `driver-logs` volume |

## Sample data

The first start registers the same sample datasets a Zetaris Cloud cluster gets, so instructions written for one work on the other. Both are read in place from the public bucket `s3a://zetaris-public-dataset`, so the machine needs outbound internet.

| Database | Tables | Format |
|---|---|---|
| `NY_TAXI` | 15, e.g. `customers`, `trips`, `yellow_taxi`, `taxi_zones` | CSV |
| `TPCDS_DB` | 24, the TPC-DS schema, e.g. `store_sales`, `item`, `date_dim` | Parquet |

Try `SELECT * FROM NY_TAXI.customers LIMIT 10`.

## Sizing

| | Query engine | For |
|---|---|---|
| `.env` | 2 GB, 2 cores | a laptop |
| `.env.server.example` | 4 GB, 4 cores | an instance with room |

The query engine uses exactly the heap it is given, so this is the one choice that decides how fast queries run. **Do not use the server file on a laptop** -- it asks for 6 GB of heap across the driver and API, and on a smaller machine the driver never starts, with a Spark error that says nothing about memory.

## Tuning the query engine

Heap and cores come from `.env`:

| | |
|---|---|
| `ZSPARK_DRIVER_MEM` | how much heap the query engine gets -- the setting that decides query speed |
| `ZSPARK_DRIVER_CORES` | cores it may use |
| `ZSPARK_MASTER_URL` | `local[2]` runs Spark in-process with two threads |

Everything else is in `conf/spark-defaults.conf`, which the driver reads at startup. It ships with the useful settings commented out beside their defaults, so you can see what is available without reading Spark's documentation:

```bash
vi conf/spark-defaults.conf
docker compose restart driver
```

The one worth knowing about is `spark.sql.shuffle.partitions`. Spark defaults to 200, which is sized for a cluster; on two cores that is 200 small tasks queueing, and lowering it near your core count is usually the largest single improvement.

Heap and cores cannot be set in that file. The driver is launched with them on the command line, and a command line wins -- so `spark.driver.memory` there is ignored silently.

## Connecting over JDBC

The query engine listens on port 10000 on this machine. Tools that speak JDBC -- DBeaver, DataGrip, Tableau, your own Java or Python code -- connect to it through the driver in `jdbc/`.

| | |
|---|---|
| Driver file | `jdbc/ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar` |
| Driver class | `com.zetaris.lightning.jdbc.LightningDriver` |
| URL | `jdbc:zetaris:lightning@localhost:10000` |
| User / password | the account you sign in to the web interface with |

- **Use this jar, not a generic Hive or Spark driver.** It is the only driver that understands the `jdbc:zetaris:lightning@` URL, and it bundles everything it needs, so add the one file to your tool and nothing else.
- **In DBeaver:** Database -> Driver Manager -> New, add the jar under Libraries, set the class and URL above, then create a connection with that driver.
- **Only from this machine.** Port 10000 is bound to `127.0.0.1` because the connection is unencrypted. To reach it from elsewhere, tunnel it: `ssh -L 10000:localhost:10000 <server>`, then connect to `localhost:10000` as above.
- **Port 10000 already taken?** Set `DRIVER_PORT` in `.env`, run `docker compose up -d`, and use that port in the URL.
- **Nothing answers until the driver is healthy.** `./verify.sh` tells you when it is.

## Day to day

```bash
docker compose ps
docker compose logs -f driver
docker compose down          # stop, keep the data
docker compose down -v       # stop and delete everything, including the metastore
```

**Back up `.env`.** It holds the field-encryption keypair's password. Without it, stored datasource credentials cannot be recovered.

## Two things worth knowing

**The keypair is generated once.** `init` writes it into a shared volume on first start, and both the driver and the API read the same copy. `docker compose down -v` destroys it along with everything encrypted with it.

**`init` runs as root and `api` has `group_add`.** A new Docker volume belongs to root until something claims it, so one container takes ownership. The driver and the API then run as different users sharing that tree through a common group.
