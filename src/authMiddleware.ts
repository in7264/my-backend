import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    name?: string;
    avatar?: string;
  };
}

export const createSessionToken = (user: {
  id: string;
  email: string;
  role: string;
  name?: string;
  avatar?: string;
}) => {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role || "authenticated",
      name: user.name,
      avatar: user.avatar,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
};

export const verifySessionToken = (token: string) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || "authenticated",
      name: decoded.name,
      avatar: decoded.avatar,
    };
  } catch (error) {
    console.error("Token verification error:", error);
    return null;
  }
};

export const setSessionCookie = (res: Response, token: string) => {
  res.cookie("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
    path: "/",
  });
};

export const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.cookies.session;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = verifySessionToken(token);

    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(401).json({ error: "Authentication failed" });
  }
};

// Middleware для проверки админских прав
export const adminMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.cookies.session;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = verifySessionToken(token);

    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Проверяем роль администратора
    if (user.role !== "service_role" && user.role !== "supabase_admin") {
      return res
        .status(403)
        .json({ error: "Forbidden: Admin access required" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Admin middleware error:", error);
    res.status(401).json({ error: "Authentication failed" });
  }
};

// ===== Middleware: require authentication =====
export const requireAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
};

// ===== Middleware: require admin role =====
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.user.role !== "supabase_admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
};
