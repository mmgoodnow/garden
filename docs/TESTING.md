# Testing

This project ships with a mock login site and a sample script for repeatable end-to-end checks.

## Start the servers

1) Start the Garden server (requires an encryption key):

```bash
export APP_ENC_KEY_BASE64="$(openssl rand -base64 32)"
bun run dev
```

2) Start the mock login site in a second terminal:

```bash
bun run mock:site
```

The mock site listens on `http://localhost:4001` with these default credentials:
- username: `test@example.com`
- password: `password123`

## Curl flow (create site -> upload script -> set creds -> run)

1) Create a site (capture the new site id):

```bash
SITE_ID=$(curl -i -s -X POST http://localhost:3000/sites \
  -F "name=Mock Site" \
  -F "domain=localhost" \
  | awk -F'/' '/Location:/ {print $NF}' | tr -d '\r')

echo "SITE_ID=$SITE_ID"
```

2) Upload the mock script JSON from `testing/mock-script.json`:

```bash
SCRIPT_JSON=$(python3 - <<'PY'
import json
with open('testing/mock-script.json', 'r', encoding='utf-8') as f:
    print(json.dumps(json.load(f)))
PY
)

curl -s -X POST http://localhost:3000/api/scripts \
  -H "Content-Type: application/json" \
  -d "{\"siteId\": ${SITE_ID}, \"script\": ${SCRIPT_JSON}}"
```

3) Set the credentials for the mock site:

```bash
curl -i -s -X POST http://localhost:3000/sites/${SITE_ID}/credentials \
  -F "username=test@example.com" \
  -F "password=password123"
```

4) Kick off a run:

```bash
curl -i -s -X POST http://localhost:3000/sites/${SITE_ID}/run
```

5) Verify the result:

- Visit `http://localhost:3000/sites/${SITE_ID}` to see run status and screenshots.
- The screenshot is stored in the database (use the UI link to view it).

## Notes

- If you change the mock site port or credentials, update `testing/mock-script.json` or the values you POST.
- The mock site is intentionally minimal; add fields or flows there as runner capabilities grow.
