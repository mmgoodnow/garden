const PORT = Number.parseInt(process.env.MOCK_PORT ?? "4001", 10);
const VALID_USERNAME = process.env.MOCK_USERNAME ?? "test@example.com";
const VALID_PASSWORD = process.env.MOCK_PASSWORD ?? "password123";
const COOKIE_NAME = "mock_session";
const COOKIE_VALUE = "ok";
const CAPTCHA_POSTER_PATH = new URL("./captcha-poster.png", import.meta.url);
const CAPTCHA_POSTER_DATA = readFileSync(CAPTCHA_POSTER_PATH);

function parseCookies(cookieHeader: string | null) {
  if (!cookieHeader) return {} as Record<string, string>;
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((pair) => pair.trim().split("="))
      .filter((pair) => pair.length === 2),
  );
}

function isAuthenticated(req: express.Request) {
  const cookies = parseCookies(req.headers.cookie ?? null);
  return cookies[COOKIE_NAME] === COOKIE_VALUE;
}

function loginPage(message = "") {
  const banner = message
    ? `<div data-testid="error" style="color:#b00020">${message}</div>`
    : "";
  return `
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
        <form method="post" action="/login" id="login-form">
          <label for="username">Username</label>
          <input id="username" name="username" autocomplete="username" />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" />
          <fieldset id="captcha">
            <legend>Captcha: Which movie does this poster belong to?</legend>
            <img src="/captcha-image" alt="Movie poster" />
            <label>
              <input id="movie-nosferatu" type="radio" name="movie" value="nosferatu" />
              Nosferatu
            </label>
            <label>
              <input id="movie-metropolis" type="radio" name="movie" value="metropolis" />
              Metropolis
            </label>
            <label>
              <input id="movie-general" type="radio" name="movie" value="the-general" />
              The General
            </label>
          </fieldset>
          <button type="submit">Sign in</button>
        </form>
      </main>
    </body>
  </html>
  `;
}

function dashboardPage(username: string) {
  return `
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
  `;
}

function captchaError(message = "") {
  if (!message) return "";
  return `<p data-testid="captcha-note" style="color:#1f7a5c">${message}</p>`;
}

const app = express();
app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => {
  if (isAuthenticated(req)) {
    res.redirect(302, "/dashboard");
    return;
  }
  res.redirect(302, "/login");
});

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) {
    res.redirect(302, "/dashboard");
    return;
  }
  res.status(200).type("html").send(`<!doctype html>${loginPage()}`);
});

app.post("/login", (req, res) => {
  const username = String(req.body.username ?? "").trim();
  const password = String(req.body.password ?? "").trim();
  const movie = String(req.body.movie ?? "");
  if (
    username === VALID_USERNAME &&
    password === VALID_PASSWORD &&
    movie === "nosferatu"
  ) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
    );
    res.redirect(302, "/dashboard");
    return;
  }
  res
    .status(200)
    .type("html")
    .send(
      `<!doctype html>${loginPage(
        `Invalid credentials or captcha.${captchaError(
          "Select the correct movie poster.",
        )}`,
      )}`,
    );
});

app.get("/dashboard", (req, res) => {
  if (!isAuthenticated(req)) {
    res.redirect(302, "/login");
    return;
  }
  res.status(200).type("html").send(`<!doctype html>${dashboardPage(VALID_USERNAME)}`);
});

app.get("/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
  res.redirect(302, "/login");
});

app.get("/captcha-image", (_req, res) => {
  res.status(200).type("image/png").send(CAPTCHA_POSTER_DATA);
});

app.listen(PORT, () => {
  console.log(`Mock login site running on http://localhost:${PORT}`);
  console.log(`Valid credentials: ${VALID_USERNAME} / ${VALID_PASSWORD}`);
});
import express from "express";
import { readFileSync } from "node:fs";
