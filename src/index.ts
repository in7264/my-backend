import express from "express";
import cors from "cors";
import authRoutes from "./authRoutes";
import cookieParser from "cookie-parser";
import equipmentRoutes from "./equipmentRoutes";

const app = express();

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

app.get("/", (req, res) => {
  res.json({ message: "Backend is running!" });
});

app.listen(3000, () => console.log("Server started on port 3000"));
