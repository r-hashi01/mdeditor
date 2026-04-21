import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask, message } from "@tauri-apps/plugin-dialog";

/**
 * @param silent true = background check on launch (silent if no update)
 *               false = manual check (shows "up to date" message)
 */
export async function checkForUpdates(silent = false): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      if (!silent) {
        await message("You are on the latest version.", {
          title: "Check for Updates",
          kind: "info",
        });
      }
      return;
    }

    const yes = await ask(
      `v${update.version} is available.\n\n${update.body ?? ""}`,
      {
        title: "Update Available",
        okLabel: "Update",
        cancelLabel: "Later",
        kind: "info",
      },
    );
    if (!yes) return;

    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    console.warn("Update check failed:", e);
    if (!silent) {
      if (import.meta.env.DEV) {
        await message("Update check is not available in development mode.", {
          title: "Check for Updates",
          kind: "info",
        });
      } else {
        await message("Failed to check for updates.", {
          title: "Error",
          kind: "error",
        });
      }
    }
  }
}
