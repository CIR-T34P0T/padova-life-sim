// Page start: apply this device's settings, build the game view (not yet
// rendering), then show the title screen and connect in the background.
// Profile data lives on the server; the browser only keeps the temporary
// guest token, device settings and saved look codes.

import "@fontsource/dela-gothic-one/latin-400.css";
import "@fontsource/m-plus-rounded-1c/latin-500.css";
import "@fontsource/m-plus-rounded-1c/latin-700.css";
import "@fontsource/m-plus-rounded-1c/latin-800.css";
import { Game } from "./game.ts";
import { createIdentityStore } from "./net/identityStore.ts";
import { Flow } from "./ui/flow.ts";
import { Hud } from "./ui/hud.ts";
import { ScreenHost } from "./ui/screens/screenHost.ts";
import { applySettings } from "./ui/settings.ts";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html`);
  return element as T;
}

applySettings();
window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => applySettings());

const hud = new Hud({ status: byId("status"), players: byId("players"), toast: byId("toast"), meChip: byId<HTMLButtonElement>("me-chip") });
const host = new ScreenHost(byId("screens"));
let flow: Flow;

const game = new Game(byId("game"), byId("joystick"), hud, {
  onProfile: (payload) => flow.onProfile(payload),
  onIdentity: ({ guestToken }) => flow.onIdentity(guestToken),
  onProfileError: (error) => flow.onProfileError(error),
  onProfileDeleted: () => flow.onProfileDeleted(),
  onDisconnected: (code) => flow.onDisconnected(code),
  onEditAppearance: () => flow.onEditAppearance(),
  onLeaveToTitle: () => flow.onLeaveToTitle(),
});

flow = new Flow(game, hud, createIdentityStore(), host);
flow.start();
