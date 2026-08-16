import { platform } from "@tauri-apps/plugin-os";

const currentPlatform = platform();

export const isMobile = currentPlatform === "android" || currentPlatform === "ios";
