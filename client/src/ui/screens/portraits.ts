// Character portraits for the title screen, the character list and the
// creator's starting looks: the real 3D character drawn once by a small
// offscreen renderer and kept as an image. One renderer at a time, freed
// when idle, so the menus never hold an extra WebGL context for long.

import { encodeLook, type AppearanceConfig } from "@padova/shared";
import { CharacterModel } from "../../render/avatar/index.ts";
import { PreviewStage, type PreviewView } from "../../render/previewStage.ts";

export type PortraitShot = "body" | "bust";

const cache = new Map<string, string>();
const queue: { key: string; appearance: AppearanceConfig; shot: PortraitShot; resolve: (url: string) => void; reject: (error: unknown) => void }[] = [];
let stage: PreviewStage | null = null;
let working = false;
let idleTimer: number | undefined;
let unavailable = false;

const SIZES: Record<PortraitShot, { width: number; height: number; view: PreviewView; zoom: number; yaw: number }> = {
  body: { width: 192, height: 240, view: "body", zoom: 0, yaw: 0.3 },
  bust: { width: 240, height: 240, view: "upper", zoom: 1.35, yaw: 0.25 },
};

/** A data URL of the character. Rejects when this browser can't render WebGL. */
export function portrait(appearance: AppearanceConfig, shot: PortraitShot = "body"): Promise<string> {
  const key = `${shot}|${encodeLook(appearance)}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  if (unavailable) return Promise.reject(new Error("3D portraits unavailable"));
  return new Promise((resolve, reject) => {
    queue.push({ key, appearance, shot, resolve, reject });
    void work();
  });
}

/** Fills an <img> with a portrait, or marks it as unavailable (CSS shows the initial instead). */
export function fillPortrait(image: HTMLImageElement, appearance: AppearanceConfig, shot: PortraitShot = "body"): void {
  image.dataset.state = "loading";
  portrait(appearance, shot).then(
    (url) => {
      image.src = url;
      image.dataset.state = "ready";
    },
    () => {
      image.dataset.state = "unavailable";
      image.alt = image.alt || "Preview unavailable";
    },
  );
}

async function work(): Promise<void> {
  if (working) return;
  working = true;
  window.clearTimeout(idleTimer);
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      const cached = cache.get(job.key);
      if (cached) {
        job.resolve(cached);
        continue;
      }
      try {
        if (!stage) {
          const canvas = document.createElement("canvas");
          stage = new PreviewStage(canvas, { antialias: true, background: null });
          stage.renderer.setPixelRatio(1);
        }
        const size = SIZES[job.shot];
        stage.setSize(size.width, size.height);
        const model = new CharacterModel(job.appearance);
        model.pose({ moving: false, seated: false, activity: "idle", time: 0 });
        stage.show(model);
        stage.frameAt(model, size.zoom, size.yaw);
        stage.render();
        const url = stage.renderer.domElement.toDataURL("image/png");
        model.dispose();
        cache.set(job.key, url);
        job.resolve(url);
      } catch (error) {
        unavailable = true;
        job.reject(error);
        for (const rest of queue.splice(0)) rest.reject(error);
      }
      // One portrait per frame keeps menus responsive while a list fills in.
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  } finally {
    working = false;
    idleTimer = window.setTimeout(release, 1500);
  }
}

function release(): void {
  if (working || !stage) return;
  stage.renderer.forceContextLoss();
  stage.dispose();
  stage = null;
}
