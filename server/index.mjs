import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const app = express();
const port = Number(process.env.PORT) || 3001;
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const distPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const sessionSecret = process.env.SESSION_SECRET;
const sessionCookieName = "nura_session";
const sessionDurationSeconds = 7 * 24 * 60 * 60;
const textModel = process.env.GEMINI_MODEL || "gemini-4-hydrogen";
const imageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1";

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("Укажите SESSION_SECRET длиной не менее 32 символов в .env.");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

function signSession(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function getSessionUser(request) {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  const token = cookie?.slice(sessionCookieName.length + 1);
  if (!token) return null;

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return null;

  const expectedSignature = createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest();
  let actualSignature;
  try {
    actualSignature = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const user = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    if (
      typeof user.sub !== "string" ||
      typeof user.email !== "string" ||
      typeof user.exp !== "number" ||
      user.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

function setSessionCookie(response, token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`,
  );
}

function getPublicSiteUrl(request) {
  const configuredUrl = process.env.PUBLIC_SITE_URL || process.env.RENDER_EXTERNAL_URL;
  if (configuredUrl) return new URL(configuredUrl);

  const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0];
  const protocol = forwardedProtocol || request.protocol;
  const host = request.get("host") || "localhost";
  return new URL(`${protocol}://${host}`);
}

function escapeHtmlAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function requireGoogleUser(request, response, next) {
  if (!googleClientId) {
    response.status(503).json({
      error: "Вход через Google не настроен. Добавьте GOOGLE_CLIENT_ID в .env.",
    });
    return;
  }

  const user = getSessionUser(request);
  if (!user) {
    response.status(401).json({ error: "Сначала войдите через Google." });
    return;
  }

  request.googleUser = user;
  next();
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const error = new Error(
      "Добавьте GEMINI_API_KEY в файл .env и перезапустите сайт.",
    );
    error.status = 503;
    throw error;
  }

  return new GoogleGenAI({ apiKey });
}

app.get("/api/health", (_request, response) => {
  response.json({
    configured: Boolean(process.env.GEMINI_API_KEY),
    textModel,
    imageModel,
    googleClientId: googleClientId || "",
  });
});

app.get("/api/auth/me", (request, response) => {
  response.json({ user: getSessionUser(request) });
});

app.post("/api/auth/google", async (request, response, next) => {
  if (!googleClientId) {
    response.status(503).json({
      error: "Вход через Google не настроен. Добавьте GOOGLE_CLIENT_ID в .env.",
    });
    return;
  }

  const { credential } = request.body ?? {};
  if (typeof credential !== "string" || !credential || credential.length > 8192) {
    response.status(400).json({ error: "Google не передал данные аккаунта." });
    return;
  }

  try {
    const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
    tokenInfoUrl.searchParams.set("id_token", credential);
    const tokenResponse = await fetch(tokenInfoUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenResponse.ok) {
      response.status(401).json({ error: "Google не подтвердил этот аккаунт." });
      return;
    }

    const claims = await tokenResponse.json();
    const expiresAt = Number(claims.exp);
    if (
      claims.aud !== googleClientId ||
      !["accounts.google.com", "https://accounts.google.com"].includes(
        claims.iss,
      ) ||
      typeof claims.sub !== "string" ||
      typeof claims.email !== "string" ||
      claims.email_verified !== "true" ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      response.status(401).json({ error: "Не удалось проверить аккаунт Google." });
      return;
    }

    const user = {
      sub: claims.sub,
      email: claims.email,
      name: typeof claims.name === "string" ? claims.name : claims.email,
      picture: typeof claims.picture === "string" ? claims.picture : "",
      exp: Math.floor(Date.now() / 1000) + sessionDurationSeconds,
    };
    const sessionToken = signSession(user);
    setSessionCookie(response, sessionToken, sessionDurationSeconds);
    response.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (_request, response) => {
  setSessionCookie(response, "", 0);
  response.json({ success: true });
});

app.post("/api/chat", requireGoogleUser, async (request, response, next) => {
  const { message, previousInteractionId } = request.body ?? {};

  if (typeof message !== "string" || !message.trim() || message.length > 8000) {
    response
      .status(400)
      .json({ error: "Введите сообщение длиной до 8 000 символов." });
    return;
  }

  if (
    previousInteractionId !== undefined &&
    (typeof previousInteractionId !== "string" ||
      previousInteractionId.length > 512)
  ) {
    response
      .status(400)
      .json({ error: "Не удалось продолжить этот диалог. Начните новый чат." });
    return;
  }

  try {
    const interaction = await getClient().interactions.create({
      model: textModel,
      input: message.trim(),
      tools: [{ type: "google_search" }, { type: "code_execution" }],
      ...(previousInteractionId
        ? { previous_interaction_id: previousInteractionId }
        : {}),
    });

    if (!interaction.output_text) {
      response
        .status(502)
        .json({
          error:
            "Gemini вернул пустой ответ. Попробуйте переформулировать запрос.",
        });
      return;
    }

    response.json({
      text: interaction.output_text,
      interactionId: interaction.id,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/images", requireGoogleUser, async (request, response, next) => {
  const { prompt } = request.body ?? {};

  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) {
    response
      .status(400)
      .json({ error: "Опишите изображение (до 4 000 символов)." });
    return;
  }

  try {
    const interaction = await getClient().interactions.create({
      model: imageModel,
      input: prompt.trim(),
      response_format: { type: "image" },
    });
    const image = interaction.output_image;

    if (!image?.data) {
      response
        .status(502)
        .json({
          error: "Gemini не вернул изображение. Попробуйте изменить описание.",
        });
      return;
    }

    response.json({
      data: image.data,
      mimeType: image.mime_type || "image/png",
    });
  } catch (error) {
    next(error);
  }
});

if (process.env.NODE_ENV === "production") {
  app.get("/robots.txt", (request, response) => {
    const sitemapUrl = new URL("/sitemap.xml", getPublicSiteUrl(request));
    response.type("text/plain").send(
      `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${sitemapUrl.href}\n`,
    );
  });

  app.get("/sitemap.xml", (request, response) => {
    const siteUrl = new URL("/", getPublicSiteUrl(request));
    response.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
        `<url><loc>${escapeXml(siteUrl.href)}</loc></url></urlset>`,
    );
  });

  const sendIndexHtml = async (request, response, next) => {
    try {
      const html = await readFile(path.join(distPath, "index.html"), "utf8");
      const canonicalUrl = new URL("/", getPublicSiteUrl(request)).href;
      const seoLinks =
        `<link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}" />` +
        `<meta property="og:url" content="${escapeHtmlAttribute(canonicalUrl)}" />`;
      response.type("html").send(html.replace("</head>", `${seoLinks}</head>`));
    } catch (error) {
      next(error);
    }
  };

  app.get("/", sendIndexHtml);
  app.use(express.static(distPath, { index: false }));
  app.get(/.*/, (request, response, next) => {
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }
    void sendIndexHtml(request, response, next);
  });
}

app.use((error, _request, response, _next) => {
  const status = Number(error.status) || 502;
  const isQuotaError =
    status === 429 ||
    error.code === "RESOURCE_EXHAUSTED" ||
    /quota|resource_exhausted/i.test(error.message || "");
  const message =
    isQuotaError
      ? "Исчерпана квота Gemini API. Проверьте лимиты и оплату проекта в Google AI Studio. Вход через Google не увеличивает квоту."
      : status === 503
      ? error.message
      : error.message ||
        "Не удалось связаться с Gemini. Проверьте API-ключ и подключение к интернету.";

  if (status >= 500) {
    console.error(`[api] ${message}`);
  }

  response.status(isQuotaError ? 429 : status).json({ error: message });
});

app.listen(port, host, () => {
  console.log(`Nura AI server is listening on ${host}:${port}`);
});
