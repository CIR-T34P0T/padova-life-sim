// Page flow: connect (with this browser's guest token, if any) → the server
// says "create a character" or "here is your character" → play. Profile
// data lives on the server; the browser only keeps the temporary guest token.

import {
  CLOSE_SIGNED_IN_ELSEWHERE,
  ERROR_INVALID_GUEST_TOKEN,
  type CharacterProfile,
  type ProfileErrorPayload,
} from "@padova/shared";
import { Game } from "./game.ts";
import { createIdentityStore } from "./net/identityStore.ts";
import { Hud } from "./ui/hud.ts";
import { ProfilePanel } from "./ui/profilePanel.ts";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html`);
  return element as T;
}

const PROFILE_ERROR_TEXT: Record<string, string> = {
  invalid_payload: "Something went wrong with that request. Please try again.",
  invalid_name: "Names need 2 to 20 characters.",
  age_category_not_allowed: "Player characters must be adults.",
  invalid_appearance: "One of those choices isn't available. Please pick again.",
  invalid_traits: "Pick at most two different personality traits.",
  already_has_character: "You already have a character.",
  no_character: "Create a character first.",
  profile_newer_version: "This profile was saved by a newer version of the game and can't be changed here.",
  rate_limited: "Too many new characters from this network recently. Please try again later.",
  storage_error: "The server couldn't save that. Please try again.",
};

const store = createIdentityStore();
const hud = new Hud({ status: byId("status"), players: byId("players"), toast: byId("toast"), meChip: byId<HTMLButtonElement>("me-chip") });
const panel = new ProfilePanel(byId("profile-panel"));
let profile: CharacterProfile | null = null;
let readOnly = false;
let createNotice: string | undefined;

const game = new Game(byId("game"), byId("joystick"), hud, {
  onProfile(payload) {
    if (payload.status === "needs_character") {
      panel.showCreate((input) => {
        panel.setBusy(true);
        game.createCharacter(input);
      }, createNotice);
      createNotice = undefined;
      return;
    }
    profile = payload.profile ?? profile;
    readOnly = payload.readOnly ?? false;
    if (profile) game.setProfile(profile);
    if (panel.mode !== "hidden" && panel.mode !== "message") panel.hide();
    for (const notice of payload.notices ?? []) hud.toast(notice, 6000);
  },
  onIdentity({ guestToken }) {
    if (!store.set(guestToken)) {
      hud.toast("This browser won't let the game remember you, so your character will be lost when you close this tab.", 9000);
    }
  },
  onProfileError(error: ProfileErrorPayload) {
    const text = PROFILE_ERROR_TEXT[error.reason] ?? "That couldn't be saved.";
    if (panel.mode === "create" || panel.mode === "edit") panel.showError(text);
    else hud.toast(text);
  },
  onDisconnected(code) {
    if (code === CLOSE_SIGNED_IN_ELSEWHERE) {
      panel.showMessage(
        "Playing in another window",
        "You opened Padova Life SIM in another tab or window, so this one was disconnected. Your character is still saved.",
        "Play here instead",
        () => location.reload(),
      );
    }
  },
  onEditAppearance() {
    if (!profile) return;
    panel.showEdit(
      profile,
      (appearance) => {
        panel.setBusy(true);
        game.updateAppearance(appearance);
      },
      () => panel.hide(),
      readOnly,
    );
  },
});

const isInvalidToken = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: number }).code === ERROR_INVALID_GUEST_TOKEN;

async function connect(): Promise<void> {
  const token = store.get();
  panel.showConnecting(token ? "Welcome back. Loading your character…" : undefined);
  try {
    await game.start(token ? { guestToken: token } : {});
    if (!store.available) {
      hud.toast("Storage is blocked in this browser, so your character can't be remembered after you close the tab.", 9000);
    }
  } catch (error) {
    if (token && isInvalidToken(error)) {
      // The saved guest profile no longer exists on this server: start fresh, and say so.
      store.clear();
      createNotice = "We couldn't find your saved guest profile on this server, so you can create a new character.";
      return connect();
    }
    console.error("Failed to join", error);
    panel.showMessage("Couldn't reach the game server", "Make sure the server is running, then try again.", "Try again", () => location.reload());
  }
}

void connect();
