// One input layer for mouse, keyboard and touch. It only interprets gestures
// ("tap at this screen point", "rotate camera", "walk forward-left") and never
// touches game state, so the same gameplay code serves every device.
//
// Gesture rules:
//   - A pointer that goes down and up without moving more than TAP_SLOP_PX
//     within TAP_MAX_MS is a tap (select / walk). Anything else is a drag.
//   - One-pointer drag rotates the camera (mouse: any button).
//   - Two pointers pinch to zoom; a pinch never produces a tap.
//   - The joystick element captures its own pointers, so it never rotates the
//     camera or triggers taps.

export interface InputHandlers {
  onTap(clientX: number, clientY: number): void;
  /** Mouse moved with no button pressed (desktop hover). Null when the pointer leaves. */
  onHover(clientX: number | null, clientY: number | null): void;
  /** Escape key: close a menu or cancel the current action. */
  onCancel(): void;
  onRotate(deltaX: number, deltaY: number): void;
  onZoom(factor: number): void;
  /** Movement relative to the camera: forward and right in [-1, 1]. */
  onMoveInput(forward: number, right: number): void;
}

const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 450;

interface TrackedPointer {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  dragging: boolean;
}

export class InputController {
  private readonly pointers = new Map<number, TrackedPointer>();
  private pinchDistance = 0;
  private gestureHadMultiplePointers = false;
  private readonly keys = new Set<string>();
  private keyboardVector = { forward: 0, right: 0 };
  private joystickVector = { forward: 0, right: 0 };
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly joystick: HTMLElement,
    private readonly handlers: InputHandlers,
  ) {
    this.listen(surface, "pointerdown", (e) => this.onPointerDown(e as PointerEvent));
    this.listen(surface, "pointermove", (e) => this.onPointerMove(e as PointerEvent));
    this.listen(surface, "pointerup", (e) => this.onPointerUp(e as PointerEvent));
    this.listen(surface, "pointercancel", (e) => this.onPointerCancel(e as PointerEvent));
    this.listen(surface, "pointerleave", (e) => {
      if ((e as PointerEvent).pointerType === "mouse") this.handlers.onHover(null, null);
    });
    this.listen(surface, "wheel", (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.listen(surface, "contextmenu", (e) => e.preventDefault());
    this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, "keyup", (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, "blur", () => this.releaseAllKeys());
    // iOS Safari pinch-zoom of the page itself.
    this.listen(document, "gesturestart", (e) => e.preventDefault());
    this.setupJoystick();
  }

  dispose(): void {
    for (const off of this.cleanup) off();
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  private onPointerDown(e: PointerEvent): void {
    this.surface.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      startTime: performance.now(),
      dragging: false,
    });
    if (this.pointers.size === 1) this.gestureHadMultiplePointers = false;
    if (this.pointers.size >= 2) {
      this.gestureHadMultiplePointers = true;
      this.pinchDistance = this.currentPinchDistance();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) {
      // A mouse moving with no button held is hovering. Touch has no hover.
      if (e.pointerType === "mouse" && e.buttons === 0) this.handlers.onHover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - pointer.lastX;
    const dy = e.clientY - pointer.lastY;
    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;

    if (this.pointers.size >= 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0 && distance > 0) this.handlers.onZoom(this.pinchDistance / distance);
      this.pinchDistance = distance;
      return;
    }

    if (!pointer.dragging && Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > TAP_SLOP_PX) {
      pointer.dragging = true;
    }
    if (pointer.dragging) this.handlers.onRotate(dx, dy);
  }

  private onPointerUp(e: PointerEvent): void {
    const pointer = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!pointer) return;
    const isTap =
      !pointer.dragging &&
      !this.gestureHadMultiplePointers &&
      performance.now() - pointer.startTime < TAP_MAX_MS &&
      (e.pointerType !== "mouse" || e.button === 0);
    if (isTap) this.handlers.onTap(e.clientX, e.clientY);
    if (this.pointers.size < 2) this.pinchDistance = 0;
  }

  private onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.handlers.onZoom(Math.exp(e.deltaY * 0.0012));
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY) : 0;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const code = e.code;
    if (code === "Escape") {
      if (down) this.handlers.onCancel();
      return;
    }
    if (!MOVE_KEYS.has(code)) return;
    e.preventDefault();
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    const forward = (this.anyKey("KeyW", "ArrowUp") ? 1 : 0) - (this.anyKey("KeyS", "ArrowDown") ? 1 : 0);
    const right = (this.anyKey("KeyD", "ArrowRight") ? 1 : 0) - (this.anyKey("KeyA", "ArrowLeft") ? 1 : 0);
    if (forward !== this.keyboardVector.forward || right !== this.keyboardVector.right) {
      this.keyboardVector = { forward, right };
      this.emitMove();
    }
  }

  private anyKey(...codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  private releaseAllKeys(): void {
    this.keys.clear();
    if (this.keyboardVector.forward !== 0 || this.keyboardVector.right !== 0) {
      this.keyboardVector = { forward: 0, right: 0 };
      this.emitMove();
    }
  }

  private emitMove(): void {
    const forward = this.keyboardVector.forward + this.joystickVector.forward;
    const right = this.keyboardVector.right + this.joystickVector.right;
    this.handlers.onMoveInput(clampUnit(forward), clampUnit(right));
  }

  private setupJoystick(): void {
    const isTouch = window.matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).has("joystick");
    this.joystick.hidden = !isTouch;
    if (!isTouch) return;
    const knob = this.joystick.querySelector<HTMLElement>(".joystick-knob");
    let activePointer: number | null = null;

    const update = (e: PointerEvent) => {
      const rect = this.joystick.getBoundingClientRect();
      const radius = rect.width / 2;
      let dx = (e.clientX - (rect.left + radius)) / radius;
      let dy = (e.clientY - (rect.top + radius)) / radius;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      const deadZone = Math.hypot(dx, dy) < 0.15;
      this.joystickVector = deadZone ? { forward: 0, right: 0 } : { forward: -dy, right: dx };
      if (knob) knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
      this.emitMove();
    };
    const release = () => {
      activePointer = null;
      this.joystickVector = { forward: 0, right: 0 };
      if (knob) knob.style.transform = "";
      this.emitMove();
    };

    this.listen(this.joystick, "pointerdown", (event) => {
      const e = event as PointerEvent;
      e.stopPropagation();
      if (activePointer !== null) return;
      activePointer = e.pointerId;
      this.joystick.setPointerCapture(e.pointerId);
      update(e);
    });
    this.listen(this.joystick, "pointermove", (event) => {
      const e = event as PointerEvent;
      if (e.pointerId === activePointer) update(e);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.listen(this.joystick, type, (event) => {
        if ((event as PointerEvent).pointerId === activePointer) release();
      });
    }
  }
}

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
