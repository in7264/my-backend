import express from "express";
import cookieParser from "cookie-parser";
import { supabase } from "./supabase";
import crypto from "crypto";
import {
  createSessionToken,
  setSessionCookie,
  verifySessionToken,
  AuthenticatedRequest,
} from "./authMiddleware";

const router = express.Router();
router.use(cookieParser());

// ===== Helper: generate PKCE code verifier and challenge =====
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString("hex");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return { codeVerifier, codeChallenge };
}

// =========================
//       EMAIL LOGIN
// =========================

router.post("/login", async (req, res) => {
  console.log("Login attempt:", req.body);
  const { email, password } = req.body;

  try {
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError) {
      console.error("Auth error:", authError);
      return res.status(400).json({ error: authError.message });
    }

    console.log("User authenticated:", authData.user);

    // Получаем данные пользователя напрямую из auth.users
    const userData = {
      id: authData.user.id,
      email: authData.user.email,
      role: authData.user.role || "user",
    };

    // Создаем JWT токен
    const token = createSessionToken(userData);

    // Устанавливаем куки
    setSessionCookie(res, token);

    res.json({
      message: "Logged in",
      role: userData.role,
      user: userData,
    });
  } catch (error) {
    console.error("Unexpected error in login:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
//        REGISTER
// =========================
router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) return res.status(400).json({ error: error.message });

  await supabase.from("profiles").insert({
    id: data.user!.id,
    email,
    role: "user",
  });

  res.json({ message: "Check your email to confirm account" });
});

// =========================
//      RESET PASSWORD
// =========================
router.post("/reset", async (req, res) => {
  const { email } = req.body;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: process.env.CLIENT_URL + "/reset-password",
  });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Reset email sent" });
});

// =========================
//        GOOGLE LOGIN
// =========================
router.get("/google", async (req, res) => {
  try {
    console.log("Starting Google OAuth flow...");

    // ИСПРАВЛЕНИЕ: Используем правильные параметры для OAuth
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${process.env.BACKEND_URL}/auth/callback`,
        // Убираем queryParams которые могут мешать
        // skipBrowserRedirect: false, // Не используем для web flow
      },
    });

    if (error) {
      console.error("Google OAuth error:", error);
      return res.status(400).json({ error: error.message });
    }

    // Проверяем что есть URL для редиректа
    if (!data?.url) {
      console.error("No redirect URL from Google OAuth");
      return res
        .status(500)
        .json({ error: "Google OAuth configuration error" });
    }

    console.log("Redirecting to Google OAuth:", data.url);
    res.redirect(data.url);
  } catch (error) {
    console.error("Unexpected error in Google OAuth:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
//     GOOGLE CALLBACK
// =========================
router.get("/callback", async (req, res) => {
  console.log("=== GOOGLE CALLBACK STARTED ===");
  console.log("Query params:", req.query);
  console.log("Code received:", req.query.code ? "YES" : "NO");

  const code = req.query.code as string;
  const error = req.query.error as string;

  // Проверяем на ошибки от Google
  if (error) {
    console.error("Google OAuth error:", error);
    return res.redirect(
      `${process.env.CLIENT_URL}/login?error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    console.error("No code received from Google");
    return res.redirect(
      `${process.env.CLIENT_URL}/login?error=${encodeURIComponent(
        "No authorization code received"
      )}`
    );
  }

  console.log("Processing Google OAuth code...");

  try {
    // ИСПРАВЛЕНИЕ: Правильный обмен кода на сессию
    console.log("Exchanging code for session...");

    const { data, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error("Exchange code error:", exchangeError);
      return res.redirect(
        `${process.env.CLIENT_URL}/login?error=${encodeURIComponent(
          exchangeError.message
        )}`
      );
    }

    console.log("Session exchange successful");
    console.log("Session data:", {
      user: data.session?.user?.email,
      access_token: data.session?.access_token ? "PRESENT" : "MISSING",
    });

    if (!data?.session?.user) {
      console.error("No user in session data");
      return res.redirect(
        `${process.env.CLIENT_URL}/login?error=${encodeURIComponent(
          "No user found in session"
        )}`
      );
    }

    const user = data.session.user;
    console.log("Google user authenticated:", {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name || user.user_metadata?.full_name,
    });

    // Проверяем, существует ли профиль
    let { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // Если профиля нет — создаем
    if (profileError && profileError.code === "PGRST116") {
      // No rows returned
      console.log("Creating new profile for user:", user.email);

      const { data: newProfile, error: insertError } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          email: user.email,
          name:
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split("@")[0],
          avatar_url: user.user_metadata?.avatar_url,
          role: "user",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error("Profile creation error:", insertError);
        // Не останавливаем процесс, можно продолжить без профиля
        profile = null;
      } else {
        profile = newProfile;
      }
    } else if (profileError) {
      console.error("Profile fetch error:", profileError);
      profile = null;
    }

    // Создаем JWT токен
    const token = createSessionToken({
      id: user.id,
      email: user.email,
      role: profile?.role || "user",
      name: profile?.name || user.user_metadata?.name,
    });

    // Устанавливаем куки
    setSessionCookie(res, token);

    console.log("JWT token created and cookie set");
    console.log("Success! Redirecting to:", process.env.CLIENT_URL);

    // Редирект на клиент
    res.redirect(process.env.CLIENT_URL || "http://localhost:5173");
  } catch (error) {
    console.error("Callback error details:", error);
    res.redirect(
      `${process.env.CLIENT_URL}/login?error=${encodeURIComponent(
        "Internal server error during OAuth callback"
      )}`
    );
  }
});
// =========================
//      CHECK SESSION
// =========================
router.get("/check", (req, res) => {
  try {
    const token = req.cookies.session;
    if (!token) return res.json({ authorized: false });

    // Используйте verifySessionToken вместо прямого использования jwt
    const decoded = verifySessionToken(token);

    if (decoded) {
      res.json({ authorized: true, user: decoded });
    } else {
      res.json({ authorized: false });
    }
  } catch (error) {
    console.error("Check session error:", error);
    res.json({ authorized: false });
  }
});

// =========================
//          LOGOUT
// =========================
router.get("/logout", (req, res) => {
  res.clearCookie("session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
  res.json({ message: "Logged out" });
});

export default router;
