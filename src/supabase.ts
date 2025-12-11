import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

console.log("Initializing Supabase Service Client...");
console.log("URL:", supabaseUrl.substring(0, 20) + "...");
console.log("Key exists:", !!supabaseServiceKey);

// Создаем клиент БЕЗ попыток установки роли
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  // Важные настройки для предотвращения ошибок
  global: {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  },
});

// Проверяем подключение
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from("equipment")
      .select("count")
      .limit(1);

    if (error) {
      console.error("Supabase connection test FAILED:", error.message);
    } else {
      console.log("Supabase Service Client initialized successfully");
    }
  } catch (err) {
    console.error("Supabase connection test ERROR:", err.message);
  }
}

testConnection();
