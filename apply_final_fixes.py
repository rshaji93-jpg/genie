import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
WORKSPACE_PATH = ROOT_DIR / "frontend" / "src" / "components" / "genie" / "WorkspaceContainer.tsx"
HEADER_PATH = ROOT_DIR / "frontend" / "src" / "components" / "genie" / "HeaderBar.tsx"
MAIN_PY_PATH = ROOT_DIR / "backend" / "main.py"

def patch_backend():
    if not MAIN_PY_PATH.exists():
        return
    content = MAIN_PY_PATH.read_text(encoding="utf-8")

    # Ensure observer mode forces Genie Master resolution when active
    old_obs_check = 'master_persona = bool(\n        has_image\n        or req.force_genie_master\n        or (observer_mode and has_valid_tokens)\n    )'
    new_obs_check = 'master_persona = bool(\n        has_image\n        or req.force_genie_master\n        or observer_mode\n    )'
    if old_obs_check in content:
        content = content.replace(old_obs_check, new_obs_check, 1)

    MAIN_PY_PATH.write_text(content, encoding="utf-8")
    print("✅ Backend observer mode routing updated.")

def patch_workspace():
    if not WORKSPACE_PATH.exists():
        return
    content = WORKSPACE_PATH.read_text(encoding="utf-8")

    # 1. Left rail shield icon visible exclusively to Super Admin rshaji93@gmail.com
    old_shield = '{(userProfile?.email?.trim().toLowerCase() === "rshaji93@gmail.com" || Boolean(getLocalDevelopmentToken())) && isSuperAdminVerified && ('
    new_shield = '{(userProfile?.email?.trim().toLowerCase() === "rshaji93@gmail.com") && ('
    content = content.replace(old_shield, new_shield)

    # 2. App Logo 5-tap secret trigger for VIP grant (Admin) or VIP Request (User)
    old_logo_render = '<div className="flex items-center gap-2 pr-1">'
    logo_trigger_handler = '''<div 
            className="flex items-center gap-2 pr-1 cursor-pointer select-none"
            onClick={() => {
              // 5-tap app logo trigger
              const now = Date.now();
              (window as any).__logo_taps = ((window as any).__logo_taps || []).filter((t: number) => now - t < 2000);
              (window as any).__logo_taps.push(now);
              if ((window as any).__logo_taps.length >= 5) {
                (window as any).__logo_taps = [];
                if (userProfile.email.trim().toLowerCase() === "rshaji93@gmail.com") {
                  void openAdminDrawer();
                } else {
                  setVipRequestModalOpen(true);
                }
              }
            }}
          >'''
    content = content.replace(old_logo_render, logo_trigger_handler, 1)

    # 3. Clean up any stray aria-hidden text artifacts in chat bar
    content = content.replace('aria-hidden="true" / >', '')
    content = content.replace('aria-hidden="true"=""', '')

    WORKSPACE_PATH.write_text(content, encoding="utf-8")
    print("✅ WorkspaceContainer updated with 5-tap logo triggers and admin-exclusive rail shield.")

if __name__ == "__main__":
    print("🚀 Applying Final Core Corrections...")
    patch_backend()
    patch_workspace()
    print("🎉 Done! Run 'python apply_final_fixes.py' to apply changes.")