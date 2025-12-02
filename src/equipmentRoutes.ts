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

    // Добавляем вычисление main_image если его нет
    const items = (data || []).map((item) => ({
      ...item,
      main_image:
        item.main_image ||
        (Array.isArray(item.images) && item.images.length > 0
          ? item.images[0]
          : null),
    }));

    res.json({ items });
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

    // Добавляем вычисление main_image если его нет
    const items = (data || []).map((item) => ({
      ...item,
      main_image:
        item.main_image ||
        (Array.isArray(item.images) && item.images.length > 0
          ? item.images[0]
          : null),
    }));

    res.json({ items });
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

    // Используем .select() вместо .single()
    const { data, error } = await supabasePublic
      .from("equipment")
      .select("*")
      .eq("id", parseInt(id));

    if (error) {
      console.error("Equipment error:", error);
      return res.status(404).json({ error: "Equipment not found" });
    }

    // Проверяем что нашли оборудование
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Equipment not found" });
    }

    // Вычисляем main_image из массива images
    const equipment = {
      ...data[0],
      main_image:
        data[0].images &&
        Array.isArray(data[0].images) &&
        data[0].images.length > 0
          ? data[0].images[0]
          : null,
    };

    res.json({ equipment });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Отслеживание просмотра товара
router.post("/:id/view", async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user?.id;

    // Получаем реальный IP-адрес
    const ip_address =
      (req.headers["x-forwarded-for"] as string) ||
      req.socket.remoteAddress ||
      "::1";
    // Убираем порт если есть
    const clean_ip = ip_address.split(":")[0];

    const user_agent = req.get("User-Agent");

    // Проверяем существование товара
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
      ip_address: clean_ip,
      user_agent,
    });

    if (viewError) {
      console.error("View tracking error:", viewError);
      return res.status(500).json({ error: viewError.message });
    }

    // Обновляем счетчик просмотров
    const { error: updateError } = await supabase.rpc(
      "increment_equipment_views",
      {
        equipment_id: parseInt(id),
      }
    );

    if (updateError) {
      console.error("Update views count error:", updateError);
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
    if (!req.user || req.user.role !== "supabase_admin") {
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

// =========================
//       ADMIN CRUD
// =========================

// В PUT запросе:
router.put("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    // Проверяем права доступа
    if (!req.user || req.user.role !== "supabase_admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    let { name, description, price, stock, category, images, imagesToDelete } =
      req.body;

    console.log("=== UPDATE REQUEST ===");
    console.log("Equipment ID:", id);
    console.log("Images to delete:", imagesToDelete);
    console.log("New images:", images);

    // Проверяем существование оборудования
    const { data: existingEquipment, error: fetchError } = await supabase
      .from("equipment")
      .select("*")
      .eq("id", parseInt(id))
      .single();

    if (fetchError || !existingEquipment) {
      console.error("Equipment not found error:", fetchError);
      return res.status(404).json({ error: "Equipment not found" });
    }

    console.log("Existing equipment images:", existingEquipment.images);

    // Обрабатываем images - они приходят как массив
    let processedImages: string[] = [];
    if (images !== undefined && images !== null) {
      if (Array.isArray(images)) {
        // Просто используем массив как есть
        processedImages = images.filter((img: string) => {
          return typeof img === "string" && img.trim().length > 0;
        });
      } else if (typeof images === "string") {
        // Для обратной совместимости
        processedImages = images
          .split(",")
          .map((img: string) => img.trim())
          .filter((img: string) => img.length > 0);
      }
    }

    // ==============================================
    // ИСПРАВЛЕНИЕ: Фильтруем изображения, удаляя те, что помечены на удаление
    // ==============================================
    if (
      imagesToDelete &&
      Array.isArray(imagesToDelete) &&
      imagesToDelete.length > 0
    ) {
      console.log("Filtering out images marked for deletion...");

      // Удаляем из processedImages те изображения, которые помечены на удаление
      processedImages = processedImages.filter((imgUrl: string) => {
        const shouldKeep = !imagesToDelete.includes(imgUrl);
        if (!shouldKeep) {
          console.log(`Removing from processedImages: ${imgUrl}`);
        }
        return shouldKeep;
      });

      console.log("Images after filtering:", processedImages);
    }

    // Если после фильтрации нет изображений, устанавливаем пустой массив
    // НЕ оставляем старые изображения, если они все помечены на удаление
    // if (processedImages.length === 0 && existingEquipment.images) {
    //   processedImages = existingEquipment.images; // ЗАКОММЕНТИРУЙТЕ ЭТУ СТРОКУ!
    // }

    console.log("Processed images to save:", processedImages);

    // Удаляем старые изображения с сервера если они есть
    if (
      imagesToDelete &&
      Array.isArray(imagesToDelete) &&
      imagesToDelete.length > 0
    ) {
      console.log("Starting to delete old images from storage...");

      try {
        // Для каждого URL извлекаем имя файла и удаляем из хранилища
        const deletePromises = imagesToDelete.map(async (imageUrl: string) => {
          try {
            // Извлекаем имя файла из URL
            const urlParts = imageUrl.split("/");
            const fileName = urlParts[urlParts.length - 1];

            if (!fileName) {
              console.warn("Could not extract filename from URL:", imageUrl);
              return;
            }

            console.log("Deleting file from storage:", fileName);

            // Удаляем файл из Supabase Storage
            const { error: deleteError } = await supabase.storage
              .from("equipment-images")
              .remove([fileName]);

            if (deleteError) {
              console.error("Error deleting file:", fileName, deleteError);
              return;
            }

            console.log("File deleted successfully from storage:", fileName);
          } catch (deleteError) {
            console.error("Error deleting image URL:", imageUrl, deleteError);
          }
        });

        // Ждем удаления всех изображений
        await Promise.all(deletePromises);
        console.log("All old images deleted successfully from storage");
      } catch (deleteError) {
        console.error("Error during image deletion:", deleteError);
        // Не прерываем выполнение, если не удалось удалить старые изображения
        // Продолжаем обновление оборудования
      }
    }

    // Записываем изменение цены в историю
    if (price && parseFloat(price) !== existingEquipment.price) {
      await supabase.from("price_history").insert({
        equipment_id: parseInt(id),
        old_price: existingEquipment.price,
        new_price: parseFloat(price),
        changed_by: req.user.id,
      });
    }

    // Подготавливаем данные для обновления
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    // Добавляем только те поля которые пришли в запросе
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (category !== undefined) updateData.category = category;

    // Всегда обновляем images с новым массивом
    updateData.images = processedImages;

    console.log("Update data for DB:", JSON.stringify(updateData, null, 2));

    // Обновляем оборудование в базе данных
    const { error: updateError } = await supabase
      .from("equipment")
      .update(updateData)
      .eq("id", parseInt(id));

    if (updateError) {
      console.error("Update equipment error:", updateError);
      console.error("Update error details:", {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      });
      return res.status(500).json({ error: updateError.message });
    }

    console.log("Update successful, waiting a bit...");
    // Даем время на обновление
    await new Promise((resolve) => setTimeout(resolve, 500));

    // После обновления получаем обновленные данные напрямую из БД
    const { data: updatedData, error: selectError } = await supabase
      .from("equipment")
      .select("id, name, images")
      .eq("id", parseInt(id))
      .single();

    if (selectError) {
      console.error("Select after update error:", selectError);
    } else {
      console.log("Direct query after update:");
      console.log("Updated data:", updatedData);
      console.log("Images in updated data:", updatedData.images);
      console.log("Type of images:", typeof updatedData.images);
      console.log("Is array:", Array.isArray(updatedData.images));
    }

    // Также попробуем получить данные через другой запрос
    const { data: rawData } = await supabase.rpc("get_equipment_by_id", {
      eq_id: parseInt(id),
    });

    console.log("RPC result:", rawData);

    // Получаем полные данные для ответа
    const { data: finalData, error: finalError } = await supabase
      .from("equipment")
      .select("*")
      .eq("id", parseInt(id))
      .single();

    if (finalError) {
      console.error("Final select error:", finalError);
      return res.json({
        success: true,
        message: "Оборудование успешно обновлено",
      });
    }

    // Вычисляем main_image для ответа
    const responseEquipment = {
      ...finalData,
      main_image:
        finalData.images &&
        Array.isArray(finalData.images) &&
        finalData.images.length > 0
          ? finalData.images[0]
          : null,
    };

    res.json({
      success: true,
      equipment: responseEquipment,
      message: "Оборудование успешно обновлено",
      deletedImages: imagesToDelete || [],
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// В POST запросе:
router.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    // Проверяем права доступа - только админы
    if (!req.user || req.user.role !== "supabase_admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    let { name, description, price, stock, category, images } = req.body;

    // Валидация
    if (!name || !price || !stock || !category) {
      return res.status(400).json({
        error: "Missing required fields: name, price, stock, category",
      });
    }

    // Обрабатываем images
    let processedImages: string[] = [];
    if (images !== undefined && images !== null) {
      // Преобразуем images в массив если это строка
      if (typeof images === "string") {
        processedImages = images
          .split(",")
          .map((img: string) => img.trim())
          .filter((img: string) => img.length > 0);
      } else if (Array.isArray(images)) {
        processedImages = images.filter((img: string) => img.trim().length > 0);
      }
    }

    console.log("Creating equipment with images:", processedImages);

    // Создаем оборудование
    const { data, error } = await supabase
      .from("equipment")
      .insert({
        name,
        description: description || "",
        price: parseFloat(price),
        stock: parseInt(stock),
        category,
        images: processedImages,
      })
      .select()
      .single();

    if (error) {
      console.error("Create equipment error:", error);
      return res.status(500).json({ error: error.message });
    }

    // Вычисляем main_image для ответа
    const responseEquipment = {
      ...data,
      main_image:
        data.images && Array.isArray(data.images) && data.images.length > 0
          ? data.images[0]
          : null,
    };

    res.status(201).json({
      success: true,
      equipment: responseEquipment,
      message: "Оборудование успешно добавлено",
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Удалить оборудование
router.delete("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    // Проверяем права доступа
    if (!req.user || req.user.role !== "supabase_admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    // Проверяем существование оборудования
    const { data: existingEquipment, error: fetchError } = await supabase
      .from("equipment")
      .select("*")
      .eq("id", parseInt(id))
      .single();

    if (fetchError || !existingEquipment) {
      return res.status(404).json({ error: "Equipment not found" });
    }

    // Удаляем связанные данные (опционально)
    await supabase
      .from("product_views")
      .delete()
      .eq("equipment_id", parseInt(id));

    await supabase
      .from("price_history")
      .delete()
      .eq("equipment_id", parseInt(id));

    // Удаляем оборудование
    const { error } = await supabase
      .from("equipment")
      .delete()
      .eq("id", parseInt(id));

    if (error) {
      console.error("Delete equipment error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({
      success: true,
      message: "Оборудование успешно удалено",
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
export default router;
