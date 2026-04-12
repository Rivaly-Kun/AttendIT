/* =========================================================
   AttendIT — Shared Application State
   ========================================================= */

const state = {
  currentUser: null,
  currentRole: null,
  currentUserData: null,
  qrInterval: null,
  html5QrScanner: null,
  monitorUnsub: null,
  activeListeners: [],
};

export default state;

export function cleanup() {
  if (state.monitorUnsub) {
    try {
      state.monitorUnsub();
    } catch (e) {
      /* ignore */
    }
    state.monitorUnsub = null;
  }

  state.activeListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      /* ignore */
    }
  });
  state.activeListeners = [];

  if (state.qrInterval) {
    clearInterval(state.qrInterval);
    state.qrInterval = null;
  }

  if (state.html5QrScanner) {
    try {
      state.html5QrScanner.stop();
    } catch (e) {
      /* ignore */
    }
    state.html5QrScanner = null;
  }
}
