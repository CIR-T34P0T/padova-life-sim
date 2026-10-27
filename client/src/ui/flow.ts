// The page flow around the world: title screen → (new life: name →
// look → review) or Continue → entering transition → the piazza, plus
// Manage characters, Settings and Credits, editing a look (from the title
// screen or in the world) and going back to the title. The server decides
// every outcome; this only shows screens and sends requests.

import {
  CLOSE_SIGNED_IN_ELSEWHERE,
  DEFAULT_APPEARANCE,
  PROFILE_CONFIG,
  cloneAppearance,
  confirmNameMatches,
  confirmsProfileDeletion,
  PROFILE_DELETE_WORD,
  decodeLook,
  type AppearanceConfig,
  type CharacterProfile,
  type CharacterSummary,
  type ProfileErrorPayload,
  type ProfileFailure,
  type ProfilePayload,
} from "@padova/shared";
import type { Game } from "../game.ts";
import type { IdentityStore } from "../net/identityStore.ts";
import type { Hud } from "./hud.ts";
import { CreatorScreen } from "./screens/creatorScreen.ts";
import { Dialog } from "./screens/dialog.ts";
import { CreditsScreen, MessageScreen, SettingsScreen, TransitionScreen } from "./screens/infoScreens.ts";
import { ManageScreen } from "./screens/manageScreen.ts";
import type { ScreenHost } from "./screens/screenHost.ts";
import { SetupScreen, type SetupValues } from "./screens/setupScreen.ts";
import { TitleScreen, type LobbyView } from "./screens/titleScreen.ts";
import { prefersReducedMotion } from "./settings.ts";

type Pending =
  | { kind: "create"; name: string }
  | { kind: "enter"; name: string; from: "title" | "manage" }
  | { kind: "edit-lobby"; characterId: string; name: string }
  | { kind: "edit-world" }
  | { kind: "delete"; name: string }
  | { kind: "delete-profile" }
  | { kind: "leave" };

/** A request the server never answers is reported instead of waiting forever. */
const PENDING_TIMEOUT_MS = 15_000;

const ERROR_TEXT: Record<ProfileFailure, string> = {
  invalid_payload: "Something went wrong with that request. Please try again.",
  invalid_name: "Names need 2 to 20 characters.",
  age_category_not_allowed: "Player characters must be adults.",
  invalid_appearance: "One of those choices isn't available on this server. Please pick again.",
  invalid_traits: "Pick at most two different personality traits.",
  too_many_characters: "All your lives are in use. Delete one in Manage characters to start another.",
  character_not_found: "That character no longer exists. The list has been refreshed.",
  character_in_use: "That character is being played in another window right now.",
  confirm_name_mismatch: "The name you typed doesn't match. Type the character's name to delete it.",
  in_world: "Go back to the title screen first.",
  busy: "Still working on your last request. One moment.",
  profile_newer_version: "This character was saved by a newer version of the game and can't be changed here.",
  rate_limited: "Too many new characters from this network recently. Please try again later.",
  storage_error: "The server couldn't save that. Please try again.",
  profile_not_found: "There's no saved profile for this browser on the server.",
  confirm_mismatch: `Type ${PROFILE_DELETE_WORD} to confirm.`,
};

export class Flow {
  private lobby: LobbyView = { status: "connecting", characters: [], maxCharacters: PROFILE_CONFIG.maxCharactersPerAccount };
  private title: TitleScreen | null = null;
  private manage: ManageScreen | null = null;
  private creator: CreatorScreen | null = null;
  private dialog: Dialog | null = null;
  private pending: Pending | null = null;
  private pendingTimer: number | undefined;
  private setup: SetupValues = { displayName: "", traits: [] };
  private draft: AppearanceConfig = cloneAppearance(DEFAULT_APPEARANCE);
  private profile: CharacterProfile | null = null;
  private readOnly = false;
  private notice: string | undefined;
  private signedInElsewhere = false;

  constructor(
    private readonly game: Game,
    private readonly hud: Hud,
    private readonly store: IdentityStore,
    private readonly host: ScreenHost,
  ) {
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("e2e")) {
      const flow = this;
      (window as unknown as { __flow: unknown }).__flow = {
        screen: () => document.getElementById("screens")?.dataset.screen ?? "",
        lobby: () => ({ ...flow.lobby }),
        pending: () => flow.pending?.kind ?? null,
      };
    }
  }

  start(): void {
    this.showTitle();
    void this.connect();
  }

  // ── Connecting ────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    const token = this.store.get();
    try {
      await this.game.connect(token ? { guestToken: token } : {});
      if (!this.store.available) {
        this.notice = "This browser won't store data, so your characters can't be remembered after you close the tab.";
        this.refreshLobbyScreens();
      }
    } catch (error) {
      if (token && (error as { code?: number })?.code === 4401) {
        // The saved guest profile no longer exists on this server: start fresh, and say so.
        this.store.clear();
        this.notice = "We couldn't find your saved guest profile on this server, so you can start a new life.";
        return this.connect();
      }
      console.error("Failed to join", error);
      this.lobby = { ...this.lobby, status: "offline", message: undefined };
      this.refreshLobbyScreens();
    }
  }

  // ── Server events (wired by main.ts) ──────────────────────────────────

  onProfile(payload: ProfilePayload): void {
    for (const notice of payload.notices ?? []) this.hud.toast(notice, 6000);
    if (payload.status === "lobby") return this.onLobby(payload);
    this.profile = payload.profile ?? this.profile;
    this.readOnly = payload.readOnly ?? false;
    if (this.profile) this.game.setProfile(this.profile);
    const pending = this.takePending();
    if (pending?.kind === "edit-world") {
      this.closeCreator();
      this.host.clear();
      this.game.setCovered(false);
      this.hud.toast("Look saved.");
      return;
    }
    if (!this.game.isInWorld) void this.enterWorld();
  }

  private onLobby(payload: ProfilePayload): void {
    this.lobby = {
      status: "ready",
      characters: payload.characters ?? [],
      maxCharacters: payload.maxCharacters ?? this.lobby.maxCharacters,
      message: this.notice,
    };
    const pending = this.takePending();
    if (this.game.isInWorld) {
      // Back at the title screen (we asked to leave, or the server sent us back).
      this.game.leaveWorld();
      this.game.setCovered(false);
      this.profile = null;
      this.showTitle();
      return;
    }
    if (pending?.kind === "edit-lobby") {
      this.closeCreator();
      this.showManage(`Look saved for ${pending.name}.`);
      return;
    }
    if (pending?.kind === "delete") {
      this.dialog?.close();
      this.dialog = null;
      this.showManage(`${pending.name} was deleted.`);
      return;
    }
    this.refreshLobbyScreens();
  }

  onIdentity(token: string): void {
    if (!this.store.set(token)) {
      this.hud.toast("This browser won't let the game remember you, so your character will be lost when you close this tab.", 9000);
    }
  }

  onProfileError(error: ProfileErrorPayload): void {
    const text = error.reason === "too_many_characters" ? `All ${this.lobby.maxCharacters} lives are in use. Delete one in Manage characters to start another.` : (ERROR_TEXT[error.reason] ?? "That couldn't be saved.");
    if (error.action === "listCharacters") {
      this.lobby = { ...this.lobby, status: "offline", message: "Couldn't load your characters. " };
      this.refreshLobbyScreens();
      return;
    }
    if (error.reason === "busy") {
      this.hud.toast(text);
      return; // the request in flight still gets its own answer
    }
    const pending = this.takePending();
    switch (error.action) {
      case "createCharacter":
        if (error.reason === "invalid_name") return this.showSetup(text);
        if (this.creator) this.creator.setError(text);
        else this.showTitle(text);
        return;
      case "enterWorld":
        if (pending?.kind === "enter" && pending.from === "manage") this.showManage(text);
        else this.showTitle(text);
        return;
      case "updateAppearance":
        if (this.creator) this.creator.setError(text);
        else this.hud.toast(text);
        return;
      case "deleteCharacter":
        if (this.dialog?.isOpen) this.dialog.setError(text);
        else this.manage?.setStatus(text);
        return;
      case "deleteProfile":
        if (this.dialog?.isOpen) this.dialog.setError(error.reason === "character_in_use" ? "One of your characters is being played in another window. Go back to the title screen there first." : text);
        else this.hud.toast(text);
        return;
    }
  }

  /** The server deleted this browser's guest profile (asked here or in another window of the same profile). */
  onProfileDeleted(): void {
    this.takePending();
    this.store.clear();
    this.dialog?.close();
    this.dialog = null;
    this.closeCreator();
    this.notice = undefined;
    this.lobby = { ...this.lobby, characters: [], message: undefined };
    this.host.show(
      new MessageScreen(
        "Profile deleted",
        "Your guest profile and all its characters were deleted from the server, and this browser no longer remembers you. You can start a new life whenever you like.",
        "Back to the title screen",
        () => this.showTitle(),
      ),
    );
  }

  onDisconnected(code: number | undefined): void {
    this.takePending();
    this.dialog?.close();
    const wasInWorld = this.game.isInWorld;
    this.game.leaveWorld();
    this.closeCreator();
    if (code === CLOSE_SIGNED_IN_ELSEWHERE) {
      this.signedInElsewhere = true;
      this.host.show(
        new MessageScreen(
          "Playing in another window",
          "You started playing in another tab or window, so this one was disconnected. Your character is saved.",
          "Play here instead",
          () => location.reload(),
        ),
      );
      return;
    }
    if (wasInWorld) {
      this.host.show(
        new MessageScreen("Connection lost", "The connection to the game server was lost. Your character was saved by the server.", "Back to the title screen", () => location.reload()),
      );
      return;
    }
    this.lobby = { ...this.lobby, status: "offline", message: undefined };
    this.showTitle();
  }

  /** In the world: the player chose "Edit look" (on themselves or in the character panel). */
  onEditAppearance(): void {
    if (!this.profile || this.pending) return;
    const saved = this.profile.appearance;
    const screen = this.openCreator({
      mode: "edit",
      displayName: this.profile.displayName,
      traits: this.profile.traits,
      start: saved,
      base: saved,
      readOnly: this.readOnly,
      onBack: () => this.confirmDiscard(screen, () => this.closeWorldEditor()),
      onChange: () => undefined,
      onConfirm: (look) => {
        this.setPending({ kind: "edit-world" });
        screen?.setBusy(true);
        this.game.updateAppearance(look);
      },
    });
    if (screen) this.game.setCovered(true);
  }

  /** In the world: "Back to title" in the character panel. Saves and leaves the piazza. */
  onLeaveToTitle(): void {
    if (this.pending || !this.game.isInWorld) return;
    this.setPending({ kind: "leave" });
    this.game.setCovered(true);
    this.host.show(new TransitionScreen(this.profile?.displayName ?? "", "leaving"));
    this.game.requestLeaveWorld();
  }

  // ── Screens ───────────────────────────────────────────────────────────

  private showTitle(message?: string): void {
    this.closeCreator();
    this.manage = null;
    if (message) this.lobby = { ...this.lobby, message };
    const title = new TitleScreen(this.lobby, {
      onNewLife: () => this.startNewLife(),
      onContinue: (character) => this.play(character, "title"),
      onManage: () => this.showManage(),
      onSettings: () => this.showSettings(),
      onCredits: () => this.host.show(new CreditsScreen(() => this.showTitle())),
      onRetry: () => location.reload(),
    });
    this.title = title;
    this.host.show(title);
    // A one-off message is shown once.
    if (message) this.lobby = { ...this.lobby, message: this.notice };
  }

  private showManage(status?: string): void {
    this.closeCreator();
    this.title = null;
    const manage = new ManageScreen(this.lobby.characters, this.lobby.maxCharacters, {
      onBack: () => this.showTitle(),
      onPlay: (character) => this.play(character, "manage"),
      onEdit: (character) => this.editFromLobby(character),
      onDelete: (character) => this.confirmDelete(character),
      onNewLife: () => this.startNewLife(),
    });
    this.manage = manage;
    this.host.show(manage);
    if (status) manage.setStatus(status);
  }

  private refreshLobbyScreens(): void {
    this.title?.update(this.lobby);
    this.manage?.update(this.lobby.characters, this.lobby.maxCharacters);
  }

  private startNewLife(): void {
    if (this.lobby.characters.length >= this.lobby.maxCharacters) {
      this.showManage(`All ${this.lobby.maxCharacters} lives are in use. Delete one to start a new life.`);
      return;
    }
    this.setup = { displayName: "", traits: [] };
    this.draft = cloneAppearance(DEFAULT_APPEARANCE);
    this.showSetup();
  }

  private showSetup(error?: string): void {
    this.closeCreator();
    this.title = null;
    this.manage = null;
    this.host.show(
      new SetupScreen(
        this.setup,
        {
          onBack: () => this.showTitle(),
          onNext: (values) => {
            this.setup = values;
            this.showNewLifeCreator();
          },
        },
        error,
      ),
    );
  }

  private showNewLifeCreator(): void {
    const screen = this.openCreator({
      mode: "create",
      displayName: this.setup.displayName,
      traits: this.setup.traits,
      start: this.draft,
      base: DEFAULT_APPEARANCE,
      onBack: () => this.showSetup(),
      onChange: (look) => (this.draft = look),
      onConfirm: (look) => {
        this.draft = look;
        this.setPending({ kind: "create", name: this.setup.displayName });
        screen?.setBusy(true);
        this.game.createCharacter({ displayName: this.setup.displayName, ageCategory: "adult", appearance: look, traits: [...this.setup.traits] });
      },
    });
  }

  private editFromLobby(character: CharacterSummary): void {
    const saved = decodeLook(character.look).appearance;
    const screen = this.openCreator({
      mode: "edit",
      displayName: character.displayName,
      traits: character.traits,
      start: saved,
      base: saved,
      readOnly: character.readOnly,
      onBack: () => this.confirmDiscard(screen, () => this.showManage()),
      onChange: () => undefined,
      onConfirm: (look) => {
        this.setPending({ kind: "edit-lobby", characterId: character.characterId, name: character.displayName });
        screen?.setBusy(true);
        this.game.updateAppearance(look, character.characterId);
      },
    });
  }

  /** Opens the creator screen; without WebGL it explains instead of showing an empty preview. */
  private openCreator(options: ConstructorParameters<typeof CreatorScreen>[0]): CreatorScreen | null {
    this.closeCreator();
    this.title = null;
    this.manage = null;
    try {
      this.creator = new CreatorScreen(options);
    } catch (error) {
      console.error("Character creator unavailable", error);
      this.host.show(
        new MessageScreen(
          "3D preview unavailable",
          "This browser couldn't start the 3D preview (WebGL). Try another browser, or update your graphics drivers.",
          "Back",
          () => (this.game.isInWorld ? this.closeWorldEditor() : this.showTitle()),
        ),
      );
      return null;
    }
    this.host.show(this.creator);
    return this.creator;
  }

  private closeCreator(): void {
    // The screen host destroys the creator screen when it is replaced.
    this.creator = null;
  }

  private closeWorldEditor(): void {
    this.takePending();
    this.closeCreator();
    this.host.clear();
    this.game.setCovered(false);
  }

  private confirmDiscard(screen: CreatorScreen | null, leave: () => void): void {
    if (!screen || !screen.creator.changed) return leave();
    this.dialog = new Dialog({
      title: "Discard your changes?",
      body: ["Your look hasn't been saved. Leaving now keeps the look you had before."],
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      danger: true,
      onConfirm: (_value, dialog) => {
        dialog.close();
        this.dialog = null;
        leave();
      },
      onCancel: () => (this.dialog = null),
    });
  }

  private showSettings(): void {
    // Deleting needs a saved profile and a connection to the server that holds it.
    const canDelete = this.store.get() !== null && this.lobby.status === "ready";
    this.host.show(new SettingsScreen(() => this.showTitle(), true, canDelete ? { characters: this.lobby.characters.length, onDelete: () => this.confirmDeleteProfile() } : null));
  }

  private confirmDeleteProfile(): void {
    const count = this.lobby.characters.length;
    const lives = count === 1 ? "your character" : `all ${count} of your characters`;
    this.dialog = new Dialog({
      title: "Delete your profile?",
      body: [
        `This permanently deletes your guest profile from the server with ${count === 0 ? "everything saved for it" : lives}: their money, skills, studies, job, home, relationships, story and blocks. It can't be undone.`,
        "Reports you sent stay with the moderators until they expire, without your name.",
        `Type ${PROFILE_DELETE_WORD} to confirm.`,
      ],
      input: { label: `Type ${PROFILE_DELETE_WORD}`, placeholder: PROFILE_DELETE_WORD },
      canConfirm: (value) => confirmsProfileDeletion(value),
      confirmLabel: "Delete my profile",
      danger: true,
      onConfirm: (value, dialog) => {
        this.setPending({ kind: "delete-profile" });
        dialog.setBusy(true);
        this.game.deleteProfile(value);
      },
      onCancel: () => (this.dialog = null),
    });
  }

  private confirmDelete(character: CharacterSummary): void {
    this.dialog = new Dialog({
      title: `Delete ${character.displayName}?`,
      body: [
        `This permanently deletes ${character.displayName} with their needs, skills, money and history. It can't be undone. Your other characters stay.`,
        `Type ${character.displayName} to confirm.`,
      ],
      input: { label: "Character name", placeholder: character.displayName },
      canConfirm: (value) => confirmNameMatches(value, character.displayName),
      confirmLabel: "Delete forever",
      danger: true,
      onConfirm: (value, dialog) => {
        this.setPending({ kind: "delete", name: character.displayName });
        dialog.setBusy(true);
        this.game.deleteCharacter(character.characterId, value);
      },
      onCancel: () => (this.dialog = null),
    });
  }

  private play(character: CharacterSummary, from: "title" | "manage"): void {
    if (this.pending) return;
    this.setPending({ kind: "enter", name: character.displayName, from });
    this.host.show(new TransitionScreen(character.displayName, "arriving"));
    this.game.enterCharacter(character.characterId);
  }

  /** The server placed the character: draw the world, then uncover it. */
  private async enterWorld(): Promise<void> {
    const name = this.profile?.displayName ?? "";
    let transition = this.host.current instanceof TransitionScreen ? this.host.current : null;
    if (!transition) {
      transition = new TransitionScreen(name, "arriving");
      this.host.show(transition);
    }
    this.closeCreator();
    this.game.setCovered(false);
    await Promise.race([this.game.enterWorld(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    if (this.host.current !== transition) return; // something else (e.g. a disconnect) took over
    transition.arrived(this.game.gameMinute);
    const reduced = prefersReducedMotion();
    await new Promise((resolve) => setTimeout(resolve, reduced ? 250 : 800));
    if (this.host.current !== transition) return;
    if (!reduced) {
      transition.element.dataset.phase = "out";
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (this.host.current !== transition) return;
    }
    this.host.clear();
  }

  // ── Pending requests ──────────────────────────────────────────────────

  private setPending(pending: Pending): void {
    this.pending = pending;
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => this.onPendingTimeout(), PENDING_TIMEOUT_MS);
  }

  private takePending(): Pending | null {
    const pending = this.pending;
    this.pending = null;
    window.clearTimeout(this.pendingTimer);
    return pending;
  }

  private onPendingTimeout(): void {
    const pending = this.takePending();
    if (!pending || this.signedInElsewhere) return;
    const text = "The server didn't answer. Please try again.";
    if (pending.kind === "create" || pending.kind === "edit-lobby" || pending.kind === "edit-world") this.creator?.setError(text);
    else if (pending.kind === "delete" || pending.kind === "delete-profile") this.dialog?.setError(text);
    else if (pending.kind === "enter") this.showTitle(text);
    else if (pending.kind === "leave") {
      this.game.setCovered(false);
      this.host.clear();
      this.hud.toast(text);
    }
  }
}
