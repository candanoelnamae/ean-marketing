import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) throw new Error("Server configuration is incomplete.");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);

    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Sign in required." }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", callerData.user.id)
      .maybeSingle();

    if (profileError || callerProfile?.role !== "ADMIN") {
      return json({ error: "Administrator access required." }, 403);
    }

    const body = await req.json();
    const action = body?.action;

    if (action === "list") {
      const { data, error } = await admin
        .from("profiles")
        .select("id, full_name, username, role, created_at, must_change_password")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json({ users: data ?? [] });
    }

    if (action === "create") {
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const role = body.role === "ADMIN" ? "ADMIN" : "USER";

      if (!fullName || fullName.length > 120) return json({ error: "Enter a valid full name." }, 400);
      if (!/^[a-zA-Z0-9._-]{1,30}$/.test(username)) return json({ error: "Username must be 1–30 letters, numbers, dots, underscores, or hyphens." }, 400);
      if (password.length < 8) return json({ error: "Default password must be at least 8 characters." }, 400);

      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .ilike("username", username)
        .maybeSingle();
      if (existing) return json({ error: "That username is already in use." }, 409);

      // New username accounts receive an internal email address so Supabase Auth
      // can authenticate them; users continue to sign in with their username.
      const internalEmail = username + "@users.eanmarketing.invalid";
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, username },
      });
      if (createError || !created.user) throw createError ?? new Error("Could not create the authentication account.");

      const { error: insertError } = await admin.from("profiles").insert({
        id: created.user.id,
        full_name: fullName,
        username,
        role,
        must_change_password: true,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw insertError;
      }
      return json({ success: true, user_id: created.user.id });
    }

    if (action === "update") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      if (!userId) return json({ error: "User ID is required." }, 400);
      const updates: Record<string, unknown> = {};
      if (typeof body.full_name === "string") {
        const name = body.full_name.trim();
        if (!name || name.length > 120) return json({ error: "Enter a valid full name." }, 400);
        updates.full_name = name;
      }
      if (body.role === "ADMIN" || body.role === "USER") updates.role = body.role;
      if (Object.keys(updates).length === 0) return json({ error: "No valid changes supplied." }, 400);

      if (userId === callerData.user.id && updates.role === "USER") {
        const { count, error: countError } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "ADMIN");
        if (countError) throw countError;
        if ((count ?? 0) <= 1) return json({ error: "You cannot remove the only administrator role." }, 400);
      }

      const { error } = await admin.from("profiles").update(updates).eq("id", userId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "reset_password") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!userId) return json({ error: "User ID is required." }, 400);
      if (password.length < 8) return json({ error: "Temporary password must be at least 8 characters." }, 400);

      const { error: authError } = await admin.auth.admin.updateUserById(userId, { password });
      if (authError) throw authError;
      const { error: flagError } = await admin
        .from("profiles")
        .update({ must_change_password: true })
        .eq("id", userId);
      if (flagError) throw flagError;
      return json({ success: true });
    }

    if (action === "delete") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      if (!userId) return json({ error: "User ID is required." }, 400);
      if (userId === callerData.user.id) return json({ error: "You cannot delete your own signed-in account." }, 400);

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id, role")
        .eq("id", userId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "User not found." }, 404);

      if (target.role === "ADMIN") {
        const { count, error: countError } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "ADMIN");
        if (countError) throw countError;
        if ((count ?? 0) <= 1) return json({ error: "You cannot delete the only administrator." }, 400);
      }

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Request failed." }, 400);
  }
});
