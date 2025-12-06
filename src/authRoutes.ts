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
// =========================
//        GOOGLE CALLBACK
// =========================
router.post("/google/callback", async (req, res) => {
  try {
    console.log("Processing Google callback...");

    const { googleAccessToken, userInfo } = req.body;

    if (!googleAccessToken || !userInfo) {
      return res.status(400).json({ error: "Missing required data" });
    }

    // Проверяем токен Google
    const googleResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${googleAccessToken}`
    );

    if (!googleResponse.ok) {
      return res.status(401).json({ error: "Invalid Google token" });
    }

    // Проверяем email
    if (!userInfo.email) {
      return res.status(400).json({ error: "No email provided by Google" });
    }

    let user;

    // Пытаемся найти пользователя по email через Supabase Auth
    const { data: existingUsers, error: findError } =
      await supabase.auth.admin.listUsers();

    if (findError) {
      console.error("Error finding user:", findError);
      // Если не удалось получить список пользователей, пробуем создать нового
    }

    // Ищем пользователя по email в списке
    const userByEmail = existingUsers?.users?.find(
      (u: any) => u.email === userInfo.email
    );

    if (userByEmail) {
      // Пользователь существует - обновляем данные
      const { data: updateData, error: updateError } =
        await supabase.auth.admin.updateUserById(userByEmail.id, {
          email: userInfo.email,
          user_metadata: {
            name: userInfo.name || userByEmail.user_metadata?.name,
            avatar_url:
              userInfo.picture || userByEmail.user_metadata?.avatar_url,
            full_name: userInfo.name || userByEmail.user_metadata?.full_name,
          },
        });

      if (updateError) {
        console.error("Update user error:", updateError);
        // Если не удалось обновить, пробуем создать нового
      } else {
        user = updateData.user;
      }
    }

    // Если пользователь не найден или не удалось обновить, создаем нового
    if (!user) {
      const { data: signUpData, error: signUpError } =
        await supabase.auth.admin.createUser({
          email: userInfo.email,
          email_confirm: true,
          user_metadata: {
            name: userInfo.name || userInfo.email.split("@")[0],
            avatar_url: userInfo.picture,
            full_name: userInfo.name,
            provider: "google",
          },
        });

      if (signUpError) {
        // Проверяем, не означает ли ошибка, что пользователь уже существует
        if (signUpError.message.includes("already registered")) {
          // Пытаемся получить пользователя через обычный метод (не admin)
          const { data: existingUser } = await supabase.auth.signInWithPassword(
            {
              email: userInfo.email,
              password: "temporary_password", // Для Google-пользователей пароль не используется
            }
          );

          if (existingUser?.user) {
            user = existingUser.user;
          } else {
            throw new Error("User exists but cannot be accessed");
          }
        } else {
          throw signUpError;
        }
      } else {
        user = signUpData.user;
      }
    }

    if (!user) {
      throw new Error("Failed to create or find user");
    }

    console.log("User processed:", {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name,
    });

    // Создаем JWT токен сессии
    const userData = {
      id: user.id,
      email: user.email!,
      name: user.user_metadata?.name || user.email?.split("@")[0] || "User",
      role: user.role || "authenticated",
      avatar: user.user_metadata?.avatar_url,
    };

    const token = createSessionToken(userData);
    setSessionCookie(res, token);

    // Получаем данные пользователя
    const [favoritesResult, cartResult] = await Promise.allSettled([
      supabase.from("favorites").select("*").eq("user_id", user.id),
      supabase.from("cart_items").select("*").eq("user_id", user.id),
    ]);

    res.json({
      success: true,
      user: userData,
      favorites:
        favoritesResult.status === "fulfilled"
          ? favoritesResult.value.data
          : [],
      cart: cartResult.status === "fulfilled" ? cartResult.value.data : [],
    });
  } catch (error) {
    console.error("Google callback error:", error);
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
