import express from "express";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { supabase } from "./supabase";

const router = express.Router();
router.use(cookieParser());

router.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===== Helper: create JWT =====
function createSessionToken(user: any) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );
}

// ===== Helper: set cookie =====
function setSessionCookie(res: any, token: string) {
  res.cookie("session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
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
      role: authData.user.role || "user", // Используем поле role из auth.users если есть
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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${process.env.BACKEND_URL}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      console.error("Google OAuth error:", error);
      return res.status(400).json({ error: error.message });
    }

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
  const token_hash = req.query.token_hash as string;
  const code = req.query.code as string;

  console.log("Google callback received:", { token_hash, code });

  try {
    // Обмен кода на сессию
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      code || token_hash
    );

    if (error) {
      console.error("Exchange code error:", error);
      return res.status(400).json({ error: error.message });
    }

    console.log("Session data:", data);

    if (!data?.session?.user) {
      console.error("No user in session data");
      return res.status(400).json({ error: "No user found in session" });
    }

    const user = data.session.user;
    console.log("Google user:", user);

    // Проверяем, существует ли профиль
    let profile = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // Если профиля нет — создаем
    if (!profile.data) {
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
        return res
          .status(500)
          .json({ error: "Cannot create profile: " + insertError.message });
      }

      profile.data = newProfile;
    } else {
      console.log("Profile already exists:", profile.data.email);
    }

    // Создаем JWT токен
    const token = createSessionToken({
      id: user.id,
      email: user.email,
      role: profile.data?.role || "user",
      name: profile.data?.name || user.user_metadata?.name,
    });

    // Устанавливаем куки
    setSessionCookie(res, token);

    console.log("Success! Redirecting to:", process.env.CLIENT_URL);

    // Редирект на клиент
    res.redirect(process.env.CLIENT_URL || "http://localhost:5173");
  } catch (error) {
    console.error("Callback error:", error);
    res
      .status(500)
      .json({ error: "Internal server error during OAuth callback" });
  }
});

// =========================
//      CHECK SESSION
// =========================
router.get("/check", (req, res) => {
  try {
    const token = req.cookies.session;
    if (!token) return res.json({ authorized: false });

    const decoded = jwt.verify(token, process.env.JWT_SECRET!);

    res.json({ authorized: true, user: decoded });
  } catch {
    res.json({ authorized: false });
  }
});

// =========================
//          LOGOUT
// =========================
router.get("/logout", (req, res) => {
  res.clearCookie("session", { secure: true, sameSite: "none" });
  res.json({ message: "Logged out" });
});

export default router;
