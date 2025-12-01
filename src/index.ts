import express from "express";
import cors from "cors";
import authRoutes from "./authRoutes";
import equipmentRoutes from "./equipmentRoutes";
import analyticsRoutes from "./analyticsRoutes";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./authMiddleware";
import userRoutes from "./userRoutes";

const app = express();

app.set("trust proxy", true);

app.use(
  cors({
    origin: [
      "https://my-secure-shop.vercel.app",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/auth", authRoutes);
app.use("/equipment", equipmentRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/user", authMiddleware, userRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Backend is running!" });
});

// Добавьте обработчик для всех остальных маршрутов (для SPA)
app.get("*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.listen(3000, () => console.log("Server started on port 3000"));
