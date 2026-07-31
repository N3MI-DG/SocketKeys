/**
 * One-shot "is a newer build out there" check against GitHub, run once at
 * startup (see App.vue). Compares the running app's own version (from
 * `tauri.conf.json`, read via `getVersion()`) against the repo's latest
 * *published* release.
 */
import { reactive } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export const REPO = "N3MI-DG/SocketKeys";

export const updateCheckState = reactive({
  available: false,
  latestVersion: null as string | null,
});

interface GithubRelease {
  tag_name: string;
}

/** Release tags are pushed as `v1.2.3`; `tauri.conf.json` has no `v` */
function stripLeadingV(tag: string): string {
  return tag.replace(/^v/i, "");
}

export async function checkForUpdate(): Promise<void> {
  try {
    const [current, response] = await Promise.all([
      getVersion(),
      tauriFetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
      }),
    ]);
    // 404 means the repo has no published release yet
    if (response.status === 404) return;
    if (!response.ok) return;

    const release = (await response.json()) as GithubRelease;
    if (!release.tag_name) return;

    const latestVersion = stripLeadingV(release.tag_name);
    updateCheckState.latestVersion = latestVersion;
    updateCheckState.available = latestVersion !== current;
  } catch (err) {
    // GitHub unreachable
    console.warn("[update-check] failed", err);
  }
}
