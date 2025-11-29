import express from "express";
import { supabase } from "./supabase";

const router = express.Router();

// =========================
//      PRODUCT VIEWS
// =========================
router.post("/view", async (req, res) => {
  try {
    const { equipment_id, user_id, ip_address, user_agent } = req.body;
    
    const { data, error } = await supabase
      .from("product_views")
      .insert({
        equipment_id,
        user_id: user_id || null,
        ip_address,
        user_agent
      });

    if (error) {
      console.error("View tracking error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
//      GET ANALYTICS DATA
// =========================
router.get("/dashboard", async (req, res) => {
  try {
    // Общая статистика
    const { data: equipmentData, error: equipmentError } = await supabase
      .from("equipment")
      .select("id, name, price, stock, category");

    if (equipmentError) throw equipmentError;

    // Статистика просмотров
    const { data: viewsData, error: viewsError } = await supabase
      .from("product_views")
      .select("equipment_id, viewed_at")
      .gte("viewed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Последние 30 дней

    if (viewsError) throw viewsError;

    // История цен
    const { data: priceHistory, error: priceError } = await supabase
      .from("price_history")
      .select("equipment_id, old_price, new_price, changed_at")
      .order("changed_at", { ascending: false });

    if (priceError) throw priceError;

    // Заказы
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select("id, equipment_id, quantity, total_price, status, created_at");

    if (ordersError) throw ordersError;

    // Агрегируем данные
    const analytics = {
      totalProducts: equipmentData.length,
      totalViews: viewsData.length,
      totalOrders: ordersData.length,
      lowStock: equipmentData.filter(item => item.stock < 5).length,
      categories: [...new Set(equipmentData.map(item => item.category))],
      
      popularProducts: equipmentData.map(item => {
        const views = viewsData.filter(view => view.equipment_id === item.id).length;
        const orders = ordersData.filter(order => order.equipment_id === item.id)
          .reduce((sum, order) => sum + order.quantity, 0);
        
        return {
          id: item.id,
          name: item.name,
          views,
          orders,
          stock: item.stock,
          price: item.price
        };
      }).sort((a, b) => b.views - a.views).slice(0, 10),

      recentPriceChanges: priceHistory.slice(0, 10),
      
      salesByCategory: equipmentData.reduce((acc, item) => {
        const categoryOrders = ordersData
          .filter(order => order.equipment_id === item.id)
          .reduce((sum, order) => sum + order.quantity, 0);
        
        acc[item.category] = (acc[item.category] || 0) + categoryOrders;
        return acc;
      }, {} as Record<string, number>),

      dailyViews: viewsData.reduce((acc, view) => {
        const date = new Date(view.viewed_at).toISOString().split('T')[0];
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };

    res.json(analytics);
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;