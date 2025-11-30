import express from "express";
import { supabasePublic } from "./supabasePublic";
import { supabase } from "./supabase";
import { authMiddleware, AuthenticatedRequest } from "./authMiddleware"; // Добавьте импорт

const router = express.Router();

// Добавьте middleware для аутентификации
router.use(authMiddleware);

// =========================
//      GET CATEGORIES
// =========================
router.get("/categories", async (req, res) => {
  try {
    console.log("Fetching categories with public client...");

    const { data, error } = await supabasePublic
      .from("equipment")
      .select("category")
      .not("category", "is", null);

    if (error) {
      console.error("Categories error details:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return res.status(500).json({
        error: "Database error",
        details: error.message,
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

    const { data, error } = await supabasePublic
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
    const { data, error } = await supabasePublic
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

// =========================
//   GET SINGLE EQUIPMENT
// =========================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Fetching equipment with id:", id);

    const { data, error } = await supabasePublic
      .from("equipment")
      .select("*")
      .eq("id", parseInt(id))
      .single();

    if (error) {
      console.error("Equipment error:", error);
      return res.status(404).json({ error: "Equipment not found" });
    }

    res.json({ equipment: data });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Отслеживание просмотра товара
router.post("/:id/view", async (req: AuthenticatedRequest, res) => {
  // Используйте AuthenticatedRequest
  try {
    const { id } = req.params;
    const user_id = req.user?.id; // Теперь это работает
    const ip_address = req.ip;
    const user_agent = req.get("User-Agent");

    // Сначала проверяем существование товара
    const { data: equipment, error: equipmentError } = await supabase
      .from("equipment")
      .select("id")
      .eq("id", parseInt(id))
      .single();

    if (equipmentError || !equipment) {
      return res.status(404).json({ error: "Equipment not found" });
    }

    // Детальный лог просмотра
    const { error: viewError } = await supabase.from("product_views").insert({
      equipment_id: parseInt(id),
      user_id: user_id || null,
      ip_address,
      user_agent,
    });

    if (viewError) {
      console.error("View tracking error:", viewError);
      return res.status(500).json({ error: viewError.message });
    }

    // Обновляем счетчик просмотров в таблице equipment
    const { error: updateError } = await supabase.rpc(
      "increment_equipment_views",
      {
        equipment_id: parseInt(id),
      }
    );

    if (updateError) {
      console.error("Update views count error:", updateError);
      // Не прерываем выполнение, так как основной лог уже записан
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Получение статистики по конкретному товару
router.get("/:id/stats", async (req: AuthenticatedRequest, res) => {
  // Используйте AuthenticatedRequest
  try {
    const { id } = req.params;

    // Проверяем права доступа - только админы могут смотреть статистику
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    const [
      { data: equipmentData },
      { data: viewsData },
      { data: ordersData },
      { data: priceHistory },
    ] = await Promise.all([
      supabase.from("equipment").select("*").eq("id", id).single(),
      supabase.from("product_views").select("*").eq("equipment_id", id),
      supabase.from("orders").select("*").eq("equipment_id", id),
      supabase
        .from("price_history")
        .select("*")
        .eq("equipment_id", id)
        .order("changed_at", { ascending: false }),
    ]);

    const stats = {
      equipment: equipmentData,
      total_views: viewsData?.length || 0,
      total_orders:
        ordersData?.reduce((sum, order) => sum + order.quantity, 0) || 0,
      recent_views: viewsData?.slice(0, 10) || [],
      price_history: priceHistory || [],
      daily_stats: await getDailyStats(parseInt(id)),
    };

    res.json(stats);
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Функция для получения ежедневной статистики
async function getDailyStats(equipmentId: number) {
  const { data } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("equipment_id", equipmentId)
    .gte(
      "stat_date",
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    )
    .order("stat_date", { ascending: true });

  return data || [];
}

export default router;
