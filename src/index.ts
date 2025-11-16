import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Backend is running!" });
});

app.get("/check-role/:userId", async (req, res) => {
  res.json({ role: "admin" });
});

app.listen(3000, () => console.log("Server started on port 3000"));
