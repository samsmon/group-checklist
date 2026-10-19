'use strict';

const _projectMethods = {

  async loadProjects() {
    if (!this.user) return;
    try {
      this.projects = await api('GET', '/api/projects');
    } catch (e) {
      this.showToast('Failed to load projects: ' + e.message, 'error');
    }
  },

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
      this.showToast(e.message === 'access denied' ? 'This project is private.' : e.message, 'error');
      this.activeProject = null;
      this.items = [];
    }
  },

  async createProject() {
    this.modalError = '';
    if (!this.createProjectForm.name.trim()) {
      this.modalError = 'Project name is required.';
      return;
    }
    try {
      const project = await api('POST', '/api/projects', this.createProjectForm);
      this.projects.unshift({ ...project });
      this.closeModal();
      this.createProjectForm = { name: '', visibility: 'private' };
      this.selectProject(project.slug);
    } catch (e) {
      this.modalError = e.message;
    }
  },

  async toggleVisibility() {
    if (!this.activeProject?.is_owner) return;
    const next = this.activeProject.visibility === 'public' ? 'private' : 'public';
    try {
      const updated = await api('PATCH', `/api/projects/${this.activeProject.slug}`, { visibility: next });
      this.activeProject = { ...this.activeProject, ...updated };
      const idx = this.projects.findIndex(p => p.id === updated.id);
      if (idx !== -1) this.projects[idx].visibility = updated.visibility;
      this.showToast(`Project is now ${updated.visibility}.`);
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  },

  openDeleteProjectModal() {
    this.openModal('deleteProject');
  },

  // Leave the open project and go back to the dashboard
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
      this.projects = this.projects.filter(p => p.id !== project.id);
      this._leaveProject();
      this.showToast('Project deleted.');
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
      if (this.user) this.loadProjects();
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
