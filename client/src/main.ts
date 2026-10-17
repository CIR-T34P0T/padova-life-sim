import { sanitizeDisplayName } from "@padova/shared";
import { Game } from "./game.ts";
import { Hud } from "./ui/hud.ts";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html`);
  return element as T;
}

const form = byId<HTMLFormElement>("join");
const nameInput = byId<HTMLInputElement>("name");
const joinButton = byId<HTMLButtonElement>("join-button");
const joinError = byId<HTMLParagraphElement>("join-error");

const hud = new Hud(byId("status"), byId("players"), byId("toast"));
let game: Game | null = null;

try {
  const saved = localStorage.getItem("padova.name");
  if (saved) nameInput.value = saved;
} catch {
  // Storage can be unavailable (private mode); the name just isn't remembered.
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = sanitizeDisplayName(nameInput.value) ?? "";
  joinButton.disabled = true;
  joinError.textContent = "";
  try {
    localStorage.setItem("padova.name", name);
  } catch {
    // See above.
  }
  try {
    game ??= new Game(byId("game"), byId("joystick"), hud);
    await game.start(name);
    form.hidden = true;
  } catch (error) {
    console.error("Failed to join", error);
    joinError.textContent = "Couldn't reach the game server. Is it running?";
    hud.setStatus("disconnected", error instanceof Error ? error.message : String(error));
    joinButton.disabled = false;
  }
});
