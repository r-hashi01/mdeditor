import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";

export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    const yes = await ask(
      `v${update.version} が利用可能です（現在のバージョンから更新します）\n\n${update.body ?? ""}`,
      {
        title: "アップデートがあります",
        okLabel: "更新する",
        cancelLabel: "あとで",
        kind: "info",
      },
    );
    if (!yes) return;

    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    console.warn("Update check failed:", e);
    // サイレントに失敗（起動を妨げない）
  }
}
