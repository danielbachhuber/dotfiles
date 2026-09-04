export function useBrowserDimmingModal(_active: boolean): void {}

/** Host flavor reports live modal state; plugins have none. */
export function useIsBrowserDimmingModalOpen(): boolean {
  return false;
}
