import express from "express";
import { supabase } from "./supabase";
import { AuthenticatedRequest, requireAuth } from "./authMiddleware";

const router = express.Router();

// =========================
//        FAVORITES
// =========================

// Добавить в избранное
router.post(
  "/favorites/:equipmentId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { equipmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { data, error } = await supabase
        .from("favorites")
        .insert({
          user_id: userId,
          equipment_id: parseInt(equipmentId),
        })
        .select(
          `
        *,
        equipment:equipment_id (*)
      `
        )
        .single();

      if (error) {
        console.error("Add to favorites error:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true, favorite: data });
    } catch (error) {
      console.error("Unexpected error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Удалить из избранного
router.delete(
  "/favorites/:equipmentId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { equipmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("user_id", userId)
        .eq("equipment_id", parseInt(equipmentId));

      if (error) {
        console.error("Remove from favorites error:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Unexpected error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Получить избранное пользователя
router.get(
  "/favorites",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { data, error } = await supabase
        .from("favorites")
        .select(
          `
        *,
        equipment:equipment_id (*)
      `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Get favorites error:", error);
        return res.status(500).json({ error: error.message });
      }

      // Добавляем вычисление main_image если его нет
      const favorites = (data || []).map((fav) => ({
        ...fav,
        equipment: {
          ...fav.equipment,
          main_image:
            fav.equipment.main_image ||
            (Array.isArray(fav.equipment.images) &&
            fav.equipment.images.length > 0
              ? fav.equipment.images[0]
              : null),
        },
      }));

      res.json({ favorites });
    } catch (error) {
      console.error("Unexpected error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Проверить, есть ли товар в избранном
router.get(
  "/favorites/:equipmentId/check",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { equipmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.json({ isFavorite: false });
      }

      const { data, error } = await supabase
        .from("favorites")
        .select("*")
        .eq("user_id", userId)
        .eq("equipment_id", parseInt(equipmentId))
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 - no rows returned
        console.error("Check favorite error:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ isFavorite: !!data });
    } catch (error) {
      console.error("Unexpected error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// =========================
//          CART
// =========================

// Добавить в корзину
router.post(
  "/cart/:equipmentId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { equipmentId } = req.params;
      const { quantity = 1 } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Проверяем есть ли уже в корзине
      const { data: existingItem } = await supabase
        .from("cart_items")
        .select("*")
        .eq("user_id", userId)
        .eq("equipment_id", parseInt(equipmentId))
        .single();

      let result;
      if (existingItem) {
        // Обновляем количество
        result = await supabase
          .from("cart_items")
          .update({
            quantity: existingItem.quantity + quantity,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingItem.id)
          .select(
            `
          *,
          equipment:equipment_id (*)
        `
          )
          .single();
      } else {
        // Добавляем новый товар
        result = await supabase
          .from("cart_items")
          .insert({
            user_id: userId,
            equipment_id: parseInt(equipmentId),
            quantity: quantity,
          })
          .select(
            `
          *,
          equipment:equipment_id (*)
        `
          )
          .single();
      }

      if (result.error) {
        console.error("Add to cart error:", result.error);
        return res.status(500).json({ error: result.error.message });
      }

      res.json({ success: true, cartItem: result.data });
    } catch (error) {
      console.error("Unexpected error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Обновить количество в корзине
router.put(
  "/cart/:equipmentId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { equipmentId } = req.params;
      const { quantity } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (quantity <= 0) {
        // Если количество 0 или меньше, удаляем товар
        const { error } = await supabase
          .from("cart_items")
          .delete()
          .eq("user_id", userId)
          .eq("equipment_id", parseInt(equipmentId));

        if (error) {
          console.error("Remove from cart error:", error);
          return res.status(500).json({ error: error.message });
        }

        return res.json({ success: true, removed: true });
      }

      const { data, error } = await supabase
        .from("cart_items")
        .update({
          quantity: quantity,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("equipment_id", parseInt(equipmentId))
        .select(
          `
        *,
        equipment:equipment_id (*)
      `
        )
        .single();

      if (error) {
        console.error("Update cart error:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true, cartItem: data });
    } catch (error) {
      console.error("Unexpected error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Удалить из корзины
router.delete(
  "/cart/:equipmentId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { equipmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { error } = await supabase
        .from("cart_items")
        .delete()
        .eq("user_id", userId)
        .eq("equipment_id", parseInt(equipmentId));

      if (error) {
        console.error("Remove from cart error:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Unexpected error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Получить корзину пользователя
router.get("/cart", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.json({ cartItems: [] });
    }

    const { data, error } = await supabase
      .from("cart_items")
      .select(
        `
        *,
        equipment:equipment_id (*)
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get cart error:", error);
      return res.status(500).json({ error: error.message });
    }

    // Добавляем вычисление main_image если его нет
    const cartItems = (data || []).map((item) => ({
      ...item,
      equipment: {
        ...item.equipment,
        main_image:
          item.equipment.main_image ||
          (Array.isArray(item.equipment.images) &&
          item.equipment.images.length > 0
            ? item.equipment.images[0]
            : null),
      },
    }));

    // Рассчитываем общую стоимость
    const total =
      cartItems.reduce((sum, item) => {
        return sum + item.equipment.price * item.quantity;
      }, 0) || 0;

    res.json({
      cartItems,
      total,
      totalItems: cartItems.reduce((sum, item) => sum + item.quantity, 0) || 0,
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Очистить корзину
router.delete("/cart", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("Clear cart error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
