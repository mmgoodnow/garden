const PORT = Number.parseInt(process.env.MOCK_PORT ?? "4001", 10);
const VALID_USERNAME = process.env.MOCK_USERNAME ?? "test@example.com";
const VALID_PASSWORD = process.env.MOCK_PASSWORD ?? "password123";
const COOKIE_NAME = "mock_session";
const COOKIE_VALUE = "ok";
const CAPTCHA_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAO0lEQVR42u3OMREAIBAEsReBEkQgAjnIwSQMKo4ixW6danOcZPXW94oEAAAAAAAAAAAAAAAAAPAPINkFIk0iMOID+AgAAAAASUVORK5CYII=";

function html(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(`<!doctype html>${body}`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...headers,
    },
  });
}

function redirect(location: string, headers: HeadersInit = {}) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, ...headers },
  });
}

function parseCookies(cookieHeader: string | null) {
  if (!cookieHeader) return {} as Record<string, string>;
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((pair) => pair.trim().split("="))
      .filter((pair) => pair.length === 2),
  );
}

function isAuthenticated(req: Request) {
  const cookies = parseCookies(req.headers.get("cookie"));
  return cookies[COOKIE_NAME] === COOKIE_VALUE;
}

function loginPage(message = "") {
  const banner = message
    ? `<p data-testid="error" style="color:#b00020">${message}</p>`
    : "";
  return html(`
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Mock Login</title>
    </head>
    <body>
      <main>
        <h1>Mock Login</h1>
        ${banner}
        <form method="post" action="/login">
          <label for="username">Username</label>
          <input id="username" name="username" autocomplete="username" />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
      </main>
    </body>
  </html>
  `);
}

function dashboardPage(username: string) {
  return html(`
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Dashboard</title>
    </head>
    <body>
      <main>
        <h1>Dashboard</h1>
        <p data-testid="status">Authenticated as ${username}</p>
        <a href="/logout">Sign out</a>
      </main>
    </body>
  </html>
  `);
}

function captchaPage(message = "") {
  const banner = message
    ? `<p data-testid="captcha-note" style="color:#1f7a5c">${message}</p>`
    : "";
  return html(`
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Mock Captcha</title>
    </head>
    <body>
      <main>
        <h1>Captcha Check</h1>
        <section id="captcha" data-testid="captcha">
          <p>Which movie does this poster belong to?</p>
          <img src="/captcha-image" alt="Movie poster" />
          ${banner}
          <form method="post" action="/captcha">
            <fieldset>
              <legend>Pick one</legend>
              <label>
                <input type="radio" name="movie" value="moonlight" checked />
                Moonlight Bay
              </label>
              <label>
                <input type="radio" name="movie" value="sunset" />
                Sunset Drive
              </label>
              <label>
                <input type="radio" name="movie" value="evergreen" />
                Evergreen Lane
              </label>
            </fieldset>
            <button id="verify" type="submit">Verify</button>
          </form>
        </section>
      </main>
    </body>
  </html>
  `);
}

Bun.serve({
  port: PORT,
  routes: {
    "/": {
      GET: async (req) => {
        if (isAuthenticated(req)) {
          return redirect("/dashboard");
        }
        return redirect("/login");
      },
    },
    "/login": {
      GET: async (req) => {
        if (isAuthenticated(req)) {
          return redirect("/dashboard");
        }
        return loginPage();
      },
      POST: async (req) => {
        const form = await req.formData();
        const username = String(form.get("username") ?? "").trim();
        const password = String(form.get("password") ?? "").trim();
        if (username === VALID_USERNAME && password === VALID_PASSWORD) {
          return redirect("/dashboard", {
            "Set-Cookie": `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
          });
        }
        return loginPage("Invalid credentials");
      },
    },
    "/dashboard": {
      GET: async (req) => {
        if (!isAuthenticated(req)) {
          return redirect("/login");
        }
        return dashboardPage(VALID_USERNAME);
      },
    },
    "/logout": {
      GET: async () => {
        return redirect("/login", {
          "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        });
      },
    },
    "/captcha-image": {
      GET: async () => {
        const bytes = Buffer.from(CAPTCHA_IMAGE_BASE64, "base64");
        return new Response(bytes, {
          headers: { "Content-Type": "image/png" },
        });
      },
    },
    "/captcha": {
      GET: async (req) => {
        if (isAuthenticated(req)) {
          return redirect("/dashboard");
        }
        return captchaPage();
      },
      POST: async () => {
        return redirect("/dashboard", {
          "Set-Cookie": `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
        });
      },
    },
  },
});

console.log(`Mock login site running on http://localhost:${PORT}`);
console.log(`Valid credentials: ${VALID_USERNAME} / ${VALID_PASSWORD}`);
