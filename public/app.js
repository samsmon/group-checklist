'use strict';

// Modules (load order must match script tags in index.html):
// js/api.js      → api()
// js/modals.js   → _modalHTML
// js/auth.js     → _authMethods
// js/projects.js → _projectMethods
// js/ui.js       → _uiMethods
// js/chat.js     → _chatMethods
// js/items.js    → _itemMethods
// js/ws.js       → _wsMethods
// js/export.js   → _exportMethods

document.addEventListener('alpine:init', () => {
  // Inject modal/popup/toast HTML before Alpine scans the DOM
  const modalsMount = document.getElementById('modals-mount');
  if (modalsMount && typeof _modalHTML !== 'undefined') {
    modalsMount.innerHTML = _modalHTML;
  }

  Alpine.data('app', () => ({

    // ---- State ----
    loading: true,
    user: null,
    guestName: '',
    guestNameInput: '',

    sidebarOpen: true,
    mobileSidebarOpen: false,
    mobilePanel: 'items',

    authMode: 'login',
    authForm: { username: '', password: '' },
    authError: '',
    authLoading: false,

    projects: [],
    activeProject: null,
    items: [],

    modal: null,
    modalError: '',

    createProjectForm: { name: '', visibility: 'private' },
    itemForm: { title: '', description: '', actor_name: '', item_type: 'task' },
    editingItem: null,
    completeForm: { done_by_name: '', notes: '' },
    completingItem: null,
    pendingCompleteItem: null,
    picForm: { name: '', actor_name: '' },
    picTargetItem: null,
    deleteItemTarget: null,

    commentPopup: { visible: false, item: null, comments: [], loading: false, input: '', top: 0, left: 0 },

    importError: '',
    importLoading: false,
    importTab: 'md',

    quickAddText: '',
    quickAddBusy: false,

    draggingIndex: null,
    dragOverIndex: null,

    viewMode: localStorage.getItem('viewMode') || 'tree',
    deleteMode: false,
    selectedItems: {},
    collapsedSections: {},
    sectionMap: {},
    showProjectMenu: false,

    nonOwnerAssignMode: null,
    nonOwnerAssignItem: null,
    nonOwnerAssignInput: '',
    nonOwnerAssignError: '',

    rightTab: 'chat',
    messages: [],
    messagesLoading: false,
    messageInput: '',
    logsData: [],
    logsLoading: false,

    theme: localStorage.getItem('theme') || 'system',
    get isDark() {
      if (this.theme === 'dark') return true;
      if (this.theme === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    ws: null,
    wsSlug: null,
    wsOffline: false,
    toast: { visible: false, msg: '', type: 'success', action: null, _timer: null },

    // ---- Init ----
    async init() {
      this.guestName = localStorage.getItem('guestName') || '';
      this.sidebarOpen = localStorage.getItem('sidebarOpen') !== 'false';
      this.applyTheme();
      this.$watch('sidebarOpen', (v) => localStorage.setItem('sidebarOpen', String(v)));
      this.$watch('items', () => { this.sectionMap = this._buildSectionMap(); });
      this.$watch('activeProject', (p) => {
        document.title = p ? `${p.name} · Group Checklist` : 'Group Checklist';
      });
      try {
        this.user = await api('GET', '/api/auth/me');
      } catch {
        this.user = null;
      }
      window.addEventListener('hashchange', () => this.handleRoute());
      // Coming back to a tab that sat in the background: catch up and reconnect if needed
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !this.activeProject) return;
        this.refreshItems();
        if (this.wsSlug && this.ws?.readyState !== WebSocket.OPEN) this.connectWs(this.wsSlug);
      });
      await this.handleRoute();
      this.loading = false;
    },

    // ---- Routing ----
    async handleRoute() {
      const hash = window.location.hash;
      const match = hash.match(/^#\/p\/([a-z0-9]+)$/);
      if (match) {
        if (this.user) await this.loadProjects();
        await this.loadProject(match[1]);
      } else {
        this.activeProject = null;
        this.items = [];
        this.messages = [];
        this.logsData = [];
        this.disconnectWs();
        if (this.user) await this.loadProjects();
      }
    },

    get taskItems() {
      return this.items.filter(i => i.item_type !== 'section');
    },
    get doneCount() {
      return this.taskItems.filter(i => i.completion).length;
    },
    get progressPct() {
      const total = this.taskItems.length;
      return total ? Math.round(this.doneCount / total * 100) : 0;
    },

    // ---- Spread methods from separate files ----
    ..._authMethods,
    ..._projectMethods,
    ..._uiMethods,
    ..._chatMethods,
    ..._itemMethods,
    ..._wsMethods,
    ..._exportMethods,

  }));
});
