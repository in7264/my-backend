import express from "express";
import { supabase } from "./supabase";

const router = express.Router();

// =========================
//      PRODUCT VIEWS
// =========================
router.post("/view", async (req, res) => {
  try {
    const { equipment_id, user_id, ip_address, user_agent } = req.body;

    console.log("Tracking view for equipment:", equipment_id);

    const { data, error } = await supabase.from("product_views").insert({
      equipment_id,
      user_id: user_id || null,
      ip_address,
      user_agent,
      viewed_at: new Date().toISOString(),
    });

    if (error) {
      console.error("View tracking error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Unexpected error in view tracking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
//      GET ANALYTICS DATA
// =========================
router.get("/dashboard", async (req, res) => {
  console.log("=== ANALYTICS DASHBOARD REQUEST START ===");

  try {
    // 1. Получаем оборудование
    console.log("1. Fetching equipment...");
    const { data: equipmentData, error: equipmentError } = await supabase
      .from("equipment")
      .select("id, name, price, stock, category");

    if (equipmentError) {
      console.error("Equipment fetch error:", equipmentError);
      throw equipmentError;
    }

    console.log(`Equipment count: ${equipmentData?.length || 0}`);

    // 2. Получаем просмотры за последние 30 дней
    console.log("2. Fetching product views...");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: viewsData, error: viewsError } = await supabase
      .from("product_views")
      .select("equipment_id, viewed_at")
      .gte("viewed_at", thirtyDaysAgo.toISOString());

    if (viewsError) {
      console.error("Views fetch error:", viewsError);
      // Не прерываем выполнение, а используем пустой массив
      console.warn("Continuing with empty views data");
    }

    console.log(`Views count (last 30 days): ${viewsData?.length || 0}`);

    // 3. История цен (если таблица существует)
    console.log("3. Fetching price history...");
    let priceHistory = [];
    try {
      const { data: priceData, error: priceError } = await supabase
        .from("price_history")
        .select("equipment_id, old_price, new_price, changed_at")
        .order("changed_at", { ascending: false })
        .limit(10);

      if (priceError) {
        console.warn(
          "Price history table might not exist:",
          priceError.message
        );
      } else {
        priceHistory = priceData || [];
      }
    } catch (priceErr) {
      console.warn("Price history fetch failed:", priceErr.message);
    }

    console.log(`Price history items: ${priceHistory.length}`);

    // 4. Заказы (если таблица существует)
    console.log("4. Fetching orders...");
    let ordersData = [];
    try {
      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select("id, equipment_id, quantity, total_price, status, created_at");

      if (ordersError) {
        console.warn(
          "Orders table might not exist or is empty:",
          ordersError.message
        );
      } else {
        ordersData = orders || [];
      }
    } catch (ordersErr) {
      console.warn("Orders fetch failed:", ordersErr.message);
    }

    console.log(`Orders count: ${ordersData.length}`);

    // 5. Агрегируем данные с защитой от undefined
    console.log("5. Aggregating analytics data...");

    const safeEquipmentData = equipmentData || [];
    const safeViewsData = viewsData || [];
    const safeOrdersData = ordersData || [];

    // Подготовка данных для популярных товаров
    const popularProducts = safeEquipmentData
      .map((item) => {
        const views = safeViewsData.filter(
          (view) => view && view.equipment_id === item.id
        ).length;

        const orders = safeOrdersData
          .filter((order) => order && order.equipment_id === item.id)
          .reduce((sum, order) => sum + (order.quantity || 0), 0);

        return {
          id: item.id,
          name: item.name || "Unnamed Product",
          views: views || 0,
          orders: orders || 0,
          stock: item.stock || 0,
          price: item.price || 0,
        };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // Продажи по категориям
    const salesByCategory = {};
    safeEquipmentData.forEach((item) => {
      if (!item.category) return;

      const categoryOrders = safeOrdersData
        .filter((order) => order && order.equipment_id === item.id)
        .reduce((sum, order) => sum + (order.quantity || 0), 0);

      salesByCategory[item.category] =
        (salesByCategory[item.category] || 0) + categoryOrders;
    });

    // Ежедневные просмотры
    const dailyViews = {};
    safeViewsData.forEach((view) => {
      if (!view || !view.viewed_at) return;

      try {
        const date = new Date(view.viewed_at).toISOString().split("T")[0];
        dailyViews[date] = (dailyViews[date] || 0) + 1;
      } catch (dateError) {
        console.warn("Invalid view date:", view.viewed_at);
      }
    });

    // 6. Формируем финальный ответ
    const analytics = {
      totalProducts: safeEquipmentData.length,
      totalViews: safeViewsData.length,
      totalOrders: safeOrdersData.length,
      lowStock: safeEquipmentData.filter((item) => (item.stock || 0) < 5)
        .length,
      categories: [
        ...new Set(
          safeEquipmentData.map((item) => item.category).filter(Boolean)
        ),
      ], // Убираем пустые категории

      popularProducts,
      recentPriceChanges: priceHistory.slice(0, 10),
      salesByCategory,
      dailyViews,
    };

    console.log("6. Analytics data prepared:", {
      totalProducts: analytics.totalProducts,
      totalViews: analytics.totalViews,
      totalOrders: analytics.totalOrders,
      popularProductsCount: analytics.popularProducts.length,
      categoriesCount: analytics.categories.length,
    });

    console.log("=== ANALYTICS DASHBOARD REQUEST END ===");

    res.json(analytics);
  } catch (error) {
    console.error("=== ANALYTICS DASHBOARD ERROR ===");
    console.error("Error type:", error?.constructor?.name);
    console.error("Error message:", error?.message);
    console.error("Error details:", error);
    console.error("=== END ERROR ===");

    // Возвращаем минимальные данные вместо ошибки
    const fallbackAnalytics = {
      totalProducts: 0,
      totalViews: 0,
      totalOrders: 0,
      lowStock: 0,
      categories: [],
      popularProducts: [],
      recentPriceChanges: [],
      salesByCategory: {},
      dailyViews: {},
    };

    res.json(fallbackAnalytics);
  }
});

export default router;
