// Desktop detail panel focus, shared by agent and data source panels: on open, focus moves to
// the panel heading and the element that opened it is remembered; on close, focus goes back to
// it (or, if it re-rendered away, to the card with the same data-open-id). Pure apart from the
// env callbacks, so it is tested without a DOM. On phones the Sheet traps and restores focus.

export type Focusable = { focus: (options?: FocusOptions) => void; isConnected: boolean };

export type PanelFocusState<T extends Focusable> = { returnTo: T | null; openId: string | null };

export type PanelFocusEnv<T extends Focusable> = {
  /** document.activeElement, when it is focusable. */
  active: T | null;
  inPanel: (el: T) => boolean;
  focusHeading: () => void;
  /** The card that opens `id` ([data-open-id]). */
  opener: (id: string) => T | null;
};

export function panelFocus<T extends Focusable>(
  state: PanelFocusState<T>,
  selected: string | null,
  env: PanelFocusEnv<T>,
): PanelFocusState<T> {
  if (selected) {
    const returnTo = env.active && !env.inPanel(env.active) ? env.active : state.returnTo;
    env.focusHeading();
    return { returnTo, openId: selected };
  }
  if (!state.openId) return { returnTo: null, openId: null };
  const back = state.returnTo?.isConnected ? state.returnTo : env.opener(state.openId);
  back?.focus({ preventScroll: true });
  return { returnTo: null, openId: null };
}
