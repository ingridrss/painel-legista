
(() => {
  const URL = window.LEGISTA_SUPABASE_URL;
  const KEY = window.LEGISTA_SUPABASE_ANON_KEY;

  const configured =
    URL && KEY &&
    !URL.includes("COLE_AQUI") &&
    !KEY.includes("COLE_AQUI");

  const SYNC_META_KEY = "medlegista-cloud-meta-v1";
  const PREFIXES = ["medlegista-", "legista_", "ml.study."];

  const isStudyKey = (k) =>
    PREFIXES.some(p => k.startsWith(p)) &&
    k !== SYNC_META_KEY;

  const now = () => new Date().toISOString();

  function readMeta() {
    try { return JSON.parse(localStorage.getItem(SYNC_META_KEY) || "{}"); }
    catch { return {}; }
  }

  function writeMeta(meta) {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  }

  function captureLocal() {
    const meta = readMeta();
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isStudyKey(key)) continue;
      items[key] = {
        value: localStorage.getItem(key),
        updated_at: meta[key] || null
      };
    }
    return items;
  }

  function updateStatus(text) {
    const el = document.getElementById("cloudSyncStatus");
    if (el) el.textContent = text;
    const floating = document.getElementById("legistaFloatingSync");
    if (floating) floating.textContent = text;
  }

  function ensureFloatingStatus() {
    if (document.getElementById("cloudSyncBar")) return;
    const el = document.createElement("button");
    el.id = "legistaFloatingSync";
    el.type = "button";
    el.style.cssText = `
      position:fixed;right:12px;bottom:12px;z-index:9999;
      border:0;border-radius:999px;padding:8px 11px;
      background:#171717;color:white;font:12px system-ui;
      box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer
    `;
    el.textContent = "☁️ Nuvem";
    el.addEventListener("click", () => openAuthDialog());
    document.body.appendChild(el);
  }

  if (!configured || !window.supabase?.createClient) {
    document.addEventListener("DOMContentLoaded", () => {
      ensureFloatingStatus();
      updateStatus("☁️ Nuvem: configurar Supabase");
      const btn = document.getElementById("cloudLoginBtn");
      if (btn) btn.onclick = () => alert(
        "Preencha assets/supabase-config.js com a Project URL e a anon public key do seu Supabase."
      );
    });
    return;
  }

  const client = window.supabase.createClient(URL, KEY);

  // Patch localStorage so future week progress automatically gets a timestamp and sync.
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  let syncTimer = null;
  let suppressTracking = false;

  function markKey(key) {
    if (suppressTracking || !isStudyKey(key)) return;
    const meta = readMeta();
    meta[key] = now();
    originalSetItem.call(localStorage, SYNC_META_KEY, JSON.stringify(meta));
    schedulePush();
  }

  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage) markKey(key);
  };

  Storage.prototype.removeItem = function(key) {
    originalRemoveItem.call(this, key);
    if (this === localStorage && isStudyKey(key)) {
      const meta = readMeta();
      meta[key] = now();
      originalSetItem.call(localStorage, SYNC_META_KEY, JSON.stringify(meta));
      schedulePush();
    }
  };

  async function getUser() {
    const { data } = await client.auth.getUser();
    return data?.user || null;
  }

  async function fetchRemote(userId) {
    const { data, error } = await client
      .from("study_state")
      .select("data,updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  function mergeRemoteIntoLocal(remoteItems) {
    const localItems = captureLocal();
    const meta = readMeta();

    suppressTracking = true;
    try {
      for (const [key, remote] of Object.entries(remoteItems || {})) {
        const local = localItems[key];

        // Existing legacy local value without timestamp:
        // remote wins to avoid accidentally overwriting progress from another device.
        if (!local || !local.updated_at) {
          if (remote?.value === null || remote?.value === undefined) {
            originalRemoveItem.call(localStorage, key);
          } else {
            originalSetItem.call(localStorage, key, remote.value);
          }
          if (remote?.updated_at) meta[key] = remote.updated_at;
          continue;
        }

        const lt = new Date(local.updated_at || 0).getTime();
        const rt = new Date(remote?.updated_at || 0).getTime();
        if (rt > lt) {
          if (remote?.value === null || remote?.value === undefined) {
            originalRemoveItem.call(localStorage, key);
          } else {
            originalSetItem.call(localStorage, key, remote.value);
          }
          meta[key] = remote.updated_at;
        }
      }
      originalSetItem.call(localStorage, SYNC_META_KEY, JSON.stringify(meta));
    } finally {
      suppressTracking = false;
    }
  }

  function buildMergedPayload(remoteItems) {
    const localItems = captureLocal();
    const merged = { ...(remoteItems || {}) };

    for (const [key, local] of Object.entries(localItems)) {
      const remote = merged[key];

      // Local-only legacy data should be preserved and uploaded.
      if (!remote) {
        merged[key] = {
          value: local.value,
          updated_at: local.updated_at || now()
        };
        continue;
      }

      // If local has a timestamp, newest wins.
      if (local.updated_at) {
        const lt = new Date(local.updated_at).getTime();
        const rt = new Date(remote.updated_at || 0).getTime();
        if (lt >= rt) merged[key] = local;
      }
    }

    return merged;
  }

  async function syncNow() {
    const user = await getUser();
    if (!user) {
      updateStatus("☁️ Nuvem: não conectado");
      return;
    }

    updateStatus("☁️ Sincronizando…");

    const remoteRow = await fetchRemote(user.id);
    const remoteItems = remoteRow?.data?.items || {};

    mergeRemoteIntoLocal(remoteItems);
    const mergedItems = buildMergedPayload(remoteItems);

    const payload = {
      user_id: user.id,
      data: {
        version: 1,
        items: mergedItems
      },
      updated_at: now()
    };

    const { error } = await client
      .from("study_state")
      .upsert(payload, { onConflict: "user_id" });

    if (error) throw error;

    updateStatus("☁️ Sincronizado");
    window.dispatchEvent(new CustomEvent("legista-cloud-synced"));
  }

  function schedulePush() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncNow().catch(err => {
        console.error(err);
        updateStatus("⚠️ Falha ao sincronizar");
      });
    }, 700);
  }

  function openAuthDialog() {
    const existing = document.getElementById("legistaAuthOverlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "legistaAuthOverlay";
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.55);
      display:grid;place-items:center;z-index:10000;padding:20px
    `;

    overlay.innerHTML = `
      <div style="width:min(420px,100%);background:white;color:#222;border-radius:16px;padding:22px;font:14px system-ui">
        <h2 style="margin:0 0 8px">Sincronizar progresso</h2>
        <p style="margin:0 0 16px;color:#666">Entre com o mesmo e-mail e senha no celular e no computador.</p>

        <label style="display:block;margin:10px 0 4px">E-mail</label>
        <input id="legistaEmail" type="email" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px">

        <label style="display:block;margin:10px 0 4px">Senha</label>
        <input id="legistaPassword" type="password" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px">

        <div id="legistaAuthMsg" style="min-height:20px;margin-top:10px;color:#8b0000"></div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button id="legistaLogin" style="padding:9px 12px">Entrar</button>
          <button id="legistaSignup" style="padding:9px 12px">Criar conta</button>
          <button id="legistaLogout" style="padding:9px 12px">Sair</button>
          <button id="legistaClose" style="padding:9px 12px;margin-left:auto">Fechar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const msg = overlay.querySelector("#legistaAuthMsg");
    const email = overlay.querySelector("#legistaEmail");
    const password = overlay.querySelector("#legistaPassword");

    overlay.querySelector("#legistaClose").onclick = () => overlay.remove();

    overlay.querySelector("#legistaLogin").onclick = async () => {
      msg.textContent = "Entrando…";
      const { error } = await client.auth.signInWithPassword({
        email: email.value.trim(),
        password: password.value
      });
      if (error) {
        msg.textContent = error.message;
        return;
      }
      msg.style.color = "#176b33";
      msg.textContent = "Conectado. Sincronizando…";
      await syncNow();
      setTimeout(() => location.reload(), 400);
    };

    overlay.querySelector("#legistaSignup").onclick = async () => {
      msg.textContent = "Criando conta…";
      const { error } = await client.auth.signUp({
        email: email.value.trim(),
        password: password.value
      });
      if (error) {
        msg.textContent = error.message;
        return;
      }
      msg.style.color = "#176b33";
      msg.textContent = "Conta criada. Se o Supabase pedir confirmação, confirme pelo e-mail e depois entre.";
    };

    overlay.querySelector("#legistaLogout").onclick = async () => {
      await client.auth.signOut();
      msg.style.color = "#176b33";
      msg.textContent = "Sessão encerrada.";
      updateStatus("☁️ Nuvem: não conectado");
    };
  }

  async function boot() {
    ensureFloatingStatus();

    const btn = document.getElementById("cloudLoginBtn");
    if (btn) btn.onclick = openAuthDialog;

    const user = await getUser();
    if (!user) {
      updateStatus("☁️ Nuvem: não conectado");
      return;
    }

    updateStatus("☁️ Conectado · sincronizando…");
    try {
      await syncNow();
    } catch (err) {
      console.error(err);
      updateStatus("⚠️ Falha ao sincronizar");
    }
  }

  client.auth.onAuthStateChange(() => {
    setTimeout(() => boot(), 0);
  });

  document.addEventListener("DOMContentLoaded", boot);
  window.addEventListener("focus", () => syncNow().catch(() => {}));
})();
