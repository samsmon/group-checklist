'use strict';

// Naming: in the UI a "project" is a group and a "checklist" is one list. In the API and in most
// variable names the checklist is still called "project" (activeProject, /api/projects). See CLAUDE.md.

const DASH_PAGE = 200;     // dashboard rows per request (the API maximum)
const SIDEBAR_LOOSE = 8;   // ungrouped checklists listed in the sidebar before "N more"

const _projectMethods = {

  // ---- Lists: sidebar, groups, dashboard ----

  async loadProjects() { return this.refreshLists(); }, // older call sites

  async refreshLists() {
    if (!this.user) return;
    await Promise.all([this.loadGroups(), this.loadSidebar(), this.loadDash()]);
  },

  async loadGroups() {
    try {
      this.groups = await api('GET', '/api/groups');
      this.archivedGroups = this.dash.archived ? await api('GET', '/api/groups?archived=1') : [];
    } catch (e) {
      this.showToast('Failed to load projects: ' + e.message, 'error');
    }
  },

  async loadSidebar() {
    try {
      const { rows } = await apiList('/api/projects?limit=200&sort=activity');
      this.projects = rows;
    } catch (e) {
      this.showToast('Failed to load checklists: ' + e.message, 'error');
    }
  },

  _dashQuery(offset) {
    const params = new URLSearchParams({ sort: this.dash.sort, limit: String(DASH_PAGE), offset: String(offset) });
    const q = this.dash.q.trim();
    if (q) params.set('q', q);
    if (this.dash.group !== 'all') params.set('group', this.dash.group);
    if (this.dash.archived) params.set('archived', '1');
    return '/api/projects?' + params;
  },

  // append = true loads the next page; otherwise starts again from the top
  async loadDash(append = false) {
    if (!this.user) return;
    const seq = (this._dashSeq = (this._dashSeq || 0) + 1); // a slow older reply must not overwrite a newer one
    this.dashLoading = true;
    try {
      const { rows, total } = await apiList(this._dashQuery(append ? this.dashRows.length : 0));
      if (seq !== this._dashSeq) return;
      this.dashRows = append ? [...this.dashRows, ...rows] : rows;
      this.dashTotal = total;
    } catch (e) {
      if (seq === this._dashSeq) this.showToast('Failed to load checklists: ' + e.message, 'error');
    } finally {
      if (seq === this._dashSeq) this.dashLoading = false;
    }
  },

  // Active / Archived tabs
  setDashArchived(flag) {
    this.dash = { ...this.dash, archived: flag, group: 'all', q: '' };
    this.loadGroups();
    this.loadDash();
  },

  resetDash() {
    this.dash = { q: '', group: 'all', archived: false, sort: 'activity' };
    this.loadGroups();
    this.loadDash();
  },

  openGroupInDash(group) {
    this.dash = { q: '', group: group === 'none' ? 'none' : group.id, archived: false, sort: this.dash.sort };
    if (this.activeProject) this.goHome(); else { this.loadGroups(); this.loadDash(); }
  },

  // (dashGrouped, dashFiltering and dashGroupName are getters in app.js: object spread would freeze them)
  dashSections() {
    if (!this.dashGrouped) return [{ key: 'flat', group: null, loose: false, rows: this.dashRows }];
    const sections = this.groups.map(g => ({
      key: g.id, group: g, loose: false, rows: this.dashRows.filter(r => r.group_id === g.id),
    }));
    const loose = this.dashRows.filter(r => !r.group_id);
    if (loose.length || this.groups.length === 0) sections.push({ key: 'none', group: null, loose: true, rows: loose });
    return sections;
  },

  pct(done, total) {
    return total > 0 ? Math.round(done / total * 100) : 0;
  },

  // ---- Sidebar helpers ----

  sidebarPinned() { return this.projects.filter(p => p.pinned_at); },
  sidebarGroupRows(g) { return this.projects.filter(p => p.group_id === g.id && !p.pinned_at); },
  sidebarLoose() { return this.projects.filter(p => !p.group_id && !p.pinned_at); },
  sidebarLooseShown() { return this.sidebarLoose().slice(0, SIDEBAR_LOOSE); },
  sidebarLooseMore() { return Math.max(0, this.sidebarLoose().length - SIDEBAR_LOOSE); },

  // A group stays open while it holds the checklist you are looking at
  sidebarGroupOpen(g) {
    return this.openGroups[g.id] === true || this.activeProject?.group_id === g.id;
  },

  toggleSidebarGroup(g) {
    this.openGroups = { ...this.openGroups, [g.id]: !this.sidebarGroupOpen(g) };
    localStorage.setItem('openGroups', JSON.stringify(this.openGroups));
  },

  toggleDashGroup(id) {
    this.closedGroups = { ...this.closedGroups, [id]: !this.closedGroups[id] };
    localStorage.setItem('closedGroups', JSON.stringify(this.closedGroups));
  },

  // ---- Opening a checklist ----

  async selectProject(slug) {
    this.mobileSidebarOpen = false;
    this.mobilePanel = 'items';
    window.location.hash = `#/p/${slug}`;
  },

  async loadProject(slug) {
    try {
      const project = await api('GET', `/api/projects/${slug}`);
      this.activeProject = project;
      this.items = project.items || [];
      this.messages = [];
      this.logsData = [];
      this.rightTab = 'chat';
      this.connectWs(slug);
      this.loadMessages();
      if (project.is_owner) this.loadLogs();
    } catch (e) {
      this.showToast(e.message === 'access denied' ? 'This checklist is private.' : e.message, 'error');
      this.activeProject = null;
      this.items = [];
    }
  },

  // ---- Creating, moving, pinning, archiving checklists ----

  openCreateChecklist(groupId) {
    // Inside a project filter the new checklist starts in that project
    const preset = groupId ?? (this.dash.group !== 'all' && this.dash.group !== 'none' ? this.dash.group : '');
    this.createProjectForm = { name: '', visibility: 'private', group_id: preset || '' };
    this.openModal('createProject');
  },

  async createProject() {
    this.modalError = '';
    if (!this.createProjectForm.name.trim()) {
      this.modalError = 'Checklist name is required.';
      return;
    }
    try {
      const { group_id, ...rest } = this.createProjectForm;
      const project = await api('POST', '/api/projects', { ...rest, group_id: group_id || null });
      this.closeModal();
      this.createProjectForm = { name: '', visibility: 'private', group_id: '' };
      await this.refreshLists();
      this.selectProject(project.slug);
    } catch (e) {
      this.modalError = e.message;
    }
  },

  // PATCH an owner-only field of a checklist and refresh the lists. Returns true on success.
  async patchChecklist(slug, patch) {
    try {
      const updated = await api('PATCH', `/api/projects/${slug}`, patch);
      if (this.activeProject?.slug === slug) this.activeProject = { ...this.activeProject, ...updated };
      await this.refreshLists();
      return true;
    } catch (e) {
      this.showToast(e.message, 'error');
      return false;
    }
  },

  async togglePin(p) {
    const pin = !p.pinned_at;
    if (await this.patchChecklist(p.slug, { pinned: pin })) this.showToast(pin ? 'Pinned.' : 'Unpinned.');
  },

  async toggleArchive(p) {
    const archive = !p.archived_at;
    if (!(await this.patchChecklist(p.slug, { archived: archive }))) return;
    this.showToast(`${archive ? 'Archived' : 'Restored'}: ${this._shortTitle(p.name)}`, 'success', {
      label: 'Undo',
      run: () => this.patchChecklist(p.slug, { archived: !archive }),
    });
  },

  openMove(p) {
    this.moveTarget = p;
    this.moveGroupId = p.group_id || '';
    this.openModal('moveChecklist');
  },

  async submitMove() {
    const target = this.moveTarget;
    if (!target) { this.closeModal(); return; }
    this.modalError = '';
    if (await this.patchChecklist(target.slug, { group_id: this.moveGroupId || null })) {
      this.closeModal();
      this.showToast(this.moveGroupId ? 'Moved to the project.' : 'Removed from its project.');
    }
  },

  async toggleVisibility() {
    if (!this.activeProject?.is_owner) return;
    const next = this.activeProject.visibility === 'public' ? 'private' : 'public';
    if (await this.patchChecklist(this.activeProject.slug, { visibility: next })) {
      this.showToast(`Checklist is now ${next}.`);
    }
  },

  // ---- Groups ("projects") ----

  openCreateGroup() {
    this.groupForm = { id: null, name: '', description: '' };
    this.modalError = '';
    this.openModal('group');
  },

  openEditGroup(g) {
    this.groupForm = { id: g.id, name: g.name, description: g.description || '' };
    this.modalError = '';
    this.openModal('group');
  },

  async submitGroup() {
    this.modalError = '';
    const name = this.groupForm.name.trim();
    if (!name) { this.modalError = 'Project name is required.'; return; }
    const body = { name, description: this.groupForm.description.trim() || null };
    try {
      if (this.groupForm.id) await api('PATCH', `/api/groups/${this.groupForm.id}`, body);
      else await api('POST', '/api/groups', body);
      this.closeModal();
      await this.refreshLists();
      this.showToast(this.groupForm.id ? 'Project saved.' : 'Project created.');
    } catch (e) {
      this.modalError = e.message;
    }
  },

  async setGroupArchived(g, archived) {
    try {
      await api('PATCH', `/api/groups/${g.id}`, { archived });
      if (archived && this.dash.group === g.id) this.dash = { ...this.dash, group: 'all' };
      await this.refreshLists();
      this.showToast(archived ? `Archived project: ${this._shortTitle(g.name)}` : `Restored project: ${this._shortTitle(g.name)}`, 'success', {
        label: 'Undo',
        run: () => this.setGroupArchived(g, !archived),
      });
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  },

  openDeleteGroup(g) {
    this.groupTarget = g;
    this.openModal('deleteGroup');
  },

  async confirmDeleteGroup() {
    const g = this.groupTarget;
    if (!g) { this.closeModal(); return; }
    try {
      const res = await api('DELETE', `/api/groups/${g.id}`);
      if (this.dash.group === g.id) this.dash = { ...this.dash, group: 'all' };
      await this.refreshLists();
      this.showToast(res.ungrouped ? `Project deleted. ${res.ungrouped} checklist${res.ungrouped !== 1 ? 's' : ''} kept.` : 'Project deleted.');
    } catch (e) {
      this.showToast(e.message, 'error');
    } finally {
      this.groupTarget = null;
      this.closeModal();
    }
  },

  // ---- Deleting a checklist ----

  openDeleteProjectModal() {
    this.openModal('deleteProject');
  },

  // Leave the open checklist and go back to the dashboard
  _leaveProject() {
    this.activeProject = null;
    this.items = [];
    this.messages = [];
    this.logsData = [];
    this.disconnectWs();
    window.location.hash = '';
  },

  async confirmDeleteProject() {
    // The WebSocket "project.deleted" event can arrive before this request resolves and clear
    // activeProject, so work from a local copy and always close the dialog.
    const project = this.activeProject;
    if (!project) { this.closeModal(); return; }
    this._deletingSlug = project.slug; // lets the WebSocket handlers skip their own "deleted" notice
    try {
      await api('DELETE', `/api/projects/${project.slug}`);
      this._leaveProject();
      this.showToast('Checklist deleted.');
      this.refreshLists();
    } catch (e) {
      this.showToast(e.message, 'error');
    } finally {
      this._deletingSlug = null;
      this.closeModal();
    }
  },

  goHome() {
    this.mobileSidebarOpen = false;
    if (window.location.hash && window.location.hash !== '#') {
      window.location.hash = '';
    } else {
      this.activeProject = null;
      this.items = [];
      this.messages = [];
      this.logsData = [];
      this.disconnectWs();
      if (this.user) this.refreshLists();
    }
  },

  toggleViewMode() {
    this.viewMode = this.viewMode === 'tree' ? 'flat' : 'tree';
    localStorage.setItem('viewMode', this.viewMode);
  },

  copyLink() {
    const url = `${location.origin}/#/p/${this.activeProject.slug}`;
    navigator.clipboard.writeText(url).then(() => this.showToast('Link copied!'));
  },

};
