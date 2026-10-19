'use strict';

const _uiMethods = {

  applyTheme() {
    const html = document.documentElement;
    if (this.theme === 'dark') html.setAttribute('data-theme', 'dark');
    else if (this.theme === 'light') html.setAttribute('data-theme', 'light');
    else html.removeAttribute('data-theme');
  },

  toggleTheme() {
    this.theme = this.isDark ? 'light' : 'dark';
    localStorage.setItem('theme', this.theme);
    this.applyTheme();
  },

  saveGuestName() {
    const name = this.guestNameInput.trim();
    if (!name) return;
    this.guestName = name;
    localStorage.setItem('guestName', name);
    this.closeModal();
    if (this.pendingCompleteItem) {
      const item = this.pendingCompleteItem;
      this.pendingCompleteItem = null;
      this.directComplete(item);
    }
  },

  saveGuestNameSilent(name) {
    if (!name || this.user) return;
    this.guestName = name;
    localStorage.setItem('guestName', name);
  },

  openModal(name) {
    this._returnFocus = document.activeElement; // restored when the dialog closes
    this.modal = name;
    this.modalError = '';
    if (name === 'guestName') this.guestNameInput = this.guestName;
    if (name === 'addItem') this.itemForm = { title: '', description: '', actor_name: '', item_type: 'task' };
    if (name === 'import') { this.importError = ''; this.importLoading = false; this.importTab = 'md'; }
    if (name === 'auth') { this.authError = ''; }
    // Focus the first field once the modal is visible
    this.$nextTick(() => {
      const el = document.querySelector('.modal-backdrop:not([style*="display: none"]) .modal input:not([type="file"]), .modal-backdrop:not([style*="display: none"]) .modal textarea');
      if (el) el.focus();
    });
  },

  closeModal() {
    this.modal = null;
    this.modalError = '';
    const back = this._returnFocus;
    this._returnFocus = null;
    if (back && document.body.contains(back)) this.$nextTick(() => back.focus());
  },

  // Keep Tab inside the open dialog (and pull focus in if it escaped)
  trapFocus(e) {
    if (!this.modal) return;
    const backdrop = [...document.querySelectorAll('.modal-backdrop')].find((b) => getComputedStyle(b).display !== 'none');
    const dialog = backdrop?.querySelector('.modal');
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((el) => el.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  },

  skipToList() {
    const el = document.querySelector('.items-wrap, .dash-inner');
    if (!el) return;
    el.setAttribute('tabindex', '-1');
    el.focus();
  },

  // Escape closes the topmost layer: comment popup, project menu, then modal
  handleEscape() {
    if (this.commentPopup.visible) return this.closeCommentPopup();
    if (this.showProjectMenu) { this.showProjectMenu = false; return; }
    if (this.mobileSidebarOpen) { this.mobileSidebarOpen = false; return; }
    if (this.modal) this.closeModal();
  },

  // "2 min ago", "Yesterday", "12 Oct": short and scannable for the dashboard
  relTime(iso) {
    if (!iso) return 'no activity';
    const then = new Date(iso);
    const mins = Math.floor((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' h ago';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },

  allSectionsCollapsed() {
    const sections = this.items.filter(i => i.item_type === 'section');
    return sections.length > 0 && sections.every(s => this.collapsedSections[s.id]);
  },

  // `action` ({ label, run }) adds a button, e.g. Undo, and keeps the toast up longer.
  showToast(msg, type = 'success', action = null) {
    if (this.toast._timer) clearTimeout(this.toast._timer);
    this.toast = { visible: true, msg, type, action, _timer: null };
    this._armToast();
  },

  _armToast() {
    if (this.toast._timer) clearTimeout(this.toast._timer);
    const ms = this.toast.action ? 6000 : 3000;
    this.toast._timer = setTimeout(() => { this.toast.visible = false; }, ms);
  },

  pauseToast() {
    if (this.toast._timer) clearTimeout(this.toast._timer);
  },

  resumeToast() {
    if (this.toast.visible) this._armToast();
  },

  runToastAction() {
    const action = this.toast.action;
    this.pauseToast();
    this.toast.visible = false;
    if (action) action.run();
  },

};
