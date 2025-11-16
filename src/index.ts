import express from "express";
import cors from "cors";
import authRoutes from "./authRoutes";
import cookieParser from "cookie-parser";

const app = express();

app.use(
  cors({
    origin: ["https://in7264.github.io", "http://localhost:5173"],
    credentials: true
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/auth", authRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Backend is running!" });
});

app.listen(3000, () => console.log("Server started on port 3000"));
