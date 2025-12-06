import express from "express";
import { supabase } from "./supabase";
import { AuthenticatedRequest, requireAuth } from "./authMiddleware";

const router = express.Router();

// =========================
//        FAVORITES
// =========================

// Добавить в избранное
router.post("/favorites", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const { equipment_id } = req.body;

    if (!userId || !equipment_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from("favorites")
      .insert({
        user_id: userId,
        equipment_id: equipment_id,
      })
      .select()
      .single();

    if (error) {
      console.error("Add to favorites error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    console.error("Unexpected error adding favorite:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Удалить из избранного
router.delete("/favorites/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const favoriteId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("id", favoriteId)
      .eq("user_id", userId);

    if (error) {
      console.error("Remove from favorites error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Unexpected error removing favorite:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Получить избранное пользователя
router.get("/favorites", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
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

    res.json(data || []);
  } catch (error) {
    console.error("Unexpected error in favorites:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
router.post("/cart", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const { equipment_id, quantity = 1 } = req.body;

    if (!userId || !equipment_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from("cart_items")
      .upsert({
        user_id: userId,
        equipment_id: equipment_id,
        quantity: quantity,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Add to cart error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    console.error("Unexpected error adding to cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
router.delete("/cart/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const cartItemId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("id", cartItemId)
      .eq("user_id", userId);

    if (error) {
      console.error("Remove from cart error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Unexpected error removing cart item:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Получить корзину пользователя
router.get("/cart", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
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

    res.json(data || []);
  } catch (error) {
    console.error("Unexpected error in cart:", error);
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
