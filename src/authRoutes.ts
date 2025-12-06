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

    // Используем данные напрямую из auth.users
    const userData = {
      id: authData.user.id,
      email: authData.user.email,
      name:
        authData.user.user_metadata?.full_name ||
        authData.user.user_metadata?.name ||
        authData.user.email?.split("@")[0],
      role: authData.user.role || "authenticated",
    };

    // Создаем JWT токен
    const token = createSessionToken(userData);

    // Устанавливаем куки
    setSessionCookie(res, token);

    res.json({
      message: "Logged in",
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
    options: {
      data: {
        name: email.split("@")[0], // Добавляем имя по умолчанию
        role: "authenticated",
      },
    },
  });

  if (error) return res.status(400).json({ error: error.message });

  // НЕ создаем запись в profiles, используем только auth.users
  res.json({
    message: "Check your email to confirm account",
    user: {
      id: data.user!.id,
      email: data.user!.email,
      name: email.split("@")[0],
    },
  });
});

// =========================
//        GOOGLE CALLBACK
// =========================
router.post("/google/callback", async (req, res) => {
  try {
    console.log("Processing Google callback from frontend...");

    const { access_token, refresh_token, expires_at, provider_token } =
      req.body;

    console.log("Received tokens:", {
      hasAccessToken: !!access_token,
      hasRefreshToken: !!refresh_token,
      hasProviderToken: !!provider_token,
    });

    if (!access_token || !refresh_token) {
      console.error("Missing required tokens");
      return res.status(400).json({ error: "Missing required tokens" });
    }

    // Устанавливаем сессию в Supabase
    const {
      data: { session, user },
      error,
    } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error) {
      console.error("Supabase setSession error:", error);
      return res.status(401).json({ error: error.message });
    }

    if (!user) {
      console.error("No user after setting session");
      return res.status(401).json({ error: "Authentication failed - no user" });
    }

    console.log("User authenticated:", {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name,
      role: user.role,
    });

    // Получаем данные пользователя из auth.users
    const userData = {
      id: user.id,
      email: user.email,
      name:
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0],
      role: user.role || "authenticated",
      avatar: user.user_metadata?.avatar_url,
    };

    // Создаем наш JWT токен
    const token = createSessionToken(userData);

    // Устанавливаем куки
    setSessionCookie(res, token);

    console.log("JWT cookie set, responding with success");

    // Пытаемся получить данные пользователя (favorites и cart_items)
    try {
      const [favoritesResult, cartResult] = await Promise.allSettled([
        supabase.from("favorites").select("*").eq("user_id", user.id),
        supabase.from("cart_items").select("*").eq("user_id", user.id),
      ]);

      const favorites =
        favoritesResult.status === "fulfilled"
          ? favoritesResult.value.data
          : [];
      const cart =
        cartResult.status === "fulfilled" ? cartResult.value.data : [];

      if (favoritesResult.status === "rejected") {
        console.warn("Failed to fetch favorites:", favoritesResult.reason);
      }
      if (cartResult.status === "rejected") {
        console.warn("Failed to fetch cart items:", cartResult.reason);
      }

      res.json({
        success: true,
        user: userData,
        favorites: favorites || [],
        cart: cart || [],
      });
    } catch (fetchError) {
      console.error("Error fetching user data:", fetchError);
      // Все равно возвращаем успешную аутентификацию
      res.json({
        success: true,
        user: userData,
        favorites: [],
        cart: [],
      });
    }
  } catch (error) {
    console.error("Google callback processing error:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// =========================
//      CHECK SESSION
// =========================
router.get("/check", (req, res) => {
  try {
    const token = req.cookies.session;
    if (!token) return res.json({ authorized: false });

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
