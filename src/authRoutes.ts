import express from "express";
import { supabase } from "./supabase";

const router = express.Router();

// =========================
//      GET CATEGORIES
// =========================
router.get("/categories", async (req, res) => {
  try {
    console.log("Environment check:", {
      hasUrl: !!process.env.SUPABASE_URL,
      hasKey: !!process.env.SUPABASE_SERVICE_ROLE,
      urlLength: process.env.SUPABASE_URL?.length,
      keyLength: process.env.SUPABASE_SERVICE_ROLE?.length
    });

    const { data, error } = await supabase
      .from("equipment")
      .select("category")
      .not("category", "is", null);

    if (error) {
      console.error("Categories error details:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return res.status(500).json({ 
        error: "Database error",
        details: error.message 
      });
    }

    console.log("Raw categories data:", data);

    // Получаем уникальные категории
    const categories = [...new Set(data.map((item) => item.category))].filter(
      Boolean
    );

    console.log("Unique categories:", categories);

    res.json({ categories });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
//   GET EQUIPMENT BY CATEGORY
// =========================
router.get("/category/:category", async (req, res) => {
  try {
    const { category } = req.params;
    console.log("Fetching equipment for category:", category);

    const { data, error } = await supabase
      .from("equipment")
      .select("*")
      .eq("category", decodeURIComponent(category))
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Equipment error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ items: data || [] });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
//      GET ALL EQUIPMENT
// =========================
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("equipment")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Equipment error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ items: data || [] });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;